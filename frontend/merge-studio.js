/* ==========================================================================
   CleanLab — Visual Multi-PDF Merger (Add PDFs, Pick Pages, Combine into One)
   ========================================================================== */

(() => {
  'use strict';

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  // DOM Elements
  const mergeDropzone = document.getElementById('mergeDropzone');
  const mergeFileInput = document.getElementById('mergeFileInput');
  const mergeBrowseBtn = document.getElementById('mergeBrowseBtn');
  const mergeSampleBtn = document.getElementById('mergeSampleBtn');
  const mergeAddMoreBtn = document.getElementById('mergeAddMoreBtn');

  const mergeFileBanner = document.getElementById('mergeFileBanner');
  const mergeBannerCount = document.getElementById('mergeBannerCount');
  const mergeBannerPages = document.getElementById('mergeBannerPages');
  const mergeWorkspace = document.getElementById('mergeWorkspace');

  const mergeGroupsWrap = document.getElementById('mergeGroupsWrap');
  const mergeThumbStatus = document.getElementById('mergeThumbStatus');
  const mergeFilesList = document.getElementById('mergeFilesList');

  const mergeOutputName = document.getElementById('mergeOutputName');
  const mergePlanSummary = document.getElementById('mergePlanSummary');
  const mergeErrorBox = document.getElementById('mergeErrorBox');

  const mergeRunBtn = document.getElementById('mergeRunBtn');
  const mergeProgressStage = document.getElementById('mergeProgressStage');
  const mergeProgressFill = document.getElementById('mergeProgressFill');
  const mergeProgressText = document.getElementById('mergeProgressText');

  const mergeResultsDeck = document.getElementById('mergeResultsDeck');
  const mergeResultMeta = document.getElementById('mergeResultMeta');
  const mergeDownloadBtn = document.getElementById('mergeDownloadBtn');

  // Shared Zoom Modal
  const pdfZoomModal = document.getElementById('pdfZoomModal');
  const pdfZoomTitle = document.getElementById('pdfZoomTitle');
  const pdfZoomCanvas = document.getElementById('pdfZoomCanvas');

  /**
   * Each entry in `pdfEntries`:
   * { id, name, sizeBytes, pdfLibDoc, pdfJsDoc, totalPages, selectedPages: Set<number>, expr: string, thumbs: Map<number, HTMLCanvasElement> }
   */
  let pdfEntries = [];
  let nextEntryId = 1;
  let mergedBlobUrl = null;
  let merging = false;

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function showError(msg) {
    mergeErrorBox.textContent = msg || '';
    mergeErrorBox.classList.toggle('show', Boolean(msg));
  }

  function clearMergedOutput() {
    if (mergedBlobUrl) {
      URL.revokeObjectURL(mergedBlobUrl);
      mergedBlobUrl = null;
    }
    mergeResultsDeck.style.display = 'none';
    mergeProgressStage.style.display = 'none';
    mergeProgressFill.style.width = '0%';
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

  function parsePageExpression(expr, maxPages, fileName) {
    const cleaned = (expr || '').trim();
    if (!cleaned) return [];
    const tokens = cleaned.split(',').map((t) => t.trim()).filter(Boolean);
    const pages = [];
    const seen = new Set();
    for (const tok of tokens) {
      if (/^\d+$/.test(tok)) {
        const p = Number(tok);
        if (p < 1 || p > maxPages) {
          throw new Error(`${fileName}: Page ${p} doesn't exist (has ${maxPages} pages).`);
        }
        if (!seen.has(p)) { seen.add(p); pages.push(p); }
      } else if (/^\d+\s*-\s*\d+$/.test(tok)) {
        const [a, b] = tok.split('-').map((n) => Number(n.trim()));
        if (a < 1 || b > maxPages || a > b) {
          throw new Error(`${fileName}: Range "${tok}" doesn't fit ${maxPages} pages.`);
        }
        for (let p = a; p <= b; p++) {
          if (!seen.has(p)) { seen.add(p); pages.push(p); }
        }
      } else {
        throw new Error(`${fileName}: Check "${tok}" — use page numbers like 1-3, 5.`);
      }
    }
    return pages;
  }

  async function openZoom(entry, pageNum) {
    pdfZoomTitle.textContent = `${entry.name} — Page ${pageNum} of ${entry.totalPages}`;
    pdfZoomModal.classList.add('open');
    if (!entry.pdfJsDoc) return;
    try {
      const page = await entry.pdfJsDoc.getPage(pageNum);
      const vp = page.getViewport({ scale: 1.35 });
      pdfZoomCanvas.width = Math.floor(vp.width);
      pdfZoomCanvas.height = Math.floor(vp.height);
      const ctx = pdfZoomCanvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch {
      // Ignore zoom render error
    }
  }

  function updateSummary() {
    showError('');
    if (!pdfEntries.length) {
      mergePlanSummary.textContent = 'Add at least one PDF file to merge.';
      return { error: 'Add at least one PDF file.' };
    }

    let totalPicked = 0;
    const plan = [];
    for (const entry of pdfEntries) {
      let pages;
      try {
        pages = parsePageExpression(entry.expr, entry.totalPages, entry.name);
      } catch (err) {
        mergePlanSummary.textContent = err.message;
        return { error: err.message };
      }
      if (pages.length) {
        totalPicked += pages.length;
        plan.push({ entry, pages });
      }
    }

    if (!totalPicked) {
      const msg = 'Click at least one page to include in the merged PDF.';
      mergePlanSummary.textContent = msg;
      return { error: msg };
    }

    const outName = ((mergeOutputName.value || 'merged').trim() || 'merged').replace(/\.pdf$/i, '') + '.pdf';
    mergePlanSummary.textContent = `Combines ${totalPicked} page${totalPicked === 1 ? '' : 's'} from ${plan.length} file${plan.length === 1 ? '' : 's'} into ${outName}`;
    return { plan, totalPicked, outName };
  }

  function syncBanner() {
    const hasFiles = pdfEntries.length > 0;
    mergeDropzone.style.display = hasFiles ? 'none' : 'block';
    mergeFileBanner.classList.toggle('active', hasFiles);
    mergeWorkspace.classList.toggle('active', hasFiles);

    const totalAllPages = pdfEntries.reduce((sum, e) => sum + e.totalPages, 0);
    mergeBannerCount.textContent = `${pdfEntries.length} PDF${pdfEntries.length === 1 ? '' : 's'} added`;
    mergeBannerPages.textContent = `${totalAllPages} total pages`;
  }

  function syncThumbnailStatesForEntry(entry) {
    const groupEl = mergeGroupsWrap.querySelector(`.merge-group[data-entry-id="${entry.id}"]`);
    if (!groupEl) return;
    groupEl.querySelectorAll('.thumb-card').forEach((card) => {
      const p = Number(card.dataset.page);
      card.classList.toggle('selected', entry.selectedPages.has(p));
    });
    const countLabel = groupEl.querySelector('.merge-group-picked');
    if (countLabel) {
      countLabel.textContent = `${entry.selectedPages.size}/${entry.totalPages} picked`;
    }
  }

  function renderFileControls() {
    mergeFilesList.innerHTML = '';
    pdfEntries.forEach((entry, idx) => {
      const item = document.createElement('div');
      item.className = 'merge-file-item';
      item.innerHTML = `
        <div class="merge-file-top">
          <div class="merge-file-title"></div>
          <div class="merge-file-actions">
            <button type="button" class="icon-mini-btn" data-act="up" title="Move up" aria-label="Move up">↑</button>
            <button type="button" class="icon-mini-btn" data-act="down" title="Move down" aria-label="Move down">↓</button>
            <button type="button" class="icon-mini-btn" data-act="remove" title="Remove file" aria-label="Remove file">&times;</button>
          </div>
        </div>
        <div class="merge-pages-row">
          <label>Pages</label>
          <input type="text" class="text-input merge-expr-input" placeholder="e.g. 1-${entry.totalPages}" />
        </div>
      `;

      item.querySelector('.merge-file-title').textContent = `${idx + 1}. ${entry.name} (${entry.totalPages}p)`;
      const upBtn = item.querySelector('[data-act="up"]');
      const downBtn = item.querySelector('[data-act="down"]');
      upBtn.disabled = idx === 0;
      downBtn.disabled = idx === pdfEntries.length - 1;

      upBtn.addEventListener('click', () => {
        if (idx === 0) return;
        [pdfEntries[idx - 1], pdfEntries[idx]] = [pdfEntries[idx], pdfEntries[idx - 1]];
        clearMergedOutput();
        renderAll();
      });

      downBtn.addEventListener('click', () => {
        if (idx >= pdfEntries.length - 1) return;
        [pdfEntries[idx + 1], pdfEntries[idx]] = [pdfEntries[idx], pdfEntries[idx + 1]];
        clearMergedOutput();
        renderAll();
      });

      item.querySelector('[data-act="remove"]').addEventListener('click', () => {
        pdfEntries = pdfEntries.filter((e) => e.id !== entry.id);
        clearMergedOutput();
        syncBanner();
        renderAll();
      });

      const exprInput = item.querySelector('.merge-expr-input');
      exprInput.value = entry.expr;
      exprInput.dataset.entryId = String(entry.id);
      exprInput.addEventListener('input', () => {
        entry.expr = exprInput.value;
        try {
          const parsed = parsePageExpression(entry.expr, entry.totalPages, entry.name);
          entry.selectedPages = new Set(parsed);
          syncThumbnailStatesForEntry(entry);
          clearMergedOutput();
          updateSummary();
        } catch (err) {
          showError(err.message);
        }
      });

      mergeFilesList.appendChild(item);
    });
  }

  function renderThumbnailGroups() {
    mergeGroupsWrap.innerHTML = '';
    pdfEntries.forEach((entry, idx) => {
      const group = document.createElement('div');
      group.className = 'merge-group';
      group.dataset.entryId = String(entry.id);
      group.innerHTML = `
        <div class="merge-group-head">
          <strong>${idx + 1}. ${escapeHtml(entry.name)}</strong>
          <span class="muted-val merge-group-picked">${entry.selectedPages.size}/${entry.totalPages} picked</span>
        </div>
        <div class="thumb-grid"></div>
      `;
      const grid = group.querySelector('.thumb-grid');
      for (let p = 1; p <= entry.totalPages; p++) {
        const card = document.createElement('div');
        card.className = 'thumb-card' + (entry.selectedPages.has(p) ? ' selected' : '');
        card.dataset.page = String(p);
        card.innerHTML = `
          <div class="thumb-canvas-wrap">
            <span class="muted-val">Page ${p}</span>
          </div>
          <div class="thumb-foot">
            <span>Page ${p}</span>
            <button type="button" class="thumb-zoom" title="View page ${p}" aria-label="View page ${p}">🔍</button>
          </div>
        `;

        if (entry.thumbs.has(p)) {
          const wrap = card.querySelector('.thumb-canvas-wrap');
          wrap.innerHTML = '';
          wrap.appendChild(entry.thumbs.get(p));
        }

        card.querySelector('.thumb-zoom').addEventListener('click', (e) => {
          e.stopPropagation();
          openZoom(entry, p);
        });

        card.addEventListener('click', () => {
          if (entry.selectedPages.has(p)) entry.selectedPages.delete(p);
          else entry.selectedPages.add(p);
          entry.expr = pagesToExpression(entry.selectedPages);
          const matchingInput = mergeFilesList.querySelector(`.merge-expr-input[data-entry-id="${entry.id}"]`);
          if (matchingInput) matchingInput.value = entry.expr;
          syncThumbnailStatesForEntry(entry);
          clearMergedOutput();
          updateSummary();
        });

        grid.appendChild(card);
      }
      mergeGroupsWrap.appendChild(group);
    });
  }

  function renderAll() {
    syncBanner();
    renderFileControls();
    renderThumbnailGroups();
    updateSummary();
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  }

  async function renderEntryThumbnails(entry) {
    if (!entry.pdfJsDoc) return;
    mergeThumbStatus.textContent = `Loading previews for ${entry.name}...`;
    for (let p = 1; p <= entry.totalPages; p++) {
      if (!pdfEntries.some((e) => e.id === entry.id)) return;
      try {
        const page = await entry.pdfJsDoc.getPage(p);
        const vp = page.getViewport({ scale: 0.34 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        entry.thumbs.set(p, canvas);

        const groupEl = mergeGroupsWrap.querySelector(`.merge-group[data-entry-id="${entry.id}"]`);
        const card = groupEl?.querySelector(`.thumb-card[data-page="${p}"]`);
        const wrap = card?.querySelector('.thumb-canvas-wrap');
        if (wrap) {
          wrap.innerHTML = '';
          wrap.appendChild(canvas);
        }
      } catch {
        // Keep placeholder
      }
      if (p % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    mergeThumbStatus.textContent = 'Ready';
  }

  async function addPdfFiles(fileItems) {
    if (!fileItems || !fileItems.length) return;
    clearMergedOutput();
    showError('');

    const addedEntries = [];
    for (const item of fileItems) {
      try {
        const bytes = item.bytes || new Uint8Array(await item.file.arrayBuffer());
        const name = item.name || item.file.name || 'document.pdf';
        const pdfLibDoc = await window.PDFLib.PDFDocument.load(bytes.slice());
        const totalPages = pdfLibDoc.getPageCount();
        let pdfJsDoc = null;
        if (window.pdfjsLib) {
          try {
            pdfJsDoc = await window.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
          } catch {
            pdfJsDoc = null;
          }
        }
        const selectedPages = new Set(Array.from({ length: totalPages }, (_, i) => i + 1));
        const entry = {
          id: nextEntryId++,
          name,
          sizeBytes: bytes.byteLength,
          pdfLibDoc,
          pdfJsDoc,
          totalPages,
          selectedPages,
          expr: pagesToExpression(selectedPages),
          thumbs: new Map(),
        };
        pdfEntries.push(entry);
        addedEntries.push(entry);
      } catch {
        showError(`Could not open "${item.name || item.file?.name || 'file'}". Make sure it is a valid, unencrypted PDF.`);
      }
    }

    if (addedEntries.length) {
      renderAll();
      window.CleanLab?.toast(`Added ${addedEntries.length} PDF${addedEntries.length === 1 ? '' : 's'}`);
      for (const entry of addedEntries) {
        await renderEntryThumbnails(entry);
      }
    }
  }

  async function createSamplePdfs() {
    const specs = [
      {
        name: 'sample-part-a.pdf',
        pages: ['Part A — Cover', 'Part A — Agenda', 'Part A — Summary'],
      },
      {
        name: 'sample-part-b.pdf',
        pages: ['Part B — Charts', 'Part B — Appendix'],
      },
    ];

    const built = [];
    for (const sp of specs) {
      const doc = await window.PDFLib.PDFDocument.create();
      sp.pages.forEach((label, idx) => {
        const pg = doc.addPage([595, 842]);
        pg.drawRectangle({ x: 48, y: 720, width: 499, height: 60, color: window.PDFLib.rgb(0.04, 0.04, 0.04) });
        pg.drawText(label, { x: 68, y: 742, size: 20, color: window.PDFLib.rgb(1, 1, 1) });
        pg.drawRectangle({
          x: 48, y: 260, width: 499, height: 340,
          borderWidth: 1.5, borderColor: window.PDFLib.rgb(0.85, 0.85, 0.85),
        });
        pg.drawText(`${sp.name} · P${idx + 1}`, {
          x: 170, y: 420, size: 26, color: window.PDFLib.rgb(0.08, 0.08, 0.08),
        });
      });
      built.push({ name: sp.name, bytes: await doc.save() });
    }
    await addPdfFiles(built);
  }

  // Upload events
  mergeBrowseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    mergeFileInput.click();
  });
  mergeAddMoreBtn?.addEventListener('click', () => mergeFileInput.click());
  mergeDropzone?.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    mergeFileInput.click();
  });

  mergeFileInput?.addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    if (files.length) {
      await addPdfFiles(files.map((file) => ({ file, name: file.name })));
    }
    mergeFileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    mergeDropzone?.addEventListener(ev, (e) => {
      e.preventDefault();
      mergeDropzone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    mergeDropzone?.addEventListener(ev, (e) => {
      e.preventDefault();
      mergeDropzone.classList.remove('drag-over');
    });
  });
  mergeDropzone?.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!files.length) {
      window.CleanLab?.toast('Please drop PDF files');
      return;
    }
    await addPdfFiles(files.map((file) => ({ file, name: file.name })));
  });

  mergeSampleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    createSamplePdfs();
  });

  mergeOutputName?.addEventListener('input', () => {
    clearMergedOutput();
    updateSummary();
  });

  // Merge execution
  mergeRunBtn?.addEventListener('click', async () => {
    if (merging) return;
    const summary = updateSummary();
    if (summary.error) {
      showError(summary.error);
      return;
    }

    merging = true;
    showError('');
    clearMergedOutput();
    mergeProgressStage.style.display = 'block';
    mergeProgressFill.style.width = '12%';
    mergeProgressText.textContent = 'Collecting selected pages...';

    try {
      const mergedDoc = await window.PDFLib.PDFDocument.create();
      const { plan, totalPicked, outName } = summary;

      for (let i = 0; i < plan.length; i++) {
        const { entry, pages } = plan[i];
        mergeProgressText.textContent = `Adding ${pages.length} page${pages.length === 1 ? '' : 's'} from ${entry.name}...`;

        const zeroIdx = pages.map((p) => p - 1);
        const copied = await mergedDoc.copyPages(entry.pdfLibDoc, zeroIdx);
        copied.forEach((pg) => mergedDoc.addPage(pg));

        const pct = Math.round(((i + 1) / plan.length) * 85);
        mergeProgressFill.style.width = `${pct}%`;
        await new Promise((r) => setTimeout(r, 40));
      }

      mergeProgressText.textContent = 'Saving combined PDF...';
      mergeProgressFill.style.width = '94%';
      const bytes = await mergedDoc.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      mergedBlobUrl = URL.createObjectURL(blob);

      mergeProgressFill.style.width = '100%';
      mergeProgressText.textContent = 'All ready!';

      mergeResultMeta.textContent = `${totalPicked} page${totalPicked === 1 ? '' : 's'} · ${formatBytes(bytes.byteLength)}`;
      mergeDownloadBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = mergedBlobUrl;
        a.download = outName;
        a.click();
        window.CleanLab?.toast('Merged PDF downloaded');
      };
      mergeResultsDeck.style.display = 'block';
      window.CleanLab?.toast('Merged PDF ready');
    } catch (err) {
      showError('Could not merge these PDFs: ' + (err?.message || err));
    } finally {
      merging = false;
    }
  });
})();
