// ============================================================
// COMPRESS LOGIC - RECALIBRACIÓN FINA (~12%, ~45%, ~95%)
// ============================================================
let compressFile = null;
const dropZoneCompress = document.getElementById('dropZoneCompress');
const fileInputCompress = document.getElementById('fileInputCompress');
const compressBtn = document.getElementById('compressBtn');

if (dropZoneCompress && fileInputCompress && compressBtn) {

    // Prevenir comportamientos por defecto del navegador en drag & drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZoneCompress.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZoneCompress.addEventListener(eventName, () => {
            dropZoneCompress.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZoneCompress.addEventListener(eventName, () => {
            dropZoneCompress.classList.remove('dragover');
        }, false);
    });

    // Manejar arrastre e inserción de archivos
    dropZoneCompress.addEventListener('drop', e => {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files && files.length > 0) {
            const file = files[0];
            if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
                compressFile = file;
                const pText = dropZoneCompress.querySelector('p');
                if (pText) pText.textContent = `📄 ${compressFile.name}`;
                
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(compressFile);
                fileInputCompress.files = dataTransfer.files;
            } else {
                alert('Por favor, selecciona un archivo PDF válido.');
            }
        }
    });

    // Clic convencional para selección
    dropZoneCompress.addEventListener('click', () => fileInputCompress.click());

    fileInputCompress.addEventListener('change', e => {
        if (e.target.files.length > 0) {
            compressFile = e.target.files[0];
            const pText = dropZoneCompress.querySelector('p');
            if (pText) pText.textContent = `📄 ${compressFile.name}`;
        }
    });

    // Proceso de compresión en el cliente
    compressBtn.addEventListener('click', async () => {
        if (!compressFile) { 
            alert('Selecciona un PDF para comprimir'); 
            return; 
        }

        compressBtn.disabled = true;
        showLoading(true);
        showStatus('compressStatus', '⏳ Inicializando motor PDF...');

        try {
            const selectedRadio = document.querySelector('input[name="compressLevel"]:checked');
            const level = selectedRadio ? selectedRadio.value : 'recommended';

            showStatus('compressStatus', '⏳ Procesando optimización...');

            const arrayBuffer = await readFileAsArrayBuffer(compressFile);
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const totalPages = pdf.numPages;

            // Parámetros afinados según los últimos resultados del test:
            // Extreme: 750px / quality 0.42  -> Ajusta del 23% hacia el ~12%
            // Recommended: 1800px / quality 0.84 -> Ajusta del 33% hacia el ~45%
            // Low: Render escala 2.0x / quality 0.98 -> Ajusta del 90% hacia el ~95%
            let maxDimension, quality, forceOriginalScale;
            switch (level) {
                case 'extreme': 
                    maxDimension = 750; 
                    quality = 0.42; 
                    forceOriginalScale = false;
                    break;
                case 'recommended': 
                    maxDimension = 1800; 
                    quality = 0.84; 
                    forceOriginalScale = false;
                    break;
                case 'low': 
                    maxDimension = 3200; 
                    quality = 0.98; 
                    forceOriginalScale = true;
                    break;
                default: 
                    maxDimension = 1800; 
                    quality = 0.84;
                    forceOriginalScale = false;
            }

            const images = [];

            for (let i = 1; i <= totalPages; i++) {
                showStatus('compressStatus', `⏳ Procesando página ${i} de ${totalPages}...`);
                const page = await pdf.getPage(i);
                
                let scale = 1.5;
                const unscaledViewport = page.getViewport({ scale: 1.0 });

                if (!forceOriginalScale) {
                    const currentMax = Math.max(unscaledViewport.width, unscaledViewport.height);
                    if (currentMax > maxDimension) {
                        scale = maxDimension / currentMax;
                    }
                } else {
                    scale = 2.0; 
                }

                const viewport = page.getViewport({ scale });
                const canvas = document.createElement('canvas');
                canvas.width = Math.floor(viewport.width);
                canvas.height = Math.floor(viewport.height);
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                await page.render({ canvasContext: ctx, viewport }).promise;

                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                images.push(dataUrl);
            }

            showStatus('compressStatus', '⏳ Generando documento comprimido...');

            const resp = await fetch('/compress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ images, level })
            });

            if (!resp.ok) throw new Error(await resp.text());

            const blob = await resp.blob();
            downloadFile(blob, `compressed_${level}.pdf`);

            showStatus('compressStatus', '✅ PDF comprimido correctamente');
        } catch (err) {
            showStatus('compressStatus', '❌ ' + err.message, true);
        } finally {
            compressBtn.disabled = false;
            showLoading(false);
        }
    });
}
