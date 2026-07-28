pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let reorderFile = null;
const reorderBtn = document.getElementById('reorderBtn');
const reorderPreview = document.getElementById('reorderPreview');
const gridContainer = document.getElementById('reorderPageGrid');
let sortableInstance = null;

setupDropZone('dropZoneReorder', 'fileInputReorder', files => {
    if (files && files[0]) {
        reorderFile = files[0];
        document.querySelector('#dropZoneReorder p').textContent = `📄 ${reorderFile.name}`;
        loadAndRenderPdf(reorderFile);
    }
});

async function loadAndRenderPdf(file) {
    gridContainer.innerHTML = '<p style="font-size:0.9rem; color:#6b7280;">Cargando miniaturas...</p>';
    reorderPreview.style.display = 'block';

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
            card.dataset.pageIndex = i; // Número de página original (1-based)

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

        // Inicializar Sortable.js en el contenedor
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

reorderBtn.addEventListener('click', async () => {
    if (!reorderFile) { alert('Primero selecciona un PDF'); return; }

    // Obtener la secuencia actual de tarjetas según la cuadrícula
    const cards = gridContainer.querySelectorAll('.page-card-reorder');
    const newOrderIndices = Array.from(cards).map(card => card.dataset.pageIndex);

    if (newOrderIndices.length === 0) {
        alert('No hay páginas para reordenar.');
        return;
    }

    reorderBtn.disabled = true;
    if (typeof showLoading === 'function') showLoading(true);

    try {
        const formData = new FormData();
        formData.append('file', reorderFile);
        formData.append('mode', 'ranges');
        formData.append('ranges', newOrderIndices.join(','));

        // Reutilizamos la ruta /split enviándole la nueva secuencia de páginas en orden
        const resp = await fetch('/split', { method: 'POST', body: formData });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(errText);
        }

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
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
