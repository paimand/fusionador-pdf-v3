const express = require('express');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Configuración de Multer para almacenar los archivos subidos en memoria RAM
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite de 50MB por archivo
});

// Servir la interfaz estática
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

/**
 * Función para cargar de forma segura un PDF, gestionando permisos de encriptación
 * de entidades bancarias (CaixaBank, BBVA, etc.)
 */
async function loadPdfSafely(buffer) {
  try {
    // Intento 1: Carga estándar del documento
    const pdf = await PDFDocument.load(buffer);
    return pdf;
  } catch (firstError) {
    console.log('Fallo de carga estándar, intentando bypass de encriptación de permisos...');
    try {
      // Intento 2: Ignorar la capa de encriptación de permisos/propietario
      const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
      return pdf;
    } catch (secondError) {
      throw new Error('El PDF está protegido con contraseña de lectura o tiene una estructura incompatible.');
    }
  }
}

// Endpoint principal para la unión de documentos PDF
app.post('/merge', upload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se ha adjuntado ningún archivo PDF.' });
    }

    // Crear el nuevo documento PDF unificado
    const mergedPdf = await PDFDocument.create();
    
    // Registrar fontkit para gestionar incrustación de fuentes complejas (típicas de extractos bancarios)
    mergedPdf.registerFontkit(fontkit);

    for (let index = 0; index < req.files.length; index++) {
      const file = req.files[index];
      
      try {
        // Carga segura del PDF
        const pdf = await loadPdfSafely(file.buffer);
        
        // Copiar todas las páginas al nuevo PDF
        const pageIndices = pdf.getPageIndices();
        const copiedPages = await mergedPdf.copyPages(pdf, pageIndices);

        copiedPages.forEach((page) => {
          mergedPdf.addPage(page);
        });
      } catch (fileError) {
        console.error(`Error procesando el archivo ${file.originalname}:`, fileError.message);
        return res.status(422).json({
          error: `Error al procesar "${file.originalname}": ${fileError.message}`
        });
      }
    }

    // Guardar el archivo unificado
    const mergedPdfBytes = await mergedPdf.save();

    // Enviar respuesta HTTP
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="documento_unido.pdf"');
    res.send(Buffer.from(mergedPdfBytes));

  } catch (err) {
    console.error('Error general en la ruta /merge:', err);
    res.status(500).json({ 
      error: 'Ocurrió un error inesperado al procesar los archivos PDF.',
      details: err.message 
    });
  }
});

// Manejador de rutas no encontradas
app.use((req, res) => {
  res.status(404).send('Página o recurso no encontrado.');
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor de SuitePDF funcionando correctamente en el puerto ${port}`);
});
