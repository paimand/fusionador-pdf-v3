document.addEventListener('DOMContentLoaded', () => {
    const compressForm = document.getElementById('compressForm');
    const fileInput = document.getElementById('fileInput');
    const levelSelect = document.getElementById('compressionLevel');
    const submitBtn = document.getElementById('submitBtn');
    const statusDiv = document.getElementById('statusMessage');

    if (!compressForm) return;

    compressForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (!fileInput.files || fileInput.files.length === 0) {
            showStatus('Por favor, selecciona un archivo PDF.', 'error');
            return;
        }

        const formData = new FormData();
        formData.append('file', fileInput.files[0]);
        formData.append('level', levelSelect ? levelSelect.value : 'recommended');

        submitBtn.disabled = true;
        showStatus('Comprimiendo PDF, por favor espera...', 'info');

        try {
            const response = await fetch('/compress', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || 'Error al procesar la compresión en el servidor.');
            }

            // Recibir el archivo comprimido como Blob
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            
            // Crear enlace de descarga automático
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `comprimido_${Date.now()}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            
            window.URL.revokeObjectURL(downloadUrl);
            showStatus('¡PDF comprimido y descargado con éxito!', 'success');

        } catch (error) {
            console.error('Error:', error);
            showStatus(error.message, 'error');
        } finally {
            submitBtn.disabled = false;
        }
    });

    function showStatus(message, type) {
        if (!statusDiv) return;
        statusDiv.textContent = message;
        statusDiv.className = `status-message ${type}`;
    }
});
