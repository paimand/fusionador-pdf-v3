// ============================================================
// COMPRESS LOGIC (ENVÍO MULTIPART A BACKEND CON GHOSTSCRIPT)
// ============================================================
let compressFile = null;
const dropZoneCompress = document.getElementById('dropZoneCompress');
const fileInputCompress = document.getElementById('fileInputCompress');
const compressBtn = document.getElementById('compressBtn');

if (dropZoneCompress && fileInputCompress && compressBtn) {

    // Prevenir comportamientos por defecto del navegador en drag & drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZoneCompress.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZoneCompress.addEventListener(eventName, () => {
            dropZoneCompress.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZoneCompress.addEventListener(eventName, () => {
            dropZoneCompress.classList.remove('dragover');
        }, false);
    });

    // Manejar arrastre e inserción de archivos
    dropZoneCompress.addEventListener('drop', e => {
        const dt = e.dataTransfer;
        const files = dt.files;

        if (files && files.length > 0) {
            const file = files[0];
            if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
                compressFile = file;
                const pText = dropZoneCompress.querySelector('p');
                if (pText) pText.textContent = `📄 ${compressFile.name}`;
                
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(compressFile);
                fileInputCompress.files = dataTransfer.files;
            } else {
                alert('Por favor, selecciona un archivo PDF válido.');
            }
        }
    });

    // Clic convencional para selección
    dropZoneCompress.addEventListener('click', () => fileInputCompress.click());

    fileInputCompress.addEventListener('change', e => {
        if (e.target.files.length > 0) {
            compressFile = e.target.files[0];
            const pText = dropZoneCompress.querySelector('p');
            if (pText) pText.textContent = `📄 ${compressFile.name}`;
        }
    });

    // Enviar archivo al servidor para compresión
    compressBtn.addEventListener('click', async () => {
        if (!compressFile) { 
            alert('Selecciona un PDF para comprimir'); 
            return; 
        }

        compressBtn.disabled = true;
        if (typeof showLoading === 'function') showLoading(true);
        if (typeof showStatus === 'function') showStatus('compressStatus', '⏳ Comprimiendo PDF en el servidor...');

        try {
            const selectedRadio = document.querySelector('input[name="compressLevel"]:checked');
            const level = selectedRadio ? selectedRadio.value : 'recommended';

            const formData = new FormData();
            formData.append('pdf', compressFile);
            formData.append('level', level);

            const resp = await fetch('/compress', {
                method: 'POST',
                body: formData
            });

            if (!resp.ok) {
                const errText = await resp.text();
                throw new Error(errText || 'Error al comprimir el archivo.');
            }

            const blob = await resp.blob();
            
            // Descargar el archivo procesado
            if (typeof downloadFile === 'function') {
                downloadFile(blob, `comprimido_${compressFile.name}`);
            } else {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `comprimido_${compressFile.name}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            }

            if (typeof showStatus === 'function') showStatus('compressStatus', '✅ PDF comprimido correctamente');
        } catch (err) {
            if (typeof showStatus === 'function') showStatus('compressStatus', '❌ ' + err.message, true);
        } finally {
            compressBtn.disabled = false;
            if (typeof showLoading === 'function') showLoading(false);
        }
    });
}
