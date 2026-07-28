const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar límite de payload para imágenes comprimidas
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static('public'));

// ========== FUNCIÓN AUXILIAR ==========
// Convierte rangos tipo "1-3,5" a un array de índices (base 0)
function parsePageRanges(rangesStr, totalPages) {
    if (!rangesStr || rangesStr.trim() === '') return [];
    const parts = rangesStr.split(',').map(s => s.trim());
    const pageIndices = new Set();
    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            if (isNaN(start) || isNaN(end)) continue;
            const min = Math.max(1, start);
            const max = Math.min(totalPages, end);
            for (let i = min; i <= max; i++) pageIndices.add(i - 1);
        } else {
            const num = Number(part);
            if (!isNaN(num) && num >= 1 && num <= totalPages) pageIndices.add(num - 1);
        }
    }
    return Array.from(pageIndices).sort((a, b) => a - b);
}

// Crea un nuevo PDF a partir de un PDF original y un array de índices de páginas
async function createPdfFromIndices(sourcePdf, indices) {
    const newPdf = await PDFDocument.create();
    const pages = await newPdf.copyPages(sourcePdf, indices);
    pages.forEach(p => newPdf.addPage(p));
    return await newPdf.save();
}

// ========== RUTA: UNIR (con soporte mejorado para PDFs complejos) ==========
app.post('/merge', upload.array('pdfs'), async (req, res) => {
    try {
        const files = req.files;
        if (!files || files.length === 0) {
            return res.status(400).send('No se subió ningún archivo PDF');
        }

        const mergedPdf = await PDFDocument.create();
        const errores = [];

        for (const file of files) {
            try {
                // Cargar el PDF con opciones que ignoran encriptación y errores de fuentes
                const pdf = await PDFDocument.load(file.buffer, {
                    ignoreEncryption: true,
                    updateMetadata: false
                });
                const indices = pdf.getPageIndices();
                if (indices.length === 0) {
                    errores.push(`El archivo "${file.originalname}" no tiene páginas.`);
                    continue;
                }
                const copiedPages = await mergedPdf.copyPages(pdf, indices);
                copiedPages.forEach(page => mergedPdf.addPage(page));
            } catch (err) {
                console.error(`Error al procesar ${file.originalname}:`, err.message);
                errores.push(`Error al leer "${file.originalname}": ${err.message}`);
            }
        }

        if (errores.length > 0) {
            if (mergedPdf.getPageCount() === 0) {
                return res.status(400).send(`No se pudo procesar ningún PDF. Errores: ${errores.join('; ')}`);
            }
            console.warn('Advertencia: algunos PDFs no se pudieron fusionar:', errores);
        }

        const pdfBytes = await mergedPdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=merged.pdf');
        if (errores.length > 0) {
            res.setHeader('X-Warning', `Algunos archivos no se pudieron procesar: ${errores.join('; ')}`);
        }
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Error general al fusionar:', error);
        res.status(500).send(`Error al fusionar PDFs: ${error.message}`);
    }
});

// ========== RUTA: DIVIDIR ==========
app.post('/split', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).send('No se subió ningún archivo');
        const { mode, ranges: rangesStr } = req.body;
        const pdf = await PDFDocument.load(file.buffer);
        const totalPages = pdf.getPageCount();

        if (mode === 'individual') {
            return res.status(501).send('Dividir en páginas individuales requiere generar un ZIP. Pendiente de implementar.');
        }

        const pageIndices = parsePageRanges(rangesStr || '', totalPages);
        if (pageIndices.length === 0) {
            return res.status(400).send('No se especificaron rangos válidos');
        }
        const pdfBytes = await createPdfFromIndices(pdf, pageIndices);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=split.pdf');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al dividir PDF');
    }
});

// ========== RUTA: ELIMINAR PÁGINAS ==========
app.post('/delete-pages', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).send('No se subió ningún archivo');
        const pdf = await PDFDocument.load(file.buffer);
        const totalPages = pdf.getPageCount();
        const indicesToDelete = parsePageRanges(req.body.pagesToDelete || '', totalPages);
        if (indicesToDelete.length === 0) {
            return res.status(400).send('No se especificaron páginas a eliminar');
        }
        const allIndices = Array.from({ length: totalPages }, (_, i) => i);
        const remainingIndices = allIndices.filter(i => !indicesToDelete.includes(i));
        if (remainingIndices.length === 0) {
            return res.status(400).send('No quedan páginas después de eliminar');
        }
        const pdfBytes = await createPdfFromIndices(pdf, remainingIndices);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=modified.pdf');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al eliminar páginas');
    }
});

// ========== RUTA: EXTRAER PÁGINAS ==========
app.post('/extract-pages', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).send('No se subió ningún archivo');
        const pdf = await PDFDocument.load(file.buffer);
        const indicesToExtract = parsePageRanges(req.body.pagesToExtract || '', pdf.getPageCount());
        if (indicesToExtract.length === 0) {
            return res.status(400).send('No se especificaron páginas a extraer');
        }
        const pdfBytes = await createPdfFromIndices(pdf, indicesToExtract);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=extracted.pdf');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al extraer páginas');
    }
});

// ========== RUTA: REORDENAR PÁGINAS ==========
app.post('/reorder-pages', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).send('No se subió ningún archivo');
        const newOrderStr = req.body.newOrder;
        if (!newOrderStr) return res.status(400).send('No se especificó el nuevo orden');
        const newOrder = JSON.parse(newOrderStr);
        if (!Array.isArray(newOrder) || newOrder.length === 0) {
            return res.status(400).send('Formato de orden inválido');
        }
        const pdf = await PDFDocument.load(file.buffer);
        const totalPages = pdf.getPageCount();
        const indices = newOrder.map(n => n - 1).filter(i => i >= 0 && i < totalPages);
        if (indices.length !== newOrder.length) {
            return res.status(400).send('Algunos números de página están fuera de rango');
        }
        if (new Set(indices).size !== indices.length) {
            return res.status(400).send('No se permiten páginas duplicadas');
        }
        const pdfBytes = await createPdfFromIndices(pdf, indices);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=reordered.pdf');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error(error);
        res.status(500).send('Error al reordenar páginas');
    }
});

// ========== RUTA: COMPRIMIR PDF ==========
app.post('/compress', async (req, res) => {
    try {
        const { images, level } = req.body;
        if (!images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).send('No se recibieron páginas para comprimir');
        }

        const newPdf = await PDFDocument.create();

        for (const imgDataUrl of images) {
            const base64Data = imgDataUrl.replace(/^data:image\/jpeg;base64,/, "");
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const embeddedImage = await newPdf.embedJpg(imageBuffer);

            const page = newPdf.addPage([embeddedImage.width, embeddedImage.height]);
            page.drawImage(embeddedImage, {
                x: 0, y: 0,
                width: embeddedImage.width,
                height: embeddedImage.height,
            });
        }

        const pdfBytes = await newPdf.save({ useObjectStreams: true });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=compressed_${level || 'pdf'}.pdf`);
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Error al comprimir:', error);
        res.status(500).send('Error al generar el PDF comprimido');
    }
});

// ========== INICIO DEL SERVIDOR ==========
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
