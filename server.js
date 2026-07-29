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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('public'));

// Helper para limpiar/desencriptar PDFs bancarios con qpdf
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

// Helper universal y robusto para parsear listas de páginas desde cualquier formato
function parsePageList(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
  }
  if (typeof input === 'string') {
    let trimmed = input.trim();
    // Intentar parsear si viene como JSON stringify (ej: "[1,2,3]")
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map(n => parseInt(n, 10)).filter(n => !isNaN(n));
        }
      } catch (e) {}
    }
    // Si viene separado por comas (ej: "1,2,3")
    return trimmed.split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
  }
  return [];
}

// ------------------------------------------------------------
// 1. UNIR PDF (/merge) - Funciona OK
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
// 2. DIVIDIR PDF (/split) - Funciona OK
// ------------------------------------------------------------
app.post('/split', upload.any(), async (req, res) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.status(400).send('No se ha subido ningún archivo.');
    }

    const mode = req.body.mode || 'individual';
    const rangesStr = req.body.ranges || req.body.pages || '';
    const mergeRanges = req.body.mergeRanges === 'true' || req.body.mergeRanges === true;

    const cleanedBuffer = await cleanPdfBuffer(file.buffer);
    const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
    const totalPages = srcPdf.getPageCount();

    if (mode === 'individual') {
      let selectedPages = parsePageList(rangesStr);
      if (selectedPages.length === 0) {
        selectedPages = Array.from({ length: totalPages }, (_, i) => i + 1);
      }

      const zip = new JSZip();
      for (const pageNum of selectedPages) {
        const idx = pageNum - 1;
        if (idx >= 0 && idx < totalPages) {
          const singlePdf = await PDFDocument.create();
          const [copiedPage] = await singlePdf.copyPages(srcPdf, [idx]);
          singlePdf.addPage(copiedPage);
          const pdfBytes = await singlePdf.save();
          zip.file(`pagina_${pageNum}.pdf`, pdfBytes);
        }
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="paginas_individuales.zip"');
      return res.send(zipBuffer);
    }

    const rangeGroups = [];
    if (rangesStr && typeof rangesStr === 'string' && rangesStr.trim() !== '') {
      const parts = rangesStr.split(',');
      for (const part of parts) {
        const groupIndices = [];
        if (part.includes('-')) {
          const [start, end] = part.split('-').map(n => parseInt(n.trim(), 10));
          if (!isNaN(start) && !isNaN(end)) {
            for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
              if (i >= 1 && i <= totalPages) groupIndices.push(i - 1);
            }
          }
        } else {
          const pageNum = parseInt(part.trim(), 10);
          if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
            groupIndices.push(pageNum - 1);
          }
        }
        if (groupIndices.length > 0) rangeGroups.push(groupIndices);
      }
    }

    if (rangeGroups.length === 0) {
      return res.status(400).send('No se han especificado rangos válidos.');
    }

    if (!mergeRanges) {
      const zip = new JSZip();
      for (let i = 0; i < rangeGroups.length; i++) {
        const group = rangeGroups[i];
        const rangePdf = await PDFDocument.create();
        const copiedPages = await rangePdf.copyPages(srcPdf, group);
        copiedPages.forEach(p => rangePdf.addPage(p));
        const pdfBytes = await rangePdf.save();
        zip.file(`rango_${i + 1}.pdf`, pdfBytes);
      }

      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="rangos_divididos.zip"');
      return res.send(zipBuffer);
    } else {
      const allIndices = rangeGroups.flat();
      const outPdf = await PDFDocument.create();
      const copiedPages = await outPdf.copyPages(srcPdf, allIndices);
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
// 3. ELIMINAR PÁGINAS (/delete) - Corregido y blindado
// ------------------------------------------------------------
app.post('/delete', upload.any(), async (req, res) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.status(400).send('No se ha subido ningún archivo.');
    }

    // Recoger los datos de páginas a eliminar de cualquier posible propiedad que envíe el cliente
    const rawInput = req.body.pages || req.body.remove || req.body.deletedPages || req.body.paginas;
    const pagesToDeleteRaw = parsePageList(rawInput);
    const pagesToDelete = pagesToDeleteRaw.map(n => n - 1);

    const cleanedBuffer = await cleanPdfBuffer(file.buffer);
    const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
    const totalPages = srcPdf.getPageCount();

    const pagesToKeep = [];
    for (let i = 0; i < totalPages; i++) {
      if (!pagesToDelete.includes(i)) {
        pagesToKeep.push(i);
      }
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

// ------------------------------------------------------------
// 4. EXTRAER PÁGINAS (/extract) - Funciona OK
// ------------------------------------------------------------
app.post('/extract', upload.any(), async (req, res) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.status(400).send('No se ha subido ningún archivo.');
    }

    const pagesToExtractRaw = parsePageList(req.body.pages || req.body.extract);
    const pagesToExtract = pagesToExtractRaw.map(n => n - 1);

    const cleanedBuffer = await cleanPdfBuffer(file.buffer);
    const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
    const totalPages = srcPdf.getPageCount();

    const validIndices = pagesToExtract.filter(idx => idx >= 0 && idx < totalPages);
    if (validIndices.length === 0) {
      return res.status(400).send('No se seleccionaron páginas válidas para extraer.');
    }

    const outPdf = await PDFDocument.create();
    const copiedPages = await outPdf.copyPages(srcPdf, validIndices);
    copiedPages.forEach(p => outPdf.addPage(p));

    const pdfBytes = await outPdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="paginas_extraidas.pdf"');
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Error en /extract:', err);
    return res.status(500).send(`Error extrayendo páginas: ${err.message}`);
  }
});

// ------------------------------------------------------------
// 5. ORDENAR PÁGINAS (/reorder) - Funciona OK
// ------------------------------------------------------------
app.post('/reorder', upload.any(), async (req, res) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.status(400).send('No se ha subido ningún archivo.');
    }

    const orderRaw = parsePageList(req.body.order || req.body.pages);
    const orderIndices = orderRaw.map(n => n - 1);

    const cleanedBuffer = await cleanPdfBuffer(file.buffer);
    const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
    const totalPages = srcPdf.getPageCount();

    const validIndices = orderIndices.filter(idx => idx >= 0 && idx < totalPages);
    if (validIndices.length === 0) {
      return res.status(400).send('El orden de páginas proporcionado no es válido.');
    }

    const outPdf = await PDFDocument.create();
    const copiedPages = await outPdf.copyPages(srcPdf, validIndices);
    copiedPages.forEach(p => outPdf.addPage(p));

    const pdfBytes = await outPdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="documento_reordenado.pdf"');
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Error en /reorder:', err);
    return res.status(500).send(`Error reordenando páginas: ${err.message}`);
  }
});

// ------------------------------------------------------------
// 6. COMPRIMIR PDF (/compress) - Corregido y blindado con upload.any()
// ------------------------------------------------------------
app.post('/compress', upload.any(), async (req, res) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.status(400).send('No se ha subido ningún archivo.');
    }

    const cleanedBuffer = await cleanPdfBuffer(file.buffer);
    const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });

    const pdfBytes = await srcPdf.save({ useObjectStreams: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="documento_comprimido.pdf"');
    return res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('Error en /compress:', err);
    return res.status(500).send(`Error comprimiendo PDF: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor iniciado en el puerto ${PORT}`);
});
