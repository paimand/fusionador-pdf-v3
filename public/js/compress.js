let compressFile = null;
const compressBtn = document.getElementById('compressBtn');
const compressOptions = document.getElementById('compressOptions');

setupDropZone('dropZoneCompress', 'fileInputCompress', files => {
    if (files && files[0]) {
        compressFile = files[0];
        document.querySelector('#dropZoneCompress p').textContent = `📄 ${compressFile.name}`;
        compressOptions.style.display = 'block';
    }
});

compressBtn.addEventListener('click', async () => {
    if (!compressFile) {
        alert('Primero selecciona un archivo PDF.');
        return;
    }

    compressBtn.disabled = true;
    if (typeof showLoading === 'function') showLoading(true);

    try {
        const formData = new FormData();
        formData.append('file', compressFile);
        formData.append('level', document.getElementById('compressionLevel').value);

        const resp = await fetch('/compress', { method: 'POST', body: formData });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(errText);
        }

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comprimido_${compressFile.name}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        if (typeof showStatus === 'function') showStatus('compressStatus', '✅ Archivo comprimido con éxito');
    } catch (err) {
        if (typeof showStatus === 'function') {
            showStatus('compressStatus', '❌ ' + err.message, true);
        } else {
            alert('Error: ' + err.message);
        }
    } finally {
        compressBtn.disabled = false;
        if (typeof showLoading === 'function') showLoading(false);
    }
});
