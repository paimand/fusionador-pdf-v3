const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const JSZip = require('jszip');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Helper para desencriptar y reparar PDFs bancarios con qpdf
async function cleanPdfBuffer(inputBuffer) {
  return new Promise((resolve) => {
    const tempIn = path.join(os.tmpdir(), `in_${Date.now()}_${Math.random().toString(36).substring(2)}.pdf`);
    const tempOut = path.join(os.tmpdir(), `out_${Date.now()}_${Math.random().toString(36).substring(2)}.pdf`);

    fs.writeFileSync(tempIn, inputBuffer);

    exec(`qpdf --decrypt "${tempIn}" "${tempOut}"`, (error) => {
      if (!error && fs.existsSync(tempOut)) {
        const cleanedBuffer = fs.readFileSync(tempOut);
        try { fs.unlinkSync(tempIn); } catch (e) {}
        try { fs.unlinkSync(tempOut); } catch (e) {}
        resolve(cleanedBuffer);
      } else {
        try { fs.unlinkSync(tempIn); } catch (e) {}
        try { if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut); } catch (e) {}
        resolve(inputBuffer);
      }
    });
  });
}

// ------------------------------------------------------------
// 1. ENDPOINT: UNIR PDF (/merge)
// ------------------------------------------------------------
app.post('/merge', upload.any(), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).send('No se han subido archivos.');
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
    return res.send(Buffer.from(mergedPdfBytes));
  } catch (err) {
    console.error('Error en /merge:', err);
    return res.status(500).send(`Error procesando la unión de PDFs: ${err.message}`);
  }
});

// ------------------------------------------------------------
// 2. ENDPOINT: DIVIDIR PDF (/split)
// ------------------------------------------------------------
app.post('/split', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No se ha subido ningún archivo.');
    }

    const mode = req.body.mode || 'individual';
    const rangesStr = req.body.ranges || req.body.pages || '';

    const cleanedBuffer = await cleanPdfBuffer(req.file.buffer);
    const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
    const totalPages = srcPdf.getPageCount();

    let pageIndices = [];

    if (rangesStr && rangesStr.trim() !== '') {
      const parts = rangesStr.split(',');
      for (const part of parts) {
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(n => parseInt(n.trim(), 10));
          if (!isNaN(start) && !isNaN(end)) {
            for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
              if (i >= 1 && i <= totalPages) pageIndices.push(i - 1);
            }
          }
        } else {
          const pageNum = parseInt(part.trim(), 10);
          if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
            pageIndices.push(pageNum - 1);
          }
        }
      }
    } else {
      pageIndices = Array.from({ length: totalPages }, (_, i) => i);
    }

    if (pageIndices.length === 0) {
      pageIndices = Array.from({ length: totalPages }, (_, i) => i);
    }

    // Modo INDIVIDUAL o MÚLTIPLES PÁGINAS DIVIDIDAS -> Archivo ZIP
    if (mode === 'individual' || (mode === 'all' && pageIndices.length > 1)) {
      if (pageIndices.length === 1) {
        const singlePdf = await PDFDocument.create();
        const [copiedPage] = await singlePdf.copyPages(srcPdf, [pageIndices[0]]);
        singlePdf.addPage(copiedPage);
        const pdfBytes = await singlePdf.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="pagina_${pageIndices[0] + 1}.pdf"`);
        return res.send(Buffer.from(pdfBytes));
      }

      const zip = new JSZip();
      for (let i = 0; i < pageIndices.length; i++) {
        const idx = pageIndices[i];
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
      // Modo RANGO -> Generar un único PDF con las páginas seleccionadas
      const outPdf = await PDFDocument.create();
      const copiedPages = await outPdf.copyPages(srcPdf, pageIndices);
      copiedPages.forEach(p => outPdf.addPage(p));
      const pdfBytes = await outPdf.save();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="documento_dividido.pdf"');
      return res.send(Buffer.from(pdfBytes));
    }
  } catch (err) {
    console.error('Error en /split:', err);
    return res.status(500).send(`Error dividiendo PDF: ${err.message}`);
  }
});

// ------------------------------------------------------------
// 3. ENDPOINT: ELIMINAR PÁGINAS (/delete)
// ------------------------------------------------------------
app.post('/delete', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No se ha subido ningún archivo.');

    const pagesToDelete = (req.body.pages || '').split(',').map(n => parseInt(n.trim(), 10) - 1).filter(n => !isNaN(n));
    const cleanedBuffer = await cleanPdfBuffer(req.file.buffer);
    const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
    const totalPages = srcPdf.getPageCount();

    const pagesToKeep = [];
    for (let i = 0; i < totalPages; i++) {
      if (!pagesToDelete.includes(i)) pagesToKeep.push(i);
    }

    if (pagesToKeep.length === 0) {
      return res.status(400).send('No puedes eliminar todas las páginas del documento.');
    }

    const outPdf = await PDFDocument.create();
    const copiedPages = await outPdf.copyPages(srcPdf, pagesToKeep);
    copiedPages.forEach(p => outPdf.addPage(p));

    const pdfBytes = await outPdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="documento_modificado.pdf"');
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Error en /delete:', err);
    return res.status(500).send(`Error eliminando páginas: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});
