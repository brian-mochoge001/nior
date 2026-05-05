const express = require('express');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Required for Render
const IS_PROD = process.env.NODE_ENV === 'production';
const DATA_FILE = path.join(__dirname, 'data', 'barcodes.json');
const DEFAULT_DATA = { barcodes: [], generatedAt: [] };

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Safely read and parse the barcodes JSON file.
 * Returns a valid default if the file is missing, empty, or corrupt.
 */
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8').trim();
    if (!raw) return { ...DEFAULT_DATA };
    const parsed = JSON.parse(raw);
    // Ensure the shape is correct
    return {
      barcodes: Array.isArray(parsed.barcodes) ? parsed.barcodes : [],
      generatedAt: Array.isArray(parsed.generatedAt) ? parsed.generatedAt : []
    };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

// Initialize data file if missing
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
}

app.use(cors());
app.use(compression()); // Gzip responses for faster load times on Render
app.use(morgan(IS_PROD ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: IS_PROD ? '1d' : 0 // Cache static assets in production
}));

// Health check endpoint for Render
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// GET all stored barcodes
app.get('/api/barcodes', (req, res) => {
  const data = readData();
  res.json(data);
});

// POST generate new barcodes (modified for pageCount)
app.post('/api/barcodes/generate', (req, res) => {
  try {
    const { pageCount, prefix } = req.body; // Changed from 'count' to 'pageCount'
    const PER_PAGE = 48; // Constant for barcodes per page

    if (!pageCount || pageCount < 1 || pageCount > 200) { // Updated validation for page count
      return res.status(400).json({ error: 'Page count must be between 1 and 200' });
    }

    const count = pageCount * PER_PAGE; // Calculate total barcodes needed

    // Read existing barcodes
    const data = readData();
    const existingSet = new Set(data.barcodes);

    const eanPrefix = prefix || '200'; // Use 200-299 range (internal use / in-store)
    const newBarcodes = [];
    let attempts = 0;
    const maxAttempts = count * 100; // Increased max attempts to ensure unique barcodes

    while (newBarcodes.length < count && attempts < maxAttempts) {
      attempts++;
      // Generate random 9-digit product code portion
      const randomPart = Math.floor(Math.random() * 1000000000).toString().padStart(9, '0');
      const partial = eanPrefix + randomPart;

      // Ensure we have exactly 12 digits before check digit
      const digits12 = partial.substring(0, 12);

      // Calculate EAN-13 check digit
      const checkDigit = calculateEAN13CheckDigit(digits12);
      const ean13 = digits12 + checkDigit;

      if (!existingSet.has(ean13)) {
        existingSet.add(ean13);
        newBarcodes.push(ean13);
      }
    }

    // Generate a unique ID for this generation batch
    const generationId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    // Save to file
    data.barcodes = Array.from(existingSet);
    data.generatedAt.push({
      id: generationId,
      timestamp: new Date().toISOString(),
      count: newBarcodes.length, // Still report generated count
      prefix: eanPrefix,
      barcodeValues: newBarcodes,
      pageCount: pageCount // Store page count for history
    });

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    res.json({
      generated: newBarcodes.length,
      barcodes: newBarcodes,
      totalStored: data.barcodes.length,
      generationId,
      pageCount: pageCount // Return pageCount to frontend
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate barcodes' });
  }
});

// DELETE a specific generation batch by ID
app.delete('/api/barcodes/generation/:id', (req, res) => {
  try {
    const { id } = req.params;
    const data = readData();

    // Find the generation entry
    const genIndex = data.generatedAt.findIndex(g => g.id === id);
    if (genIndex === -1) {
      return res.status(404).json({ error: 'Generation not found' });
    }

    const generation = data.generatedAt[genIndex];

    // Remove the barcodes that belong to this generation
    if (generation.barcodeValues && generation.barcodeValues.length > 0) {
      const toRemove = new Set(generation.barcodeValues);
      data.barcodes = data.barcodes.filter(b => !toRemove.has(b));
    }

    // Remove the generation entry
    data.generatedAt.splice(genIndex, 1);

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    res.json({
      message: 'Generation deleted',
      removedCount: generation.barcodeValues ? generation.barcodeValues.length : generation.count,
      totalStored: data.barcodes.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete generation' });
  }
});

// DELETE clear all barcodes
app.delete('/api/barcodes', (req, res) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ barcodes: [], generatedAt: [] }, null, 2));
    res.json({ message: 'All barcodes cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear barcodes' });
  }
});

/**
 * Calculate EAN-13 check digit
 * @param {string} digits12 - First 12 digits of the EAN-13
 * @returns {string} - The check digit
 */
function calculateEAN13CheckDigit(digits12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(digits12[i], 10);
    sum += (i % 2 === 0) ? digit : digit * 3;
  }
  const remainder = sum % 10;
  return remainder === 0 ? '0' : (10 - remainder).toString();
}

const server = app.listen(PORT, HOST, () => {
  console.log(`🔷 Nior Barcode Generator running at http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => process.exit(0));
});
