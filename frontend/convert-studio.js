/* ==========================================================================
   CleanLab — Image Converter Studio (PNG, JPG, WebP, AVIF, GIF, BMP, TIFF, ICO)
   ========================================================================== */

(() => {
  'use strict';

  const FORMAT_META = {
    png: {
      label: 'PNG',
      ext: '.png',
      mime: 'image/png',
      alpha: true,
      lossy: false,
      losslessOpt: false,
      hint: 'PNG · Lossless compression · Preserves transparency',
    },
    jpg: {
      label: 'JPG',
      ext: '.jpg',
      mime: 'image/jpeg',
      alpha: false,
      lossy: true,
      losslessOpt: false,
      hint: 'JPG · Photo compression · No transparency (uses matte background)',
    },
    webp: {
      label: 'WebP',
      ext: '.webp',
      mime: 'image/webp',
      alpha: true,
      lossy: true,
      losslessOpt: true,
      hint: 'WebP · High efficiency · Preserves transparency',
    },
    avif: {
      label: 'AVIF',
      ext: '.avif',
      mime: 'image/avif',
      alpha: true,
      lossy: true,
      losslessOpt: true,
      hint: 'AVIF · Next-gen compression · Preserves transparency',
    },
    gif: {
      label: 'GIF',
      ext: '.gif',
      mime: 'image/gif',
      alpha: true,
      lossy: false,
      losslessOpt: false,
      hint: 'GIF · 256-color palette · Preserves binary transparency',
    },
    bmp: {
      label: 'BMP',
      ext: '.bmp',
      mime: 'image/bmp',
      alpha: false,
      lossy: false,
      losslessOpt: false,
      hint: 'BMP · Uncompressed bitmap · No transparency',
    },
    tiff: {
      label: 'TIFF',
      ext: '.tiff',
      mime: 'image/tiff',
      alpha: true,
      lossy: false,
      losslessOpt: false,
      hint: 'TIFF · Archival lossless · Preserves transparency',
    },
    ico: {
      label: 'ICO',
      ext: '.ico',
      mime: 'image/x-icon',
      alpha: true,
      lossy: false,
      losslessOpt: false,
      hint: 'ICO · Favicon / app icon (up to 256×256) · Preserves transparency',
    },
  };

  const state = {
    sourceBlob: null,
    sourceUrl: '',
    sourceName: 'image.png',
    sourceExtLabel: 'PNG',
    sourceImg: null,
    srcW: 0,
    srcH: 0,
    hasAlpha: false,
    format: 'webp',
    quality: 88,
    lossless: false,
    scale: 100,
    preserveAlpha: true,
    matteColor: '#ffffff',
    previewView: 'converted',
    resultBlob: null,
    resultUrl: '',
    previewFallbackUrl: '',
    resultW: 0,
    resultH: 0,
    busy: false,
    runId: 0,
    abortCtrl: null,
    debounceTimer: null,
    progressTimer: null,
  };

  // DOM refs
  const panelConvert = document.getElementById('panel-convert');
  const convDropzone = document.getElementById('convDropzone');
  const convFileInput = document.getElementById('convFileInput');
  const convBrowseBtn = document.getElementById('convBrowseBtn');
  const convSampleBtn = document.getElementById('convSampleBtn');
  const convReplaceBtn = document.getElementById('convReplaceBtn');
  const convFileBanner = document.getElementById('convFileBanner');
  const convFileName = document.getElementById('convFileName');
  const convOrigMetaBadge = document.getElementById('convOrigMetaBadge');
  const convOrigSizeBadge = document.getElementById('convOrigSizeBadge');
  const convAlphaBadge = document.getElementById('convAlphaBadge');
  const convWorkspace = document.getElementById('convWorkspace');

  const convResultMeta = document.getElementById('convResultMeta');
  const convPreviewTabs = document.getElementById('convPreviewTabs');
  const convPreviewStage = document.getElementById('convPreviewStage');
  const convResultImg = document.getElementById('convResultImg');
  const convCompareWrap = document.getElementById('convCompareWrap');
  const convCompareResultImg = document.getElementById('convCompareResultImg');
  const convCompareOverlay = document.getElementById('convCompareOverlay');
  const convCompareOrigImg = document.getElementById('convCompareOrigImg');
  const convCompareLine = document.getElementById('convCompareLine');
  const convCompareSlider = document.getElementById('convCompareSlider');
  const convOriginalImg = document.getElementById('convOriginalImg');
  const convPreviewNote = document.getElementById('convPreviewNote');

  const convBackdropBar = document.getElementById('convBackdropBar');
  const convBackdropSwatches = [...(convBackdropBar?.querySelectorAll('.bg-swatch') || [])];
  const convBackdropColor = document.getElementById('convBackdropColor');

  const convStatsDeck = document.getElementById('convStatsDeck');
  const convStatOrigSize = document.getElementById('convStatOrigSize');
  const convStatOrigSub = document.getElementById('convStatOrigSub');
  const convStatNewSize = document.getElementById('convStatNewSize');
  const convStatNewSub = document.getElementById('convStatNewSub');
  const convStatDiffPct = document.getElementById('convStatDiffPct');
  const convStatDiffSub = document.getElementById('convStatDiffSub');
  const convOrigBarFill = document.getElementById('convOrigBarFill');
  const convOrigBarPct = document.getElementById('convOrigBarPct');
  const convNewBarFill = document.getElementById('convNewBarFill');
  const convNewBarPct = document.getElementById('convNewBarPct');

  const convAlphaCapTag = document.getElementById('convAlphaCapTag');
  const convFormatTabs = document.getElementById('convFormatTabs');
  const convFormatHint = document.getElementById('convFormatHint');
  const convQualityVal = document.getElementById('convQualityVal');
  const convQualityRange = document.getElementById('convQualityRange');
  const convQualityHint = document.getElementById('convQualityHint');
  const convLosslessWrap = document.getElementById('convLosslessWrap');
  const convLosslessCheck = document.getElementById('convLosslessCheck');

  const convDimVal = document.getElementById('convDimVal');
  const convScaleTabs = document.getElementById('convScaleTabs');

  const convPreserveWrap = document.getElementById('convPreserveWrap');
  const convPreserveAlphaCheck = document.getElementById('convPreserveAlphaCheck');
  const convAlphaStatus = document.getElementById('convAlphaStatus');
  const convMatteWrap = document.getElementById('convMatteWrap');
  const convMatteLabel = document.getElementById('convMatteLabel');
  const convMatteSwatches = [...(convMatteWrap?.querySelectorAll('.bg-swatch') || [])];
  const convMatteColor = document.getElementById('convMatteColor');
  const convMatteHex = document.getElementById('convMatteHex');

  const convOutputName = document.getElementById('convOutputName');
  const convErrorBox = document.getElementById('convErrorBox');
  const convRunBtn = document.getElementById('convRunBtn');
  const convProgressStage = document.getElementById('convProgressStage');
  const convProgressFill = document.getElementById('convProgressFill');
  const convProgressText = document.getElementById('convProgressText');

  const convResultsDeck = document.getElementById('convResultsDeck');
  const convExportMeta = document.getElementById('convExportMeta');
  const convDownloadBtn = document.getElementById('convDownloadBtn');
  const convCopyBtn = document.getElementById('convCopyBtn');

  async function resolveApiBase() {
    if (typeof window.resolveCleanLabApiBase === 'function') {
      return window.resolveCleanLabApiBase();
    }
    return null;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function inferExtLabel(name, mime) {
    const ext = (name.split('.').pop() || '').toUpperCase();
    if (ext && ext.length <= 5 && ext !== name.toUpperCase()) {
      return ext === 'JPEG' ? 'JPG' : ext;
    }
    if (mime && mime.startsWith('image/')) {
      return mime.split('/')[1].toUpperCase().replace('JPEG', 'JPG').replace('X-ICON', 'ICO');
    }
    return 'IMG';
  }

  function showError(msg) {
    if (!convErrorBox) return;
    if (!msg) {
      convErrorBox.textContent = '';
      convErrorBox.classList.remove('show');
    } else {
      convErrorBox.textContent = msg;
      convErrorBox.classList.add('show');
    }
  }

  function startProgress(label = 'Converting image...') {
    clearInterval(state.progressTimer);
    if (convProgressStage) convProgressStage.style.display = 'block';
    if (convProgressFill) convProgressFill.style.width = '24%';
    if (convProgressText) convProgressText.textContent = label;
    let pct = 24;
    state.progressTimer = setInterval(() => {
      pct = Math.min(92, pct + 18);
      if (convProgressFill) convProgressFill.style.width = `${pct}%`;
    }, 240);
  }

  function stopProgress(doneMsg) {
    clearInterval(state.progressTimer);
    state.progressTimer = null;
    if (!convProgressStage) return;
    if (doneMsg) {
      if (convProgressFill) convProgressFill.style.width = '100%';
      if (convProgressText) convProgressText.textContent = doneMsg;
      setTimeout(() => {
        if (!state.busy && convProgressStage) convProgressStage.style.display = 'none';
      }, 450);
    } else {
      convProgressStage.style.display = 'none';
    }
  }

  function setPreviewView(view) {
    state.previewView = view;
    convPreviewTabs?.querySelectorAll('.seg-tab').forEach((b) => {
      const active = b.dataset.convView === view;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    if (convResultImg) convResultImg.style.display = view === 'converted' ? 'block' : 'none';
    if (convCompareWrap) convCompareWrap.style.display = view === 'compare' ? 'inline-block' : 'none';
    if (convOriginalImg) convOriginalImg.style.display = view === 'original' ? 'block' : 'none';
  }

  function setComparePos(pct) {
    const v = Math.max(0, Math.min(100, Number(pct) || 50));
    if (convCompareOverlay) convCompareOverlay.style.clipPath = `inset(0 ${100 - v}% 0 0)`;
    if (convCompareLine) convCompareLine.style.left = `${v}%`;
  }

  function setBackdrop(val) {
    if (!convPreviewStage) return;
    convBackdropSwatches.forEach((s) => s.classList.toggle('active', s.dataset.backdrop === val));
    if (val === 'checker') {
      convPreviewStage.classList.add('bg-checker');
      convPreviewStage.style.backgroundColor = '#ffffff';
    } else {
      convPreviewStage.classList.remove('bg-checker');
      convPreviewStage.style.backgroundColor = val;
    }
  }

  function setMatteColor(hex) {
    state.matteColor = hex;
    if (convMatteColor && /^#[0-9a-f]{6}$/i.test(hex)) convMatteColor.value = hex;
    if (convMatteHex) convMatteHex.textContent = hex.toLowerCase();
    convMatteSwatches.forEach((s) => s.classList.toggle('active', s.dataset.matte?.toLowerCase() === hex.toLowerCase()));
  }

  function computeTargetDims() {
    if (!state.srcW || !state.srcH) return { w: 0, h: 0 };
    let w = Math.max(1, Math.round((state.srcW * state.scale) / 100));
    let h = Math.max(1, Math.round((state.srcH * state.scale) / 100));
    if (state.format === 'ico') {
      const side = Math.min(256, Math.max(w, h, 16));
      w = side;
      h = side;
    }
    return { w, h };
  }

  function syncControlsUI() {
    const meta = FORMAT_META[state.format];
    if (convFormatHint) convFormatHint.textContent = meta.hint;
    if (convAlphaCapTag) {
      convAlphaCapTag.textContent = meta.alpha ? 'Transparency supported' : 'No transparency';
    }

    // Quality slider & lossless toggle state
    if (convLosslessWrap) {
      convLosslessWrap.style.display = meta.losslessOpt ? 'inline-flex' : 'none';
    }
    if (!meta.losslessOpt && state.lossless) {
      state.lossless = false;
      if (convLosslessCheck) convLosslessCheck.checked = false;
    }

    if (!meta.lossy) {
      if (convQualityRange) convQualityRange.disabled = true;
      if (convQualityVal) convQualityVal.textContent = meta.label === 'GIF' ? '256-color' : 'Lossless';
      if (convQualityHint) {
        convQualityHint.textContent =
          meta.label === 'BMP'
            ? 'Uncompressed bitmap pixels'
            : meta.label === 'GIF'
              ? 'Palette indexed · Fixed quality'
              : 'Lossless format · Quality slider not needed';
      }
    } else if (meta.losslessOpt && state.lossless) {
      if (convQualityRange) convQualityRange.disabled = true;
      if (convQualityVal) convQualityVal.textContent = 'Lossless';
      if (convQualityHint) convQualityHint.textContent = `Exact lossless ${meta.label} encoding`;
    } else {
      if (convQualityRange) convQualityRange.disabled = false;
      if (convQualityVal) convQualityVal.textContent = `${state.quality}%`;
      if (convQualityHint) {
        if (state.quality >= 90) convQualityHint.textContent = 'Maximum detail · Larger file size';
        else if (state.quality >= 75) convQualityHint.textContent = 'Balanced visual fidelity and size';
        else if (state.quality >= 45) convQualityHint.textContent = 'Compact web size · Slight compression';
        else convQualityHint.textContent = 'Aggressive compression · Smallest size';
      }
    }

    // Target dimensions display
    const dims = computeTargetDims();
    if (convDimVal) {
      convDimVal.textContent = dims.w ? `${dims.w} × ${dims.h} (${state.scale}%)` : '—';
    }

    // Transparency controls
    if (meta.alpha) {
      if (convPreserveWrap) convPreserveWrap.style.display = 'block';
      if (convAlphaStatus) {
        if (state.hasAlpha) {
          convAlphaStatus.textContent = state.preserveAlpha
            ? `${meta.label} supports transparency — alpha channel will be preserved.`
            : 'Transparency disabled — transparent pixels will be filled below.';
        } else {
          convAlphaStatus.textContent = state.srcW
            ? `Uploaded image is opaque — ${meta.label} will keep full solid pixels.`
            : 'Alpha channel will be kept when present.';
        }
      }
      if (convMatteWrap) {
        convMatteWrap.style.display = state.hasAlpha && !state.preserveAlpha ? 'block' : 'none';
      }
      if (convMatteLabel) {
        convMatteLabel.textContent = 'Fill transparent areas with background color:';
      }
    } else {
      if (convPreserveWrap) convPreserveWrap.style.display = 'none';
      if (convMatteWrap) convMatteWrap.style.display = state.hasAlpha || !state.srcW ? 'block' : 'none';
      if (convMatteLabel) {
        convMatteLabel.textContent = `${meta.label} cannot store transparency — transparent areas will be filled with:`;
      }
      if (!state.hasAlpha && state.srcW && convPreserveWrap && convAlphaStatus) {
        convPreserveWrap.style.display = 'block';
        convPreserveAlphaCheck.disabled = true;
        convAlphaStatus.textContent = `${meta.label} is opaque (uploaded image also has no transparency).`;
      }
    }
    if (meta.alpha && convPreserveAlphaCheck) {
      convPreserveAlphaCheck.disabled = false;
    }
  }

  // Detect whether loaded image actually has non-opaque alpha pixels
  function detectAlphaChannel(img) {
    try {
      const w = Math.min(256, img.naturalWidth || img.width || 1);
      const h = Math.min(256, img.naturalHeight || img.height || 1);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 252) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Draw source image onto canvas at target dimensions + alpha/matte rules
  function renderTargetCanvas(forceOpaque = false, customMaxSide = 0) {
    const img = state.sourceImg;
    if (!img) throw new Error('Source image not ready');
    const meta = FORMAT_META[state.format];
    let w = Math.max(1, Math.round((state.srcW * state.scale) / 100));
    let h = Math.max(1, Math.round((state.srcH * state.scale) / 100));

    if (customMaxSide > 0) {
      const side = Math.min(customMaxSide, Math.max(w, h, 16));
      const canvas = document.createElement('canvas');
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext('2d');
      const keepAlpha = meta.alpha && state.preserveAlpha && !forceOpaque;
      if (!keepAlpha) {
        ctx.fillStyle = state.matteColor || '#ffffff';
        ctx.fillRect(0, 0, side, side);
      }
      const ratio = Math.min(side / w, side / h);
      const dw = Math.max(1, Math.round(w * ratio));
      const dh = Math.max(1, Math.round(h * ratio));
      ctx.drawImage(img, Math.floor((side - dw) / 2), Math.floor((side - dh) / 2), dw, dh);
      return canvas;
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const keepAlpha = meta.alpha && state.preserveAlpha && !forceOpaque;
    if (!keepAlpha) {
      ctx.fillStyle = state.matteColor || '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }

  function encodeCanvasToBmp(canvas) {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d');
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const rowSize = Math.floor((24 * w + 31) / 32) * 4;
    const pixelBytes = rowSize * h;
    const buf = new ArrayBuffer(54 + pixelBytes);
    const dv = new DataView(buf);

    dv.setUint8(0, 0x42);
    dv.setUint8(1, 0x4d);
    dv.setUint32(2, 54 + pixelBytes, true);
    dv.setUint32(10, 54, true);
    dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true);
    dv.setInt32(22, -h, true);
    dv.setUint16(26, 1, true);
    dv.setUint16(28, 24, true);
    dv.setUint32(34, pixelBytes, true);

    const bytes = new Uint8Array(buf);
    for (let y = 0; y < h; y++) {
      const rowOff = 54 + y * rowSize;
      for (let x = 0; x < w; x++) {
        const s = (y * w + x) * 4;
        const d = rowOff + x * 3;
        bytes[d] = rgba[s + 2];
        bytes[d + 1] = rgba[s + 1];
        bytes[d + 2] = rgba[s];
      }
    }
    return new Blob([buf], { type: 'image/bmp' });
  }

  function encodeCanvasToIco(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async (pngBlob) => {
        if (!pngBlob) return reject(new Error('Could not encode ICO image.'));
        const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
        const out = new Uint8Array(22 + pngBytes.length);
        const dv = new DataView(out.buffer);
        // ICONDIR
        dv.setUint16(0, 0, true);
        dv.setUint16(2, 1, true);
        dv.setUint16(4, 1, true);
        // ICONDIRENTRY
        out[6] = canvas.width >= 256 ? 0 : canvas.width;
        out[7] = canvas.height >= 256 ? 0 : canvas.height;
        out[8] = 0;
        out[9] = 0;
        dv.setUint16(10, 1, true);
        dv.setUint16(12, 32, true);
        dv.setUint32(14, pngBytes.length, true);
        dv.setUint32(18, 22, true);
        out.set(pngBytes, 22);
        resolve(new Blob([out], { type: 'image/x-icon' }));
      }, 'image/png');
    });
  }

  function canvasToBlobStrict(canvas, mime, q) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error(`Browser encoding failed for ${mime}.`));
        if (mime === 'image/avif' && blob.type !== 'image/avif') {
          return reject(
            new Error(
              'AVIF encoding requires the Python server (python backend/app/server.py), or choose PNG / JPG / WebP / BMP / ICO.'
            )
          );
        }
        resolve(blob);
      }, mime, q);
    });
  }

  async function convertClientSide() {
    const meta = FORMAT_META[state.format];
    if (state.format === 'gif' || state.format === 'tiff') {
      throw new Error(
        `${meta.label} conversion requires the Python server (python backend/app/server.py), or pick PNG / JPG / WebP / AVIF / BMP / ICO.`
      );
    }

    if (state.format === 'bmp') {
      const canvas = renderTargetCanvas(true);
      const blob = encodeCanvasToBmp(canvas);
      return { blob, w: canvas.width, h: canvas.height, previewUrl: '', note: 'Browser BMP conversion' };
    }

    if (state.format === 'ico') {
      const canvas = renderTargetCanvas(false, 256);
      const blob = await encodeCanvasToIco(canvas);
      return { blob, w: canvas.width, h: canvas.height, previewUrl: '', note: 'Browser ICO conversion' };
    }

    const canvas = renderTargetCanvas(!meta.alpha);
    const q = state.lossless ? 1 : Math.max(0.01, Math.min(1, state.quality / 100));
    const blob = await canvasToBlobStrict(canvas, meta.mime, q);
    return { blob, w: canvas.width, h: canvas.height, previewUrl: '', note: `Browser ${meta.label}` };
  }

  function updateSizeStats(origBytes, newBytes, outW, outH) {
    const meta = FORMAT_META[state.format];
    if (convStatOrigSize) convStatOrigSize.textContent = formatBytes(origBytes);
    if (convStatOrigSub) convStatOrigSub.textContent = `${state.sourceExtLabel} · ${state.srcW} × ${state.srcH}`;

    if (convStatNewSize) convStatNewSize.textContent = formatBytes(newBytes);
    if (convStatNewSub) convStatNewSub.textContent = `${meta.label} · ${outW} × ${outH}`;

    const delta = newBytes - origBytes;
    const pct = origBytes > 0 ? (delta / origBytes) * 100 : 0;
    const absPct = Math.abs(pct).toFixed(1);
    const absBytes = formatBytes(Math.abs(delta));

    if (convStatDiffPct) {
      if (delta < 0) convStatDiffPct.textContent = `-${absPct}%`;
      else if (delta > 0) convStatDiffPct.textContent = `+${absPct}%`;
      else convStatDiffPct.textContent = '0.0%';
    }
    if (convStatDiffSub) {
      if (delta < 0) convStatDiffSub.textContent = `${absBytes} smaller`;
      else if (delta > 0) convStatDiffSub.textContent = `${absBytes} larger`;
      else convStatDiffSub.textContent = 'Exact same size';
    }

    const maxBytes = Math.max(origBytes, newBytes, 1);
    const origBarW = Math.max(4, Math.round((origBytes / maxBytes) * 100));
    const newBarW = Math.max(4, Math.round((newBytes / maxBytes) * 100));
    const ratioPct = origBytes > 0 ? Math.round((newBytes / origBytes) * 100) : 100;

    if (convOrigBarFill) convOrigBarFill.style.width = `${origBarW}%`;
    if (convOrigBarPct) convOrigBarPct.textContent = '100%';
    if (convNewBarFill) convNewBarFill.style.width = `${newBarW}%`;
    if (convNewBarPct) convNewBarPct.textContent = `${ratioPct}%`;

    if (convStatsDeck) convStatsDeck.style.display = 'block';
  }

  async function applyPreviewBlob(blob, fallbackCanvasNeeded) {
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    if (state.previewFallbackUrl) {
      URL.revokeObjectURL(state.previewFallbackUrl);
      state.previewFallbackUrl = '';
    }
    state.resultBlob = blob;
    state.resultUrl = URL.createObjectURL(blob);

    let displayUrl = state.resultUrl;
    let noteText = '';

    if (fallbackCanvasNeeded) {
      const previewCanvas = renderTargetCanvas(false);
      const previewBlob = await new Promise((res) => previewCanvas.toBlob(res, 'image/png'));
      if (previewBlob) {
        state.previewFallbackUrl = URL.createObjectURL(previewBlob);
        displayUrl = state.previewFallbackUrl;
        noteText = `Preview rendered cleanly — your downloaded file is genuine ${FORMAT_META[state.format].label} (${formatBytes(blob.size)}).`;
      }
    }

    if (convResultImg) convResultImg.src = displayUrl;
    if (convCompareResultImg) convCompareResultImg.src = displayUrl;
    if (convCompareOrigImg) convCompareOrigImg.src = state.sourceUrl;
    if (convOriginalImg) convOriginalImg.src = state.sourceUrl;

    if (convPreviewNote) {
      if (noteText) {
        convPreviewNote.textContent = noteText;
        convPreviewNote.style.display = 'block';
      } else {
        convPreviewNote.textContent = '';
        convPreviewNote.style.display = 'none';
      }
    }
  }

  async function convertImage() {
    if (!state.sourceBlob || !state.sourceImg) return;
    const myRun = ++state.runId;
    if (state.abortCtrl) {
      try { state.abortCtrl.abort(); } catch {}
    }
    const ctrl = new AbortController();
    state.abortCtrl = ctrl;

    state.busy = true;
    showError('');
    if (convRunBtn) convRunBtn.disabled = true;
    if (convResultMeta) convResultMeta.textContent = 'Converting...';
    if (convPreviewStage) convPreviewStage.classList.add('is-busy');
    startProgress(`Converting to ${FORMAT_META[state.format].label}...`);

    try {
      const apiBase = await resolveApiBase();
      if (myRun !== state.runId || ctrl.signal.aborted) return;

      const meta = FORMAT_META[state.format];
      let outBlob;
      let outW;
      let outH;
      let origSize = state.sourceBlob.size;

      if (apiBase !== null) {
        const form = new FormData();
        form.append('image', state.sourceBlob, state.sourceName);
        form.append('format', state.format);
        form.append('quality', String(state.quality));
        form.append('lossless', state.lossless ? '1' : '0');
        form.append('preserve_alpha', state.preserveAlpha ? '1' : '0');
        form.append('matte_color', state.matteColor);
        form.append('scale', String(state.scale));

        const res = await fetch(`${apiBase}/api/image-convert`, {
          method: 'POST',
          body: form,
          signal: ctrl.signal,
        });
        if (myRun !== state.runId) return;
        if (!res.ok) {
          let errMsg = `Conversion failed (${res.status})`;
          try {
            const j = await res.json();
            if (j?.error) errMsg = j.error;
          } catch {}
          throw new Error(errMsg);
        }

        outBlob = await res.blob();
        if (myRun !== state.runId) return;
        origSize = Number(res.headers.get('X-Original-Size') || state.sourceBlob.size);
        outW = Number(res.headers.get('X-Image-Width') || state.srcW);
        outH = Number(res.headers.get('X-Image-Height') || state.srcH);
      } else {
        const local = await convertClientSide();
        if (myRun !== state.runId) return;
        outBlob = local.blob;
        outW = local.w;
        outH = local.h;
      }

      state.resultW = outW;
      state.resultH = outH;

      const needsFallbackPreview = state.format === 'tiff';
      await applyPreviewBlob(outBlob, needsFallbackPreview);
      if (myRun !== state.runId) return;

      updateSizeStats(origSize, outBlob.size, outW, outH);

      if (convResultMeta) convResultMeta.textContent = `${meta.label} · ${outW} × ${outH} · ${formatBytes(outBlob.size)}`;
      if (convExportMeta) convExportMeta.textContent = `${meta.label} · ${formatBytes(outBlob.size)}`;
      if (convDownloadBtn) convDownloadBtn.textContent = `Download ${meta.label}`;
      if (convResultsDeck) convResultsDeck.style.display = 'block';

      setPreviewView(state.previewView);
      setComparePos(convCompareSlider?.value || 50);
      stopProgress('Conversion ready.');
    } catch (err) {
      if (err?.name === 'AbortError' || myRun !== state.runId) return;
      stopProgress('');
      showError(err?.message || 'Could not convert this image.');
      if (convResultMeta) convResultMeta.textContent = 'Ready';
    } finally {
      if (myRun === state.runId) {
        state.busy = false;
        if (convPreviewStage) convPreviewStage.classList.remove('is-busy');
        if (convRunBtn) convRunBtn.disabled = false;
      }
    }
  }

  function scheduleConvert(delay = 140) {
    clearTimeout(state.debounceTimer);
    if (!state.sourceBlob || !state.sourceImg) return;
    state.debounceTimer = setTimeout(() => convertImage(), delay);
  }

  function buildSampleTransparentPngBlob() {
    return new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = 720;
      c.height = 540;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);

      // Floating shadow on true alpha channel
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
      ctx.shadowBlur = 32;
      ctx.shadowOffsetY = 16;

      // Outer rounded black badge
      ctx.fillStyle = '#0a0a0a';
      ctx.beginPath();
      ctx.roundRect(140, 75, 440, 380, 48);
      ctx.fill();
      ctx.restore();

      // Inner geometric crisp details
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(184, 120, 160, 140, 22);
      ctx.fill();

      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(452, 190, 68, 0, Math.PI * 2);
      ctx.fill();

      const grad = ctx.createLinearGradient(184, 290, 536, 410);
      grad.addColorStop(0, '#f59e0b');
      grad.addColorStop(0.5, '#ef4444');
      grad.addColorStop(1, '#10b981');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(184, 290, 352, 118, 22);
      ctx.fill();

      // Punch a crisp circular transparent cutout window inside the badge
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(264, 190, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      c.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  function loadFile(blob, name = 'image.png') {
    if (!blob) return;
    if (state.sourceUrl) URL.revokeObjectURL(state.sourceUrl);
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    if (state.previewFallbackUrl) {
      URL.revokeObjectURL(state.previewFallbackUrl);
      state.previewFallbackUrl = '';
    }

    state.sourceBlob = blob;
    state.sourceName = name;
    state.sourceUrl = URL.createObjectURL(blob);
    state.sourceExtLabel = inferExtLabel(name, blob.type);
    state.resultBlob = null;
    state.resultUrl = '';

    const stem = name.replace(/\.[^.]+$/, '') || 'converted';
    if (convOutputName) convOutputName.value = stem;
    if (convFileName) convFileName.textContent = name;
    if (convOrigSizeBadge) convOrigSizeBadge.textContent = formatBytes(blob.size);
    if (convResultsDeck) convResultsDeck.style.display = 'none';
    if (convStatsDeck) convStatsDeck.style.display = 'none';
    if (convPreviewNote) convPreviewNote.style.display = 'none';
    showError('');

    const img = new Image();
    img.onload = () => {
      state.sourceImg = img;
      state.srcW = img.naturalWidth || img.width;
      state.srcH = img.naturalHeight || img.height;
      state.hasAlpha = detectAlphaChannel(img);

      if (convOrigMetaBadge) {
        convOrigMetaBadge.textContent = `${state.sourceExtLabel} · ${state.srcW} × ${state.srcH}`;
      }
      if (convAlphaBadge) {
        convAlphaBadge.textContent = state.hasAlpha ? 'Transparent' : 'Opaque';
        convAlphaBadge.classList.toggle('has-alpha', state.hasAlpha);
      }

      if (convResultImg) convResultImg.src = state.sourceUrl;
      if (convOriginalImg) convOriginalImg.src = state.sourceUrl;
      if (convCompareOrigImg) convCompareOrigImg.src = state.sourceUrl;

      if (convDropzone) convDropzone.style.display = 'none';
      if (convFileBanner) convFileBanner.classList.add('active');
      if (convWorkspace) convWorkspace.classList.add('active');

      syncControlsUI();
      setPreviewView('converted');
      convertImage();
    };
    img.onerror = () => {
      showError('Could not decode this image file. Try PNG, JPG, WebP, GIF, BMP, AVIF, or ICO.');
    };
    img.src = state.sourceUrl;
  }

  // Fallback if an exotic image format (e.g. TIFF/ICO edge case) fails <img> render
  convResultImg?.addEventListener('error', async () => {
    if (!state.sourceImg || state.previewFallbackUrl) return;
    const c = renderTargetCanvas(false);
    const b = await new Promise((res) => c.toBlob(res, 'image/png'));
    if (!b) return;
    state.previewFallbackUrl = URL.createObjectURL(b);
    convResultImg.src = state.previewFallbackUrl;
    if (convCompareResultImg) convCompareResultImg.src = state.previewFallbackUrl;
    if (convPreviewNote) {
      convPreviewNote.textContent = `Preview rendered cleanly — downloaded file is exact ${FORMAT_META[state.format].label}.`;
      convPreviewNote.style.display = 'block';
    }
  });

  // Upload events
  convBrowseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    convFileInput?.click();
  });
  convReplaceBtn?.addEventListener('click', () => convFileInput?.click());
  convDropzone?.addEventListener('click', () => convFileInput?.click());
  convFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file, file.name);
    convFileInput.value = '';
  });

  convDropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    convDropzone.classList.add('dragover');
  });
  convDropzone?.addEventListener('dragleave', () => convDropzone.classList.remove('dragover'));
  convDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    convDropzone.classList.remove('dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file, file.name);
  });

  convSampleBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const blob = await buildSampleTransparentPngBlob();
    if (blob) loadFile(blob, 'sample-transparent.png');
  });

  document.addEventListener('paste', (e) => {
    if (!panelConvert?.classList.contains('active')) return;
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) loadFile(blob, 'pasted-image.png');
        break;
      }
    }
  });

  // Preview mode tabs & compare slider & backdrop
  convPreviewTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-tab');
    if (btn?.dataset.convView) setPreviewView(btn.dataset.convView);
  });
  convCompareSlider?.addEventListener('input', (e) => setComparePos(e.target.value));
  convBackdropSwatches.forEach((swatch) => {
    swatch.addEventListener('click', () => setBackdrop(swatch.dataset.backdrop));
  });
  convBackdropColor?.addEventListener('input', (e) => setBackdrop(e.target.value));

  // Output format tabs
  convFormatTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-tab');
    const fmt = btn?.dataset.convFmt;
    if (!fmt || !FORMAT_META[fmt] || fmt === state.format) return;
    state.format = fmt;
    convFormatTabs.querySelectorAll('.seg-tab').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    syncControlsUI();
    scheduleConvert(60);
  });

  // Quality slider & lossless toggle
  convQualityRange?.addEventListener('input', (e) => {
    state.quality = Math.max(1, Math.min(100, Number(e.target.value) || 88));
    syncControlsUI();
    scheduleConvert(180);
  });
  convLosslessCheck?.addEventListener('change', () => {
    state.lossless = Boolean(convLosslessCheck.checked);
    syncControlsUI();
    scheduleConvert(60);
  });

  // Scale tabs
  convScaleTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-tab');
    const sc = Number(btn?.dataset.convScale);
    if (!sc || sc === state.scale) return;
    state.scale = sc;
    convScaleTabs.querySelectorAll('.seg-tab').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', String(active));
    });
    syncControlsUI();
    scheduleConvert(60);
  });

  // Transparency controls
  convPreserveAlphaCheck?.addEventListener('change', () => {
    state.preserveAlpha = Boolean(convPreserveAlphaCheck.checked);
    syncControlsUI();
    scheduleConvert(60);
  });

  convMatteSwatches.forEach((sw) => {
    sw.addEventListener('click', () => {
      if (!sw.dataset.matte) return;
      setMatteColor(sw.dataset.matte);
      scheduleConvert(60);
    });
  });
  convMatteColor?.addEventListener('input', (e) => {
    setMatteColor(e.target.value);
    scheduleConvert(160);
  });

  convRunBtn?.addEventListener('click', () => convertImage());

  // Export & clipboard copy
  convDownloadBtn?.addEventListener('click', () => {
    if (!state.resultBlob || !state.resultUrl) return;
    const meta = FORMAT_META[state.format];
    const base = (convOutputName?.value || 'converted').trim().replace(/[<>:"/\\|?*]+/g, '_') || 'converted';
    const cleanBase = base.replace(/\.(png|jpe?g|webp|avif|gif|bmp|tiff?|ico)$/i, '');
    const a = document.createElement('a');
    a.href = state.resultUrl;
    a.download = `${cleanBase}${meta.ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.CleanLab?.toast(`Downloaded ${cleanBase}${meta.ext}`);
  });

  convCopyBtn?.addEventListener('click', async () => {
    if (!state.sourceImg) return;
    try {
      const canvas = state.format === 'ico' ? renderTargetCanvas(false, 256) : renderTargetCanvas(!FORMAT_META[state.format].alpha);
      const pngBlob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!pngBlob || !navigator.clipboard?.write) throw new Error('Clipboard image copy not supported here');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      window.CleanLab?.toast('Copied preview image to clipboard');
    } catch {
      window.CleanLab?.toast('Clipboard copy not supported — use Download instead');
    }
  });

  // Initialize default control states
  setBackdrop('checker');
  setMatteColor('#ffffff');
  syncControlsUI();
})();
