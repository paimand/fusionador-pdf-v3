const express = require('express');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

const app = express();
const PORT = process.env.PORT || 3000;

// Garantizar la existencia de la carpeta temporal 'uploads'
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Middlewares estándar con límite ampliado para JSON
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Servir las vistas HTML
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/merge.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'merge.html'));
});

app.get('/split.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'split.html'));
});

app.get('/compress.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'compress.html'));
});

// ============================================================
// RUTA DE COMPRESIÓN ULTRARRÁPIDA (RECONSTRUCCIÓN DE PÁGINAS)
// ============================================================
app.post('/compress', async (req, res) => {
    try {
        const { images, level } = req.body;

        if (!images || !Array.isArray(images) || images.length === 0) {
            return res.status(400).send('No se han recibido páginas para procesar.');
        }

        // Crear un nuevo documento PDF limpio
        const pdfDoc = await PDFDocument.create();

        for (const dataUrl of images) {
            // Extraer el base64 de la imagen JPEG
            const base64Data = dataUrl.replace(/^data:image\/jpeg;base64,/, '');
            const imageBuffer = Buffer.from(base64Data, 'base64');

            // Incrustar la imagen optimizada
            const embeddedImage = await pdfDoc.embedJpg(imageBuffer);
            const { width, height } = embeddedImage;

            // Crear página adaptada al tamaño exacto de la imagen
            const page = pdfDoc.addPage([width, height]);
            page.drawImage(embeddedImage, {
                x: 0,
                y: 0,
                width: width,
                height: height,
            });
        }

        // Guardar el nuevo documento optimizado
        const pdfBytes = await pdfDoc.save();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="compressed_${level || 'result'}.pdf"`);
        return res.send(Buffer.from(pdfBytes));

    } catch (error) {
        console.error('Error procesando compresión rápida:', error);
        return res.status(500).send('Error interno reconstruyendo el PDF comprimido.');
    }
});

// ============================================================
// RESTO DE RUTAS DE TU APLICACIÓN (MERGE, SPLIT, ETC.)
// ============================================================

app.listen(PORT, () => {
    console.log(`Servidor iniciado correctamente en el puerto ${PORT}`);
});
