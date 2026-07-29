const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const Archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Multer en memoria (sin escribir en disco para ser más rápido)
const upload = multer({ storage: multer.memoryStorage() });

// Garantizar la existencia de la carpeta temporal 'uploads'
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Middlewares estándar con límite ampliado para JSON / base64
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Servir archivos estáticos desde la carpeta public (CSS, JS, imágenes)
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// RUTAS PARA SERVIR VISTAS HTML (CARPETA PUBLIC)
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

app.get('/compress.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'compress.html'));
});

// ============================================================
// 1. ENDPOINT: UNIR PDFs (/merge)
// ============================================================
// upload.any() acepta cualquier campo de archivo ('pdfFiles', 'files', etc.)
app.post('/merge', upload.any(), async (req, res) => {
    try {
        if (!req.files || req.files.length < 2) {
            return res.status(400).send('Se requieren al menos dos archivos PDF para unir.');
        }

        const mergedPdf = await PDFDocument.create();

        for (const file of req.files) {
            const pdf = await PDFDocument.load(file.buffer);
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
// 2. ENDPOINT: DIVIDIR PDF (/split)
// ============================================================
app.post('/split', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No se ha subido ningún archivo.');
        }

        const mode = req.body.mode || 'individual';
        const rangesStr = req.body.ranges || '';
        const srcPdf = await PDFDocument.load(req.file.buffer);
        const totalPages = srcPdf.getPageCount();

        if (mode === 'individual') {
            const selectedPages = rangesStr.split(',')
                .map(n => parseInt(n.trim(), 10))
                .filter(n => !isNaN(n) && n >= 1 && n <= totalPages);

            if (selectedPages.length === 0) {
                return res.status(400).send('No se seleccionaron páginas válidas.');
            }

            if (selectedPages.length === 1) {
                const newPdf = await PDFDocument.create();
                const [copied] = await newPdf.copyPages(srcPdf, [selectedPages[0] - 1]);
                newPdf.addPage(copied);
                const bytes = await newPdf.save();

                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="pagina_${selectedPages[0]}.pdf"`);
                return res.send(Buffer.from(bytes));
            }

            const archive = Archiver('zip', { zlib: { level: 6 } });
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="paginas_divididas.zip"');
            archive.pipe(res);

            for (const pageNum of selectedPages) {
                const newPdf = await PDFDocument.create();
                const [copied] = await newPdf.copyPages(srcPdf, [pageNum - 1]);
                newPdf.addPage(copied);
                const bytes = await newPdf.save();
                archive.append(Buffer.from(bytes), { name: `pagina_${pageNum}.pdf` });
            }

            await archive.finalize();

        } else {
            const groups = rangesStr.split(',').map(s => s.trim()).filter(Boolean);
            if (groups.length === 0) {
                return res.status(400).send('Debe especificar al menos un rango.');
            }

            const archive = Archiver('zip', { zlib: { level: 6 } });
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="rangos_divididos.zip"');
            archive.pipe(res);

            for (let idx = 0; idx < groups.length; idx++) {
                const group = groups[idx];
                const parts = group.split('-').map(n => parseInt(n.trim(), 10));
                let start = parts[0];
                let end = parts[1] || start;

                if (isNaN(start) || start < 1) start = 1;
                if (isNaN(end) || end > totalPages) end = totalPages;

                const newPdf = await PDFDocument.create();
                const pageIndices = [];
                for (let p = start; p <= end; p++) {
                    pageIndices.push(p - 1);
                }

                if (pageIndices.length > 0) {
                    const copiedPages = await newPdf.copyPages(srcPdf, pageIndices);
                    copiedPages.forEach(p => newPdf.addPage(p));
                    const bytes = await newPdf.save();
                    archive.append(Buffer.from(bytes), { name: `rango_${group}.pdf` });
                }
            }

            await archive.finalize();
        }
    } catch (error) {
        console.error('Error en /split:', error);
        return res.status(500).send('Error dividiendo el PDF: ' + error.message);
    }
});

// ============================================================
// 3. ENDPOINT: COMPRESIÓN ULTRARRÁPIDA (RECONSTRUCCIÓN PÁGINAS)
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

// Fallback final: si entra a una ruta no registrada, devuelve index.html de public
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicializar el servidor
app.listen(PORT, () => {
    console.log(`Servidor iniciado correctamente en el puerto ${PORT}`);
});
