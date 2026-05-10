require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Create temp folder
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiter (100 req per 15 min)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, try again later' }
});
app.use('/api/', limiter);

// Health check
app.get('/', (req, res) => {
  res.json({
    status: '✅ PDF Toolkit Backend Running',
    version: '1.0.0',
    tools: 22,
    endpoints: '/api/pdf/*'
  });
});

// PDF Routes
app.use('/api/pdf', require('./routes/pdf.routes'));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Auto-cleanup temp files every 30 min
setInterval(() => {
  fs.readdir(tempDir, (err, files) => {
    if (err) return;
    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      fs.stat(filePath, (err, stats) => {
        if (err) return;
        const age = Date.now() - stats.mtimeMs;
        if (age > 30 * 60 * 1000) fs.unlink(filePath, () => {});
      });
    });
  });
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
