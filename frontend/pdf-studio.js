/* ==========================================================================
   CleanLab — Minimal PDF Splitter (Pick Pages Only)
   ========================================================================== */

(() => {
  'use strict';

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  // DOM Elements
  const pdfDropzone = document.getElementById('pdfDropzone');
  const pdfFileInput = document.getElementById('pdfFileInput');
  const pdfBrowseBtn = document.getElementById('pdfBrowseBtn');
  const pdfSampleBtn = document.getElementById('pdfSampleBtn');
  const pdfReplaceBtn = document.getElementById('pdfReplaceBtn');

  const pdfFileBanner = document.getElementById('pdfFileBanner');
  const pdfPageBadge = document.getElementById('pdfPageBadge');
  const pdfFileName = document.getElementById('pdfFileName');
  const pdfFileSize = document.getElementById('pdfFileSize');
  const pdfWorkspace = document.getElementById('pdfWorkspace');

  const pdfThumbGrid = document.getElementById('pdfThumbGrid');
  const pdfThumbStatus = document.getElementById('pdfThumbStatus');

  const pdfExprInput = document.getElementById('pdfExprInput');
  const pdfPickOutputRadios = [...document.querySelectorAll('input[name="pdfPickOutput"]')];
  const pdfPrefixInput = document.getElementById('pdfPrefixInput');
  const pdfZipCheck = document.getElementById('pdfZipCheck');
  const pdfPlanSummary = document.getElementById('pdfPlanSummary');
  const pdfErrorBox = document.getElementById('pdfErrorBox');

  const pdfSplitBtn = document.getElementById('pdfSplitBtn');
  const pdfProgressStage = document.getElementById('pdfProgressStage');
  const pdfProgressFill = document.getElementById('pdfProgressFill');
  const pdfProgressText = document.getElementById('pdfProgressText');

  const pdfResultsDeck = document.getElementById('pdfResultsDeck');
  const pdfResultCount = document.getElementById('pdfResultCount');
  const pdfZipRow = document.getElementById('pdfZipRow');
  const pdfDownloadZipBtn = document.getElementById('pdfDownloadZipBtn');
  const pdfResultsList = document.getElementById('pdfResultsList');

  // Zoom Modal
  const pdfZoomModal = document.getElementById('pdfZoomModal');
  const pdfZoomTitle = document.getElementById('pdfZoomTitle');
  const pdfZoomCanvas = document.getElementById('pdfZoomCanvas');
  const pdfZoomCloseBtn = document.getElementById('pdfZoomCloseBtn');

  // State
  let masterBytes = null;
  let pdfLibDoc = null;
  let pdfJsDoc = null;
  let totalPages = 0;
  let currentFileName = 'document.pdf';
  let selectedPages = new Set();
  let outputUrls = [];
  let zipDownloadUrl = null;
  let splitting = false;
  let renderSessionId = 0;

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function clearResults() {
    outputUrls.forEach((u) => URL.revokeObjectURL(u));
    outputUrls = [];
    if (zipDownloadUrl) {
      URL.revokeObjectURL(zipDownloadUrl);
      zipDownloadUrl = null;
    }
    pdfResultsDeck.style.display = 'none';
    pdfResultsList.innerHTML = '';
    pdfProgressStage.style.display = 'none';
    pdfProgressFill.style.width = '0%';
  }

  function showError(msg) {
    pdfErrorBox.textContent = msg || '';
    pdfErrorBox.classList.toggle('show', Boolean(msg));
  }

  function pagesToExpression(pagesSet) {
    const nums = [...pagesSet].sort((a, b) => a - b);
    if (!nums.length) return '';
    const parts = [];
    let start = nums[0];
    let prev = nums[0];
    for (let i = 1; i < nums.length; i++) {
      if (nums[i] === prev + 1) {
        prev = nums[i];
      } else {
        parts.push(start === prev ? `${start}` : `${start}-${prev}`);
        start = prev = nums[i];
      }
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    return parts.join(', ');
  }

  function parsePageExpression(expr) {
    const cleaned = (expr || '').trim();
    if (!cleaned) return [];
    const tokens = cleaned.split(',').map((t) => t.trim()).filter(Boolean);
    const pages = [];
    const seen = new Set();
    for (const tok of tokens) {
      if (/^\d+$/.test(tok)) {
        const p = Number(tok);
        if (p < 1 || p > totalPages) throw new Error(`Page ${p} doesn't exist (PDF has ${totalPages} pages).`);
        if (!seen.has(p)) { seen.add(p); pages.push(p); }
      } else if (/^\d+\s*-\s*\d+$/.test(tok)) {
        const [a, b] = tok.split('-').map((n) => Number(n.trim()));
        if (a < 1 || b > totalPages || a > b) {
          throw new Error(`Range "${tok}" doesn't fit a ${totalPages}-page PDF.`);
        }
        for (let p = a; p <= b; p++) {
          if (!seen.has(p)) { seen.add(p); pages.push(p); }
        }
      } else {
        throw new Error(`Check "${tok}" — use page numbers like 1-3, 5.`);
      }
    }
    return pages;
  }

  function getOutputMode() {
    const checked = pdfPickOutputRadios.find((r) => r.checked);
    return checked ? checked.value : 'single';
  }

  function syncThumbnailStates() {
    pdfThumbGrid.querySelectorAll('.thumb-card').forEach((card) => {
      const p = Number(card.dataset.page);
      card.classList.toggle('selected', selectedPages.has(p));
    });
  }

  function buildSplitJobs() {
    if (!totalPages) return { error: 'Choose a PDF file first.' };
    const prefix = ((pdfPrefixInput.value || 'split').trim() || 'split').replace(/[^a-zA-Z0-9_-]/g, '_');

    let pages;
    try {
      pages = parsePageExpression(pdfExprInput.value);
    } catch (err) {
      return { error: err.message };
    }
    if (!pages.length) return { error: 'Click at least one page to pick it.' };

    if (getOutputMode() === 'individual') {
      return {
        prefix,
        jobs: pages.map((p) => ({
          name: `${prefix}_page_${p}.pdf`,
          label: `Page ${p}`,
          pages: [p],
        })),
      };
    }

    return {
      prefix,
      jobs: [{
        name: `${prefix}_selected.pdf`,
        label: `Pages ${pagesToExpression(new Set(pages))}`,
        pages,
      }],
    };
  }

  function updatePlanSummary() {
    showError('');
    if (!totalPages) return;
    const plan = buildSplitJobs();
    if (plan.error) {
      pdfPlanSummary.textContent = plan.error;
      return;
    }
    const { jobs } = plan;
    const preview = jobs.slice(0, 3).map((j) => j.label).join(' · ');
    const more = jobs.length > 3 ? ` (+${jobs.length - 3} more)` : '';
    pdfPlanSummary.textContent = `Creates ${jobs.length} file${jobs.length === 1 ? '' : 's'}: ${preview}${more}`;
  }

  async function renderThumbnails(sessionId) {
    pdfThumbGrid.innerHTML = '';
    if (!pdfJsDoc) {
      pdfThumbStatus.textContent = `${totalPages} pages`;
      for (let p = 1; p <= totalPages; p++) {
        pdfThumbGrid.appendChild(createThumbCard(p));
      }
      syncThumbnailStates();
      return;
    }

    pdfThumbStatus.textContent = `Loading 0/${totalPages}...`;
    for (let p = 1; p <= totalPages; p++) {
      if (sessionId !== renderSessionId) return;
      const card = createThumbCard(p);
      pdfThumbGrid.appendChild(card);

      try {
        const page = await pdfJsDoc.getPage(p);
        const vp = page.getViewport({ scale: 0.36 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (sessionId !== renderSessionId) return;
        const wrap = card.querySelector('.thumb-canvas-wrap');
        wrap.innerHTML = '';
        wrap.appendChild(canvas);
      } catch {
        // Keep page placeholder
      }

      pdfThumbStatus.textContent = p === totalPages ? `${totalPages} pages` : `Loading ${p}/${totalPages}...`;
      if (p % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    syncThumbnailStates();
  }

  function createThumbCard(pageNum) {
    const card = document.createElement('div');
    card.className = 'thumb-card';
    card.dataset.page = String(pageNum);
    card.innerHTML = `
      <div class="thumb-canvas-wrap">
        <span class="muted-val">Page ${pageNum}</span>
      </div>
      <div class="thumb-foot">
        <span>Page ${pageNum}</span>
        <button type="button" class="thumb-zoom" title="View page ${pageNum}" aria-label="View page ${pageNum}">🔍</button>
      </div>
    `;

    card.querySelector('.thumb-zoom').addEventListener('click', (e) => {
      e.stopPropagation();
      openZoomModal(pageNum);
    });

    card.addEventListener('click', () => {
      if (selectedPages.has(pageNum)) selectedPages.delete(pageNum);
      else selectedPages.add(pageNum);
      pdfExprInput.value = pagesToExpression(selectedPages);
      syncThumbnailStates();
      updatePlanSummary();
    });

    return card;
  }

  async function openZoomModal(pageNum) {
    pdfZoomTitle.textContent = `Page ${pageNum} of ${totalPages}`;
    pdfZoomModal.classList.add('open');
    if (!pdfJsDoc) return;
    try {
      const page = await pdfJsDoc.getPage(pageNum);
      const vp = page.getViewport({ scale: 1.35 });
      pdfZoomCanvas.width = Math.floor(vp.width);
      pdfZoomCanvas.height = Math.floor(vp.height);
      const ctx = pdfZoomCanvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch {
      // Ignore error
    }
  }

  pdfZoomCloseBtn?.addEventListener('click', () => pdfZoomModal.classList.remove('open'));
  pdfZoomModal?.addEventListener('click', (e) => {
    if (e.target === pdfZoomModal) pdfZoomModal.classList.remove('open');
  });

  async function loadPdfBytes(uint8Bytes, fileName) {
    clearResults();
    showError('');
    masterBytes = uint8Bytes;
    currentFileName = fileName || 'document.pdf';

    try {
      pdfLibDoc = await window.PDFLib.PDFDocument.load(masterBytes.slice());
      totalPages = pdfLibDoc.getPageCount();
    } catch {
      showError('Could not open this PDF file.');
      return;
    }

    if (window.pdfjsLib) {
      try {
        pdfJsDoc = await window.pdfjsLib.getDocument({ data: masterBytes.slice() }).promise;
      } catch {
        pdfJsDoc = null;
      }
    }

    pdfDropzone.style.display = 'none';
    pdfFileBanner.classList.add('active');
    pdfWorkspace.classList.add('active');

    pdfPageBadge.textContent = `${totalPages} page${totalPages === 1 ? '' : 's'}`;
    pdfFileName.textContent = currentFileName;
    pdfFileSize.textContent = formatBytes(masterBytes.byteLength);

    // Start clean so user simply picks pages they want
    selectedPages = new Set();
    pdfExprInput.value = '';
    pdfPrefixInput.value = currentFileName.replace(/\.pdf$/i, '');

    updatePlanSummary();
    renderSessionId++;
    renderThumbnails(renderSessionId);
    window.CleanLab?.toast(`Loaded ${totalPages} pages`);
  }

  async function createSamplePdf() {
    const doc = await window.PDFLib.PDFDocument.create();
    const titles = [
      'Page 1 — Overview',
      'Page 2 — Schedule',
      'Page 3 — Budget',
      'Page 4 — Notes',
      'Page 5 — Checklist',
      'Page 6 — Appendix',
    ];
    titles.forEach((title, i) => {
      const page = doc.addPage([595, 842]);
      page.drawRectangle({ x: 48, y: 720, width: 499, height: 60, color: window.PDFLib.rgb(0.04, 0.04, 0.04) });
      page.drawText(title, { x: 68, y: 742, size: 20, color: window.PDFLib.rgb(1, 1, 1) });
      page.drawText(`Sample PDF — Page ${i + 1} of ${titles.length}`, {
        x: 48, y: 660, size: 14, color: window.PDFLib.rgb(0.15, 0.15, 0.15),
      });
      page.drawRectangle({
        x: 48, y: 260, width: 499, height: 340,
        borderWidth: 1.5, borderColor: window.PDFLib.rgb(0.85, 0.85, 0.85),
      });
      page.drawText(`PAGE ${i + 1}`, {
        x: 225, y: 420, size: 36, color: window.PDFLib.rgb(0.08, 0.08, 0.08),
      });
    });

    const bytes = await doc.save();
    await loadPdfBytes(bytes, 'sample-6pages.pdf');
  }

  // Upload triggers
  pdfBrowseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    pdfFileInput.click();
  });
  pdfReplaceBtn?.addEventListener('click', () => pdfFileInput.click());
  pdfDropzone?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    pdfFileInput.click();
  });

  pdfFileInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    await loadPdfBytes(new Uint8Array(buf), file.name);
    pdfFileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    pdfDropzone?.addEventListener(ev, (e) => {
      e.preventDefault();
      pdfDropzone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    pdfDropzone?.addEventListener(ev, (e) => {
      e.preventDefault();
      pdfDropzone.classList.remove('drag-over');
    });
  });
  pdfDropzone?.addEventListener('drop', async (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (!file || file.type !== 'application/pdf') {
      window.CleanLab?.toast('Please drop a PDF file');
      return;
    }
    const buf = await file.arrayBuffer();
    await loadPdfBytes(new Uint8Array(buf), file.name);
  });

  pdfSampleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    createSamplePdf();
  });

  pdfExprInput?.addEventListener('input', () => {
    if (!totalPages) return;
    try {
      const parsed = parsePageExpression(pdfExprInput.value);
      selectedPages = new Set(parsed);
      syncThumbnailStates();
      updatePlanSummary();
    } catch (err) {
      showError(err.message);
    }
  });

  pdfPickOutputRadios.forEach((r) => r.addEventListener('change', updatePlanSummary));
  pdfPrefixInput?.addEventListener('input', updatePlanSummary);

  // Split execution
  pdfSplitBtn?.addEventListener('click', async () => {
    if (splitting) return;
    const plan = buildSplitJobs();
    if (plan.error) {
      showError(plan.error);
      return;
    }

    splitting = true;
    showError('');
    clearResults();
    pdfProgressStage.style.display = 'block';
    pdfProgressFill.style.width = '12%';
    pdfProgressText.textContent = 'Reading selected pages...';

    const { jobs, prefix } = plan;
    const builtFiles = [];

    try {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        pdfProgressText.textContent = `Slicing file ${i + 1} of ${jobs.length}...`;

        const outDoc = await window.PDFLib.PDFDocument.create();
        const zeroIdx = job.pages.map((p) => p - 1);
        const copied = await outDoc.copyPages(pdfLibDoc, zeroIdx);
        copied.forEach((pg) => outDoc.addPage(pg));

        const bytes = await outDoc.save();
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        outputUrls.push(url);
        builtFiles.push({
          name: job.name,
          label: job.label,
          size: bytes.byteLength,
          url,
          bytes,
        });

        const pct = Math.round(((i + 1) / jobs.length) * (jobs.length > 1 ? 85 : 95));
        pdfProgressFill.style.width = `${pct}%`;
        await new Promise((r) => setTimeout(r, 40));
      }

      const wantZip = builtFiles.length > 1 && pdfZipCheck.checked && window.JSZip;
      if (wantZip) {
        pdfProgressText.textContent = 'Packing your ZIP file...';
        const zip = new window.JSZip();
        builtFiles.forEach((f) => zip.file(f.name, f.bytes));
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        zipDownloadUrl = URL.createObjectURL(zipBlob);
        pdfProgressFill.style.width = '96%';
      }

      pdfProgressFill.style.width = '100%';
      pdfProgressText.textContent = 'All ready!';

      pdfResultCount.textContent = `${builtFiles.length} file${builtFiles.length === 1 ? '' : 's'}`;
      pdfZipRow.style.display = zipDownloadUrl ? 'block' : 'none';
      if (zipDownloadUrl) {
        pdfDownloadZipBtn.onclick = () => {
          const a = document.createElement('a');
          a.href = zipDownloadUrl;
          a.download = `${prefix}_splits.zip`;
          a.click();
          window.CleanLab?.toast('ZIP downloaded');
        };
      }

      pdfResultsList.innerHTML = '';
      builtFiles.forEach((f) => {
        const row = document.createElement('div');
        row.className = 'result-item';
        const info = document.createElement('div');
        info.className = 'result-item-info';
        info.innerHTML = `
          <div class="result-item-name"></div>
          <div class="muted-val"></div>
        `;
        info.querySelector('.result-item-name').textContent = f.name;
        info.querySelector('.muted-val').textContent = `${f.label} · ${formatBytes(f.size)}`;

        const dlBtn = document.createElement('button');
        dlBtn.type = 'button';
        dlBtn.className = 'btn btn-secondary btn-sm';
        dlBtn.textContent = 'Download';
        dlBtn.addEventListener('click', () => {
          const a = document.createElement('a');
          a.href = f.url;
          a.download = f.name;
          a.click();
          window.CleanLab?.toast('Downloaded');
        });

        row.append(info, dlBtn);
        pdfResultsList.appendChild(row);
      });

      pdfResultsDeck.style.display = 'block';
      window.CleanLab?.toast(`${builtFiles.length} file${builtFiles.length === 1 ? '' : 's'} ready`);
    } catch (err) {
      showError('Could not split this PDF: ' + (err?.message || err));
    } finally {
      splitting = false;
    }
  });
})();
