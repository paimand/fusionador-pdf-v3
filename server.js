const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de almacenamiento temporal para la compresión
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 100 * 1024 * 1024 } // Límite de 100MB
});

// Middleware para JSON y estáticos
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Asegurar que existe el directorio de uploads
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// Servir las páginas HTML
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
// RUTA DE COMPRESIÓN CON GHOSTSCRIPT
// ============================================================
app.post('/compress', upload.single('pdf'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No se ha recibido ningún archivo PDF.');
    }

    const inputPath = req.file.path;
    const outputPath = path.join('uploads', `compressed_${Date.now()}_${req.file.originalname}`);
    const level = req.body.level || 'recommended';

    // Mapeo de perfiles nativos de Ghostscript:
    // /screen  -> Extreme (~12% - 72 DPI)
    // /ebook   -> Recommended (~45% - 150 DPI)
    // /printer -> Low (~95% - 300 DPI, optimización interna sin alterar calidad)
    let gsSetting = '/ebook';
    if (level === 'extreme') gsSetting = '/screen';
    if (level === 'low') gsSetting = '/printer';

    // Comando nativo Ghostscript
    const command = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=${gsSetting} -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;

    exec(command, (error, stdout, stderr) => {
        // Limpiar el archivo de entrada original
        if (fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
        }

        if (error) {
            console.error('Error procesando Ghostscript:', error || stderr);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            return res.status(500).send('Error interno al comprimir el archivo PDF.');
        }

        // Comprobar que el archivo resultante exista
        if (!fs.existsSync(outputPath)) {
            return res.status(500).send('No se pudo generar el archivo comprimido.');
        }

        // Enviar el archivo comprimido para descarga
        res.download(outputPath, `comprimido_${req.file.originalname}`, (err) => {
            // Limpiar el archivo procesado tras la descarga
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
        });
    });
});

// ============================================================
// RESTO DE RUTAS DE TU APLICACIÓN (MERGE, SPLIT, ETC.)
// (Mantiene exactamente el código que ya tenías funcional)
// ============================================================

app.listen(PORT, () => {
    console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
