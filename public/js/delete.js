document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const deleteBtn = document.getElementById('deleteBtn');
    const pagesContainer = document.getElementById('pagesContainer');
    
    // Array para almacenar las páginas seleccionadas para ELIMINAR (base 1)
    let selectedPagesToDelete = new Set();
    let currentFile = null;

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                currentFile = e.target.files[0];
                selectedPagesToDelete.clear();
                // Si tienes lógica de renderizado previo de miniaturas, se ejecuta aquí
            }
        });
    }

    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            if (!currentFile) {
                alert('Por favor, selecciona un archivo PDF primero.');
                return;
            }

            // Recopilar páginas seleccionadas (puedes ajustar cómo obtienes los índices según tu UI)
            // Ejemplo: si tienes checkboxes o elementos con clase .selected
            const selectedElements = document.querySelectorAll('.page-thumb.selected, .page-checkbox:checked');
            
            selectedPagesToDelete.clear();
            selectedElements.forEach(el => {
                const pageNum = parseInt(el.dataset.page || el.value, 10);
                if (!isNaN(pageNum)) {
                    selectedPagesToDelete.add(pageNum);
                }
            });

            if (selectedPagesToDelete.size === 0) {
                alert('Selecciona al menos una página para eliminar.');
                return;
            }

            // Deshabilitar botón para evitar múltiples envíos
            deleteBtn.disabled = true;
            deleteBtn.textContent = 'Procesando...';

            try {
                const formData = new FormData();
                formData.append('file', currentFile);
                
                // CRUCIAL: Convertir el conjunto de páginas a una cadena separada por comas (ej: "1,3,5")
                const pagesArray = Array.from(selectedPagesToDelete).sort((a, b) => a - b);
                formData.append('pages', pagesArray.join(','));

                const response = await fetch('/delete-pages', {
                    method: 'POST',
                    body: formData
                });

                // Si la respuesta HTTP no es exitosa (400, 500), NO descargamos el blob
                if (!response.ok) {
                    const errorMsg = await response.text();
                    alert('Error en el servidor: ' + errorMsg);
                    return;
                }

                // Descarga limpia del Blob PDF
                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = downloadUrl;
                a.download = 'pdf_modificado.pdf';
                document.body.appendChild(a);
                a.click();
                
                // Limpiar referencia de memoria
                window.URL.revokeObjectURL(downloadUrl);
                a.remove();

            } catch (error) {
                console.error('Error al procesar la eliminación:', error);
                alert('Ocurrió un error de red o de comunicación con el servidor.');
            } finally {
                deleteBtn.disabled = false;
                deleteBtn.textContent = 'Eliminar páginas seleccionadas';
            }
        });
    }
});
