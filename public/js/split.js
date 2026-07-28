// Configurar worker de PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let currentFile = null;
let pdfDoc = null;

const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const workspace = document.getElementById('workspace');
const fileNameDisplay = document.getElementById('fileName');
const btnRemoveFile = document.getElementById('btnRemoveFile');
const thumbnailsGrid = document.getElementById('thumbnailsGrid');
const rangeInputContainer = document.getElementById('rangeInputContainer');
const splitModeRadios = document.querySelectorAll('input[name="splitMode"]');
const btnProcessSplit = document.getElementById('btnProcessSplit');

// Selección de archivo
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

btnRemoveFile.addEventListener('click', () => {
  currentFile = null;
  pdfDoc = null;
  fileInput.value = '';
  thumbnailsGrid.innerHTML = '';
  workspace.style.display = 'none';
  uploadArea.style.display = 'block';
});

// Cambiar visibilidad según el modo seleccionado
splitModeRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    if (e.target.value === 'range') {
      rangeInputContainer.style.display = 'block';
    } else {
      rangeInputContainer.style.display = 'none';
    }
  });
});

async function handleFile(file) {
  if (file.type !== 'application/pdf') {
    alert('Por favor, selecciona un archivo PDF válido.');
    return;
  }

  currentFile = file;
  fileNameDisplay.textContent = file.name;
  uploadArea.style.display = 'none';
  workspace.style.display = 'block';

  // Leer y generar miniaturas
  const arrayBuffer = await file.arrayBuffer();
  try {
    pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    await renderThumbnails(pdfDoc);
  } catch (err) {
    console.error('Error al renderizar miniaturas:', err);
    alert('No se pudieron renderizar las miniaturas del PDF.');
  }
}

async function renderThumbnails(pdf) {
  thumbnailsGrid.innerHTML = '';
  
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.3 });

    const card = document.createElement('div');
    card.className = 'thumbnail-card';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: ctx, viewport: viewport }).promise;

    const label = document.createElement('span');
    label.className = 'thumbnail-label';
    label.textContent = `Página ${pageNum}`;

    card.appendChild(canvas);
    card.appendChild(label);
    thumbnailsGrid.appendChild(card);
  }
}

// Envío al servidor
btnProcessSplit.addEventListener('click', async () => {
  if (!currentFile) return;

  const mode = document.querySelector('input[name="splitMode"]:checked').value;
  const formData = new FormData();
  formData.append('file', currentFile);
  formData.append('mode', mode);

  if (mode === 'range') {
    const ranges = document.getElementById('pageRanges').value;
    if (!ranges.trim()) {
      alert('Por favor, especifica los rangos de página.');
      return;
    }
    formData.append('ranges', ranges);
  }

  try {
    btnProcessSplit.disabled = true;
    btnProcessSplit.textContent = 'Procesando...';

    const response = await fetch('/split', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || 'Error al dividir el PDF');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = 'pdf_dividido.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    alert(err.message);
  } finally {
    btnProcessSplit.disabled = false;
    btnProcessSplit.textContent = 'Dividir PDF';
  }
});
