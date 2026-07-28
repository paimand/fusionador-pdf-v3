// ============================================================
// COMPRESS LOGIC - REAJUSTE DE LÍMITES (~12%, ~45%, ~95%)
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

            // Parámetros reajustados:
            // Extreme: 820px / quality 0.46 -> Subir del 7% al ~12%
            // Recommended: 2100px / quality 0.87 -> Subir del 38% al ~45%
            // Low: Escala nativa (1.33x) / quality 0.88 -> Reducir al ~95% sin sobrepasar el peso original
            let maxDimension, quality, targetScale;
            switch (level) {
                case 'extreme': 
                    maxDimension = 820; 
                    quality = 0.46; 
                    targetScale = null;
                    break;
                case 'recommended': 
                    maxDimension = 2100; 
                    quality = 0.87; 
                    targetScale = null;
                    break;
                case 'low': 
                    maxDimension = 2600; 
                    quality = 0.88; 
                    targetScale = 1.33; // Escala moderada sin engordar el documento
                    break;
                default: 
                    maxDimension = 2100; 
                    quality = 0.87;
                    targetScale = null;
            }

            const images = [];

            for (let i = 1; i <= totalPages; i++) {
                showStatus('compressStatus', `⏳ Procesando página ${i} de ${totalPages}...`);
                const page = await pdf.getPage(i);
                
                const unscaledViewport = page.getViewport({ scale: 1.0 });
                const currentMax = Math.max(unscaledViewport.width, unscaledViewport.height);
                
                let scale = targetScale || 1.5;

                if (!targetScale && currentMax > maxDimension) {
                    scale = maxDimension / currentMax;
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
