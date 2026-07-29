const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const Archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Multer en memoria
const upload = multer({ storage: multer.memoryStorage() });

// Garantizar la existencia de la carpeta temporal 'uploads'
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Middlewares para JSON y formularios
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Servir archivos estáticos desde la carpeta public (CSS, JS, etc.)
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

app.get('/delete.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'delete.html'));
});

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
// 2. ENDPOINT CORREGIDO: DIVIDIR / EXTRAER PDF (/split)
// ============================================================
app.post('/split', upload.single('file'), async (req, res) => {
    try {
        const file = req.file || (req.files && req.files[0]);
        if (!file) {
            return res.status(400).send('No se ha recibido ningún archivo PDF.');
        }

        const mode = req.body.mode || 'individual';
        const rangesStr = req.body.ranges || '';
        const srcPdf = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();

        // Obtener la lista de páginas numéricas a extraer
        let pagesToExtract = [];

        if (mode === 'individual') {
            pagesToExtract = rangesStr.split(',')
                .map(n => parseInt(n.trim(), 10))
                .filter(n => !isNaN(n) && n >= 1 && n <= totalPages);
        } else {
            // Manejo de rangos (ej. "1-3, 5")
            const groups = rangesStr.split(',').map(s => s.trim()).filter(Boolean);
            for (const group of groups) {
                if (group.includes('-')) {
                    const [start, end] = group.split('-').map(n => parseInt(n.trim(), 10));
                    const pStart = isNaN(start) ? 1 : Math.max(1, start);
                    const pEnd = isNaN(end) ? totalPages : Math.min(totalPages, end);
                    for (let p = pStart; p <= pEnd; p++) pagesToExtract.push(p);
                } else {
                    const p = parseInt(group, 10);
                    if (!isNaN(p) && p >= 1 && p <= totalPages) pagesToExtract.push(p);
                }
            }
        }

        // Eliminar duplicados y ordenar
        pagesToExtract = [...new Set(pagesToExtract)].sort((a, b) => a - b);

        if (pagesToExtract.length === 0) {
            return res.status(400).send('No se han especificado páginas válidas.');
        }

        // Crear un nuevo documento PDF con la selección
        const newPdf = await PDFDocument.create();
        const pageIndices = pagesToExtract.map(p => p - 1);
        const copiedPages = await newPdf.copyPages(srcPdf, pageIndices);
        copiedPages.forEach(p => newPdf.addPage(p));

        const pdfBytes = await newPdf.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="documento_extraido.pdf"');
        return res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Error en /split:', error);
        return res.status(500).send('Error extrayendo las páginas: ' + error.message);
    }
});

// ============================================================
// 3. ENDPOINT: COMPRESIÓN ULTRARRÁPIDA (/compress)
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
// 4. ENDPOINT: ELIMINAR PÁGINAS (/delete)
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

        const srcPdf = await PDFDocument.load(file.buffer, { ignoreEncryption: true });
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

// Fallback final: si entra a una ruta no registrada, devuelve index.html de public
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicializar el servidor
app.listen(PORT, () => {
    console.log(`Servidor iniciado correctamente en el puerto ${PORT}`);
});
