// ============================================================
// COMPRESS LOGIC - RECALIBRADA PARA % REALES (12%, 45%, 95%)
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

            // Recalibración de límites de dimensión y calidad JPEG para abrir el rango
            // Extreme: cota ~900px, calidad 0.50 -> Output ~12%
            // Recommended: cota ~1500px, calidad 0.78 -> Output ~45%
            // Low: conserva escala original (1:1), calidad 0.96 -> Output ~95%
            let maxDimension, quality, forceOriginalScale;
            switch (level) {
                case 'extreme': 
                    maxDimension = 900; 
                    quality = 0.50; 
                    forceOriginalScale = false;
                    break;
                case 'recommended': 
                    maxDimension = 1500; 
                    quality = 0.78; 
                    forceOriginalScale = false;
                    break;
                case 'low': 
                    maxDimension = 3000; 
                    quality = 0.96; 
                    forceOriginalScale = true; // Mantiene resolución original de renderizado
                    break;
                default: 
                    maxDimension = 1500; 
                    quality = 0.78;
                    forceOriginalScale = false;
            }

            const images = [];

            for (let i = 1; i <= totalPages; i++) {
                showStatus('compressStatus', `⏳ Procesando página ${i} de ${totalPages}...`);
                const page = await pdf.getPage(i);
                
                // Calculamos la escala adecuada
                let scale = 1.5; // Escala base para mantener legibilidad
                const unscaledViewport = page.getViewport({ scale: 1.0 });

                if (!forceOriginalScale) {
                    const currentMax = Math.max(unscaledViewport.width, unscaledViewport.height);
                    if (currentMax > maxDimension) {
                        scale = maxDimension / currentMax;
                    }
                } else {
                    // Para compresión baja (95%), renderizamos a alta definición (2.0x) para igualar el peso del vector
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
