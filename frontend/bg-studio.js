/* ==========================================================================
   CleanLab — Background Remover Studio
   ========================================================================== */

(() => {
  'use strict';

  // Resolve backend API base URL (set via api-config.js or auto-detect)
  function getApiBase() {
    if (window.CLEANLAB_API_BASE) return String(window.CLEANLAB_API_BASE).replace(/\/$/, '');
    return '';  // relative path — works when served from same origin as backend
  }

  const PROGRESS_STEPS = [
    [14, 'Preparing photo at full resolution...'],
    [34, 'Detecting main subject...'],
    [62, 'Separating foreground details...'],
    [84, 'Refining fine edges & transparency...'],
    [94, 'Encoding high-quality PNG...'],
  ];

  const state = {
    sourceBlob: null,
    sourceUrl: '',
    sourceName: 'photo.png',
    resultBlob: null,
    resultUrl: '',
    mode: 'high',
    previewView: 'cutout',
    busy: false,
    ticker: null,
  };

  // DOM refs
  const panelBg = document.getElementById('panel-bg');
  const bgDropzone = document.getElementById('bgDropzone');
  const bgFileInput = document.getElementById('bgFileInput');
  const bgBrowseBtn = document.getElementById('bgBrowseBtn');
  const bgSampleBtn = document.getElementById('bgSampleBtn');
  const bgReplaceBtn = document.getElementById('bgReplaceBtn');
  const bgFileBanner = document.getElementById('bgFileBanner');
  const bgFileName = document.getElementById('bgFileName');
  const bgDimBadge = document.getElementById('bgDimBadge');
  const bgSizeBadge = document.getElementById('bgSizeBadge');
  const bgWorkspace = document.getElementById('bgWorkspace');

  const bgResultMeta = document.getElementById('bgResultMeta');
  const bgPreviewTabs = document.getElementById('bgPreviewTabs');
  const bgPreviewStage = document.getElementById('bgPreviewStage');
  const bgCutoutImg = document.getElementById('bgCutoutImg');
  const bgCompareWrap = document.getElementById('bgCompareWrap');
  const bgCompareCutoutImg = document.getElementById('bgCompareCutoutImg');
  const bgCompareOverlay = document.getElementById('bgCompareOverlay');
  const bgCompareOrigImg = document.getElementById('bgCompareOrigImg');
  const bgCompareLine = document.getElementById('bgCompareLine');
  const bgCompareSlider = document.getElementById('bgCompareSlider');
  const bgOriginalImg = document.getElementById('bgOriginalImg');
  const bgBackdropColor = document.getElementById('bgBackdropColor');
  const bgSwatches = [...document.querySelectorAll('.bg-swatch[data-backdrop]')];

  const bgModeTabs = document.getElementById('bgModeTabs');
  const bgRefineCheck = document.getElementById('bgRefineCheck');
  const bgExportFillRadios = [...document.querySelectorAll('input[name="bgExportFill"]')];
  const bgExportColorRow = document.getElementById('bgExportColorRow');
  const bgExportColor = document.getElementById('bgExportColor');
  const bgExportColorHex = document.getElementById('bgExportColorHex');
  const bgOutputName = document.getElementById('bgOutputName');

  const bgErrorBox = document.getElementById('bgErrorBox');
  const bgProcessBtn = document.getElementById('bgProcessBtn');
  const bgProgressStage = document.getElementById('bgProgressStage');
  const bgProgressFill = document.getElementById('bgProgressFill');
  const bgProgressText = document.getElementById('bgProgressText');
  const bgResultsDeck = document.getElementById('bgResultsDeck');
  const bgExportSize = document.getElementById('bgExportSize');
  const bgDownloadBtn = document.getElementById('bgDownloadBtn');
  const bgCopyBtn = document.getElementById('bgCopyBtn');

  const formatBytes = (bytes) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const showError = (msg) => {
    if (!bgErrorBox) return;
    if (!msg) {
      bgErrorBox.textContent = '';
      bgErrorBox.classList.remove('show');
    } else {
      bgErrorBox.textContent = msg;
      bgErrorBox.classList.add('show');
    }
  };

  const startProgress = () => {
    clearInterval(state.ticker);
    if (bgProgressStage) bgProgressStage.style.display = 'block';
    let step = 0;
    const apply = (idx) => {
      const [pct, text] = PROGRESS_STEPS[Math.min(idx, PROGRESS_STEPS.length - 1)];
      if (bgProgressFill) bgProgressFill.style.width = `${pct}%`;
      if (bgProgressText) bgProgressText.textContent = text;
    };
    apply(0);
    state.ticker = setInterval(() => {
      if (step < PROGRESS_STEPS.length - 1) {
        step++;
        apply(step);
      }
    }, 650);
  };

  const stopProgress = (doneText) => {
    clearInterval(state.ticker);
    state.ticker = null;
    if (!bgProgressStage) return;
    if (doneText) {
      if (bgProgressFill) bgProgressFill.style.width = '100%';
      if (bgProgressText) bgProgressText.textContent = doneText;
      setTimeout(() => {
        if (!state.busy && bgProgressStage) bgProgressStage.style.display = 'none';
      }, 650);
    } else {
      bgProgressStage.style.display = 'none';
    }
  };

  const setComparePos = (pct) => {
    const val = Math.max(0, Math.min(100, Number(pct) || 50));
    if (bgCompareOverlay) bgCompareOverlay.style.clipPath = `inset(0 ${100 - val}% 0 0)`;
    if (bgCompareLine) bgCompareLine.style.left = `${val}%`;
  };

  const setPreviewView = (view) => {
    state.previewView = view;
    bgPreviewTabs?.querySelectorAll('.seg-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.bgView === view);
    });
    if (bgCutoutImg) bgCutoutImg.style.display = view === 'cutout' && state.resultUrl ? 'block' : 'none';
    if (bgCompareWrap) bgCompareWrap.style.display = view === 'compare' && state.resultUrl && state.sourceUrl ? 'inline-block' : 'none';
    if (bgOriginalImg) bgOriginalImg.style.display = view === 'original' || !state.resultUrl ? 'block' : 'none';
  };

  const setBackdrop = (val) => {
    if (!bgPreviewStage) return;
    bgSwatches.forEach((btn) => btn.classList.toggle('active', btn.dataset.backdrop === val));
    if (val === 'checker') {
      bgPreviewStage.classList.add('bg-checker');
      bgPreviewStage.style.backgroundColor = '';
    } else {
      bgPreviewStage.classList.remove('bg-checker');
      bgPreviewStage.style.backgroundColor = val;
    }
  };

  const buildSamplePhotoBlob = () => new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 760;
    canvas.height = 560;
    const ctx = canvas.getContext('2d');

    // Clean studio gradient background (single continuous backdrop)
    const bgGrad = ctx.createLinearGradient(0, 0, 760, 560);
    bgGrad.addColorStop(0, '#c7d2fe');
    bgGrad.addColorStop(0.55, '#fbcfe8');
    bgGrad.addColorStop(1, '#fde68a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 760, 560);

    // Subtle soft studio tabletop plane
    const tableGrad = ctx.createLinearGradient(0, 360, 0, 560);
    tableGrad.addColorStop(0, 'rgba(255,255,255,0.22)');
    tableGrad.addColorStop(1, 'rgba(255,255,255,0.06)');
    ctx.fillStyle = tableGrad;
    ctx.fillRect(0, 360, 760, 200);

    // Foreground subject: sleek dark retro camera with lens & strap lug
    // Camera handle / top plate
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.roundRect(210, 175, 340, 220, 26);
    ctx.fill();

    // Silver top metallic band
    const metal = ctx.createLinearGradient(210, 175, 210, 235);
    metal.addColorStop(0, '#e5e7eb');
    metal.addColorStop(1, '#9ca3af');
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.roundRect(210, 175, 340, 58, [26, 26, 6, 6]);
    ctx.fill();

    // Viewfinder hump
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.roundRect(320, 140, 120, 44, [14, 14, 4, 4]);
    ctx.fill();
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.roundRect(352, 152, 56, 22, 6);
    ctx.fill();

    // Shutter button
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.roundRect(475, 160, 34, 16, 6);
    ctx.fill();

    // Outer lens barrel
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(380, 295, 86, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#d1d5db';
    ctx.stroke();

    // Inner glass reflection
    const glass = ctx.createRadialGradient(356, 270, 8, 380, 295, 58);
    glass.addColorStop(0, '#93c5fd');
    glass.addColorStop(0.55, '#1e3a8a');
    glass.addColorStop(1, '#09090b');
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.arc(380, 295, 56, 0, Math.PI * 2);
    ctx.fill();

    // Specular highlight on glass
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(356, 272, 14, 8, -0.5, 0, Math.PI * 2);
    ctx.fill();

    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });

  const processImage = async () => {
    if (!state.sourceBlob || state.busy) return;
    state.busy = true;
    showError('');
    if (bgProcessBtn) bgProcessBtn.disabled = true;
    if (bgResultMeta) bgResultMeta.textContent = 'Processing...';
    if (bgPreviewStage) bgPreviewStage.classList.add('is-busy');
    startProgress();

    try {
      const form = new FormData();
      form.append('image', state.sourceBlob, state.sourceName);
      form.append('mode', state.mode);
      form.append('refine', bgRefineCheck?.checked ? '1' : '0');

      const fillMode = bgExportFillRadios.find((r) => r.checked)?.value || 'transparent';
      form.append('bg_color', fillMode === 'solid' ? (bgExportColor?.value || '#ffffff') : 'transparent');

      const res = await fetch(`${getApiBase()}/api/remove-bg`, { method: 'POST', body: form });
      if (!res.ok) {
        let errMsg = `Server error (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) errMsg = j.error;
        } catch {}
        throw new Error(errMsg);
      }

      const outBlob = await res.blob();
      const outW = res.headers.get('X-Image-Width');
      const outH = res.headers.get('X-Image-Height');
      if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
      state.resultBlob = outBlob;
      state.resultUrl = URL.createObjectURL(outBlob);

      if (bgCutoutImg) bgCutoutImg.src = state.resultUrl;
      if (bgCompareCutoutImg) bgCompareCutoutImg.src = state.resultUrl;
      if (bgCompareOrigImg) bgCompareOrigImg.src = state.sourceUrl;

      const dims = outW && outH ? `${outW} × ${outH} px` : '';
      if (outW && outH && bgDimBadge) bgDimBadge.textContent = `${outW} × ${outH} px`;
      if (bgResultMeta) bgResultMeta.textContent = `${dims ? dims + ' · ' : ''}${formatBytes(outBlob.size)}`;
      if (bgExportSize) bgExportSize.textContent = `PNG · ${formatBytes(outBlob.size)}`;
      if (bgResultsDeck) bgResultsDeck.style.display = 'block';
      if (bgDownloadBtn) {
        bgDownloadBtn.textContent = fillMode === 'solid' ? 'Download PNG' : 'Download Transparent PNG';
      }

      setPreviewView(state.previewView === 'original' ? 'cutout' : state.previewView);
      setComparePos(bgCompareSlider?.value || 50);
      stopProgress('Cutout ready.');
    } catch (err) {
      stopProgress('');
      const msg = err?.message === 'Failed to fetch'
        ? 'Start the Python server (python backend/app/server.py) to run high-quality Background Remover.'
        : (err?.message || 'Could not remove background from this image.');
      showError(msg);
      if (bgResultMeta) bgResultMeta.textContent = 'Ready';
    } finally {
      state.busy = false;
      if (bgPreviewStage) bgPreviewStage.classList.remove('is-busy');
      if (bgProcessBtn) bgProcessBtn.disabled = false;
    }
  };

  const loadImageBlob = (blob, name = 'photo.png') => {
    if (!blob) return;
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultBlob = null;
    state.resultUrl = '';

    state.sourceBlob = blob;
    state.sourceName = name;
    state.sourceUrl = URL.createObjectURL(blob);

    const stem = name.replace(/\.[^.]+$/, '') || 'image';
    if (bgOutputName) bgOutputName.value = `${stem}-nobg`;
    if (bgFileName) bgFileName.textContent = name;
    if (bgSizeBadge) bgSizeBadge.textContent = formatBytes(blob.size);
    if (bgDimBadge) bgDimBadge.textContent = 'Loading...';
    if (bgOriginalImg) {
      bgOriginalImg.onload = () => {
        if (bgOriginalImg.naturalWidth && bgDimBadge) {
          bgDimBadge.textContent = `${bgOriginalImg.naturalWidth} × ${bgOriginalImg.naturalHeight} px`;
        }
      };
      bgOriginalImg.src = state.sourceUrl;
    }

    if (bgDropzone) bgDropzone.style.display = 'none';
    if (bgFileBanner) bgFileBanner.classList.add('active');
    if (bgWorkspace) bgWorkspace.classList.add('active');
    if (bgResultsDeck) bgResultsDeck.style.display = 'none';
    setPreviewView('cutout');
    processImage();
  };

  // Upload handlers
  bgBrowseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    bgFileInput?.click();
  });
  bgReplaceBtn?.addEventListener('click', () => bgFileInput?.click());
  bgDropzone?.addEventListener('click', () => bgFileInput?.click());
  bgFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadImageBlob(file, file.name);
    bgFileInput.value = '';
  });

  bgDropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    bgDropzone.classList.add('dragover');
  });
  bgDropzone?.addEventListener('dragleave', () => bgDropzone.classList.remove('dragover'));
  bgDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    bgDropzone.classList.remove('dragover');
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) loadImageBlob(file, file.name);
  });

  // Paste image shortcut when Background Remover is active
  document.addEventListener('paste', (e) => {
    if (!panelBg?.classList.contains('active')) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) loadImageBlob(file, 'pasted-image.png');
  });

  // Sample photo button
  bgSampleBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const blob = await buildSamplePhotoBlob();
    if (blob) loadImageBlob(blob, 'sample-camera.png');
  });

  // Preview view switcher & backdrop swatches
  bgPreviewTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-tab');
    if (btn?.dataset.bgView) setPreviewView(btn.dataset.bgView);
  });
  bgCompareSlider?.addEventListener('input', () => setComparePos(bgCompareSlider.value));
  bgSwatches.forEach((btn) => {
    btn.addEventListener('click', () => setBackdrop(btn.dataset.backdrop));
  });
  bgBackdropColor?.addEventListener('input', () => setBackdrop(bgBackdropColor.value));

  // Mode, edge refine, & export fill settings
  bgModeTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-tab');
    if (!btn?.dataset.bgMode || btn.dataset.bgMode === state.mode) return;
    state.mode = btn.dataset.bgMode;
    bgModeTabs.querySelectorAll('.seg-tab').forEach((b) => b.classList.toggle('active', b === btn));
    if (state.sourceBlob) processImage();
  });

  bgRefineCheck?.addEventListener('change', () => {
    if (state.sourceBlob) processImage();
  });

  bgExportFillRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      const solid = radio.value === 'solid' && radio.checked;
      if (bgExportColorRow) bgExportColorRow.style.display = solid ? 'flex' : 'none';
      if (state.sourceBlob) processImage();
    });
  });

  bgExportColor?.addEventListener('change', () => {
    if (bgExportColorHex) bgExportColorHex.textContent = bgExportColor.value;
    if (state.sourceBlob) processImage();
  });
  bgExportColor?.addEventListener('input', () => {
    if (bgExportColorHex) bgExportColorHex.textContent = bgExportColor.value;
  });

  bgProcessBtn?.addEventListener('click', processImage);

  // Download & copy
  bgDownloadBtn?.addEventListener('click', () => {
    if (!state.resultBlob || !state.resultUrl) return;
    const rawName = (bgOutputName?.value || 'cutout').trim().replace(/[<>:"/\\|?*]+/g, '-');
    const filename = rawName.toLowerCase().endsWith('.png') ? rawName : `${rawName}.png`;
    const a = document.createElement('a');
    a.href = state.resultUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.CleanLab?.toast(`Saved ${filename}`);
  });

  bgCopyBtn?.addEventListener('click', async () => {
    if (!state.resultBlob) return;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': state.resultBlob })]);
        window.CleanLab?.toast('Copied PNG to clipboard');
      } else {
        window.CleanLab?.toast('Clipboard image copy unavailable in this browser');
      }
    } catch {
      window.CleanLab?.toast('Could not copy image to clipboard');
    }
  });
})();
