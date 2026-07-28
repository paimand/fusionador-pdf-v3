// ============================================================
// CONFIGURACIÓN DE PDF.JS
// ============================================================
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ============================================================
// FUNCIONES AUXILIARES GLOBALES
// ============================================================
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e.target.error);
        reader.readAsArrayBuffer(file);
    });
}

function showLoading(show) {
    const el = document.getElementById('loading');
    if (el) el.style.display = show ? 'block' : 'none';
}

function showStatus(elementId, message, isError = false) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = message;
        el.style.color = isError ? '#d32f2f' : '#1d1d1f';
    }
}

function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function setupDropZone(zoneId, inputId, onFilesSelected) {
    const dropZone = document.getElementById(zoneId);
    const fileInput = document.getElementById(inputId);
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            onFilesSelected(e.dataTransfer.files);
        }
    });
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => {
        if (e.target.files && e.target.files.length > 0) {
            onFilesSelected(e.target.files);
        }
    });
}

async function renderThumbnail(file, canvas, pageNum = 1) {
    try {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(pageNum);
        const scale = 0.5;
        const viewport = page.getViewport({ scale });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (_) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f0f0f2';
        ctx.fillRect(0, 0, canvas.width || 50, canvas.height || 70);
        ctx.fillStyle = '#86868b';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Sin vista', (canvas.width || 50) / 2, (canvas.height || 70) / 2);
    }
}

async function renderPageGrid(file, gridId, selectionsArray) {
    const grid = document.getElementById(gridId);
    if (!grid) return;
    grid.innerHTML = '';
    try {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;

        if (selectionsArray.length !== totalPages) {
            selectionsArray.length = 0;
            for (let i = 0; i < totalPages; i++) selectionsArray.push(false);
        }

        for (let i = 0; i < totalPages; i++) {
            const pageNum = i + 1;
            const div = document.createElement('div');
            div.className = 'page-item';
            div.dataset.index = i;

            const canvas = document.createElement('canvas');
            div.appendChild(canvas);

            const overlay = document.createElement('div');
            overlay.className = 'check-overlay';
            overlay.textContent = '✓';
            div.appendChild(overlay);

            const label = document.createElement('div');
            label.className = 'page-number';
            label.textContent = `Pág. ${pageNum}`;
            div.appendChild(label);

            const updateStyle = () => div.classList.toggle('selected', selectionsArray[i]);

            div.addEventListener('click', () => {
                selectionsArray[i] = !selectionsArray[i];
                updateStyle();
            });

            grid.appendChild(div);
            updateStyle();

            try {
                const page = await pdf.getPage(pageNum);
                const scale = 0.3;
                const viewport = page.getViewport({ scale });
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport }).promise;
            } catch (_) {
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#f0f0f2';
                ctx.fillRect(0, 0, canvas.width || 120, canvas.height || 160);
                ctx.fillStyle = '#86868b';
                ctx.font = '12px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('Pág. ' + pageNum, (canvas.width || 120) / 2, (canvas.height || 160) / 2);
            }
        }

        const previewId = gridId.replace('PageGrid', 'Preview');
        const previewEl = document.getElementById(previewId);
        if (previewEl) previewEl.style.display = 'block';

    } catch (err) {
        alert('Error al cargar las páginas: ' + err.message);
    }
}