// ============================================================
// CARGA DINÁMICA DE PDF.JS Y FUNCIONES AUXILIARES
// ============================================================
async function ensurePdfJsLoaded() {
    if (typeof pdfjsLib === 'undefined') {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('No se pudo cargar la librería PDF.js'));
            document.head.appendChild(script);
        });
    }
    if (pdfjsLib && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
}

function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e.target.error);
        reader.readAsArrayBuffer(file);
    });
}

function showLoading(show) {
    const loadingEl = document.getElementById('loading');
    if (loadingEl) loadingEl.style.display = show ? 'block' : 'none';
}

function showStatus(elementId, message, isError = false) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = message;
        el.style.color = isError ? '#d32f2f' : '#1d1d1f';
    }
}

// ============================================================
// LÓGICA DE COMPRESIÓN
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
            await ensurePdfJsLoaded();

            const selectedRadio = document.querySelector('input[name="compressLevel"]:checked');
            const level = selectedRadio ? selectedRadio.value : 'recommended';

            showStatus('compressStatus', '⏳ Procesando optimización...');

            const arrayBuffer = await readFileAsArrayBuffer(compressFile);
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const totalPages = pdf.numPages;

            let maxDimension, quality;
            switch (level) {
                case 'extreme': maxDimension = 800; quality = 0.5; break;
                case 'recommended': maxDimension = 1200; quality = 0.7; break;
                case 'low': maxDimension = 1800; quality = 0.85; break;
                default: maxDimension = 1200; quality = 0.7;
            }

            const images = [];

            for (let i = 1; i <= totalPages; i++) {
                showStatus('compressStatus', `⏳ Procesando página ${i} de ${totalPages}...`);
                const page = await pdf.getPage(i);
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
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `compressed_${level}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showStatus('compressStatus', '✅ PDF comprimido correctamente');
        } catch (err) {
            showStatus('compressStatus', '❌ ' + err.message, true);
        } finally {
            compressBtn.disabled = false;
            showLoading(false);
        }
    });
}
