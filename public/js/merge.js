// ============================================================
// SUITE PDF - MERGE (UNIR) LOGIC
// ============================================================
let mergeFiles = [];

const fileListMerge = document.getElementById('fileListMerge');
const fileCountMerge = document.getElementById('fileCountMerge');
const mergeBtn = document.getElementById('mergeBtn');
const clearMergeBtn = document.getElementById('clearMerge');
const mergeStatus = document.getElementById('mergeStatus');
const mergeOmitted = document.getElementById('mergeOmitted');

// Inicializar reordenación mediante SortableJS
if (fileListMerge) {
    new Sortable(fileListMerge, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        onEnd: function(evt) {
            const [moved] = mergeFiles.splice(evt.oldIndex, 1);
            mergeFiles.splice(evt.newIndex, 0, moved);
            updateMergeCount();
        }
    });
}

function updateMergeCount() {
    if (!fileCountMerge) return;
    const count = mergeFiles.length;
    fileCountMerge.textContent = count === 0 ? '0 archivos' : (count === 1 ? '1 archivo' : `${count} archivos`);
}

function renderMergeList() {
    if (!fileListMerge) return;
    fileListMerge.innerHTML = '';

    mergeFiles.forEach((file, index) => {
        const li = document.createElement('li');

        // Contenedor de miniatura Canvas
        const thumbDiv = document.createElement('div');
        thumbDiv.className = 'thumbnail';
        const canvas = document.createElement('canvas');
        thumbDiv.appendChild(canvas);
        li.appendChild(thumbDiv);

        if (typeof renderThumbnail === 'function') {
            renderThumbnail(file, canvas);
        }

        // Información del archivo
        const infoDiv = document.createElement('div');
        infoDiv.className = 'file-info';

        const nameSpan = document.createElement('div');
        nameSpan.className = 'file-name';
        nameSpan.textContent = file.name;

        const metaSpan = document.createElement('div');
        metaSpan.className = 'file-meta';
        metaSpan.textContent = (file.size / 1024).toFixed(1) + ' KB';

        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(metaSpan);
        li.appendChild(infoDiv);

        // Botón para eliminar un elemento
        const delBtn = document.createElement('button');
        delBtn.className = 'delete-btn';
        delBtn.textContent = '×';
        delBtn.title = 'Eliminar archivo';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            mergeFiles.splice(index, 1);
            renderMergeList();
        });

        li.appendChild(delBtn);
        fileListMerge.appendChild(li);
    });

    updateMergeCount();
}

function handleMergeFiles(files) {
    const pdfFiles = Array.from(files).filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    if (pdfFiles.length === 0) {
        alert('Por favor, selecciona únicamente archivos en formato PDF.');
        return;
    }
    mergeFiles.push(...pdfFiles);
    renderMergeList();
    const input = document.getElementById('fileInputMerge');
    if (input) input.value = '';
}

// Configurar Dropzone
if (typeof setupDropZone === 'function') {
    setupDropZone('dropZoneMerge', 'fileInputMerge', handleMergeFiles);
}

// Botón de vaciar lista
if (clearMergeBtn) {
    clearMergeBtn.addEventListener('click', () => {
        mergeFiles = [];
        renderMergeList();
        if (mergeOmitted) mergeOmitted.innerHTML = '';
        if (typeof showStatus === 'function') showStatus('mergeStatus', '');
    });
}

// Botón de unión de PDFs
if (mergeBtn) {
    mergeBtn.addEventListener('click', async () => {
        if (mergeFiles.length === 0) {
            alert('No hay archivos para unir.');
            return;
        }

        mergeBtn.disabled = true;
        if (typeof showLoading === 'function') showLoading(true);
        if (typeof showStatus === 'function') showStatus('mergeStatus', '⏳ Uniendo PDFs...');
        if (mergeOmitted) mergeOmitted.innerHTML = '';

        try {
            const formData = new FormData();
            mergeFiles.forEach(f => formData.append('pdfs', f));

            const resp = await fetch('/merge', {
                method: 'POST',
                body: formData
            });

            if (!resp.ok) {
                const errorText = await resp.text();
                throw new Error(errorText || 'Error al fusionar los archivos.');
            }

            // Leer avisos de archivos omitidos si existieran
            const omitted = resp.headers.get('X-Omitted');
            if (omitted && mergeOmitted) {
                mergeOmitted.innerHTML = `<div class="omitted-text">⚠️ ${omitted}</div>`;
            }

            const blob = await resp.blob();

            if (typeof downloadFile === 'function') {
                downloadFile(blob, 'merged.pdf');
            } else {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'merged.pdf';
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            }

            if (typeof showStatus === 'function') {
                showStatus('mergeStatus', '✅ PDFs unidos correctamente');
            }
        } catch (err) {
            if (typeof showStatus === 'function') {
                showStatus('mergeStatus', '❌ ' + err.message, true);
            }
            console.error(err);
        } finally {
            mergeBtn.disabled = false;
            if (typeof showLoading === 'function') showLoading(false);
        }
    });
}

// Inicializar contador al cargar
updateMergeCount();
