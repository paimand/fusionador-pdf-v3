// ============================================================
// CONFIGURACIÓN GLOBAL
// ============================================================
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ============================================================
// INYECCIÓN DINÁMICA DE HEADER Y FOOTER COMUNES
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    injectHeader();
    injectFooter();
});

function injectHeader() {
    const headerContainer = document.getElementById('app-header');
    if (!headerContainer) return;

    const currentPath = window.location.pathname;

    headerContainer.innerHTML = `
        <header class="navbar-ilove">
            <div class="navbar-container">
                <!-- LOGO CORPORATIVO -->
                <a href="/" class="navbar-brand">
                    <img src="https://i.ibb.co/RTgVzm5q/Suite-PDF-removebg-preview.png" alt="Suite PDF" class="brand-logo">
                </a>

                <!-- NAVEGACIÓN PRINCIPAL -->
                <nav class="navbar-nav">
                    <a href="/merge.html" class="nav-link ${currentPath.includes('merge') ? 'active' : ''}">UNIR PDF</a>
                    <a href="/split.html" class="nav-link ${currentPath.includes('split') ? 'active' : ''}">DIVIDIR PDF</a>
                    <a href="/compress.html" class="nav-link ${currentPath.includes('compress') ? 'active' : ''}">COMPRIMIR PDF</a>

                    <!-- MENÚ DESPLEGABLE: TODAS LAS HERRAMIENTAS -->
                    <div class="dropdown">
                        <button class="dropdown-toggle" id="toolsDropdownBtn" type="button">
                            TODAS LAS HERRAMIENTAS PDF
                            <span class="dropdown-arrow">▼</span>
                        </button>
                        <div class="dropdown-menu" id="toolsDropdownMenu">
                            <a href="/delete.html" class="dropdown-item ${currentPath.includes('delete') ? 'active' : ''}">
                                <span class="icon">🗑️</span>
                                <div class="item-text">
                                    <strong>Eliminar páginas</strong>
                                    <small>Quita las páginas innecesarias del PDF</small>
                                </div>
                            </a>
                            <a href="/extract.html" class="dropdown-item ${currentPath.includes('extract') ? 'active' : ''}">
                                <span class="icon">✂️</span>
                                <div class="item-text">
                                    <strong>Extraer páginas</strong>
                                    <small>Selecciona y extrae páginas específicas</small>
                                </div>
                            </a>
                            <a href="/reorder.html" class="dropdown-item ${currentPath.includes('reorder') ? 'active' : ''}">
                                <span class="icon">🔄</span>
                                <div class="item-text">
                                    <strong>Ordenar páginas</strong>
                                    <small>Reorganiza el orden de las páginas</small>
                                </div>
                            </a>
                        </div>
                    </div>
                </nav>
            </div>
        </header>
    `;

    // Soporte para apertura por clic (móviles/pantallas táctiles) y cierre al hacer clic fuera
    const dropdownBtn = document.getElementById('toolsDropdownBtn');
    const dropdownMenu = document.getElementById('toolsDropdownMenu');

    if (dropdownBtn && dropdownMenu) {
        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdownMenu.classList.toggle('show');
        });

        document.addEventListener('click', () => {
            dropdownMenu.classList.remove('show');
        });
    }
}

function injectFooter() {
    const footerContainer = document.getElementById('app-footer');
    if (!footerContainer) return;

    footerContainer.innerHTML = `
        <footer class="app-footer">
            <p>© ${new Date().getFullYear()} SuitePDF — Herramientas en línea para tus documentos PDF</p>
        </footer>
    `;
}

// ============================================================
// FUNCIONES AUXILIARES Y UTILITARIAS
// ============================================================
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e.target.error);
        reader.readAsArrayBuffer(file);
    });
}

function showLoading(show) {
    const el = document.getElementById('loading');
    if (el) el.style.display = show ? 'block' : 'none';
}

function showStatus(elementId, message, isError = false) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? '#ef4444' : '#10b981';
    el.style.fontWeight = '500';
}

function downloadFile(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

// ============================================================
// SETUP DRAG & DROP
// ============================================================
function setupDropZone(dropZoneId, inputId, onFilesSelected) {
    const dropZone = document.getElementById(dropZoneId);
    const input = document.getElementById(inputId);
    if (!dropZone || !input) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', e => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            input.files = files;
            onFilesSelected(files);
        }
    });

    dropZone.addEventListener('click', () => input.click());

    input.addEventListener('change', e => {
        if (e.target.files && e.target.files.length > 0) {
            onFilesSelected(e.target.files);
        }
    });
}

// ============================================================
// RENDERIZAR MINIATURA (para listas)
// ============================================================
async function renderThumbnail(file, canvas, pageNum = 1) {
    try {
        const arrayBuffer = await readFileAsArrayBuffer(file);
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 0.5 });
        const ctx = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (_) {
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f0f0f2';
        ctx.fillRect(0, 0, canvas.width || 50, canvas.height || 70);
        ctx.fillStyle = '#86868b';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Sin vista', (canvas.width || 50) / 2, (canvas.height || 70) / 2);
    }
}
