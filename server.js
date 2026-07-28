const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { PDFDocument, degrees, rgb } = require('pdf-lib');

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. MIDDLEWARES Y RUTAS
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Directorios temporales
const UPLOAD_DIR = path.join(__dirname, 'tmp/uploads');
const OUTPUT_DIR = path.join(__dirname, 'tmp/outputs');

fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(OUTPUT_DIR);

// Configuración de Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // Límite de 100 MB
});

// Helper para borrar archivos temporales de forma segura
const safeUnlink = async (files) => {
  if (!files) return;
  const list = Array.isArray(files) ? files : [files];
  for (const file of list) {
    if (file && file.path) {
      await fs.remove(file.path).catch(() => {});
    }
  }
};

// Limpieza automática de archivos antiguos (> 30 minutos)
setInterval(async () => {
  const maxAgeMs = 30 * 60 * 1000;
  const now = Date.now();
  for (const dir of [UPLOAD_DIR, OUTPUT_DIR]) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.remove(filePath);
        }
      }
    } catch (err) {
      console.error('Error al limpiar temporales:', err);
    }
  }
}, 15 * 60 * 1000);

// ==========================================
// 2. ENDPOINTS DE LA API
// ==========================================

// Health check para Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// ------------------------------------------
// COMPRIMIR PDF (FORZANDO RE-MUESTREO AGRESIVO)
// ------------------------------------------
app.post('/compress', upload.any(), async (req, res, next) => {
  const tempId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  const inputPath = path.join(UPLOAD_DIR, `compress_in_${tempId}.pdf`);
  const outputPath = path.join(OUTPUT_DIR, `compress_out_${tempId}.pdf`);

  try {
    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo PDF.' });
    }

    const file = files[0];
    const level = req.body.level || 'recommended';
    await fs.copy(file.path, inputPath);

    // Configurar parámetros de resampleo y calidad
    let dpi = 120;
    let pdfSettings = '/ebook';

    if (level === 'extreme') {
      dpi = 72;
      pdfSettings = '/screen';
    } else if (level === 'recommended') {
      dpi = 120;
      pdfSettings = '/ebook';
    } else if (level === 'low') {
      dpi = 180;
      pdfSettings = '/printer';
    }

    // Argumentos explícitos de Ghostscript para forzar la compresión de imágenes
    const gsArgs = [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=${pdfSettings}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      // Downsampling Imágenes Color
      '-dDownsampleColorImages=true',
      '-dColorImageDownsampleType=/Bicubic',
      `-dColorImageResolution=${dpi}`,
      '-dAutoFilterColorImages=false',
      '-dColorImageFilter=/DCTEncode', // Compresión JPEG obligatoria
      // Downsampling Escala de Grises
      '-dDownsampleGrayImages=true',
      '-dGrayImageDownsampleType=/Bicubic',
      `-dGrayImageResolution=${dpi}`,
      '-dAutoFilterGrayImages=false',
      '-dGrayImageFilter=/DCTEncode',
      // Downsampling Monocromo (Texto escaneado)
      '-dDownsampleMonoImages=true',
      '-dMonoImageDownsampleType=/Bicubic',
      `-dMonoImageResolution=${Math.max(dpi, 120)}`,
      // Estructura y Fuentes
      '-dEmbedAllFonts=true',
      '-dSubsetFonts=true',
      '-dCompressPages=true',
      `-sOutputFile=${outputPath}`,
      inputPath
    ];

    try {
      await execFileAsync('gs', gsArgs);
    } catch (gsError) {
      console.warn('Ghostscript falló, ejecutando fallback con qpdf:', gsError.message);
      await execFileAsync('qpdf', [
        '--linearize',
        '--object-streams=generate',
        '--recompress-flate',
        inputPath,
        outputPath
      ]);
    }

    const inputStats = await fs.stat(inputPath);
    const outputStats = await fs.stat(outputPath);

    console.log(`[Compress] Original: ${inputStats.size} bytes | Resultado: ${outputStats.size} bytes`);

    // Si el resultado es más grande que el original, devolver el original
    const finalPath = (outputStats.size >= inputStats.size && level !== 'extreme') ? inputPath : outputPath;

    res.download(finalPath, 'comprimido.pdf', async () => {
      await safeUnlink(files);
      await fs.remove(inputPath).catch(() => {});
      await fs.remove(outputPath).catch(() => {});
    });

  } catch (err) {
    await safeUnlink(req.files);
    next(err);
  }
});

// ------------------------------------------
// UNIR PDFs (Merge)
// ------------------------------------------
app.post('/api/pdf/merge', upload.array('files'), async (req, res, next) => {
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: 'Se requieren al menos 2 archivos PDF.' });
    }

    const mergedPdf = await PDFDocument.create();

    for (const file of req.files) {
      const pdfBytes = await fs.readFile(file.path);
      const pdf = await PDFDocument.load(pdfBytes);
      const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    }

    const outputBytes = await mergedPdf.save();
    const outputPath = path.join(OUTPUT_DIR, `unido_${Date.now()}.pdf`);
    await fs.writeFile(outputPath, outputBytes);

    await safeUnlink(req.files);
    res.download(outputPath, 'PDF_Unido.pdf', () => fs.remove(outputPath));
  } catch (error) {
    await safeUnlink(req.files);
    next(error);
  }
});

// ------------------------------------------
// DIVIDIR PDF (Split)
// ------------------------------------------
app.post('/api/pdf/split', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo PDF.' });

    const pagesToExtract = req.body.pages ? JSON.parse(req.body.pages) : null;
    const pdfBytes = await fs.readFile(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    const totalPages = pdf.getPageCount();

    const newPdf = await PDFDocument.create();
    const targetIndices = pagesToExtract 
      ? pagesToExtract.map(p => p - 1).filter(idx => idx >= 0 && idx < totalPages)
      : Array.from({ length: totalPages }, (_, i) => i);

    const copiedPages = await newPdf.copyPages(pdf, targetIndices);
    copiedPages.forEach((page) => newPdf.addPage(page));

    const outputBytes = await newPdf.save();
    const outputPath = path.join(OUTPUT_DIR, `dividido_${Date.now()}.pdf`);
    await fs.writeFile(outputPath, outputBytes);

    await safeUnlink(req.file);
    res.download(outputPath, 'PDF_Dividido.pdf', () => fs.remove(outputPath));
  } catch (error) {
    await safeUnlink(req.file);
    next(error);
  }
});

// ------------------------------------------
// ROTAR PÁGINAS (Rotate)
// ------------------------------------------
app.post('/api/pdf/rotate', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo PDF.' });

    const rotationAngle = parseInt(req.body.rotation, 10) || 90;
    const pdfBytes = await fs.readFile(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);

    pdf.getPages().forEach(page => {
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees((currentRotation + rotationAngle) % 360));
    });

    const outputBytes = await pdf.save();
    const outputPath = path.join(OUTPUT_DIR, `rotado_${Date.now()}.pdf`);
    await fs.writeFile(outputPath, outputBytes);

    await safeUnlink(req.file);
    res.download(outputPath, 'PDF_Rotado.pdf', () => fs.remove(outputPath));
  } catch (error) {
    await safeUnlink(req.file);
    next(error);
  }
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) res.status(404).send('Página no encontrada');
  });
});

// Manejador Global de Errores
app.use((err, req, res, next) => {
  console.error('Error interno:', err);
  res.status(500).json({ error: 'Ocurrió un error en el servidor.', message: err.message });
});

app.listen(PORT, () => {
  console.log(`Servidor SuitePDF activo en el puerto ${PORT}`);
});
