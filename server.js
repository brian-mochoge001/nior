const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'barcodes.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Ensure barcodes.json exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ barcodes: [], generatedAt: [] }, null, 2));
}

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET all stored barcodes
app.get('/api/barcodes', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read barcodes file' });
  }
});

// POST generate new barcodes
app.post('/api/barcodes/generate', (req, res) => {
  try {
    const { count, prefix } = req.body;

    if (!count || count < 1 || count > 10000) {
      return res.status(400).json({ error: 'Count must be between 1 and 10000' });
    }

    // Read existing barcodes
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const existingSet = new Set(data.barcodes);

    const eanPrefix = prefix || '200'; // Use 200-299 range (internal use / in-store)
    const newBarcodes = [];
    let attempts = 0;
    const maxAttempts = count * 100;

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

    // Save to file
    data.barcodes = Array.from(existingSet);
    data.generatedAt.push({
      timestamp: new Date().toISOString(),
      count: newBarcodes.length,
      prefix: eanPrefix
    });

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    res.json({
      generated: newBarcodes.length,
      barcodes: newBarcodes,
      totalStored: data.barcodes.length
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate barcodes' });
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

app.listen(PORT, () => {
  console.log(`🔷 Nior Barcode Generator running at http://localhost:${PORT}`);
});
