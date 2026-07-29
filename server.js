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

// Middlewares para JSON y formularios
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Helper para desproteger y aplanar PDFs mediante qpdf
async function cleanPdfBuffer(inputBuffer) {
    const tempInput = path.join(uploadDir, `temp_in_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);
    const tempOutput = path.join(uploadDir, `temp_out_${Date.now()}_${Math.random().toString(36).substring(7)}.pdf`);

    try {
        await fs.promises.writeFile(tempInput, inputBuffer);
        await execPromise(`qpdf --decrypt "${tempInput}" "${tempOutput}"`);
        const cleanedBuffer = await fs.promises.readFile(tempOutput);
        
        // Limpieza de temporales
        await fs.promises.unlink(tempInput).catch(() => {});
        await fs.promises.unlink(tempOutput).catch(() => {});
        
        return cleanedBuffer;
    } catch (err) {
        // Si qpdf no está instalado o falla, se intenta limpiar archivos de todas formas y retornar buffer original
        await fs.promises.unlink(tempInput).catch(() => {});
        await fs.promises.unlink(tempOutput).catch(() => {});
        return inputBuffer;
    }
}

// Función auxiliar para parsear paginas/rangos sin importar el formato enviado por frontend
function parsePageRanges(rawRanges, totalPages) {
    if (!rawRanges) return [];
    
    let parsedRanges = rawRanges;
    if (typeof rawRanges === 'string') {
        try {
            parsedRanges = JSON.parse(rawRanges);
        } catch (e) {
            parsedRanges = rawRanges.split(',').map(s => s.trim());
        }
    }

    if (!Array.isArray(parsedRanges)) {
        parsedRanges = [parsedRanges];
    }

    const pagesToKeep = new Set();

    parsedRanges.forEach(rangeStr => {
        const str = String(rangeStr).trim();
        if (str.includes('-')) {
            const parts = str.split('-').map(p => parseInt(p.trim(), 10));
            const start = Math.max(1, parts[0] || 1);
            const end = Math.min(totalPages, parts[1] || totalPages);
            for (let i = start; i <= end; i++) {
                pagesToKeep.add(i);
            }
        } else {
            const pageNum = parseInt(str, 10);
            if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
                pagesToKeep.add(pageNum);
            }
        }
    });

    return Array.from(pagesToKeep).sort((a, b) => a - b);
}

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
// ENDPOINT: /merge (UNIR PDFS)
// ============================================================
app.post('/merge', upload.array('files'), async (req, res) => {
    try {
        if (!req.files || req.files.length < 2) {
            return res.status(400).send('Por favor, sube al menos 2 archivos PDF para unir.');
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
        res.setHeader('Content-Disposition', 'attachment; filename="pdf_unido.pdf"');
        return res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Error en /merge:', error);
        return res.status(500).send('Error interno al procesar la unión de PDFs: ' + error.message);
    }
});

// ============================================================
// ENDPOINT: /split (DIVIDIR PDF - TODAS LAS OPCIONES)
// ============================================================
app.post('/split', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).send('No se ha subido ningún archivo PDF.');
        }

        const mode = req.body.mode || (req.body.ranges ? 'ranges' : 'all');
        const cleanedBuffer = await cleanPdfBuffer(file.buffer);
        const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();

        // OPCIÓN 1: Dividir en páginas individuales (Genera un ZIP)
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
            return;
        }

        // OPCIÓN 2: Extraer por Rangos o Selección (Genera un PDF con las páginas indicadas)
        const rawInput = req.body.ranges || req.body.pages || req.body.selectedPages;
        const targetPages = parsePageRanges(rawInput, totalPages);

        if (targetPages.length === 0) {
            return res.status(400).send('No se han especificado rangos o páginas válidos para extraer.');
        }

        const newPdf = await PDFDocument.create();
        const keepIndices = targetPages.map(p => p - 1);
        const copiedPages = await newPdf.copyPages(srcPdf, keepIndices);
        copiedPages.forEach(page => newPdf.addPage(page));

        const pdfBytes = await newPdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="pdf_dividido.pdf"');
        return res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Error en /split:', error);
        return res.status(500).send('Error interno al dividir el PDF: ' + error.message);
    }
});

// ============================================================
// ENDPOINT: /delete (ELIMINAR PÁGINAS)
// ============================================================
app.post('/delete', upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).send('No se ha subido ningún archivo PDF.');
        }

        const rawPages = req.body.pages || req.body.pagesToDelete;
        const cleanedBuffer = await cleanPdfBuffer(file.buffer);
        const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();

        const pagesToDelete = parsePageRanges(rawPages, totalPages);
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

// Fallback final
app.use((req, res) => {
    res.status(404).send('Página o ruta no encontrada.');
});

app.listen(PORT, () => {
    console.log(`Servidor iniciado correctamente en http://localhost:${PORT}`);
});
