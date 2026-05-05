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
let pendingDeleteCallback = null;

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
    // If file doesn't exist or API fails, assume 0
    document.getElementById('totalStored').textContent = '0';
    document.getElementById('historyList').innerHTML = '<p class="empty-state">No barcodes generated yet</p>';
  }
}

// ---- Generate Barcodes ----

async function generateBarcodes() {
  const pageCountInput = document.getElementById('pageCount'); // Changed input ID
  const prefixInput = document.getElementById('barcodePrefix');
  const btn = document.getElementById('generateBtn');

  const pageCount = parseInt(pageCountInput.value, 10); // Read pageCount
  const prefix = prefixInput.value.trim() || '200';

  // Updated validation for pageCount
  if (!pageCount || pageCount < 1 || pageCount > 200) {
    showToast('Please enter a number of pages between 1 and 200', 'error');
    return;
  }

  const totalBarcodesToGenerate = pageCount * PER_PAGE; // Calculate total barcodes

  // Show progress
  btn.classList.add('loading');
  btn.disabled = true;
  // Updated status message
  showStatus('Generating…', `Creating ${totalBarcodesToGenerate.toLocaleString()} barcodes across ${pageCount} page(s)`);
  updateProgress(10);

  try {
    updateProgress(30);

    // Changed body to send 'pageCount' instead of 'count'
    const result = await apiFetch('/api/barcodes/generate', {
      method: 'POST',
      body: JSON.stringify({ pageCount, prefix })
    });

    updateProgress(60);
    lastGeneratedBarcodes = result.barcodes;

    // Show preview (first page worth)
    showPreview(result.barcodes.slice(0, PER_PAGE));
    updateProgress(80);

    // Generate PDF and auto-download
    // Updated status message for PDF generation
    updateStatusText('Building PDF…', `Laying out ${result.generated} barcodes in ${Math.ceil(result.generated / PER_PAGE)} page(s)`);
    await generatePDF(result.barcodes);

    updateProgress(100);
    // Updated final status message
    updateStatusText('Complete!', `Generated ${result.generated} barcodes · PDF downloaded`);

    // Update stats
    document.getElementById('totalStored').textContent = result.totalStored.toLocaleString();
    loadStats(); // Reload history and stats

    // Updated toast message
    showToast(`✓ ${result.generated} barcodes generated (${result.pageCount} pages) & PDF downloaded`, 'success');

  } catch (err) {
    showToast(err.message, 'error');
    hideStatus();
  } finally {
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

// ---- PDF Generation ----

async function generatePDF(barcodes, filename) {
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

    // ---- Draw cutting grid lines ----
    doc.setDrawColor(180, 180, 180); // Light grey for cut guides
    doc.setLineWidth(0.3);

    // Vertical lines
    for (let c = 0; c <= COLS; c++) {
      const lx = marginX + c * cellWidth;
      doc.line(lx, marginY, lx, marginY + ROWS * cellHeight);
    }

    // Horizontal lines
    for (let r = 0; r <= ROWS; r++) {
      const ly = marginY + r * cellHeight;
      doc.line(marginX, ly, marginX + COLS * cellWidth, ly);
    }

    // ---- Render barcodes inside the grid ----
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
  const pdfFilename = filename || `nior-barcodes-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.pdf`;
  doc.save(pdfFilename);
}

// ---- Re-download PDF for a past generation ----

async function redownloadPDF(generationId) {
  try {
    const data = await apiFetch('/api/barcodes');
    const generation = (data.generatedAt || []).find(g => g.id === generationId);

    if (!generation || !generation.barcodeValues || generation.barcodeValues.length === 0) {
      showToast('No barcodes found for this generation', 'error');
      return;
    }

    showToast('Building PDF…', 'success');

    const dateStr = new Date(generation.timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    await generatePDF(generation.barcodeValues, `nior-barcodes-${dateStr}.pdf`);

    // Updated toast message
    const numPages = Math.ceil(generation.barcodeValues.length / PER_PAGE);
    showToast(`✓ PDF downloaded (${generation.barcodeValues.length} barcodes, ${numPages} pages)`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ---- Preview ----

function showPreview(barcodes) {
  const section = document.getElementById('previewSection');
  const grid = document.getElementById('previewGrid');
  const badge = document.getElementById('previewBadge');

  section.style.display = 'block';
  // Updated badge to reflect pages
  const numPages = Math.ceil(lastGeneratedBarcodes.length / PER_PAGE);
  badge.textContent = `${lastGeneratedBarcodes.length} barcodes · ${numPages} page(s)`;

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

  // Show most recent first, limit to 50
  const recent = entries.slice(-50).reverse();

  list.innerHTML = recent.map(entry => {
    const date = new Date(entry.timestamp);
    const formatted = date.toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    const hasBarcodesData = entry.barcodeValues && entry.barcodeValues.length > 0;
    const downloadBtnHtml = hasBarcodesData
      ? `<button class="history-action-btn download-btn" onclick="redownloadPDF('${entry.id}')" title="Download PDF">
           <svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"/></svg>
         </button>`
      : '';

    const deleteBtnHtml = entry.id
      ? `<button class="history-action-btn delete-btn" onclick="confirmDeleteGeneration('${entry.id}', ${entry.count})" title="Delete this batch">
           <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>
         </button>`
      : '';

    // Updated to display page count from entry if available, otherwise calculate
    const pages = entry.pageCount || Math.ceil(entry.count / PER_PAGE);
    const pageText = pages === 1 ? 'page' : 'pages';

    return `
      <div class="history-item" id="gen-${entry.id || ''}">
        <div class="history-item-info">
          <span class="history-item-count">${entry.count} barcode${entry.count !== 1 ? 's' : ''} (${pages} ${pageText})</span>
          <span class="history-item-date">${formatted}</span>
        </div>
        <div class="history-item-actions">
          <span class="history-item-prefix">Prefix: ${entry.prefix}</span>
          ${downloadBtnHtml}
          <button class="history-action-btn view-btn" onclick="viewGeneration('${entry.id}')" title="View barcodes">
             <svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zM4 10a6 6 0 0112 0 6 6 0 01-12 0z" clip-rule="evenodd"/></svg>
          </button>
          ${deleteBtnHtml}
        </div>
      </div>
    `;
  }).join('');
}

// ---- Delete Generation ----

function confirmDeleteGeneration(id, count) {
  const modal = document.getElementById('confirmModal');
  const confirmBtn = document.getElementById('modalConfirmBtn');
  const title = document.getElementById('modalTitle');
  const message = document.getElementById('modalMessage');

  title.textContent = 'Delete Generation?';
  message.textContent = `This will permanently remove ${count} barcode${count !== 1 ? 's' : ''} from this batch. This action cannot be undone.`;

  modal.classList.add('active');

  // Set up confirm handler
  pendingDeleteCallback = () => deleteGeneration(id);
  confirmBtn.onclick = () => {
    closeModal();
    if (pendingDeleteCallback) pendingDeleteCallback();
    pendingDeleteCallback = null;
  };
}

async function deleteGeneration(id) {
  try {
    // Add exit animation to the item
    const el = document.getElementById(`gen-${id}`);
    if (el) {
      el.classList.add('removing');
      await new Promise(r => setTimeout(r, 300));
    }

    const result = await apiFetch(`/api/barcodes/generation/${id}`, { method: 'DELETE' });

    document.getElementById('totalStored').textContent = result.totalStored.toLocaleString();
    loadStats();
    showToast(`✓ Deleted ${result.removedCount} barcodes`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
    loadStats(); // Refresh to fix UI
  }
}

// ---- View Generation ----

async function viewGeneration(generationId) {
  try {
    const data = await apiFetch('/api/barcodes');
    const generation = (data.generatedAt || []).find(g => g.id === generationId);

    if (!generation || !generation.barcodeValues || generation.barcodeValues.length === 0) {
      showToast('No barcodes found for this generation', 'error');
      return;
    }

    const modal = document.getElementById('viewModal');
    const modalTitle = document.getElementById('viewModalTitle');
    const modalBarcodesContainer = document.getElementById('viewModalBarcodes');

    modalTitle.textContent = `Viewing Barcodes (${generation.count} total)`;
    modalBarcodesContainer.innerHTML = ''; // Clear previous content

    const barcodeListHtml = generation.barcodeValues.map(code => {
      const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      // JsBarcode will be used to render SVG in the DOM.
      // We'll need to append this SVG to the modal container.
      // For simplicity, we can generate the SVG elements directly here if possible,
      // or dynamically render them after the modal is visible.
      // For now, let's assume we'll render them in the DOM and then use JsBarcode.

      return `<div class="view-barcode-item">
                <svg id="barcode-${code}"></svg>
                <p>${code}</p>
              </div>`;
    }).join('');

    modalBarcodesContainer.innerHTML = barcodeListHtml;

    // Now render the barcodes using JsBarcode
    generation.barcodeValues.forEach(code => {
      JsBarcode(`#barcode-${code}`, code, {
        format: 'EAN13',
        width: 1.5,
        height: 40,
        displayValue: true,
        fontSize: 12,
        font: 'monospace',
        textMargin: 2,
        margin: 3,
        lineColor: '#1a1a2e',
        background: '#ffffff'
      });
    });

    modal.style.display = 'flex'; // Show the modal

  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeViewModal() {
  document.getElementById('viewModal').style.display = 'none';
  // Clear content to avoid lingering data
  document.getElementById('viewModalBarcodes').innerHTML = '';
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.id === 'viewModal') closeViewModal();
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('viewModal').style.display === 'flex') {
    closeViewModal();
  }
});


// ---- Clear All ----

async function clearAllBarcodes() {
  const modal = document.getElementById('confirmModal');
  const confirmBtn = document.getElementById('modalConfirmBtn');
  const title = document.getElementById('modalTitle');
  const message = document.getElementById('modalMessage');

  title.textContent = 'Clear All Barcodes?';
  message.textContent = 'This will permanently delete all stored barcodes and generation history. This action cannot be undone.';

  modal.classList.add('active');

  pendingDeleteCallback = async () => {
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
  };

  confirmBtn.onclick = () => {
    closeModal();
    if (pendingDeleteCallback) pendingDeleteCallback();
    pendingDeleteCallback = null;
  };
}

// ---- Modal ----

function closeModal() {
  document.getElementById('confirmModal').classList.remove('active');
  pendingDeleteCallback = null;
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.id === 'confirmModal') closeModal();
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

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
