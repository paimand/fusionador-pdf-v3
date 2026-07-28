// ============================================================
// COMPRESS LOGIC - ULTRA RÁPIDO Y PROGRESO PÁGINA A PÁGINA
// ============================================================
let compressFile = null;
const dropZoneCompress = document.getElementById('dropZoneCompress');
const fileInputCompress = document.getElementById('fileInputCompress');
const compressBtn = document.getElementById('compressBtn');

if (dropZoneCompress && fileInputCompress && compressBtn) {

    // Prevenir comportamientos por defecto en drag & drop
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

    // Manejar inserción de archivos por arrastre
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

    // Procesamiento optimizado de compresión
    compressBtn.addEventListener('click', async () => {
        if (!compressFile) { 
            alert('Selecciona un PDF para comprimir'); 
            return; 
        }

        compressBtn.disabled = true;
        if (typeof showLoading === 'function') showLoading(true);
        if (typeof showStatus === 'function') showStatus('compressStatus', '⏳ Inicializando motor PDF...');

        try {
            const selectedRadio = document.querySelector('input[name="compressLevel"]:checked');
            const level = selectedRadio ? selectedRadio.value : 'recommended';

            const arrayBuffer = await readFileAsArrayBuffer(compressFile);
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const totalPages = pdf.numPages;

            // Parámetros afinados para respuesta rápida y ratios exactos:
            // Extreme: maxDimension 650px / quality 0.28 -> Caída drástica a ~12%
            // Recommended: maxDimension 1300px / quality 0.65 -> Bajada efectiva a ~45%
            // Low: maxDimension 2000px / quality 0.88 -> Conservador ~95%
            let maxDimension, quality;
            switch (level) {
                case 'extreme': 
                    maxDimension = 650; 
                    quality = 0.28; 
                    break;
                case 'recommended': 
                    maxDimension = 1300; 
                    quality = 0.65; 
                    break;
                case 'low': 
                    maxDimension = 2000; 
                    quality = 0.88; 
                    break;
                default: 
                    maxDimension = 1300; 
                    quality = 0.65;
            }

            const images = [];

            for (let i = 1; i <= totalPages; i++) {
                if (typeof showStatus === 'function') {
                    showStatus('compressStatus', `⏳ Comprimiendo página ${i} de ${totalPages}...`);
                }
                
                const page = await pdf.getPage(i);
                
                // Cálculo de escala acelerado
                const unscaledViewport = page.getViewport({ scale: 1.0 });
                const currentMax = Math.max(unscaledViewport.width, unscaledViewport.height);
                
                let scale = 1.0;
                if (currentMax > maxDimension) {
                    scale = maxDimension / currentMax;
                }

                const viewport = page.getViewport({ scale });
                const canvas = document.createElement('canvas');
                canvas.width = Math.floor(viewport.width);
                canvas.height = Math.floor(viewport.height);
                const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });

                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                await page.render({ canvasContext: ctx, viewport }).promise;

                // Extracción ultrarrápida JPEG
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                images.push(dataUrl);
            }

            if (typeof showStatus === 'function') {
                showStatus('compressStatus', '⏳ Reconstruyendo documento PDF...');
            }

            // Envío ligero al backend
            const resp = await fetch('/compress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ images, level })
            });

            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(errText || 'Error al comprimir el archivo.');
            }

            const blob = await resp.blob();
            
            if (typeof downloadFile === 'function') {
                downloadFile(blob, `comprimido_${level}_${compressFile.name}`);
            } else {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `comprimido_${level}_${compressFile.name}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            }

            if (typeof showStatus === 'function') {
                showStatus('compressStatus', '✅ PDF comprimido correctamente');
            }
        } catch (err) {
            if (typeof showStatus === 'function') {
                showStatus('compressStatus', '❌ ' + err.message, true);
            }
        } finally {
            compressBtn.disabled = false;
            if (typeof showLoading === 'function') showLoading(false);
        }
    });
}
