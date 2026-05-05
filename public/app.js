/* ============================================
   NIOR — App Logic
   EAN-13 Barcode Generation + PDF Export
   ============================================ */

const API_BASE = '';
const COLS = 6;
const ROWS = 8;
const PER_PAGE = COLS * ROWS; // 48 barcodes per A4 page

// ---- State ----
let lastGeneratedBarcodes = [];

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
});

// ---- API Helpers ----

async function apiFetch(url, options = {}) {
  const res = await fetch(API_BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

async function loadStats() {
  try {
    const data = await apiFetch('/api/barcodes');
    document.getElementById('totalStored').textContent = data.barcodes.length.toLocaleString();
    renderHistory(data.generatedAt || []);
  } catch {
    document.getElementById('totalStored').textContent = '0';
  }
}

// ---- Generate Barcodes ----

async function generateBarcodes() {
  const countInput = document.getElementById('barcodeCount');
  const prefixInput = document.getElementById('barcodePrefix');
  const btn = document.getElementById('generateBtn');

  const count = parseInt(countInput.value, 10);
  const prefix = prefixInput.value.trim() || '200';

  if (!count || count < 1 || count > 10000) {
    showToast('Please enter a number between 1 and 10,000', 'error');
    return;
  }

  // Show progress
  btn.classList.add('loading');
  btn.disabled = true;
  showStatus('Generating…', `Creating ${count.toLocaleString()} unique EAN-13 barcodes`);
  updateProgress(10);

  try {
    updateProgress(30);

    const result = await apiFetch('/api/barcodes/generate', {
      method: 'POST',
      body: JSON.stringify({ count, prefix })
    });

    updateProgress(60);
    lastGeneratedBarcodes = result.barcodes;

    // Show preview (first page worth)
    showPreview(result.barcodes.slice(0, PER_PAGE));
    updateProgress(80);

    // Generate PDF
    updateStatusText('Building PDF…', `Laying out ${result.generated} barcodes in ${Math.ceil(result.generated / PER_PAGE)} page(s)`);
    await generatePDF(result.barcodes);

    updateProgress(100);
    updateStatusText('Complete!', `Generated ${result.generated} barcodes · PDF downloaded`);

    // Update stats
    document.getElementById('totalStored').textContent = result.totalStored.toLocaleString();
    loadStats();

    showToast(`✓ ${result.generated} barcodes generated & PDF downloaded`, 'success');

  } catch (err) {
    showToast(err.message, 'error');
    hideStatus();
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ---- PDF Generation ----

async function generatePDF(barcodes) {
  const { jsPDF } = window.jspdf;

  // A4 dimensions in mm
  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 10;
  const marginY = 10;

  const cellWidth = (pageWidth - 2 * marginX) / COLS;
  const cellHeight = (pageHeight - 2 * marginY) / ROWS;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const totalPages = Math.ceil(barcodes.length / PER_PAGE);

  for (let page = 0; page < totalPages; page++) {
    if (page > 0) doc.addPage();

    const startIdx = page * PER_PAGE;
    const pageBarcodes = barcodes.slice(startIdx, startIdx + PER_PAGE);

    for (let i = 0; i < pageBarcodes.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);

      const x = marginX + col * cellWidth;
      const y = marginY + row * cellHeight;

      // Create a temporary canvas for the barcode
      const canvas = document.createElement('canvas');

      JsBarcode(canvas, pageBarcodes[i], {
        format: 'EAN13',
        width: 2,
        height: 50,
        displayValue: true,
        fontSize: 14,
        font: 'monospace',
        textMargin: 2,
        margin: 4,
        background: '#ffffff'
      });

      // Add barcode image to PDF
      const imgData = canvas.toDataURL('image/png');
      const barcodeAspect = canvas.width / canvas.height;

      // Fit barcode in cell with padding
      const padding = 2;
      const availWidth = cellWidth - 2 * padding;
      const availHeight = cellHeight - 2 * padding;

      let drawWidth, drawHeight;
      if (availWidth / availHeight > barcodeAspect) {
        drawHeight = availHeight;
        drawWidth = drawHeight * barcodeAspect;
      } else {
        drawWidth = availWidth;
        drawHeight = drawWidth / barcodeAspect;
      }

      const drawX = x + padding + (availWidth - drawWidth) / 2;
      const drawY = y + padding + (availHeight - drawHeight) / 2;

      doc.addImage(imgData, 'PNG', drawX, drawY, drawWidth, drawHeight);
    }

    // Update progress for multi-page PDFs
    const pdfProgress = 80 + (page / totalPages) * 18;
    updateProgress(Math.round(pdfProgress));
  }

  // Download the PDF
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  doc.save(`nior-barcodes-${timestamp}.pdf`);
}

// ---- Preview ----

function showPreview(barcodes) {
  const section = document.getElementById('previewSection');
  const grid = document.getElementById('previewGrid');
  const badge = document.getElementById('previewBadge');

  section.style.display = 'block';
  badge.textContent = `${lastGeneratedBarcodes.length} barcodes · ${Math.ceil(lastGeneratedBarcodes.length / PER_PAGE)} page(s)`;

  grid.innerHTML = '';

  barcodes.forEach((code, idx) => {
    const item = document.createElement('div');
    item.className = 'preview-item';
    item.style.animationDelay = `${idx * 20}ms`;

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    item.appendChild(svgEl);

    grid.appendChild(item);

    JsBarcode(svgEl, code, {
      format: 'EAN13',
      width: 1.2,
      height: 35,
      displayValue: true,
      fontSize: 10,
      font: 'monospace',
      textMargin: 1,
      margin: 2,
      background: '#ffffff',
      lineColor: '#1a1a2e'
    });
  });
}

// ---- Status / Progress ----

function showStatus(title, message) {
  const card = document.getElementById('statusCard');
  card.style.display = 'block';
  document.getElementById('statusTitle').textContent = title;
  document.getElementById('statusMessage').textContent = message;
}

function updateStatusText(title, message) {
  document.getElementById('statusTitle').textContent = title;
  document.getElementById('statusMessage').textContent = message;
}

function hideStatus() {
  document.getElementById('statusCard').style.display = 'none';
}

function updateProgress(percent) {
  const circle = document.getElementById('progressCircle');
  const text = document.getElementById('progressText');
  const circumference = 2 * Math.PI * 26; // r=26
  const offset = circumference - (percent / 100) * circumference;
  circle.style.strokeDashoffset = offset;
  text.textContent = `${percent}%`;
}

// ---- History ----

function renderHistory(entries) {
  const list = document.getElementById('historyList');

  if (!entries.length) {
    list.innerHTML = '<p class="empty-state">No barcodes generated yet</p>';
    return;
  }

  // Show most recent first, limit to 20
  const recent = entries.slice(-20).reverse();

  list.innerHTML = recent.map(entry => {
    const date = new Date(entry.timestamp);
    const formatted = date.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    return `
      <div class="history-item">
        <div class="history-item-info">
          <span class="history-item-count">${entry.count} barcode${entry.count !== 1 ? 's' : ''}</span>
          <span class="history-item-date">${formatted}</span>
        </div>
        <span class="history-item-prefix">Prefix: ${entry.prefix}</span>
      </div>
    `;
  }).join('');
}

// ---- Clear All ----

async function clearAllBarcodes() {
  if (!confirm('This will delete all stored barcode history. Are you sure?')) return;

  try {
    await apiFetch('/api/barcodes', { method: 'DELETE' });
    document.getElementById('totalStored').textContent = '0';
    document.getElementById('previewSection').style.display = 'none';
    hideStatus();
    loadStats();
    showToast('All barcode history cleared', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---- Toast ----

function showToast(message, type = 'success') {
  // Remove existing toasts
  document.querySelectorAll('.toast').forEach(t => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3200);
}
