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
        console.warn('Aviso: qpdf no pudo procesar el archivo, usando el buffer original:', err.message);
        return inputBuffer;
    } finally {
        if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
    }
}

// Middlewares para JSON y formularios
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// RUTAS HTML
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/merge.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'merge.html')));
app.get('/split.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'split.html')));
app.get('/extract.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'extract.html')));
app.get('/compress.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'compress.html')));
app.get('/delete.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'delete.html')));
app.get('/reorder.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reorder.html')));

// ============================================================
// 1. ENDPOINT: UNIR PDFs (/merge)
// ============================================================
app.post('/merge', upload.any(), async (req, res) => {
    try {
        if (!req.files || req.files.length < 2) {
            return res.status(400).send('Se requieren al menos dos archivos PDF para unir.');
        }

        const mergedPdf = await PDFDocument.create();

        for (const file of req.files) {
            const cleanedBuffer = await cleanPdfBuffer(file.buffer);
            const pdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach(page => mergedPdf.addPage(page));
        }

        const mergedPdfBytes = await mergedPdf.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="documento_unido.pdf"');
        return res.send(Buffer.from(mergedPdfBytes));
    } catch (error) {
        console.error('Error en /merge:', error);
        return res.status(500).send('Error procesando la unión de PDFs: ' + error.message);
    }
});

// ============================================================
// 2. ENDPOINT: DIVIDIR / EXTRAER PDF (/split)
// ============================================================
app.post('/split', upload.single('file'), async (req, res) => {
    try {
        const file = req.file || (req.files && req.files[0]);
        if (!file) {
            return res.status(400).send('No se ha recibido ningún archivo PDF.');
        }

        const mode = req.body.mode || 'individual';
        const rangesStr = req.body.ranges || '';
        const mergeRanges = req.body.mergeRanges === 'true' || req.body.mergeRanges === true;

        const cleanedBuffer = await cleanPdfBuffer(file.buffer);
        const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();

        // ------------------------------------------------------------
        // MODO 1: DIVIDIR EN PÁGINAS INDIVIDUALES (ZIP)
        // ------------------------------------------------------------
        if (mode === 'individual' || mode === 'pages') {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="paginas_divididas.zip"');

            const archive = Archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            for (let i = 0; i < totalPages; i++) {
                const singleDoc = await PDFDocument.create();
                const [copiedPage] = await singleDoc.copyPages(srcPdf, [i]);
                singleDoc.addPage(copiedPage);
                const pdfBytes = await singleDoc.save();

                archive.append(Buffer.from(pdfBytes), { name: `pagina_${i + 1}.pdf` });
            }

            await archive.finalize();
            return;
        }

        // ------------------------------------------------------------
        // MODO 2: DIVIDIR POR RANGOS
        // ------------------------------------------------------------
        const rawGroups = rangesStr.split(',').map(s => s.trim()).filter(Boolean);
        const rangeList = []; // Array de arrays de índices base-0

        for (const group of rawGroups) {
            const indices = [];
            if (group.includes('-')) {
                const [start, end] = group.split('-').map(n => parseInt(n.trim(), 10));
                const pStart = isNaN(start) ? 1 : Math.max(1, start);
                const pEnd = isNaN(end) ? totalPages : Math.min(totalPages, end);
                for (let p = pStart; p <= pEnd; p++) indices.push(p - 1);
            } else {
                const p = parseInt(group, 10);
                if (!isNaN(p) && p >= 1 && p <= totalPages) indices.push(p - 1);
            }
            if (indices.length > 0) {
                rangeList.push({ name: group, indices });
            }
        }

        if (rangeList.length === 0) {
            return res.status(400).send('No se han especificado rangos válidos.');
        }

        // OPCIÓN A: UNIR TODOS LOS RANGOS EN UN ÚNICO PDF
        if (mergeRanges) {
            const newPdf = await PDFDocument.create();
            
            for (const item of rangeList) {
                const copiedPages = await newPdf.copyPages(srcPdf, item.indices);
                copiedPages.forEach(p => newPdf.addPage(p));
            }

            const pdfBytes = await newPdf.save();

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="rangos_unidos.pdf"');
            return res.send(Buffer.from(pdfBytes));
        }

        // OPCIÓN B: CADA RANGO EN UN PDF INDEPENDIENTE (ZIP)
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="rangos_divididos.zip"');

        const archive = Archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        for (let idx = 0; idx < rangeList.length; idx++) {
            const item = rangeList[idx];
            const rangeDoc = await PDFDocument.create();
            const copiedPages = await rangeDoc.copyPages(srcPdf, item.indices);
            copiedPages.forEach(p => rangeDoc.addPage(p));
            
            const pdfBytes = await rangeDoc.save();
            const fileName = `rango_${item.name.replace(/\s+/g, '_')}.pdf`;
            archive.append(Buffer.from(pdfBytes), { name: fileName });
        }

        await archive.finalize();
        return;

    } catch (error) {
        console.error('Error en /split:', error);
        return res.status(500).send('Error dividiendo las páginas: ' + error.message);
    }
});

// ============================================================
// 3. ENDPOINT: REORDENAR PÁGINAS PDF (/reorder)
// ============================================================
app.post('/reorder', upload.single('file'), async (req, res) => {
    try {
        const file = req.file || (req.files && req.files[0]);
        if (!file) {
            return res.status(400).send('No se ha recibido ningún archivo PDF.');
        }

        const pageOrderStr = req.body.order || req.body.ranges || '';
        const cleanedBuffer = await cleanPdfBuffer(file.buffer);
        const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();

        const pageIndices = pageOrderStr
            .split(',')
            .map(n => parseInt(n.trim(), 10) - 1)
            .filter(idx => !isNaN(idx) && idx >= 0 && idx < totalPages);

        if (pageIndices.length === 0) {
            return res.status(400).send('No se ha recibido una secuencia de orden válida.');
        }

        const newPdf = await PDFDocument.create();

        for (const idx of pageIndices) {
            const [copiedPage] = await newPdf.copyPages(srcPdf, [idx]);
            newPdf.addPage(copiedPage);
        }

        const pdfBytes = await newPdf.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="pdf_reordenado.pdf"');
        return res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Error en /reorder:', error);
        return res.status(500).send('Error al reordenar las páginas: ' + error.message);
    }
});

// ============================================================
// 4. ENDPOINT: COMPRESIÓN ULTRARRÁPIDA (/compress)
// ============================================================
app.post('/compress', async (req, res) => {
    try {
        const { images, level } = req.body;

        if (!images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).send('No se han recibido páginas para procesar.');
        }

        const pdfDoc = await PDFDocument.create();

        for (const dataUrl of images) {
            const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
            const imageBuffer = Buffer.from(base64Data, 'base64');

            const embeddedImage = await pdfDoc.embedJpg(imageBuffer);
            const { width, height } = embeddedImage;

            const page = pdfDoc.addPage([width, height]);
            page.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: width,
                height: height,
            });
        }

        const pdfBytes = await pdfDoc.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="compressed_${level || 'result'}.pdf"`);
        return res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Error procesando compresión rápida:', error);
        return res.status(500).send('Error interno reconstruyendo el PDF comprimido.');
    }
});

// ============================================================
// 5. ENDPOINT: ELIMINAR PÁGINAS (/delete)
// ============================================================
app.post('/delete', upload.any(), async (req, res) => {
    try {
        const file = req.files && req.files.length > 0 ? req.files[0] : req.file;
        if (!file) {
            return res.status(400).send('No se ha recibido ningún archivo PDF.');
        }

        const rawPages = req.body.pagesToDelete || req.body.pages || '';
        const pagesToDelete = rawPages
            .toString()
            .split(',')
            .map(n => parseInt(n.trim(), 10))
            .filter(n => !isNaN(n) && n > 0);

        if (pagesToDelete.length === 0) {
            return res.status(400).send('No se han especificado páginas válidas para eliminar.');
        }

        const cleanedBuffer = await cleanPdfBuffer(file.buffer);
        const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();

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

// Fallback final
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicializar servidor
app.listen(PORT, () => {
    console.log(`Servidor iniciado correctamente en el puerto ${PORT}`);
});
