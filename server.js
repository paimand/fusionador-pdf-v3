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

// Configuración de almacenamiento en memoria para Multer
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite de 50MB
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * Desencripta y repara el PDF usando qpdf antes de procesarlo con pdf-lib
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
 * Convierte un string de rangos/páginas (ej: "3,1,2" o "1,3-5,7") en un array 
 * preservando EXACTAMENTE el orden especificado (sin reordenar numéricamente).
 */
function parsePageRanges(rangesStr, totalPages) {
  const pageIndices = [];
  const parts = rangesStr.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(num => parseInt(num.trim(), 10));
      if (!isNaN(start) && !isNaN(end)) {
        const step = start <= end ? 1 : -1;
        let current = start;
        while (true) {
          if (current >= 1 && current <= totalPages) {
            pageIndices.push(current - 1);
          }
          if (current === end) break;
          current += step;
        }
      }
    } else {
      const pageNum = parseInt(trimmed, 10);
      if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        pageIndices.push(pageNum - 1);
      }
    }
  }

  return pageIndices;
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
// RUTA: DIVIDIR / REORDENAR / EXTRAER PDF
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

      if (targetIndices.length === 1) {
        const singlePdf = await PDFDocument.create();
        const [copiedPage] = await singlePdf.copyPages(srcPdf, targetIndices);
        singlePdf.addPage(copiedPage);

        const pdfBytes = await singlePdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="pagina_${targetIndices[0] + 1}.pdf"`);
        return res.send(Buffer.from(pdfBytes));
      }

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
      // Modo Rangos / Reordenar / Extraer: copia página por página en el orden recibido
      const targetIndices = parsePageRanges(rangesStr, totalPages);

      if (targetIndices.length === 0) {
        return res.status(400).json({ error: 'El rango o secuencia de páginas no es válido.' });
      }

      const outputPdf = await PDFDocument.create();

      for (const pageIdx of targetIndices) {
        const [copiedPage] = await outputPdf.copyPages(srcPdf, [pageIdx]);
        outputPdf.addPage(copiedPage);
      }

      const pdfBytes = await outputPdf.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="documento_procesado.pdf"');
      return res.send(Buffer.from(pdfBytes));
    }

  } catch (err) {
    console.error('Error general en /split:', err);
    res.status(500).json({ error: 'Error al procesar el archivo PDF.', details: err.message });
  }
});

// ------------------------------------------------------------
// RUTA: ELIMINAR PÁGINAS PDF
// ------------------------------------------------------------
app.post('/delete', upload.any(), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo PDF.' });
    }

    const file = req.files[0];
    const pagesToDeleteStr = req.body.pagesToDelete || '';

    const cleanedBuffer = await cleanPdfBuffer(file.buffer);
    const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
    const totalPages = srcPdf.getPageCount();

    const toDeleteSet = new Set(
      pagesToDeleteStr.split(',')
        .map(num => parseInt(num.trim(), 10) - 1)
        .filter(idx => !isNaN(idx) && idx >= 0 && idx < totalPages)
    );

    const keepIndices = [];
    for (let i = 0; i < totalPages; i++) {
      if (!toDeleteSet.has(i)) {
        keepIndices.push(i);
      }
    }

    if (keepIndices.length === 0) {
      return res.status(400).json({ error: 'No se pueden eliminar todas las páginas del documento.' });
    }

    const outputPdf = await PDFDocument.create();
    for (const pageIdx of keepIndices) {
      const [copiedPage] = await outputPdf.copyPages(srcPdf, [pageIdx]);
      outputPdf.addPage(copiedPage);
    }

    const pdfBytes = await outputPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="pdf_modificado.pdf"');
    res.send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error('Error general en /delete:', err);
    res.status(500).json({ error: 'Error al eliminar páginas del PDF.', details: err.message });
  }
});

// Middleware global para manejo de errores de subida
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Error en la subida: ${err.message}` });
  } else if (err) {
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
  next();
});

// Fallback para rutas no existentes
app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.listen(port, () => {
  console.log(`Servidor de SuitePDF listo en el puerto ${port}`);
});
