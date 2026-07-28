const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { PDFDocument, degrees, rgb } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. CONFIGURACIÓN Y MIDDLEWARES
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Directorios temporales para subidas y salidas
const UPLOAD_DIR = path.join(__dirname, 'tmp/uploads');
const OUTPUT_DIR = path.join(__dirname, 'tmp/outputs');

fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(OUTPUT_DIR);

// Configuración de Multer para almacenamiento temporal
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite de 50 MB
});

// ==========================================
// 2. TAREAS DE MANTENIMIENTO (CLEANUP)
// ==========================================
// Limpieza periódica de archivos temporales mayores a 30 minutos
const cleanTempFiles = async () => {
  const maxAgeMs = 30 * 60 * 1000; // 30 min
  const now = Date.now();

  [UPLOAD_DIR, OUTPUT_DIR].forEach(async (dir) => {
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
      console.error(`Error al limpiar el directorio ${dir}:`, err);
    }
  });
};

setInterval(cleanTempFiles, 15 * 60 * 1000); // Ejecutar cada 15 minutos

// Auxiliary helper to cleanup files safely after request
const safeUnlink = async (files) => {
  if (!files) return;
  const list = Array.isArray(files) ? files : [files];
  for (const file of list) {
    if (file && file.path) {
      await fs.remove(file.path).catch(() => {});
    }
  }
};

// ==========================================
// 3. RUTAS Y ENDPOINTS DE LA API
// ==========================================

// Health Check (Vital para Render/Cloud deployments)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// ------------------------------------------
// A. UNIR PDFs (Merge)
// ------------------------------------------
app.post('/api/pdf/merge', upload.array('files'), async (req, res, next) => {
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: 'Se requieren al menos 2 archivos PDF para unir.' });
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
// B. DIVIDIR PDF (Split)
// ------------------------------------------
app.post('/api/pdf/split', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo PDF.' });

    const pagesToExtract = req.body.pages ? JSON.parse(req.body.pages) : null; // Ej: [1, 2, 3]
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
// C. ROTAR PÁGINAS (Rotate)
// ------------------------------------------
app.post('/api/pdf/rotate', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo PDF.' });

    const rotationAngle = parseInt(req.body.rotation, 10) || 90; // 90, 180, 270
    const pdfBytes = await fs.readFile(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);

    const pages = pdf.getPages();
    pages.forEach(page => {
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

// ------------------------------------------
// D. ELIMINAR PÁGINAS (Delete Pages)
// ------------------------------------------
app.post('/api/pdf/delete-pages', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo PDF.' });

    // Páginas a eliminar (1-indexed), ej: [2, 5]
    const pagesToDelete = req.body.pages ? JSON.parse(req.body.pages) : [];
    const pdfBytes = await fs.readFile(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    
    const totalPages = pdf.getPageCount();
    const keepIndices = [];

    for (let i = 0; i < totalPages; i++) {
      if (!pagesToDelete.includes(i + 1)) {
        keepIndices.push(i);
      }
    }

    if (keepIndices.length === 0) {
      return res.status(400).json({ error: 'No puedes eliminar todas las páginas del documento.' });
    }

    const newPdf = await PDFDocument.create();
    const copiedPages = await newPdf.copyPages(pdf, keepIndices);
    copiedPages.forEach(page => newPdf.addPage(page));

    const outputBytes = await newPdf.save();
    const outputPath = path.join(OUTPUT_DIR, `editado_${Date.now()}.pdf`);
    await fs.writeFile(outputPath, outputBytes);

    await safeUnlink(req.file);
    res.download(outputPath, 'PDF_Editado.pdf', () => fs.remove(outputPath));
  } catch (error) {
    await safeUnlink(req.file);
    next(error);
  }
});

// ------------------------------------------
// E. CONVERTIR IMÁGENES A PDF (Images to PDF)
// ------------------------------------------
app.post('/api/pdf/images-to-pdf', upload.array('images'), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Debes subir al menos una imagen.' });
    }

    const pdfDoc = await PDFDocument.create();

    for (const file of req.files) {
      const imgBytes = await fs.readFile(file.path);
      const ext = path.extname(file.originalname).toLowerCase();
      let image;

      if (ext === '.jpg' || ext === '.jpeg') {
        image = await pdfDoc.embedJpg(imgBytes);
      } else if (ext === '.png') {
        image = await pdfDoc.embedPng(imgBytes);
      } else {
        continue; // Ignorar formatos no soportados
      }

      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }

    const outputBytes = await pdfDoc.save();
    const outputPath = path.join(OUTPUT_DIR, `imagenes_${Date.now()}.pdf`);
    await fs.writeFile(outputPath, outputBytes);

    await safeUnlink(req.files);
    res.download(outputPath, 'Imagenes_Convertidas.pdf', () => fs.remove(outputPath));
  } catch (error) {
    await safeUnlink(req.files);
    next(error);
  }
});

// ------------------------------------------
// F. MARCA DE AGUA (Watermark)
// ------------------------------------------
app.post('/api/pdf/watermark', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo PDF.' });

    const text = req.body.text || 'CONFIDENCIAL';
    const pdfBytes = await fs.readFile(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);

    const pages = pdf.getPages();
    pages.forEach(page => {
      const { width, height } = page.getSize();
      page.drawText(text, {
        x: width / 4,
        y: height / 2,
        size: 50,
        color: rgb(0.75, 0.75, 0.75),
        rotate: degrees(45),
        opacity: 0.5,
      });
    });

    const outputBytes = await pdf.save();
    const outputPath = path.join(OUTPUT_DIR, `watermark_${Date.now()}.pdf`);
    await fs.writeFile(outputPath, outputBytes);

    await safeUnlink(req.file);
    res.download(outputPath, 'PDF_MarcaDeAgua.pdf', () => fs.remove(outputPath));
  } catch (error) {
    await safeUnlink(req.file);
    next(error);
  }
});

// Catch-all para SPA / Frontend fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) res.status(404).send('Página no encontrada');
  });
});

// ==========================================
// 4. GESTIÓN DE ERRORES GLOBAL
// ==========================================
app.use((err, req, res, next) => {
  console.error('Error interno del servidor:', err);
  res.status(500).json({
    error: 'Ocurrió un error procesando la solicitud.',
    message: err.message
  });
});

// ==========================================
// 5. INICIALIZACIÓN DEL SERVIDOR
// ==========================================
app.listen(PORT, () => {
  console.log(`Servidor SuitePDF ejecutándose en el puerto ${PORT}`);
});
