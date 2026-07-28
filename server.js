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
        cb(null, uniqueSuffix + '-' + file.originalname.replace(/\s+/g, '_'));
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
// RUTA DE COMPRESIÓN CON GHOSTSCRIPT (RUTA ABSOLUTA RENDER)
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
        const safeOriginalName = req.file.originalname.replace(/\s+/g, '_');
        const outputPath = path.join(uploadDir, `compressed_${Date.now()}_${safeOriginalName}`);
        const level = req.body.level || 'recommended';

        // Mapeo de perfiles nativos Ghostscript
        let gsSetting = '/ebook';
        if (level === 'extreme') gsSetting = '/screen';
        if (level === 'low') gsSetting = '/printer';

        // Usamos la ruta binaria explícita /usr/bin/gs en Linux
        const gsBinary = process.platform === 'win32' ? 'gswin64c' : '/usr/bin/gs';
        
        // Comando Ghostscript optimizado
        const command = `${gsBinary} -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=${gsSetting} -dNOPAUSE -dQUIET -dBATCH -sOutputFile="${outputPath}" "${inputPath}"`;

        exec(command, { timeout: 90000 }, (error, stdout, stderr) => {
            // Eliminar siempre el archivo original recibido
            if (fs.existsSync(inputPath)) {
                try { fs.unlinkSync(inputPath); } catch (e) {}
            }

            if (error) {
                console.error('Error ejecutando Ghostscript:', error);
                console.error('Stderr:', stderr);
                if (fs.existsSync(outputPath)) {
                    try { fs.unlinkSync(outputPath); } catch (e) {}
                }
                // Retornamos el detalle real del error para depuración
                return res.status(500).send(`Error de compresión (${error.code || 'GS_FAIL'}): ${stderr || error.message}`);
            }

            if (!fs.existsSync(outputPath)) {
                return res.status(500).send('No se pudo generar el archivo procesado en el servidor.');
            }

            // Descargar el archivo comprimido generado
            res.download(outputPath, `comprimido_${safeOriginalName}`, (downloadErr) => {
                if (downloadErr) {
                    console.error('Error al enviar la descarga:', downloadErr);
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
// RESTO DE RUTAS DE TU APLICACIÓN (MERGE, SPLIT, ETC.)
// ============================================================

app.listen(PORT, () => {
    console.log(`Servidor iniciado correctamente en el puerto ${PORT}`);
});
