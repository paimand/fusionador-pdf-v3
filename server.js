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
        console.warn('Advertencia: qpdf falló o no está instalado. Usando buffer original:', err.message);
        return inputBuffer;
    } finally {
        if (fs.existsSync(tempInput)) fs.promises.unlink(tempInput).catch(() => {});
        if (fs.existsSync(tempOutput)) fs.promises.unlink(tempOutput).catch(() => {});
    }
}

// Helper para parsear rangos y listas de páginas (ej: "1-3, 5, 7-9")
function parsePageRanges(rangesStr, totalPages) {
    const pages = new Set();
    if (!rangesStr) return [];

    const parts = rangesStr.split(',');
    for (let part of parts) {
        part = part.trim();
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(n => parseInt(n.trim(), 10));
            if (!isNaN(start) && !isNaN(end)) {
                const min = Math.max(1, Math.min(start, end));
                const max = Math.min(totalPages, Math.max(start, end));
                for (let i = min; i <= max; i++) {
                    pages.add(i);
                }
            }
        } else {
            const num = parseInt(part, 10);
            if (!isNaN(num) && num >= 1 && num <= totalPages) {
                pages.add(num);
            }
        }
    }
    return Array.from(pages).sort((a, b) => a - b);
}

// Middlewares para JSON y formularios
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// RUTAS PARA SERVIR VISTAS HTML
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/merge.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'merge.html'));
});

app.get('/split.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'split.html'));
});

app.get('/delete.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'delete.html'));
});

app.get('/extract.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'extract.html'));
});

app.get('/reorder.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reorder.html'));
});

// ============================================================
// ENDPOINTS DE PROCESAMIENTO DE PDF
// ============================================================

// 1. UNIR PDFs (/merge)
app.post('/merge', upload.array('files'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).send('No se han subido archivos para unir.');
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
        return res.status(500).send('Error interno al unir los PDFs: ' + error.message);
    }
});

// 2. DIVIDIR PDF (/split)
app.post('/split', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No se ha subido ningún archivo.');
        }

        const cleanedBuffer = await cleanPdfBuffer(req.file.buffer);
        const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();
        const mode = req.body.mode || 'all';

        if (mode === 'all') {
            const archive = Archiver('zip', { zlib: { level: 9 } });
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="paginas_divididas.zip"');
            archive.pipe(res);

            for (let i = 0; i < totalPages; i++) {
                const newPdf = await PDFDocument.create();
                const [copiedPage] = await newPdf.copyPages(srcPdf, [i]);
                newPdf.addPage(copiedPage);
                const pdfBytes = await newPdf.save();
                archive.append(Buffer.from(pdfBytes), { name: `pagina_${i + 1}.pdf` });
            }

            await archive.finalize();
        } else if (mode === 'ranges') {
            const rangesStr = req.body.ranges || '';
            const mergeRanges = req.body.mergeRanges === 'true' || req.body.mergeRanges === true;

            const selectedPages = parsePageRanges(rangesStr, totalPages);
            if (selectedPages.length === 0) {
                return res.status(400).send('No se especificaron rangos válidos.');
            }

            const zeroBasedIndices = selectedPages.map(p => p - 1);

            if (mergeRanges) {
                const newPdf = await PDFDocument.create();
                const copiedPages = await newPdf.copyPages(srcPdf, zeroBasedIndices);
                copiedPages.forEach(p => newPdf.addPage(p));
                const pdfBytes = await newPdf.save();

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'attachment; filename="pdf_reordenado.pdf"');
                return res.send(Buffer.from(pdfBytes));
            } else {
                const archive = Archiver('zip', { zlib: { level: 9 } });
                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', 'attachment; filename="rangos_divididos.zip"');
                archive.pipe(res);

                for (const idx of zeroBasedIndices) {
                    const newPdf = await PDFDocument.create();
                    const [copiedPage] = await newPdf.copyPages(srcPdf, [idx]);
                    newPdf.addPage(copiedPage);
                    const pdfBytes = await newPdf.save();
                    archive.append(Buffer.from(pdfBytes), { name: `pagina_${idx + 1}.pdf` });
                }

                await archive.finalize();
            }
        } else {
            return res.status(400).send('Modo de división no válido.');
        }
    } catch (error) {
        console.error('Error en /split:', error);
        return res.status(500).send('Error interno al dividir el PDF: ' + error.message);
    }
});

// 3. EXTRAER PÁGINAS (/extract)
app.post('/extract', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No se ha subido ningún archivo.');
        }

        const cleanedBuffer = await cleanPdfBuffer(req.file.buffer);
        const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();
        const pagesStr = req.body.pages || '';

        const selectedPages = parsePageRanges(pagesStr, totalPages);
        if (selectedPages.length === 0) {
            return res.status(400).send('No se han especificado páginas válidas para extraer.');
        }

        const zeroBasedIndices = selectedPages.map(p => p - 1);

        const newPdf = await PDFDocument.create();
        const copiedPages = await newPdf.copyPages(srcPdf, zeroBasedIndices);
        copiedPages.forEach(p => newPdf.addPage(p));
        const pdfBytes = await newPdf.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="paginas_extraidas.pdf"');
        return res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Error en /extract:', error);
        return res.status(500).send('Error interno al extraer páginas: ' + error.message);
    }
});

// 4. ELIMINAR PÁGINAS (/delete)
app.post('/delete', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No se ha subido ningún archivo.');
        }

        const pagesStr = req.body.pages || '';
        const cleanedBuffer = await cleanPdfBuffer(req.file.buffer);
        const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();

        const pagesToDelete = parsePageRanges(pagesStr, totalPages);
        if (pagesToDelete.length === 0) {
            return res.status(400).send('No se han especificado páginas válidas para eliminar.');
        }

        const keepIndices = [];
        for (let i = 1; i <= totalPages; i++) {
            if (!pagesToDelete.includes(i)) {
                keepIndices.push(i - 1);
            }
        }

        if (keepIndices.length === 0) {
            return res.status(400).send('No puedes eliminar todas las páginas del documento.');
        }

        const newPdf = await PDFDocument.create();
        const copiedPages = await newPdf.copyPages(srcPdf, keepIndices);
        copiedPages.forEach(page => newPdf.addPage(page));

        const pdfBytes = await newPdf.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="pdf_modificado.pdf"');
        return res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Error en /delete:', error);
        return res.status(500).send('Error interno al eliminar las páginas: ' + error.message);
    }
});

// Fallback final: si entra a una ruta no registrada, devuelve index.html
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// INICIAR SERVIDOR
app.listen(PORT, () => {
    console.log(`Servidor iniciado y escuchando en el puerto ${PORT}`);
});
