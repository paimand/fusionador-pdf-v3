const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Garantizar la existencia de la carpeta temporal 'uploads'
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuración de Multer para recepción de archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // Límite de 100 MB
});

// Middlewares estándar
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Servir las vistas de la aplicación
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
// RUTA DE COMPRESIÓN CON GHOSTSCRIPT (BLINDADA)
// ============================================================
app.post('/compress', (req, res) => {
    upload.single('pdf')(req, res, (err) => {
        if (err) {
            console.error('Error al subir el archivo:', err);
            return res.status(400).send('Error en la transferencia del archivo.');
        }

        if (!req.file) {
            return res.status(400).send('No se ha recibido ningún archivo PDF.');
        }

        const inputPath = req.file.path;
        const outputPath = path.join(uploadDir, `compressed_${Date.now()}_${req.file.originalname}`);
        const level = req.body.level || 'recommended';

        // Mapeo de perfiles nativos Ghostscript:
        // /screen  -> Extreme (~12% - 72 DPI)
        // /ebook   -> Recommended (~45% - 150 DPI)
        // /printer -> Low (~95% - 300 DPI, optimización interna)
        let gsSetting = '/ebook';
        if (level === 'extreme') gsSetting = '/screen';
        if (level === 'low') gsSetting = '/printer';

        // Comando nativo Ghostscript
        const command = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=${gsSetting} -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;

        // Timeout de seguridad de 60 segundos por si el archivo es grande
        exec(command, { timeout: 60000 }, (error, stdout, stderr) => {
            // Eliminar siempre el archivo original recibido
            if (fs.existsSync(inputPath)) {
                try { fs.unlinkSync(inputPath); } catch (e) {}
            }

            if (error) {
                console.error('Error ejecutando Ghostscript:', error || stderr);
                if (fs.existsSync(outputPath)) {
                    try { fs.unlinkSync(outputPath); } catch (e) {}
                }
                return res.status(500).send('Error interno al comprimir el PDF.');
            }

            if (!fs.existsSync(outputPath)) {
                return res.status(500).send('No se generó el archivo procesado.');
            }

            // Descargar el archivo comprimido generado
            res.download(outputPath, `comprimido_${req.file.originalname}`, (downloadErr) => {
                if (downloadErr) {
                    console.error('Error al enviar descarga:', downloadErr);
                }
                // Eliminar el archivo de salida procesado
                if (fs.existsSync(outputPath)) {
                    try { fs.unlinkSync(outputPath); } catch (e) {}
                }
            });
        });
    });
});

// ============================================================
// OTRAS RUTAS DE TU APLICACIÓN (MERGE, SPLIT, ETC.)
// (Mantiene tus endpoints de pdf-lib sin modificaciones)
// ============================================================

app.listen(PORT, () => {
    console.log(`Servidor iniciado correctamente en el puerto ${PORT}`);
});
