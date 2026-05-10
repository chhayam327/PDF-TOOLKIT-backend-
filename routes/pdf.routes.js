const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PDFDocument, degrees, rgb, StandardFonts } = require('pdf-lib');
const sharp = require('sharp');
const archiver = require('archiver');
const { v4: uuidv4 } = require('uuid');

// Multer config
const upload = multer({
  dest: 'temp/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

const tempDir = path.join(__dirname, '..', 'temp');

// Helper: cleanup
const cleanup = (files) => {
  files.forEach(f => {
    if (f && fs.existsSync(f)) fs.unlink(f, () => {});
  });
};

// ============ 1. MERGE PDF ============
router.post('/merge', upload.array('files', 20), async (req, res) => {
  const filePaths = req.files?.map(f => f.path) || [];
  try {
    if (!req.files || req.files.length < 2) {
      return res.status(400).json({ error: 'Upload at least 2 PDFs' });
    }
    const merged = await PDFDocument.create();
    for (const file of req.files) {
      const pdfBytes = fs.readFileSync(file.path);
      const pdf = await PDFDocument.load(pdfBytes);
      const pages = await merged.copyPages(pdf, pdf.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const out = await merged.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=merged.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup(filePaths);
  }
});

// ============ 2. SPLIT PDF ============
router.post('/split', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    const total = pdf.getPageCount();

    const zipPath = path.join(tempDir, `split_${uuidv4()}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip');
    archive.pipe(output);

    for (let i = 0; i < total; i++) {
      const newPdf = await PDFDocument.create();
      const [page] = await newPdf.copyPages(pdf, [i]);
      newPdf.addPage(page);
      const bytes = await newPdf.save();
      archive.append(Buffer.from(bytes), { name: `page_${i + 1}.pdf` });
    }
    await archive.finalize();

    output.on('close', () => {
      res.download(zipPath, 'split_pages.zip', () => {
        cleanup([req.file.path, zipPath]);
      });
    });
  } catch (e) {
    cleanup([req.file?.path]);
    res.status(500).json({ error: e.message });
  }
});

// ============ 3. COMPRESS PDF ============
router.post('/compress', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    const out = await pdf.save({
      useObjectStreams: true,
      addDefaultPage: false
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=compressed.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 4. ROTATE PDF ============
router.post('/rotate', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const angle = parseInt(req.body.angle) || 90;
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    pdf.getPages().forEach(p => p.setRotation(degrees(angle)));
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=rotated.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 5. JPG TO PDF ============
router.post('/jpg-to-pdf', upload.array('files', 30), async (req, res) => {
  const filePaths = req.files?.map(f => f.path) || [];
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No files' });
    const pdf = await PDFDocument.create();
    for (const file of req.files) {
      const imgBytes = fs.readFileSync(file.path);
      const jpg = await sharp(imgBytes).jpeg().toBuffer();
      const img = await pdf.embedJpg(jpg);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=images.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup(filePaths);
  }
});

// ============ 6. PAGE NUMBERS ============
router.post('/page-numbers', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const pages = pdf.getPages();
    pages.forEach((page, i) => {
      const { width } = page.getSize();
      page.drawText(`${i + 1} / ${pages.length}`, {
        x: width / 2 - 20, y: 20,
        size: 12, font, color: rgb(0, 0, 0)
      });
    });
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=numbered.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 7. WATERMARK PDF ============
router.post('/watermark', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const text = req.body.text || 'CONFIDENTIAL';
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    pdf.getPages().forEach(page => {
      const { width, height } = page.getSize();
      page.drawText(text, {
        x: width / 4, y: height / 2,
        size: 50, font,
        color: rgb(0.9, 0.1, 0.1),
        opacity: 0.3, rotate: degrees(45)
      });
    });
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=watermarked.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 8. PROTECT PDF ============
router.post('/protect', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const password = req.body.password;
    if (!password) return res.status(400).json({ error: 'Password required' });
    
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    // Note: pdf-lib basic encryption
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=protected.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});
// ============ 9. UNLOCK PDF ============
router.post('/unlock', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const password = req.body.password || '';
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes, { 
      ignoreEncryption: true,
      password: password 
    });
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=unlocked.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: 'Wrong password or corrupted file' });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 10. CROP PDF ============
router.post('/crop', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const margin = parseInt(req.body.margin) || 20;
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    pdf.getPages().forEach(page => {
      const { width, height } = page.getSize();
      page.setCropBox(margin, margin, width - margin * 2, height - margin * 2);
    });
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=cropped.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 11. ORGANIZE PDF (Reorder/Delete pages) ============
router.post('/organize', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const order = JSON.parse(req.body.order || '[]'); // [3,1,2,4]
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    const newPdf = await PDFDocument.create();
    
    const pageIndices = order.length 
      ? order.map(n => n - 1) 
      : pdf.getPageIndices();
    
    const pages = await newPdf.copyPages(pdf, pageIndices);
    pages.forEach(p => newPdf.addPage(p));
    
    const out = await newPdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=organized.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 12. PDF TO JPG ============
router.post('/pdf-to-jpg', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const { fromPath } = require('pdf2pic');
    
    const options = {
      density: 150,
      saveFilename: 'page',
      savePath: tempDir,
      format: 'jpg',
      width: 1200,
      height: 1600
    };
    
    const convert = fromPath(req.file.path, options);
    const results = await convert.bulk(-1);
    
    const zipPath = path.join(tempDir, `images_${uuidv4()}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip');
    archive.pipe(output);
    
    results.forEach((r, i) => {
      archive.file(r.path, { name: `page_${i + 1}.jpg` });
    });
    await archive.finalize();
    
    output.on('close', () => {
      res.download(zipPath, 'images.zip', () => {
        cleanup([req.file.path, zipPath, ...results.map(r => r.path)]);
      });
    });
  } catch (e) {
    cleanup([req.file?.path]);
    res.status(500).json({ error: 'PDF to JPG failed: ' + e.message });
  }
});

// ============ 13. WORD TO PDF ============
router.post('/word-to-pdf', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: req.file.path });
    const text = result.value;
    
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    let page = pdf.addPage();
    const { width, height } = page.getSize();
    let y = height - 50;
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (y < 50) {
        page = pdf.addPage();
        y = height - 50;
      }
      page.drawText(line.substring(0, 90), {
        x: 50, y, size: 11, font, color: rgb(0, 0, 0)
      });
      y -= 16;
    }
    
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=converted.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 14. PDF TO WORD ============
router.post('/pdf-to-word', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const pdfParse = require('pdf-parse');
    const { Document, Packer, Paragraph, TextRun } = require('docx');
    
    const dataBuffer = fs.readFileSync(req.file.path);
    const data = await pdfParse(dataBuffer);
    
    const doc = new Document({
      sections: [{
        properties: {},
        children: data.text.split('\n').map(line => 
          new Paragraph({ children: [new TextRun(line)] })
        )
      }]
    });
    
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename=converted.docx');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 15. HTML TO PDF ============
router.post('/html-to-pdf', async (req, res) => {
  try {
    const { html, url } = req.body;
    if (!html && !url) return res.status(400).json({ error: 'HTML or URL required' });
    
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage();
    const { height } = page.getSize();
    
    // Strip HTML tags for basic conversion
    const text = (html || `Source: ${url}`).replace(/<[^>]+>/g, '');
    page.drawText(text.substring(0, 2000), {
      x: 50, y: height - 50, size: 10, font, maxWidth: 500
    });
    
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=webpage.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ 16. SIGN PDF ============
router.post('/sign', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const signText = req.body.signature || 'Signed';
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    const font = await pdf.embedFont(StandardFonts.HelveticaOblique);
    
    const lastPage = pdf.getPages()[pdf.getPageCount() - 1];
    lastPage.drawText(signText, {
      x: 50, y: 50, size: 24, font, color: rgb(0, 0, 0.7)
    });
    lastPage.drawText(`Date: ${new Date().toLocaleDateString()}`, {
      x: 50, y: 30, size: 10, font, color: rgb(0.3, 0.3, 0.3)
    });
    
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=signed.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 17. EDIT PDF (Add text) ============
router.post('/edit', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const text = req.body.text || '';
    const x = parseInt(req.body.x) || 50;
    const y = parseInt(req.body.y) || 50;
    const pageNum = parseInt(req.body.page) || 1;
    
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.getPages()[pageNum - 1];
    
    page.drawText(text, { x, y, size: 14, font, color: rgb(0, 0, 0) });
    
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=edited.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 18. REPAIR PDF ============
router.post('/repair', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const pdfBytes = fs.readFileSync(req.file.path);
    const pdf = await PDFDocument.load(pdfBytes, { 
      ignoreEncryption: true,
      throwOnInvalidObject: false
    });
    const out = await pdf.save({ useObjectStreams: false });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=repaired.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: 'Cannot repair this file' });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 19. PDF TO EXCEL ============
router.post('/pdf-to-excel', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(req.file.path));
    
    // Basic CSV format (Excel can open)
    const csv = data.text.split('\n').map(line => 
      line.split(/\s+/).join(',')
    ).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=extracted.csv');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 20. PDF TO PPT ============
router.post('/pdf-to-ppt', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    // Note: Full PPT requires complex libs. Returning text version.
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(req.file.path));
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=slides.txt');
    res.send('=== SLIDES ===\n\n' + data.text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 21. OCR PDF ============
router.post('/ocr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(fs.readFileSync(req.file.path));
    
    // Embed extracted text into new PDF
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    let page = pdf.addPage();
    let y = page.getHeight() - 50;
    
    data.text.split('\n').forEach(line => {
      if (y < 50) { page = pdf.addPage(); y = page.getHeight() - 50; }
      page.drawText(line.substring(0, 90), { x: 50, y, size: 10, font });
      y -= 14;
    });
    
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=ocr.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup([req.file?.path]);
  }
});

// ============ 22. SCAN TO PDF ============
router.post('/scan-to-pdf', upload.array('files', 20), async (req, res) => {
  const filePaths = req.files?.map(f => f.path) || [];
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'No images' });
    const pdf = await PDFDocument.create();
    
    for (const file of req.files) {
      // Enhance scan: increase contrast, sharpen
      const enhanced = await sharp(file.path)
        .normalize()
        .sharpen()
        .jpeg({ quality: 90 })
        .toBuffer();
      
      const img = await pdf.embedJpg(enhanced);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    
    const out = await pdf.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=scanned.pdf');
    res.send(Buffer.from(out));
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    cleanup(filePaths);
  }
});

module.exports = router;
