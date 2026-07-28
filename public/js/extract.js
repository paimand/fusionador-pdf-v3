pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let extractFile = null;
let pagesToExtract = []; // Guarda true/false por cada página
const extractBtn = document.getElementById('extractBtn');
const extractPreview = document.getElementById('extractPreview');
const gridContainer = document.getElementById('extractPageGrid');

setupDropZone('dropZoneExtract', 'fileInputExtract', files => {
    if (files && files[0]) {
        extractFile = files[0];
        document.querySelector('#dropZoneExtract p').textContent = `📄 ${extractFile.name}`;
        loadAndRenderPdf(extractFile);
    }
});

async function loadAndRenderPdf(file) {
    gridContainer.innerHTML = '<p style="font-size:0.9rem; color:#6b7280;">Cargando miniaturas...</p>';
    extractPreview.style.display = 'block';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdfDoc.numPages;

        pagesToExtract = new Array(numPages).fill(false); // Por defecto ninguna seleccionada
        gridContainer.innerHTML = '';

        for (let i = 1; i <= numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: 0.25 });

            const card = document.createElement('div');
            card.className = 'page-card-extract';
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
                const idx = parseInt(card.dataset.pageIndex);
                pagesToExtract[idx] = !pagesToExtract[idx];
                card.classList.toggle('to-extract', pagesToExtract[idx]);
            });

            gridContainer.appendChild(card);
        }
    } catch (err) {
        console.error('Error al generar miniaturas:', err);
        gridContainer.innerHTML = '<p style="color:red;">Error al cargar las miniaturas del PDF.</p>';
    }
}

document.getElementById('extractSelectAll').addEventListener('click', () => {
    pagesToExtract.fill(true);
    document.querySelectorAll('.page-card-extract').forEach(card => card.classList.add('to-extract'));
});

document.getElementById('extractDeselectAll').addEventListener('click', () => {
    pagesToExtract.fill(false);
    document.querySelectorAll('.page-card-extract').forEach(card => card.classList.remove('to-extract'));
});

extractBtn.addEventListener('click', async () => {
    if (!extractFile) { alert('Primero selecciona un PDF'); return; }

    const selectedIndices = pagesToExtract
        .map((toExtract, idx) => toExtract ? idx + 1 : null)
        .filter(v => v !== null);

    if (selectedIndices.length === 0) {
        alert('Selecciona al menos una página para extraer.');
        return;
    }

    extractBtn.disabled = true;
    if (typeof showLoading === 'function') showLoading(true);

    try {
        const formData = new FormData();
        formData.append('file', extractFile);
        formData.append('mode', 'ranges');
        formData.append('ranges', selectedIndices.join(','));

        // Reutilizamos la ruta /split con modo rangos para generar un único PDF con la selección
        const resp = await fetch('/split', { method: 'POST', body: formData });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(errText);
        }

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'paginas_extraidas.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        if (typeof showStatus === 'function') showStatus('extractStatus', '✅ Páginas extraídas con éxito');
    } catch (err) {
        if (typeof showStatus === 'function') {
            showStatus('extractStatus', '❌ ' + err.message, true);
        } else {
            alert('Error: ' + err.message);
        }
    } finally {
        extractBtn.disabled = false;
        if (typeof showLoading === 'function') showLoading(false);
    }
});
