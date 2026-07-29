// ============================================================
// ENDPOINT: DIVIDIR / EXTRAER PDF (/split)
// ============================================================
app.post('/split', upload.single('file'), async (req, res) => {
    try {
        const file = req.file || (req.files && req.files[0]);
        if (!file) {
            return res.status(400).send('No se ha recibido ningún archivo PDF.');
        }

        const mode = req.body.mode || 'individual';
        const rangesStr = req.body.ranges || '';
        const mergeRanges = req.body.mergeRanges === 'true' || req.body.mergeRanges === true;

        const cleanedBuffer = await cleanPdfBuffer(file.buffer);
        const srcPdf = await PDFDocument.load(cleanedBuffer, { ignoreEncryption: true });
        const totalPages = srcPdf.getPageCount();

        // ------------------------------------------------------------
        // MODO 1: DIVIDIR EN PÁGINAS INDIVIDUALES (ZIP)
        // ------------------------------------------------------------
        if (mode === 'individual' || mode === 'pages') {
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="paginas_divididas.zip"');

            const archive = Archiver('zip', { zlib: { level: 9 } });
            archive.pipe(res);

            for (let i = 0; i < totalPages; i++) {
                const singleDoc = await PDFDocument.create();
                const [copiedPage] = await singleDoc.copyPages(srcPdf, [i]);
                singleDoc.addPage(copiedPage);
                const pdfBytes = await singleDoc.save();

                archive.append(Buffer.from(pdfBytes), { name: `pagina_${i + 1}.pdf` });
            }

            await archive.finalize();
            return;
        }

        // ------------------------------------------------------------
        // MODO 2: DIVIDIR POR RANGOS
        // ------------------------------------------------------------
        const rawGroups = rangesStr.split(',').map(s => s.trim()).filter(Boolean);
        const rangeList = []; // Array de arrays de índices base-0

        for (const group of rawGroups) {
            const indices = [];
            if (group.includes('-')) {
                const [start, end] = group.split('-').map(n => parseInt(n.trim(), 10));
                const pStart = isNaN(start) ? 1 : Math.max(1, start);
                const pEnd = isNaN(end) ? totalPages : Math.min(totalPages, end);
                for (let p = pStart; p <= pEnd; p++) indices.push(p - 1);
            } else {
                const p = parseInt(group, 10);
                if (!isNaN(p) && p >= 1 && p <= totalPages) indices.push(p - 1);
            }
            if (indices.length > 0) {
                rangeList.push({ name: group, indices });
            }
        }

        if (rangeList.length === 0) {
            return res.status(400).send('No se han especificado rangos válidos.');
        }

        // OPCIÓN A: UNIR TODOS LOS RANGOS EN UN ÚNICO PDF
        if (mergeRanges) {
            const newPdf = await PDFDocument.create();
            
            for (const item of rangeList) {
                const copiedPages = await newPdf.copyPages(srcPdf, item.indices);
                copiedPages.forEach(p => newPdf.addPage(p));
            }

            const pdfBytes = await newPdf.save();

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'attachment; filename="rangos_unidos.pdf"');
            return res.send(Buffer.from(pdfBytes));
        }

        // OPCIÓN B: CADA RANGO EN UN PDF INDEPENDIENTE (ZIP)
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="rangos_divididos.zip"');

        const archive = Archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        for (let idx = 0; idx < rangeList.length; idx++) {
            const item = rangeList[idx];
            const rangeDoc = await PDFDocument.create();
            const copiedPages = await rangeDoc.copyPages(srcPdf, item.indices);
            copiedPages.forEach(p => rangeDoc.addPage(p));
            
            const pdfBytes = await rangeDoc.save();
            const fileName = `rango_${item.name.replace(/\s+/g, '_')}.pdf`;
            archive.append(Buffer.from(pdfBytes), { name: fileName });
        }

        await archive.finalize();
        return;

    } catch (error) {
        console.error('Error en /split:', error);
        return res.status(500).send('Error dividiendo las páginas: ' + error.message);
    }
});
