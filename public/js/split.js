pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let splitFile = null;
let splitSelections = [];

const splitBtn = document.getElementById('splitBtn');
const splitRangesInput = document.getElementById('splitRanges');
const splitRangesContainer = document.getElementById('splitRangesContainer');
const splitPreview = document.getElementById('splitPreview');
const gridContainer = document.getElementById('splitPageGrid');

// Cambio de modo de división (Páginas individuales vs Rangos)
document.querySelectorAll('input[name="splitMode"]').forEach(radio => {
    radio.addEventListener('change', () => {
        const isRanges = radio.value === 'ranges';
        if (splitRangesContainer) splitRangesContainer.style.display = isRanges ? 'block' : 'none';
        if (splitPreview) splitPreview.style.display = (isRanges || !splitFile) ? 'none' : 'block';
    });
});

// Inicializar Drag & Drop con setupDropZone de common.js
if (typeof setupDropZone === 'function') {
    setupDropZone('dropZoneSplit', 'fileInputSplit', files => {
        if (files && files[0]) {
            splitFile = files[0];
            const dropText = document.querySelector('#dropZoneSplit p');
            if (dropText) dropText.textContent = `📄 ${splitFile.name}`;
            loadAndRenderPdf(splitFile);
        }
    });
}

// Cargar PDF y renderizar cuadrícula de previsualización
async function loadAndRenderPdf(file) {
    if (!gridContainer) return;

    gridContainer.innerHTML = '<p style="font-size:0.9rem; color:#6b7280;">Cargando miniaturas...</p>';
    if (splitPreview) splitPreview.style.display = 'block';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdfDoc.numPages;

        splitSelections = new Array(numPages).fill(true);
        gridContainer.innerHTML = '';

        for (let i = 1; i <= numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: 0.25 });

            const card = document.createElement('div');
            card.className = 'page-card selected';
            card.dataset.pageIndex = i - 1;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            const label = document.createElement('span');
            label.textContent = `Pág. ${i}`;

            card.appendChild(canvas);
            card.appendChild(label);

            card.addEventListener('click', () => {
                const idx = parseInt(card.dataset.pageIndex, 10);
                splitSelections[idx] = !splitSelections[idx];
                card.classList.toggle('selected', splitSelections[idx]);
            });

            gridContainer.appendChild(card);
        }
    } catch (err) {
        console.error('Error al generar miniaturas:', err);
        gridContainer.innerHTML = '<p style="color:red;">Error al cargar las miniaturas del PDF.</p>';
    }
}

// Selección masiva
const selectAllBtn = document.getElementById('splitSelectAll');
if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
        splitSelections.fill(true);
        document.querySelectorAll('.page-card').forEach(card => card.classList.add('selected'));
    });
}

const deselectAllBtn = document.getElementById('splitDeselectAll');
if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', () => {
        splitSelections.fill(false);
        document.querySelectorAll('.page-card').forEach(card => card.classList.remove('selected'));
    });
}

// Procesar envío al Backend (/split)
if (splitBtn) {
    splitBtn.addEventListener('click', async () => {
        if (!splitFile) { 
            alert('Primero selecciona un PDF'); 
            return; 
        }

        const modeRadio = document.querySelector('input[name="splitMode"]:checked');
        const mode = modeRadio ? modeRadio.value : 'individual';
        let pagesToSend = '';

        if (mode === 'individual') {
            const selectedIndices = splitSelections
                .map((sel, idx) => sel ? idx + 1 : null)
                .filter(v => v !== null);

            if (selectedIndices.length === 0) { 
                alert('Selecciona al menos una página'); 
                return; 
            }
            pagesToSend = selectedIndices.join(',');
        } else {
            pagesToSend = splitRangesInput ? splitRangesInput.value.trim() : '';
            if (!pagesToSend) { 
                alert('Introduce rangos válidos (Ej: 1, 3-5)'); 
                return; 
            }
        }

        splitBtn.disabled = true;
        if (typeof showLoading === 'function') showLoading(true);

        try {
            const formData = new FormData();
            formData.append('file', splitFile);
            formData.append('mode', mode);
            formData.append('ranges', pagesToSend);

            const resp = await fetch('/split', { 
                method: 'POST', 
                body: formData 
            });

            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(errText);
            }

            // Detección dinámica del tipo de archivo devuelto
            const contentType = resp.headers.get('content-type') || '';
            const isZip = contentType.includes('application/zip');
            
            // Si el servidor envía un solo PDF o un ZIP con múltiples páginas
            const defaultFilename = isZip ? 'paginas_extraidas.zip' : 'documento_extraido.pdf';

            const blob = await resp.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = defaultFilename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            if (typeof showStatus === 'function') {
                showStatus('splitStatus', '✅ Extracción / División completada');
            }
        } catch (err) {
            if (typeof showStatus === 'function') {
                showStatus('splitStatus', '❌ ' + err.message, true);
            } else {
                alert('Error: ' + err.message);
            }
        } finally {
            splitBtn.disabled = false;
            if (typeof showLoading === 'function') showLoading(false);
        }
    });
}
