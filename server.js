const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const { execFile } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const app = express();
const port = process.env.PORT || 3000;

// Configuración de Multer para almacenamiento en memoria
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Normaliza y desencripta un buffer de PDF mediante QPDF.
 * Elimina la encriptación de propietario y repara tablas XRef corruptas
 * típicas de documentos expedidos por CaixaBank, BBVA, etc.
 */
async function cleanPdfBuffer(inputBuffer) {
  const tempId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  const inputPath = path.join(os.tmpdir(), `input_${tempId}.pdf`);
  const outputPath = path.join(os.tmpdir(), `output_${tempId}.pdf`);

  try {
    // 1. Guardar buffer en archivo temporal
    await fs.writeFile(inputPath, inputBuffer);

    // 2. Desencriptar y reestructurar el archivo con qpdf
    await execFileAsync('qpdf', ['--decrypt', inputPath, outputPath]);

    // 3. Leer el buffer procesado y limpio
    const cleanedBuffer = await fs.readFile(outputPath);
    return cleanedBuffer;
  } catch (error) {
    // Si qpdf no puede procesarlo (p. ej. requiere contraseña de apertura de usuario),
    // se continúa con el buffer original como fallback.
    console.warn('Advertencia [qpdf]: No se pudo desencriptar el archivo con qpdf. Usando archivo original:', error.message);
    return inputBuffer;
  } finally {
    // Limpieza garantizada de archivos temporales de disco
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// Ruta para unir documentos PDF
app.post('/merge', upload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).send('No se han adjuntado archivos PDF.');
    }

    const mergedPdf = await PDFDocument.create();

    for (const file of req.files) {
      // Normalización previa con QPDF
      const cleanedBuffer = await cleanPdfBuffer(file.buffer);

      // Carga en pdf-lib
      const pdf = await PDFDocument.load(cleanedBuffer);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const mergedPdfBytes = await mergedPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=documento_unido.pdf');
    res.send(Buffer.from(mergedPdfBytes));
  } catch (err) {
    console.error('Error durante la unión de PDFs:', err);
    res.status(500).send('Ocurrió un error al procesar y unir los archivos PDF.');
  }
});

app.listen(port, () => {
  console.log(`Servidor ejecutándose correctamente en el puerto ${port}`);
});
