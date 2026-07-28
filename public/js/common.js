// ============================================================
// CONFIGURACIÓN GLOBAL
// ============================================================
pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ============================================================
// FUNCIONES AUXILIARES
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

// ============================================================
// SETUP DRAG & DROP
// ============================================================
function setupDropZone(zoneId, inputId, onFilesSelected) {
    const dropZone = document.getElementById(zoneId);
    const fileInput = document.getElementById(inputId);
    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
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

// ============================================================
// RENDERIZAR MINIATURA (para listas)
// ============================================================
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

// ============================================================
// RASTERIZAR PDF A IMÁGENES (ALTA CALIDAD)
// ============================================================
async function rasterizePdfToImages(file, options = {}) {
    // Parámetros por defecto: alta calidad para preservar texto
    const {
        maxWidth = 3000,
        quality = 0.95,
        minDimension = 2000,
        usePNG = false
    } = options;

    const arrayBuffer = await readFileAsArrayBuffer(file);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;
    const images = [];

    for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });
        let width = viewport.width;
        let height = viewport.height;

        let scale = 1.0;
        if (width < minDimension) {
            scale = minDimension / width;
        } else if (width > maxWidth) {
            scale = maxWidth / width;
        }

        const scaledViewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(scaledViewport.width);
        canvas.height = Math.floor(scaledViewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: scaledViewport }).promise;

        let imageData;
        if (usePNG) {
            imageData = canvas.toDataURL('image/png');
        } else {
            imageData = canvas.toDataURL('image/jpeg', quality);
        }
        images.push(imageData);
    }
    return images;
}

// ============================================================
// FUNCIÓN PARA GENERAR PDF DESDE IMÁGENES (usando /compress)
// ============================================================
async function generatePdfFromImages(images, filename = 'output.pdf', level = 'high') {
    const resp = await fetch('/compress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, level })
    });
    if (!resp.ok) throw new Error(await resp.text());
    const blob = await resp.blob();
    downloadFile(blob, filename);
}
