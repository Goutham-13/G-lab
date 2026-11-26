/* ==========================================================================
   CleanLab — Color Picker Studio (Median-Cut Palette + On-Image Pins + Loupe)
   ========================================================================== */

(() => {
  'use strict';

  const state = {
    img: null,
    fileName: 'image.png',
    fmt: 'hex',
    showPins: true,
    paletteCount: 6,
    palette: [],
    pickedColor: null,
    activeIndex: 0, // index in palette, or -1 if pickedColor is active
  };

  // DOM refs
  const panelColor = document.getElementById('panel-color');
  const colorDropzone = document.getElementById('colorDropzone');
  const colorFileInput = document.getElementById('colorFileInput');
  const colorBrowseBtn = document.getElementById('colorBrowseBtn');
  const colorSampleBtn = document.getElementById('colorSampleBtn');
  const colorReplaceBtn = document.getElementById('colorReplaceBtn');
  const colorFileBanner = document.getElementById('colorFileBanner');
  const colorFileName = document.getElementById('colorFileName');
  const colorDimBadge = document.getElementById('colorDimBadge');
  const colorWorkspace = document.getElementById('colorWorkspace');

  const colorHoverMeta = document.getElementById('colorHoverMeta');
  const colorFmtTabs = document.getElementById('colorFmtTabs');
  const colorShowPinsCheck = document.getElementById('colorShowPinsCheck');
  const colorImageFrame = document.getElementById('colorImageFrame');
  const colorImageCanvas = document.getElementById('colorImageCanvas');
  const colorPinsLayer = document.getElementById('colorPinsLayer');
  const colorLoupe = document.getElementById('colorLoupe');
  const colorLoupeCanvas = document.getElementById('colorLoupeCanvas');
  const colorLoupeCode = document.getElementById('colorLoupeCode');

  const colorSelectedRole = document.getElementById('colorSelectedRole');
  const colorActiveSwatch = document.getElementById('colorActiveSwatch');
  const colorActiveMainCode = document.getElementById('colorActiveMainCode');
  const colorActiveSub = document.getElementById('colorActiveSub');
  const colorCodeHex = document.getElementById('colorCodeHex');
  const colorCodeRgb = document.getElementById('colorCodeRgb');
  const colorCodeHsl = document.getElementById('colorCodeHsl');
  const colorCodeCmyk = document.getElementById('colorCodeCmyk');
  const colorInspectorRows = document.getElementById('colorInspectorRows');

  const colorCountRange = document.getElementById('colorCountRange');
  const colorCountVal = document.getElementById('colorCountVal');
  const colorPaletteList = document.getElementById('colorPaletteList');
  const colorCopyAllBtn = document.getElementById('colorCopyAllBtn');
  const colorDownloadBtn = document.getElementById('colorDownloadBtn');

  // --- Color Conversion Helpers ---
  const toHex = (r, g, b) =>
    '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();

  const toRgbStr = (r, g, b) => `rgb(${r}, ${g}, ${b})`;

  const rgbToHsl = (r, g, b) => {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d !== 0) {
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
      else if (max === gn) h = ((bn - rn) / d + 2) / 6;
      else h = ((rn - gn) / d + 4) / 6;
    }
    return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
  };

  const toHslStr = (r, g, b) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    return `hsl(${h}, ${s}%, ${l}%)`;
  };

  const toCmykStr = (r, g, b) => {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const k = 1 - Math.max(rn, gn, bn);
    if (k >= 0.999) return 'cmyk(0%, 0%, 0%, 100%)';
    const c = Math.round(((1 - rn - k) / (1 - k)) * 100);
    const m = Math.round(((1 - gn - k) / (1 - k)) * 100);
    const y = Math.round(((1 - bn - k) / (1 - k)) * 100);
    return `cmyk(${c}%, ${m}%, ${y}%, ${Math.round(k * 100)}%)`;
  };

  const formatColor = (c, fmt = state.fmt) => {
    if (!c) return '';
    if (fmt === 'rgb') return toRgbStr(c.r, c.g, c.b);
    if (fmt === 'hsl') return toHslStr(c.r, c.g, c.b);
    if (fmt === 'cmyk') return toCmykStr(c.r, c.g, c.b);
    return toHex(c.r, c.g, c.b);
  };

  const copyText = async (text, triggerBtn) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    window.CleanLab?.toast(`Copied ${text}`);
    if (triggerBtn) {
      const prev = triggerBtn.textContent;
      triggerBtn.textContent = 'Copied';
      setTimeout(() => {
        if (triggerBtn.isConnected) triggerBtn.textContent = prev;
      }, 900);
    }
  };

  // --- Palette Extraction (Density Histogram Peaks + Exact Pixel Medoids + Coherent Pins) ---
  const extractPalette = (canvas, count) => {
    const srcW = canvas.width;
    const srcH = canvas.height;
    if (!srcW || !srcH) return [];

    const maxDim = 180;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const sw = Math.max(16, Math.round(srcW * scale));
    const sh = Math.max(16, Math.round(srcH * scale));

    const off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    const octx = off.getContext('2d', { willReadFrequently: true });
    octx.drawImage(canvas, 0, 0, sw, sh);
    const data = octx.getImageData(0, 0, sw, sh).data;

    // Group opaque pixels into 24-level quantized color bins (fast, crisp peaks without blending artifacts)
    const bins = new Map();
    const pixels = [];
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const idx = (y * sw + x) * 4;
        if (data[idx + 3] < 128) continue;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Local coherence: penalize border pixels so pins land squarely inside color regions
        let edgeDiff = 0;
        if (x > 1 && x < sw - 2 && y > 1 && y < sh - 2) {
          const nIdx = ((y - 2) * sw + x) * 4;
          const eIdx = (y * sw + (x + 2)) * 4;
          edgeDiff =
            Math.abs(r - data[nIdx]) + Math.abs(g - data[nIdx + 1]) + Math.abs(b - data[nIdx + 2]) +
            Math.abs(r - data[eIdx]) + Math.abs(g - data[eIdx + 1]) + Math.abs(b - data[eIdx + 2]);
        } else {
          edgeDiff = 999;
        }

        const p = {
          r,
          g,
          b,
          edgeDiff,
          xp: ((x + 0.5) / sw) * 100,
          yp: ((y + 0.5) / sh) * 100,
        };
        pixels.push(p);

        const qr = r >> 3;
        const qg = g >> 3;
        const qb = b >> 3;
        const key = (qr << 10) | (qg << 5) | qb;
        let bin = bins.get(key);
        if (!bin) {
          bin = { sr: 0, sg: 0, sb: 0, count: 0, rep: p, bestCoherence: edgeDiff };
          bins.set(key, bin);
        }
        bin.sr += r;
        bin.sg += g;
        bin.sb += b;
        bin.count++;
        if (edgeDiff < bin.bestCoherence) {
          bin.bestCoherence = edgeDiff;
          bin.rep = p;
        }
      }
    }
    if (!pixels.length) return [];

    // Sort dense bins (keep real pixel color from highest-density interior region)
    const peaks = [...bins.values()]
      .map((bin) => ({
        r: bin.rep.r,
        g: bin.rep.g,
        b: bin.rep.b,
        count: bin.count,
      }))
      .sort((a, b) => b.count - a.count);

    // Pick distinct perceptual colors cleanly without averaging unrelated hues together
    const distSq = (a, b) => (a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2;
    const chosen = [];
    const thresholds = [55 * 55, 36 * 36, 20 * 20];
    for (const thr of thresholds) {
      for (const pk of peaks) {
        if (chosen.some((c) => distSq(c, pk) < thr)) continue;
        chosen.push({ ...pk, weight: 0, matches: [] });
        if (chosen.length >= count) break;
      }
      if (chosen.length >= count) break;
    }

    // Assign every sampled pixel to its closest chosen peak to compute true presence % & pin points
    for (let i = 0; i < pixels.length; i++) {
      const p = pixels[i];
      let bestIdx = 0;
      let bestD = Infinity;
      for (let j = 0; j < chosen.length; j++) {
        const d = distSq(p, chosen[j]);
        if (d < bestD) {
          bestD = d;
          bestIdx = j;
        }
      }
      chosen[bestIdx].weight++;
      if (bestD < 45 * 45) chosen[bestIdx].matches.push(p);
    }

    chosen.sort((a, b) => b.weight - a.weight);
    const total = pixels.length || 1;
    const placedPins = [];

    return chosen.map((c) => {
      const candidates = c.matches.length ? c.matches : pixels;
      let bestScore = Infinity;
      let bestX = 50;
      let bestY = 50;
      const step = Math.max(1, Math.floor(candidates.length / 260));
      for (let i = 0; i < candidates.length; i += step) {
        const p = candidates[i];
        const edgePenalty = (p.xp < 10 || p.xp > 90 || p.yp < 12 || p.yp > 88) ? 3000 : 0;
        let overlapPenalty = 0;
        for (const pin of placedPins) {
          const d = Math.hypot(p.xp - pin.xp, p.yp - pin.yp);
          if (d < 16) overlapPenalty += (16 - d) * 260;
        }
        const colorErr = distSq(p, c);
        const score = colorErr * 2 + p.edgeDiff * 6 + edgePenalty + overlapPenalty;
        if (score < bestScore) {
          bestScore = score;
          bestX = p.xp;
          bestY = p.yp;
        }
      }
      bestX = Math.max(10, Math.min(90, bestX));
      bestY = Math.max(12, Math.min(88, bestY));
      placedPins.push({ xp: bestX, yp: bestY });

      return {
        r: c.r,
        g: c.g,
        b: c.b,
        pct: Math.max(1, Math.round((c.weight / total) * 100)),
        xp: bestX,
        yp: bestY,
      };
    });
  };

  // --- UI Rendering ---
  const getActiveColor = () => {
    if (state.activeIndex === -1 && state.pickedColor) return state.pickedColor;
    return state.palette[state.activeIndex] || state.palette[0] || null;
  };

  const renderInspector = () => {
    const active = getActiveColor();
    if (!active) return;

    const hex = toHex(active.r, active.g, active.b);
    const rgb = toRgbStr(active.r, active.g, active.b);
    const hsl = toHslStr(active.r, active.g, active.b);
    const cmyk = toCmykStr(active.r, active.g, active.b);

    if (colorActiveSwatch) colorActiveSwatch.style.backgroundColor = hex;
    if (colorActiveMainCode) colorActiveMainCode.textContent = formatColor(active);
    if (colorSelectedRole) {
      colorSelectedRole.textContent = state.activeIndex === -1 ? 'Picked Pixel' : `Color #${state.activeIndex + 1} · ${active.pct}%`;
    }
    if (colorActiveSub) {
      colorActiveSub.textContent = state.activeIndex === -1
        ? `Position ${Math.round(active.xp)}%, ${Math.round(active.yp)}% on image`
        : `${active.pct}% presence in image`;
    }

    if (colorCodeHex) colorCodeHex.textContent = hex;
    if (colorCodeRgb) colorCodeRgb.textContent = rgb;
    if (colorCodeHsl) colorCodeHsl.textContent = hsl;
    if (colorCodeCmyk) colorCodeCmyk.textContent = cmyk;
  };

  const renderPins = () => {
    if (!colorPinsLayer) return;
    colorPinsLayer.replaceChildren();
    colorPinsLayer.style.display = state.showPins ? 'block' : 'none';
    if (!state.showPins) return;

    const makePin = (c, idx, isActive) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `color-pin${isActive ? ' active' : ''}`;
      btn.style.left = `${c.xp}%`;
      btn.style.top = `${c.yp}%`;
      btn.title = `${formatColor(c)} — click to select`;

      const dot = document.createElement('span');
      dot.className = 'color-pin-dot';
      dot.style.backgroundColor = toHex(c.r, c.g, c.b);

      const code = document.createElement('span');
      code.textContent = formatColor(c);

      btn.append(dot, code);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.activeIndex = idx;
        renderAll();
      });
      return btn;
    };

    state.palette.forEach((c, idx) => {
      colorPinsLayer.appendChild(makePin(c, idx, state.activeIndex === idx));
    });

    if (state.pickedColor) {
      colorPinsLayer.appendChild(makePin(state.pickedColor, -1, state.activeIndex === -1));
    }
  };

  const renderPaletteList = () => {
    if (!colorPaletteList) return;
    colorPaletteList.replaceChildren();

    state.palette.forEach((c, idx) => {
      const row = document.createElement('div');
      row.className = `color-row${state.activeIndex === idx ? ' active' : ''}`;
      row.setAttribute('role', 'button');
      row.tabIndex = 0;

      const swatch = document.createElement('span');
      swatch.className = 'color-row-swatch';
      swatch.style.backgroundColor = toHex(c.r, c.g, c.b);

      const info = document.createElement('div');
      info.className = 'color-row-info';
      const code = document.createElement('span');
      code.className = 'color-row-code';
      code.textContent = formatColor(c);
      const sub = document.createElement('span');
      sub.className = 'muted-val';
      sub.textContent = `#${idx + 1} · ${c.pct}% share`;
      info.append(code, sub);

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-secondary btn-sm';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyText(formatColor(c), copyBtn);
      });

      row.append(swatch, info, copyBtn);
      row.addEventListener('click', () => {
        state.activeIndex = idx;
        renderAll();
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          state.activeIndex = idx;
          renderAll();
        }
      });

      colorPaletteList.appendChild(row);
    });
  };

  const renderAll = () => {
    renderInspector();
    renderPins();
    renderPaletteList();
  };

  const analyzeCurrentImage = () => {
    if (!colorImageCanvas) return;
    state.palette = extractPalette(colorImageCanvas, state.paletteCount);
    if (state.activeIndex >= state.palette.length) state.activeIndex = 0;
    if (state.activeIndex !== -1 && state.palette.length) state.activeIndex = 0;
    renderAll();
  };

  const loadImageElement = (img, name = 'image.png') => {
    state.img = img;
    state.fileName = name;
    state.pickedColor = null;
    state.activeIndex = 0;

    // Fit high-res image onto canvas cleanly (preserves aspect & fast pixel lookup)
    const maxCanvasDim = 1400;
    const scale = Math.min(1, maxCanvasDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const cw = Math.max(1, Math.round((img.naturalWidth || 800) * scale));
    const ch = Math.max(1, Math.round((img.naturalHeight || 600) * scale));
    colorImageCanvas.width = cw;
    colorImageCanvas.height = ch;
    const ctx = colorImageCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);

    if (colorFileName) colorFileName.textContent = name;
    if (colorDimBadge) colorDimBadge.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
    if (colorDropzone) colorDropzone.style.display = 'none';
    if (colorFileBanner) colorFileBanner.classList.add('active');
    if (colorWorkspace) colorWorkspace.classList.add('active');

    analyzeCurrentImage();
  };

  const loadFile = (blob, name = 'image.png') => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      loadImageElement(img, name);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      window.CleanLab?.toast('Could not decode this image file.');
    };
    img.src = url;
  };

  // Sample vibrant editorial palette illustration
  const buildSampleArtworkBlob = () => new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = 840;
    c.height = 560;
    const ctx = c.getContext('2d');

    // Deep slate sky
    ctx.fillStyle = '#1E293B';
    ctx.fillRect(0, 0, 840, 560);

    // Warm terracotta sun
    ctx.fillStyle = '#F97316';
    ctx.beginPath();
    ctx.arc(620, 155, 86, 0, Math.PI * 2);
    ctx.fill();

    // Soft cream horizon mist
    ctx.fillStyle = '#FDE68A';
    ctx.fillRect(0, 320, 840, 240);

    // Distant teal ridge
    ctx.fillStyle = '#0F766E';
    ctx.beginPath();
    ctx.moveTo(0, 390);
    ctx.lineTo(240, 220);
    ctx.lineTo(520, 370);
    ctx.lineTo(840, 260);
    ctx.lineTo(840, 560);
    ctx.lineTo(0, 560);
    ctx.closePath();
    ctx.fill();

    // Foreground coral wave
    ctx.fillStyle = '#E11D48';
    ctx.beginPath();
    ctx.moveTo(0, 445);
    ctx.quadraticCurveTo(260, 355, 510, 445);
    ctx.quadraticCurveTo(680, 505, 840, 415);
    ctx.lineTo(840, 560);
    ctx.lineTo(0, 560);
    ctx.closePath();
    ctx.fill();

    // Indigo geometric block accent
    ctx.fillStyle = '#4F46E5';
    ctx.beginPath();
    ctx.roundRect(110, 115, 165, 165, 28);
    ctx.fill();

    c.toBlob((blob) => resolve(blob), 'image/png');
  });

  // --- Pointer Inspection / Loupe / Eyedropper ---
  const getCanvasPixelAtPointer = (e) => {
    const rect = colorImageCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const relX = Math.max(0, Math.min(rect.width - 1, e.clientX - rect.left));
    const relY = Math.max(0, Math.min(rect.height - 1, e.clientY - rect.top));
    const cx = Math.min(colorImageCanvas.width - 1, Math.floor((relX / rect.width) * colorImageCanvas.width));
    const cy = Math.min(colorImageCanvas.height - 1, Math.floor((relY / rect.height) * colorImageCanvas.height));
    const ctx = colorImageCanvas.getContext('2d', { willReadFrequently: true });
    const px = ctx.getImageData(cx, cy, 1, 1).data;
    return {
      r: px[0],
      g: px[1],
      b: px[2],
      cx,
      cy,
      xp: ((relX / rect.width) * 100),
      yp: ((relY / rect.height) * 100),
      relX,
      relY,
      rectW: rect.width,
      rectH: rect.height,
    };
  };

  colorImageCanvas?.addEventListener('pointermove', (e) => {
    if (!state.img || e.pointerType === 'touch') return;
    const hit = getCanvasPixelAtPointer(e);
    if (!hit) return;
    const code = formatColor(hit);
    if (colorHoverMeta) colorHoverMeta.textContent = `${code} · Click to pin`;

    if (colorLoupe && colorLoupeCanvas && colorLoupeCode) {
      const lctx = colorLoupeCanvas.getContext('2d');
      lctx.imageSmoothingEnabled = false;
      lctx.clearRect(0, 0, 90, 90);
      const patch = 9;
      const half = Math.floor(patch / 2);
      lctx.drawImage(
        colorImageCanvas,
        Math.max(0, hit.cx - half),
        Math.max(0, hit.cy - half),
        patch,
        patch,
        0,
        0,
        90,
        90
      );
      // Crisp center reticle
      lctx.strokeStyle = '#0a0a0a';
      lctx.lineWidth = 1.5;
      lctx.strokeRect(40, 40, 10, 10);
      colorLoupeCode.textContent = code;

      const flipLeft = hit.relX > hit.rectW - 115 ? hit.relX - 104 : hit.relX + 16;
      const flipTop = hit.relY < 120 ? hit.relY + 16 : hit.relY - 122;
      colorLoupe.style.left = `${Math.max(4, flipLeft)}px`;
      colorLoupe.style.top = `${Math.max(4, flipTop)}px`;
      colorLoupe.style.display = 'flex';
    }
  });

  colorImageCanvas?.addEventListener('pointerleave', () => {
    if (colorLoupe) colorLoupe.style.display = 'none';
    if (colorHoverMeta) colorHoverMeta.textContent = 'Click image to pick a pixel color';
  });

  colorImageCanvas?.addEventListener('click', (e) => {
    if (!state.img) return;
    const hit = getCanvasPixelAtPointer(e);
    if (!hit) return;
    state.pickedColor = {
      r: hit.r,
      g: hit.g,
      b: hit.b,
      pct: 0,
      xp: Math.max(6, Math.min(94, hit.xp)),
      yp: Math.max(8, Math.min(92, hit.yp)),
    };
    state.activeIndex = -1;
    renderAll();
  });

  // --- Controls & Upload Events ---
  colorBrowseBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    colorFileInput?.click();
  });
  colorReplaceBtn?.addEventListener('click', () => colorFileInput?.click());
  colorDropzone?.addEventListener('click', () => colorFileInput?.click());
  colorFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadFile(file, file.name);
    colorFileInput.value = '';
  });

  colorDropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    colorDropzone.classList.add('dragover');
  });
  colorDropzone?.addEventListener('dragleave', () => colorDropzone.classList.remove('dragover'));
  colorDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    colorDropzone.classList.remove('dragover');
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) loadFile(file, file.name);
  });

  document.addEventListener('paste', (e) => {
    if (!panelColor?.classList.contains('active')) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (file) loadFile(file, 'pasted-image.png');
  });

  colorSampleBtn?.addEventListener('click', async (e) => {
    e.stopPropagation();
    const blob = await buildSampleArtworkBlob();
    if (blob) loadFile(blob, 'sample-palette.png');
  });

  colorFmtTabs?.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-tab');
    if (!btn?.dataset.fmt || btn.dataset.fmt === state.fmt) return;
    state.fmt = btn.dataset.fmt;
    colorFmtTabs.querySelectorAll('.seg-tab').forEach((b) => b.classList.toggle('active', b === btn));
    renderAll();
  });

  colorShowPinsCheck?.addEventListener('change', () => {
    state.showPins = Boolean(colorShowPinsCheck.checked);
    renderPins();
  });

  colorCountRange?.addEventListener('input', () => {
    state.paletteCount = Number(colorCountRange.value) || 6;
    if (colorCountVal) colorCountVal.textContent = `${state.paletteCount} colors`;
    if (state.img) analyzeCurrentImage();
  });

  colorInspectorRows?.addEventListener('click', (e) => {
    const btn = e.target.closest('.color-copy-btn');
    if (!btn) return;
    const active = getActiveColor();
    if (!active) return;
    copyText(formatColor(active, btn.dataset.copyFmt), btn);
  });

  colorCopyAllBtn?.addEventListener('click', () => {
    if (!state.palette.length) return;
    const allCodes = state.palette.map((c) => formatColor(c)).join('\n');
    copyText(allCodes, colorCopyAllBtn);
  });

  colorDownloadBtn?.addEventListener('click', () => {
    if (!state.palette.length) return;
    const count = state.palette.length;
    const pad = 28;
    const colW = 148;
    const gap = 14;
    const width = pad * 2 + count * colW + (count - 1) * gap;
    const height = 250;

    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#0a0a0a';
    ctx.font = 'bold 18px Inter, Segoe UI, sans-serif';
    ctx.fillText(`Palette — ${state.fileName}`, pad, 38);

    state.palette.forEach((col, i) => {
      const x = pad + i * (colW + gap);
      const y = 60;
      const hex = toHex(col.r, col.g, col.b);

      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.roundRect(x, y, colW, 118, 10);
      ctx.fill();
      ctx.strokeStyle = '#d4d4d4';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#0a0a0a';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(hex, x, y + 142);

      ctx.fillStyle = '#555555';
      ctx.font = '12px monospace';
      ctx.fillText(`${col.pct}%`, x, y + 162);
    });

    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const stem = state.fileName.replace(/\.[^.]+$/, '') || 'palette';
      const a = document.createElement('a');
      a.href = url;
      a.download = `${stem}-palette.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      window.CleanLab?.toast('Saved palette PNG');
    }, 'image/png');
  });
})();
