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

// Configuración de Multer sin restricción de nombre de campo
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite 50MB por archivo
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * Desencripta y repara el PDF usando qpdf antes de que pdf-lib lo procese.
 */
async function cleanPdfBuffer(inputBuffer) {
  const tempId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  const inputPath = path.join(os.tmpdir(), `input_${tempId}.pdf`);
  const outputPath = path.join(os.tmpdir(), `output_${tempId}.pdf`);

  try {
    await fs.writeFile(inputPath, inputBuffer);

    // Desencriptar y reestructurar el PDF
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

// upload.any() acepta archivos sin importar el nombre de campo que envíe el cliente
app.post('/merge', upload.any(), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo PDF.' });
    }

    const mergedPdf = await PDFDocument.create();

    for (const file of req.files) {
      try {
        // Step 1: Desencriptar con qpdf (elimina bloqueos de CaixaBank, BBVA, etc.)
        const cleanedBuffer = await cleanPdfBuffer(file.buffer);

        // Step 2: Cargar y unir páginas
        const pdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

        copiedPages.forEach((page) => mergedPdf.addPage(page));
      } catch (fileErr) {
        console.error(`Error al procesar el archivo ${file.originalname}:`, fileErr);
        return res.status(422).json({ 
          error: `No se pudo procesar el archivo "${file.originalname}". Comprueba que no esté corrupto.` 
        });
      }
    }

    const mergedPdfBytes = await mergedPdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="documento_unido.pdf"');
    res.send(Buffer.from(mergedPdfBytes));

  } catch (err) {
    console.error('Error general en /merge:', err);
    res.status(500).json({ 
      error: 'Ocurrió un error al unir los documentos PDF.',
      details: err.message 
    });
  }
});

// Middleware global para capturar errores de Multer o del sistema y devolver JSON
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Error en la subida de archivos: ${err.message}` });
  } else if (err) {
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
  next();
});

app.use((req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

app.listen(port, () => {
  console.log(`Servidor ejecutándose correctamente en el puerto ${port}`);
});
