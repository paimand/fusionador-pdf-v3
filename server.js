// ------------------------------------------------------------
// RUTA: COMPRIMIR PDF (Con 3 niveles de compresión)
// ------------------------------------------------------------
app.post('/compress', upload.any(), async (req, res) => {
  const tempId = Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  const inputPath = path.join(os.tmpdir(), `compress_in_${tempId}.pdf`);
  const outputPath = path.join(os.tmpdir(), `compress_out_${tempId}.pdf`);

  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No se ha subido ningún archivo PDF.' });
    }

    const file = req.files[0];
    const level = req.body.level || 'recommended';
    await fs.writeFile(inputPath, file.buffer);

    // Mapeo de configuraciones según el nivel seleccionado
    // /screen = 72 dpi (Extrema)
    // /ebook = 150 dpi (Recomendada)
    // /printer = 300 dpi (Baja compresión / alta calidad)
    let gsSetting = '/ebook';
    if (level === 'extreme') gsSetting = '/screen';
    if (level === 'low') gsSetting = '/printer';

    const gsArgs = [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=${gsSetting}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      `-sOutputFile=${outputPath}`,
      inputPath
    ];

    try {
      // Intentar compresión real mediante Ghostscript
      await execFileAsync('gs', gsArgs);
    } catch (gsError) {
      console.warn('Ghostscript no está disponible o falló, aplicando optimización alternativa con qpdf:', gsError.message);
      
      // Fallback con qpdf si Ghostscript no estuviera instalado en el entorno
      await execFileAsync('qpdf', [
        '--linearize',
        '--object-streams=generate',
        '--recompress-flate',
        inputPath,
        outputPath
      ]);
    }

    const compressedBuffer = await fs.readFile(outputPath);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="comprimido.pdf"');
    res.send(compressedBuffer);

  } catch (err) {
    console.error('Error general en /compress:', err);
    res.status(500).send('Error al comprimir el archivo PDF: ' + err.message);
  } finally {
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
});
