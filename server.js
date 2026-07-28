const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const { PDFDocument } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de CORS
app.use(cors());

// Aumentar el límite del payload JSON para peticiones de compresión pesadas
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Servir archivos estáticos de la carpeta public
app.use(express.static(path.join(__dirname, 'public')));

// Configuración de almacenamiento temporal para subidas con Multer
const uploadDir = path.join(__dirname, 'tmp/uploads');
const outputDir = path.join(__dirname, 'tmp/outputs');
fs.ensureDirSync(uploadDir);
fs.ensureDirSync(outputDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ============================================================
// ENDPOINT DE COMPRESIÓN (/compress)
// ============================================================
app.post('/compress', async (req, res) => {
    try {
        const { images, level } = req.body;

        if (!images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).send('No se proporcionaron imágenes para comprimir.');
        }

        const pdfDoc = await PDFDocument.create();

        for (const dataUrl of images) {
            const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const embeddedImage = await pdfDoc.embedJpg(imageBuffer);

            const page = pdfDoc.addPage([embeddedImage.width, embeddedImage.height]);
            page.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: embeddedImage.width,
                height: embeddedImage.height,
            });
        }

        const pdfBytes = await pdfDoc.save();
        const outputPath = path.join(outputDir, `compressed_${Date.now()}.pdf`);
        await fs.writeFile(outputPath, pdfBytes);

        res.download(outputPath, `compressed_${level || 'opt'}.pdf`, async (err) => {
            if (err) console.error('Error al enviar el archivo:', err);
            await fs.remove(outputPath).catch(() => {});
        });

    } catch (error) {
        console.error('Error en /compress:', error);
        res.status(500).json({ error: 'Ocurrió un error en el servidor.', message: error.message });
    }
});

// Arrancar el servidor
app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
