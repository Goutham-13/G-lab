/* ==========================================================================
   CleanLab — Universal File Compressor Studio
   ========================================================================== */

(() => {
  'use strict';

  const PROGRESS_STEPS = [
    [16, 'Inspecting file format & structure...'],
    [38, 'Preserving visual & stream fidelity...'],
    [66, 'Compressing streams cleanly...'],
    [88, 'Verifying output integrity...'],
    [95, 'Preparing download...'],
  ];

  const state = {
    sourceBlob: null,
    sourceUrl: '',
    sourceName: 'file',
    sourceKind: 'file',
    resultBlob: null,
    resultUrl: '',
    resultExt: '',
    level: 'balanced',
    imageFormat: 'auto',
    busy: false,
    ticker: null,
  };

  // DOM refs
  const compDropzone = document.getElementById('compDropzone');
  const compFileInput = document.getElementById('compFileInput');
  const compBrowseBtn = document.getElementById('compBrowseBtn');
  const compSampleBtn = document.getElementById('compSampleBtn');
  const compReplaceBtn = document.getElementById('compReplaceBtn');
  const compFileBanner = document.getElementById('compFileBanner');
  const compFileName = document.getElementById('compFileName');
  const compTypeBadge = document.getElementById('compTypeBadge');
  const compOrigBadge = document.getElementById('compOrigBadge');
  const compWorkspace = document.getElementById('compWorkspace');

  const compNoteMeta = document.getElementById('compNoteMeta');
  const compPreviewBox = document.getElementById('compPreviewBox');
  const compStatsGrid = document.getElementById('compStatsGrid');
  const compStatOrig = document.getElementById('compStatOrig');
  const compStatNew = document.getElementById('compStatNew');
  const compStatSaved = document.getElementById('compStatSaved');

  const compPresetTabs = document.getElementById('compPresetTabs');
  const compImgFmtBlock = document.getElementById('compImgFmtBlock');
  const compImgFmtRadios = [...document.querySelectorAll('input[name="compImgFmt"]')];
  const compOutputName = document.getElementById('compOutputName');
  const compErrorBox = document.getElementById('compErrorBox');
  const compRunBtn = document.getElementById('compRunBtn');
  const compProgressStage = document.getElementById('compProgressStage');
  const compProgressFill = document.getElementById('compProgressFill');
  const compProgressText = document.getElementById('compProgressText');
  const compResultsDeck = document.getElementById('compResultsDeck');
  const compExportMeta = document.getElementById('compExportMeta');
  const compDownloadBtn = document.getElementById('compDownloadBtn');

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const detectKind = (name, mime = '') => {
    const ext = (name.split('.').pop() || '').toLowerCase();
    const ct = mime.toLowerCase();
    if (ct.startsWith('image/') && ext !== 'svg' || ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'dib', 'tif', 'tiff', 'gif'].includes(ext)) return 'image';
    if (ct === 'application/pdf' || ext === 'pdf') return 'pdf';
    if (ct.startsWith('video/') || ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi'].includes(ext)) return 'video';
    if (ct.startsWith('audio/') || ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'aiff'].includes(ext)) return 'audio';
    return 'file';
  };

  const showError = (msg) => {
    if (!compErrorBox) return;
    if (!msg) {
      compErrorBox.textContent = '';
      compErrorBox.classList.remove('show');
    } else {
      compErrorBox.textContent = msg;
      compErrorBox.classList.add('show');
    }
  };

  const startProgress = () => {
    clearInterval(state.ticker);
    if (compProgressStage) compProgressStage.style.display = 'block';
    let step = 0;
    const apply = (idx) => {
      const [pct, text] = PROGRESS_STEPS[Math.min(idx, PROGRESS_STEPS.length - 1)];
      if (compProgressFill) compProgressFill.style.width = `${pct}%`;
      if (compProgressText) compProgressText.textContent = text;
    };
    apply(0);
    state.ticker = setInterval(() => {
      if (step < PROGRESS_STEPS.length - 1) {
        step++;
        apply(step);
      }
    }, 600);
  };

  const stopProgress = (doneText) => {
    clearInterval(state.ticker);
    state.ticker = null;
    if (!compProgressStage) return;
    if (doneText) {
      if (compProgressFill) compProgressFill.style.width = '100%';
      if (compProgressText) compProgressText.textContent = doneText;
      setTimeout(() => {
        if (!state.busy && compProgressStage) compProgressStage.style.display = 'none';
      }, 650);
    } else {
      compProgressStage.style.display = 'none';
    }
  };

  const renderPreview = (url, kind, name, ext, mime) => {
    if (!compPreviewBox) return;
    compPreviewBox.replaceChildren();

    if (kind === 'image') {
      const img = document.createElement('img');
      img.src = url;
      img.alt = `${name} preview`;
      compPreviewBox.appendChild(img);
      return;
    }
    if (kind === 'video') {
      const vid = document.createElement('video');
      vid.src = url;
      vid.controls = true;
      vid.playsInline = true;
      compPreviewBox.appendChild(vid);
      return;
    }
    if (kind === 'audio') {
      const aud = document.createElement('audio');
      aud.src = url;
      aud.controls = true;
      compPreviewBox.appendChild(aud);
      return;
    }
    if (kind === 'pdf') {
      const frame = document.createElement('iframe');
      frame.src = url;
      frame.title = `${name} PDF preview`;
      compPreviewBox.appendChild(frame);
      return;
    }

    const card = document.createElement('div');
    card.className = 'link-file-preview';
    const titleEl = document.createElement('strong');
    titleEl.textContent = name;
    const subEl = document.createElement('p');
    subEl.className = 'muted-val';
    subEl.style.margin = '6px 0 0';
    subEl.textContent = `${(ext || mime || 'compressed file').toUpperCase()} ready for download`;
    card.append(titleEl, subEl);
    compPreviewBox.appendChild(card);
  };

  // Build an uncompressed 24-bit BMP sample photo (~1.3 MB) so compression achieves ~90% lossless savings
  const buildSampleBmpBlob = () => {
    const w = 720;
    const h = 600;
    const rowSize = Math.floor((24 * w + 31) / 32) * 4;
    const pixelBytes = rowSize * h;
    const buf = new ArrayBuffer(54 + pixelBytes);
    const dv = new DataView(buf);

    // BITMAPFILEHEADER (14 bytes)
    dv.setUint8(0, 0x42); // 'B'
    dv.setUint8(1, 0x4D); // 'M'
    dv.setUint32(2, 54 + pixelBytes, true);
    dv.setUint32(10, 54, true);

    // BITMAPINFOHEADER (40 bytes)
    dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, -h, true); // top-down
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true);
    dv.setUint32(34, pixelBytes, true);

    const bytes = new Uint8Array(buf);
    for (let y = 0; y < h; y++) {
      const rowOff = 54 + y * rowSize;
      for (let x = 0; x < w; x++) {
        const dx = x - w / 2;
        const dy = y - h / 2;
        const dist = Math.hypot(dx, dy);
        let r = Math.round(240 - (y / h) * 40);
        let g = Math.round(242 - (x / w) * 30);
        let b = 250;
        if (dist < 170) {
          r = Math.round(24 + (x / w) * 55);
          g = Math.round(28 + (y / h) * 65);
          b = 45;
        }
        const i = rowOff + x * 3;
        bytes[i] = b;
        bytes[i + 1] = g;
        bytes[i + 2] = r;
      }
    }
    return new Blob([buf], { type: 'image/bmp' });
  };

  const compressFile = async () => {
    if (!state.sourceBlob || state.busy) return;
    state.busy = true;
    showError('');
    if (compRunBtn) compRunBtn.disabled = true;
    if (compNoteMeta) compNoteMeta.textContent = 'Compressing...';
    startProgress();

    try {
      const form = new FormData();
      form.append('file', state.sourceBlob, state.sourceName);
      form.append('level', state.level);
      form.append('image_format', state.imageFormat);

      const res = await fetch('/api/compress', { method: 'POST', body: form });
      if (!res.ok) {
        let errMsg = `Compression failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) errMsg = j.error;
        } catch {}
        throw new Error(errMsg);
      }

      const outBlob = await res.blob();
      const origSize = Number(res.headers.get('X-Original-Size') || state.sourceBlob.size);
      const compSize = Number(res.headers.get('X-Compressed-Size') || outBlob.size);
      const outExt = res.headers.get('X-Output-Ext') || '';
      const note = res.headers.get('X-Compress-Note') || 'Compressed';
      const kind = res.headers.get('X-Compress-Kind') || state.sourceKind;

      if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
      state.resultBlob = outBlob;
      state.resultUrl = URL.createObjectURL(outBlob);
      state.resultExt = outExt;

      const pctSaved = origSize > 0 ? Math.max(0, Math.round(((origSize - compSize) / origSize) * 1000) / 10) : 0;
      if (compStatOrig) compStatOrig.textContent = formatBytes(origSize);
      if (compStatNew) compStatNew.textContent = formatBytes(compSize);
      if (compStatSaved) compStatSaved.textContent = pctSaved > 0 ? `${pctSaved}%` : 'Optimal';
      if (compStatsGrid) compStatsGrid.style.display = 'grid';

      if (compNoteMeta) compNoteMeta.textContent = note;
      if (compExportMeta) compExportMeta.textContent = `${(outExt || '.bin').toUpperCase().replace('.', '')} · ${formatBytes(compSize)}`;
      if (compDownloadBtn) {
        const labelExt = (outExt || '').toUpperCase().replace('.', '');
        compDownloadBtn.textContent = labelExt ? `Download Compressed ${labelExt}` : 'Download Compressed File';
      }
      if (compResultsDeck) compResultsDeck.style.display = 'block';

      renderPreview(state.resultUrl, kind, state.sourceName, outExt, outBlob.type);
      stopProgress('Compression complete.');
    } catch (err) {
      stopProgress('');
      const msg = err?.message === 'Failed to fetch'
        ? 'Start the Python server (python backend/app/server.py) to run File Compressor.'
        : (err?.message || 'Could not compress this file.');
      showError(msg);
      if (compNoteMeta) compNoteMeta.textContent = 'Ready';
    } finally {
      state.busy = false;
      if (compRunBtn) compRunBtn.disabled = false;
    }
  };

  const loadFile = (blob, name = 'file') => {
    if (!blob) return;
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultBlob = null;
    state.resultUrl = '';
    state.resultExt = '';

    state.sourceBlob = blob;
    state.sourceName = name;
    state.sourceUrl = URL.createObjectURL(blob);
    state.sourceKind = detectKind(name, blob.type);

    const stem = name.replace(/\.[^.]+$/, '') || 'file';
    if (compOutputName) compOutputName.value = `${stem}-compressed`;
    if (compFileName) compFileName.textContent = name;
    if (compOrigBadge) compOrigBadge.textContent = formatBytes(blob.size);
    if (compTypeBadge) {
      const labels = { image: 'Image', pdf: 'PDF', video: 'Video', audio: 'Audio', file: 'Document / File' };
      compTypeBadge.textContent = labels[state.sourceKind] || 'File';
    }

    if (compImgFmtBlock) {
      compImgFmtBlock.style.display = state.sourceKind === 'image' ? 'block' : 'none';
    }
    if (compDropzone) compDropzone.style.display = 'none';
    if (compFileBanner) compFileBanner.classList.add('active');
    if (compWorkspace) compWorkspace.classList.add('active');
    if (compResultsDeck) compResultsDeck.style.display = 'none';
    if (compStatsGrid) compStatsGrid.style.display = 'none';

    renderPreview(state.sourceUrl, state.sourceKind, name, '', blob.type);
    compressFile();
  };

  // Upload handlers
  compBrowseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    compFileInput?.click();
  });
  compReplaceBtn?.addEventListener('click', () => compFileInput?.click());
  compDropzone?.addEventListener('click', () => compFileInput?.click());
  compFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file, file.name);
    compFileInput.value = '';
  });

  compDropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    compDropzone.classList.add('dragover');
  });
  compDropzone?.addEventListener('dragleave', () => compDropzone.classList.remove('dragover'));
  compDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    compDropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file, file.name);
  });

  compSampleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const blob = buildSampleBmpBlob();
    loadFile(blob, 'sample-studio.bmp');
  });

  compPresetTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-tab');
    if (!btn?.dataset.compLevel || btn.dataset.compLevel === state.level) return;
    state.level = btn.dataset.compLevel;
    compPresetTabs.querySelectorAll('.seg-tab').forEach((b) => b.classList.toggle('active', b === btn));
    if (state.sourceBlob) compressFile();
  });

  compImgFmtRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      state.imageFormat = radio.value;
      if (state.sourceBlob && state.sourceKind === 'image') compressFile();
    });
  });

  compRunBtn?.addEventListener('click', compressFile);

  compDownloadBtn?.addEventListener('click', () => {
    if (!state.resultBlob || !state.resultUrl) return;
    const rawName = (compOutputName?.value || 'compressed').trim().replace(/[<>:"/\\|?*]+/g, '-');
    const ext = state.resultExt || '';
    const filename = ext && !rawName.toLowerCase().endsWith(ext.toLowerCase()) ? `${rawName}${ext}` : rawName;
    const a = document.createElement('a');
    a.href = state.resultUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.CleanLab?.toast(`Saved ${filename}`);
  });
})();
