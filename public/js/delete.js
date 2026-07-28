pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let deleteFile = null;
let pagesToDelete = []; // Guarda true/false si la página será eliminada
const deleteBtn = document.getElementById('deleteBtn');
const deletePreview = document.getElementById('deletePreview');
const gridContainer = document.getElementById('deletePageGrid');

setupDropZone('dropZoneDelete', 'fileInputDelete', files => {
    if (files && files[0]) {
        deleteFile = files[0];
        document.querySelector('#dropZoneDelete p').textContent = `📄 ${deleteFile.name}`;
        loadAndRenderPdf(deleteFile);
    }
});

async function loadAndRenderPdf(file) {
    gridContainer.innerHTML = '<p style="font-size:0.9rem; color:#6b7280;">Cargando miniaturas...</p>';
    deletePreview.style.display = 'block';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdfDoc.numPages;

        pagesToDelete = new Array(numPages).fill(false); // Por defecto ninguna está marcada para eliminar
        gridContainer.innerHTML = '';

        for (let i = 1; i <= numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: 0.25 });

            const card = document.createElement('div');
            card.className = 'page-card-delete';
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
                pagesToDelete[idx] = !pagesToDelete[idx];
                card.classList.toggle('to-delete', pagesToDelete[idx]);
            });

            gridContainer.appendChild(card);
        }
    } catch (err) {
        console.error('Error al generar miniaturas:', err);
        gridContainer.innerHTML = '<p style="color:red;">Error al cargar las miniaturas del PDF.</p>';
    }
}

document.getElementById('deleteSelectAll').addEventListener('click', () => {
    pagesToDelete.fill(true);
    document.querySelectorAll('.page-card-delete').forEach(card => card.classList.add('to-delete'));
});

document.getElementById('deleteDeselectAll').addEventListener('click', () => {
    pagesToDelete.fill(false);
    document.querySelectorAll('.page-card-delete').forEach(card => card.classList.remove('to-delete'));
});

deleteBtn.addEventListener('click', async () => {
    if (!deleteFile) { alert('Primero selecciona un PDF'); return; }

    const pagesToRemoveIndices = pagesToDelete
        .map((toDelete, idx) => toDelete ? idx + 1 : null)
        .filter(v => v !== null);

    if (pagesToRemoveIndices.length === 0) {
        alert('Selecciona al menos una página para eliminar.');
        return;
    }

    if (pagesToRemoveIndices.length === pagesToDelete.length) {
        alert('No puedes eliminar todas las páginas del documento.');
        return;
    }

    deleteBtn.disabled = true;
    if (typeof showLoading === 'function') showLoading(true);

    try {
        const formData = new FormData();
        formData.append('file', deleteFile);
        formData.append('pagesToDelete', pagesToRemoveIndices.join(','));

        const resp = await fetch('/delete', { method: 'POST', body: formData });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(errText);
        }

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'pdf_modificado.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        if (typeof showStatus === 'function') showStatus('deleteStatus', '✅ Páginas eliminadas con éxito');
    } catch (err) {
        if (typeof showStatus === 'function') {
            showStatus('deleteStatus', '❌ ' + err.message, true);
        } else {
            alert('Error: ' + err.message);
        }
    } finally {
        deleteBtn.disabled = false;
        if (typeof showLoading === 'function') showLoading(false);
    }
});
