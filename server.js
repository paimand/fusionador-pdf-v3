const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const Archiver = require('archiver');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Middlewares para procesar datos de formularios y JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos (HTML, CSS, JS) desde la raíz del proyecto
app.use(express.static(path.join(__dirname)));


// ==========================================
// 1. ENDPOINT: UNIR PDFs (/merge)
// ==========================================
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
        res.send(Buffer.from(mergedPdfBytes));
    } catch (error) {
        console.error('Error en /merge:', error);
        res.status(500).send('Error procesando la unión de PDFs: ' + error.message);
    }
});

// ==========================================
// 2. ENDPOINT: DIVIDIR PDF (/split)
// ==========================================
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
        res.status(500).send('Error dividiendo el PDF: ' + error.message);
    }
});

// ==========================================
// 3. ENDPOINT: EXTRAER PÁGINAS (/extract)
// ==========================================
app.post('/extract', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No se ha subido ningún archivo.');
        }

        const pagesStr = req.body.pages || '';
        const selectedPages = pagesStr.split(',')
            .map(n => parseInt(n.trim(), 10))
            .filter(n => !isNaN(n));

        if (selectedPages.length === 0) {
            return res.status(400).send('No se han especificado páginas a extraer.');
        }

        const srcPdf = await PDFDocument.load(req.file.buffer);
        const totalPages = srcPdf.getPageCount();
        const validIndices = selectedPages
            .map(p => p - 1)
            .filter(idx => idx >= 0 && idx < totalPages);

        if (validIndices.length === 0) {
            return res.status(400).send('Las páginas seleccionadas no existen en el documento.');
        }

        const extractedPdf = await PDFDocument.create();
        const copiedPages = await extractedPdf.copyPages(srcPdf, validIndices);
        copiedPages.forEach(page => extractedPdf.addPage(page));

        const pdfBytes = await extractedPdf.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="paginas_extraidas.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Error en /extract:', error);
        res.status(500).send('Error extrayendo páginas del PDF: ' + error.message);
    }
});

// ==========================================
// 4. ENDPOINT: ELIMINAR PÁGINAS (/delete-pages)
// ==========================================
app.post('/delete-pages', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No se ha subido ningún archivo.');
        }

        const pagesToDelete = (req.body.pages || '')
            .split(',')
            .map(n => parseInt(n.trim(), 10))
            .filter(n => !isNaN(n));

        const srcPdf = await PDFDocument.load(req.file.buffer);
        const totalPages = srcPdf.getPageCount();

        const keepIndices = [];
        for (let i = 1; i <= totalPages; i++) {
            if (!pagesToDelete.includes(i)) {
                keepIndices.push(i - 1);
            }
        }

        if (keepIndices.length === 0) {
            return res.status(400).send('No se pueden eliminar todas las páginas del documento.');
        }

        const newPdf = await PDFDocument.create();
        const copiedPages = await newPdf.copyPages(srcPdf, keepIndices);
        copiedPages.forEach(page => newPdf.addPage(page));

        const pdfBytes = await newPdf.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="documento_modificado.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (error) {
        console.error('Error en /delete-pages:', error);
        res.status(500).send('Error eliminando páginas del PDF: ' + error.message);
    }
});

// ==========================================
// 5. ENDPOINT: COMPRIMIR PDF (/compress)
// ==========================================
app.post('/compress', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('No se ha subido ningún archivo.');
        }

        const srcPdf = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
        
        const compressedBytes = await srcPdf.save({
            useObjectStreams: true,
            addDefaultPage: false
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="documento_comprimido.pdf"');
        res.send(Buffer.from(compressedBytes));
    } catch (error) {
        console.error('Error en /compress:', error);
        res.status(500).send('Error al comprimir el PDF: ' + error.message);
    }
});

// Manejo de fallback para devolver index.html ante rutas no reconocidas
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

// Inicialización del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor ejecutándose en http://localhost:${PORT}`);
});
