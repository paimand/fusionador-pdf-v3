const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const JSZip = require('jszip');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const app = express();
const port = process.env.PORT || 3000;

const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * Desencripta y repara el PDF usando qpdf antes de procesarlo
 */
async function cleanPdfBuffer(inputBuffer) {
  const tempId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  const inputPath = path.join(os.tmpdir(), `input_${tempId}.pdf`);
  const outputPath = path.join(os.tmpdir(), `output_${tempId}.pdf`);

  try {
    await fs.writeFile(inputPath, inputBuffer);
    await execFileAsync('qpdf', ['--decrypt', inputPath, outputPath]);
    const cleanedBuffer = await fs.readFile(outputPath);
    return cleanedBuffer;
  } catch (error) {
    console.warn('QPDF no pudo procesar el archivo, usando buffer original:', error.message);
    return inputBuffer;
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

/**
 * Convierte un string de rangos (ej: "1,3-5,7") en un array de índices numéricos basados en 0
 */
function parsePageRanges(rangesStr, totalPages) {
  const pageIndices = new Set();
  const parts = rangesStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(num => parseInt(num.trim(), 10));
      if (!isNaN(start) && !isNaN(end)) {
        const min = Math.max(1, Math.min(start, end));
        const max = Math.min(totalPages, Math.max(start, end));
        for (let i = min; i <= max; i++) {
          pageIndices.add(i - 1);
        }
      }
    } else {
      const pageNum = parseInt(trimmed, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        pageIndices.add(pageNum - 1);
      }
    }
  }

  return Array.from(pageIndices).sort((a, b) => a - b);
}

// ------------------------------------------------------------
// RUTA: UNIR PDFs
// ------------------------------------------------------------
app.post('/merge', upload.any(), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo PDF.' });
    }

    const mergedPdf = await PDFDocument.create();

    for (const file of req.files) {
      const cleanedBuffer = await cleanPdfBuffer(file.buffer);
      const pdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const mergedPdfBytes = await mergedPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="documento_unido.pdf"');
    res.send(Buffer.from(mergedPdfBytes));

  } catch (err) {
    console.error('Error general en /merge:', err);
    res.status(500).json({ error: 'Ocurrió un error al unir los documentos PDF.', details: err.message });
  }
});

// ------------------------------------------------------------
// RUTA: DIVIDIR PDF
// ------------------------------------------------------------
app.post('/split', upload.any(), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo PDF.' });
    }

    const file = req.files[0];
    const mode = req.body.mode || 'individual';
    const rangesStr = req.body.ranges || '';

    const cleanedBuffer = await cleanPdfBuffer(file.buffer);
    const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
    const totalPages = srcPdf.getPageCount();

    if (mode === 'individual') {
      const targetIndices = parsePageRanges(rangesStr, totalPages);
      
      if (targetIndices.length === 0) {
        return res.status(400).json({ error: 'No se seleccionaron páginas válidas para dividir.' });
      }

      // Si solo se selecciona una página, devuelve directamente un archivo PDF
      if (targetIndices.length === 1) {
        const singlePdf = await PDFDocument.create();
        const [copiedPage] = await singlePdf.copyPages(srcPdf, targetIndices);
        singlePdf.addPage(copiedPage);

        const pdfBytes = await singlePdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="pagina_${targetIndices[0] + 1}.pdf"`);
        return res.send(Buffer.from(pdfBytes));
      }

      // Si son varias páginas, crea un ZIP con los PDFs independientes
      const zip = new JSZip();

      for (const idx of targetIndices) {
        const singlePdf = await PDFDocument.create();
        const [copiedPage] = await singlePdf.copyPages(srcPdf, [idx]);
        singlePdf.addPage(copiedPage);

        const pdfBytes = await singlePdf.save();
        zip.file(`pagina_${idx + 1}.pdf`, pdfBytes);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="paginas_divididas.zip"');
      return res.send(zipBuffer);

    } else {
      // Modo Rangos: crea un único PDF recortado con las páginas especificadas
      const targetIndices = parsePageRanges(rangesStr, totalPages);

      if (targetIndices.length === 0) {
        return res.status(400).json({ error: 'El rango de páginas introducido no es válido.' });
      }

      const outputPdf = await PDFDocument.create();
      const copiedPages = await outputPdf.copyPages(srcPdf, targetIndices);
      copiedPages.forEach((page) => outputPdf.addPage(page));

      const pdfBytes = await outputPdf.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="documento_dividido.pdf"');
      return res.send(Buffer.from(pdfBytes));
    }

  } catch (err) {
    console.error('Error general en /split:', err);
    res.status(500).json({ error: 'Error al dividir el archivo PDF.', details: err.message });
  }
});

// Middleware de errores global
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Error en la subida: ${err.message}` });
  } else if (err) {
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
  next();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.listen(port, () => {
  console.log(`Servidor de SuitePDF listo en el puerto ${port}`);
});
