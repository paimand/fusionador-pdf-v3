const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const Archiver = require('archiver');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Multer en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Garantizar la existencia de la carpeta temporal 'uploads'
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Helper para desproteger y aplanar PDFs mediante qpdf
async function cleanPdfBuffer(inputBuffer) {
    const tempInput = path.join(uploadDir, `temp_in_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);
    const tempOutput = path.join(uploadDir, `temp_out_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);

    try {
        await fs.promises.writeFile(tempInput, inputBuffer);
        await execPromise(`qpdf --decrypt "${tempInput}" "${tempOutput}"`);
        const cleanedBuffer = await fs.promises.readFile(tempOutput);
        return cleanedBuffer;
    } catch (err) {
        console.warn('Advertencia: qpdf no pudo procesar el PDF, intentando continuar con el original:', err.message);
        return inputBuffer;
    } finally {
        if (fs.existsSync(tempInput)) fs.unlink(tempInput, () => {});
        if (fs.existsSync(tempOutput)) fs.unlink(tempOutput, () => {});
    }
}

// Middlewares para JSON y formularios
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// RUTAS PARA SERVIR VISTAS HTML
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/merge.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'merge.html')));
app.get('/split.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'split.html')));
app.get('/delete.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'delete.html')));
app.get('/extract.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'extract.html')));
app.get('/reorder.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reorder.html')));
app.get('/compress.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'compress.html')));

// ============================================================
// ENDPOINT: UNIR PDFs (/merge)
// ============================================================
// Usamos upload.any() para aceptar archivos con cualquier nombre de campo
app.post('/merge', upload.any(), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).send('No se han subido archivos PDF para unir.');
        }

        const mergedPdf = await PDFDocument.create();

        for (const file of req.files) {
            const cleanedBuffer = await cleanPdfBuffer(file.buffer);
            const pdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach(page => mergedPdf.addPage(page));
        }

        const pdfBytes = await mergedPdf.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="documento_unido.pdf"');
        return res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Error en /merge:', error);
        return res.status(500).send('Error interno al unir los archivos: ' + error.message);
    }
});

// ============================================================
// ENDPOINT: DIVIDIR / EXTRAER / REORDENAR PDFs (/split)
// ============================================================
app.post('/split', upload.any(), async (req, res) => {
    try {
        const file = req.files && req.files[0];
        if (!file) {
            return res.status(400).send('No se ha subido ningún archivo PDF.');
        }

        const mode = req.body.mode; // 'all' o 'ranges'
        const cleanedBuffer = await cleanPdfBuffer(file.buffer);
        const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();

        if (mode === 'all') {
            const archive = Archiver('zip', { zlib: { level: 9 } });
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="paginas_divididas.zip"');
            archive.pipe(res);

            for (let i = 0; i < totalPages; i++) {
                const singlePdf = await PDFDocument.create();
                const [copiedPage] = await singlePdf.copyPages(srcPdf, [i]);
                singlePdf.addPage(copiedPage);
                const singlePdfBytes = await singlePdf.save();
                archive.append(Buffer.from(singlePdfBytes), { name: `pagina_${i + 1}.pdf` });
            }

            await archive.finalize();

        } else if (mode === 'ranges') {
            const rangesStr = req.body.ranges;
            if (!rangesStr) {
                return res.status(400).send('No se especificaron los rangos o índices de páginas.');
            }

            const indicesToExtract = [];
            const parts = rangesStr.split(',');

            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed.includes('-')) {
                    const [start, end] = trimmed.split('-').map(n => parseInt(n.trim(), 10));
                    if (!isNaN(start) && !isNaN(end)) {
                        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
                            if (i >= 1 && i <= totalPages) {
                                indicesToExtract.push(i - 1);
                            }
                        }
                    }
                } else {
                    const pageNum = parseInt(trimmed, 10);
                    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
                        indicesToExtract.push(pageNum - 1);
                    }
                }
            }

            if (indicesToExtract.length === 0) {
                return res.status(400).send('Ninguna página válida fue seleccionada dentro del rango.');
            }

            const outputPdf = await PDFDocument.create();
            const copiedPages = await outputPdf.copyPages(srcPdf, indicesToExtract);
            copiedPages.forEach(page => outputPdf.addPage(page));

            const outputBytes = await outputPdf.save();

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="pdf_procesado.pdf"');
            return res.send(Buffer.from(outputBytes));

        } else {
            return res.status(400).send('Modo de división no válido.');
        }

    } catch (error) {
        console.error('Error en /split:', error);
        return res.status(500).send('Error al procesar el PDF: ' + error.message);
    }
});

// ============================================================
// ENDPOINT: ELIMINAR PÁGINAS (/delete)
// ============================================================
app.post('/delete', upload.any(), async (req, res) => {
    try {
        const file = req.files
