pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let reorderFile = null;
const reorderBtn = document.getElementById('reorderBtn');
const reorderPreview = document.getElementById('reorderPreview');
const gridContainer = document.getElementById('reorderPageGrid');
let sortableInstance = null;

if (typeof setupDropZone === 'function') {
    setupDropZone('dropZoneReorder', 'fileInputReorder', files => {
        if (files && files[0]) {
            reorderFile = files[0];
            const dropText = document.querySelector('#dropZoneReorder p');
            if (dropText) dropText.textContent = `📄 ${reorderFile.name}`;
            loadAndRenderPdf(reorderFile);
        }
    });
}

async function loadAndRenderPdf(file) {
    if (!gridContainer) return;
    gridContainer.innerHTML = '<p style="font-size:0.9rem; color:#6b7280;">Cargando miniaturas...</p>';
    if (reorderPreview) reorderPreview.style.display = 'block';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdfDoc.numPages;

        gridContainer.innerHTML = '';

        for (let i = 1; i <= numPages; i++) {
            const page = await pdfDoc.getPage(i);
            const viewport = page.getViewport({ scale: 0.25 });

            const card = document.createElement('div');
            card.className = 'page-card-reorder';
            card.setAttribute('data-page-index', i);

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: ctx, viewport: viewport }).promise;

            const label = document.createElement('span');
            label.textContent = `Pág. ${i}`;

            card.appendChild(canvas);
            card.appendChild(label);
            gridContainer.appendChild(card);
        }

        if (sortableInstance) sortableInstance.destroy();
        sortableInstance = new Sortable(gridContainer, {
            animation: 150,
            ghostClass: 'sortable-ghost'
        });

    } catch (err) {
        console.error('Error al generar miniaturas:', err);
        gridContainer.innerHTML = '<p style="color:red;">Error al cargar las miniaturas del PDF.</p>';
    }
}

if (reorderBtn) {
    reorderBtn.addEventListener('click', async () => {
        if (!reorderFile) { alert('Primero selecciona un PDF'); return; }

        const cards = gridContainer.querySelectorAll('.page-card-reorder');
        const newOrderIndices = Array.from(cards).map(card => card.getAttribute('data-page-index'));

        if (newOrderIndices.length === 0) {
            alert('No hay páginas para reordenar.');
            return;
        }

        reorderBtn.disabled = true;
        if (typeof showLoading === 'function') showLoading(true);

        try {
            const formData = new FormData();
            formData.append('file', reorderFile);
            formData.append('order', newOrderIndices.join(','));

            const resp = await fetch('/reorder', { method: 'POST', body: formData });
            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(errText);
            }

            const blob = await resp.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = 'pdf_reordenado.pdf';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);

            if (typeof showStatus === 'function') showStatus('reorderStatus', '✅ Documento reordenado con éxito');
        } catch (err) {
            if (typeof showStatus === 'function') {
                showStatus('reorderStatus', '❌ ' + err.message, true);
            } else {
                alert('Error: ' + err.message);
            }
        } finally {
            reorderBtn.disabled = false;
            if (typeof showLoading === 'function') showLoading(false);
        }
    });
}
