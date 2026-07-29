document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone') || document.querySelector('.drop-zone');
    const fileInput = document.getElementById('fileInput');
    const deleteBtn = document.getElementById('deleteBtn');
    const pagesContainer = document.getElementById('pagesContainer') || document.getElementById('pdfPreview');
    const fileInfo = document.getElementById('fileInfo');

    let currentFile = null;
    let selectedPagesToDelete = new Set();

    // ============================================================
    // 1. GESTIÓN DE SELECCIÓN Y DRAG & DROP
    // ============================================================

    if (dropZone && fileInput) {
        // Al hacer clic en la zona visual, simulamos clic en el input hidden
        dropZone.addEventListener('click', (e) => {
            // Evitar loop si el clic fue en el propio input
            if (e.target !== fileInput) {
                fileInput.click();
            }
        });

        // Prevenir comportamientos por defecto del navegador en Drag & Drop
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
            document.body.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        // Efectos visuales de arrastre
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.add('drag-active', 'border-primary');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('drag-active', 'border-primary');
            }, false);
        });

        // Captura del archivo al soltarlo (Drop)
        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;

            if (files && files.length > 0) {
                handleFile(files[0]);
            }
        });

        // Captura del archivo por selector tradicional (Change)
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleFile(e.target.files[0]);
            }
        });
    }

    // ============================================================
    // 2. PROCESAR Y MOSTRAR ARCHIVO PDF
    // ============================================================

    function handleFile(file) {
        if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
            alert('Por favor, selecciona o arrastra un archivo en formato PDF.');
            return;
        }

        currentFile = file;
        selectedPagesToDelete.clear();

        if (fileInfo) {
            fileInfo.textContent = `Archivo seleccionado: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
        }

        // Si existe el contenedor de vista previa, preparamos las miniaturas/tarjetas
        if (pagesContainer) {
            renderPagesPreview(file);
        }

        if (deleteBtn) {
            deleteBtn.disabled = false;
        }
    }

    // Renderizado simple de miniaturas o cuadrícula de selección
    async function renderPagesPreview(file) {
        pagesContainer.innerHTML = '<p class="text-center text-muted">Cargando páginas...</p>';
        
        try {
            // Leemos el número de páginas usando PDF.js o una lectura preliminar
            const arrayBuffer = await file.arrayBuffer();
            
            // Si usas pdfjsLib en la vista:
            if (window.pdfjsLib) {
                const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                pagesContainer.innerHTML = '';

                for (let i = 1; i <= pdf.numPages; i++) {
                    const card = document.createElement('div');
                    card.className = 'page-card';
                    card.dataset.page = i;
                    card.innerHTML = `
                        <div class="page-number">Página ${i}</div>
                        <div class="page-status">Conservar</div>
                    `;

                    card.addEventListener('click', () => {
                        if (selectedPagesToDelete.has(i)) {
                            selectedPagesToDelete.delete(i);
                            card.classList.remove('selected-for-delete');
                            card.querySelector('.page-status').textContent = 'Conservar';
                        } else {
                            selectedPagesToDelete.add(i);
                            card.classList.add('selected-for-delete');
                            card.querySelector('.page-status').textContent = 'Eliminar';
                        }
                    });

                    pagesContainer.appendChild(card);
                }
            } else {
                // Fallback si no está cargada la librería de miniaturas en el HTML
                pagesContainer.innerHTML = `
                    <div class="p-3 border rounded">
                        <p class="mb-2">Indica los números de páginas a eliminar separados por comas:</p>
                        <input type="text" id="manualPagesInput" class="form-control" placeholder="Ej: 1, 3, 5">
                    </div>
                `;
            }
        } catch (err) {
            console.error('Error al leer el PDF:', err);
            pagesContainer.innerHTML = '<p class="text-danger">Error al cargar la vista previa del PDF.</p>';
        }
    }

    // ============================================================
    // 3. ENVIAR AL SERVIDOR (/delete-pages)
    // ============================================================

    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (!currentFile) {
                alert('No hay ningún archivo seleccionado.');
                return;
            }

            // Si se usó el input manual de texto como fallback
            const manualInput = document.getElementById('manualPagesInput');
            if (manualInput && manualInput.value.trim() !== '') {
                const pages = manualInput.value.split(',').map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p));
                pages.forEach(p => selectedPagesToDelete.add(p));
            }

            if (selectedPagesToDelete.size === 0) {
                alert('Debes seleccionar al menos una página para eliminar.');
                return;
            }

            deleteBtn.disabled = true;
            deleteBtn.textContent = 'Procesando...';

            try {
                const formData = new FormData();
                formData.append('file', currentFile);

                const pagesArray = Array.from(selectedPagesToDelete).sort((a, b) => a - b);
                formData.append('pages', pagesArray.join(','));

                const response = await fetch('/delete-pages', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const errorMsg = await response.text();
                    alert('Error del servidor: ' + errorMsg);
                    return;
                }

                // Descarga binaria sin corrupción de Acrobat
                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = downloadUrl;
                a.download = 'pdf_modificado.pdf';
                document.body.appendChild(a);
                a.click();
                
                window.URL.revokeObjectURL(downloadUrl);
                a.remove();

            } catch (error) {
                console.error('Error en la petición:', error);
                alert('Ocurrió un error al procesar el archivo.');
            } finally {
                deleteBtn.disabled = false;
                deleteBtn.textContent = 'Eliminar páginas seleccionadas';
            }
        });
    }
});
