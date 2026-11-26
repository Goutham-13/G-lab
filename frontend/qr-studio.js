/* ==========================================================================
   CleanLab — Minimal QR Code Generator (Image-Aligned QR, Live Preview, PNG + SVG)
   ========================================================================== */

(() => {
  'use strict';

  const MODE_ORDER = ['url', 'wifi', 'vcard', 'text', 'email'];

  // Content tabs & panels
  const modeBtns = [...document.querySelectorAll('#qrModeTabs [data-qr-mode]')];
  const qrSubpanels = Object.fromEntries(
    MODE_ORDER.map((m) => [m, document.getElementById(`qr-mode-${m}`)])
  );

  // Inputs
  const qrUrlInput = document.getElementById('qrUrlInput');
  const qrHttpsBtn = document.getElementById('qrHttpsBtn');
  const wifiSsid = document.getElementById('wifiSsid');
  const wifiPass = document.getElementById('wifiPass');
  const wifiSec = document.getElementById('wifiSec');
  const wifiHidden = document.getElementById('wifiHidden');

  const vcName = document.getElementById('vcName');
  const vcOrg = document.getElementById('vcOrg');
  const vcPhone = document.getElementById('vcPhone');
  const vcEmail = document.getElementById('vcEmail');

  const qrTextArea = document.getElementById('qrTextArea');
  const emTo = document.getElementById('emTo');
  const emSubject = document.getElementById('emSubject');
  const emBody = document.getElementById('emBody');

  // Look controls
  const qrSizeSlider = document.getElementById('qrSizeSlider');
  const qrSizeLabel = document.getElementById('qrSizeLabel');
  const qrEcSelect = document.getElementById('qrEcSelect');
  const qrFgColor = document.getElementById('qrFgColor');
  const qrBgColor = document.getElementById('qrBgColor');
  const swatchBtns = [...document.querySelectorAll('.swatch-btn')];
  const qrMarginCheck = document.getElementById('qrMarginCheck');
  const qrRoundCheck = document.getElementById('qrRoundCheck');
  const qrContrastAlert = document.getElementById('qrContrastAlert');

  // Image alignment controls
  const qrLogoFileInput = document.getElementById('qrLogoFileInput');
  const qrLogoUploadBtn = document.getElementById('qrLogoUploadBtn');
  const qrLogoPreviewChip = document.getElementById('qrLogoPreviewChip');
  const qrLogoThumb = document.getElementById('qrLogoThumb');
  const qrLogoClearBtn = document.getElementById('qrLogoClearBtn');
  const qrImageOptions = document.getElementById('qrImageOptions');
  const imgModeBtns = [...document.querySelectorAll('#qrImgModeTabs [data-img-mode]')];
  const qrBlendSliderWrap = document.getElementById('qrBlendSliderWrap');
  const qrBlendSlider = document.getElementById('qrBlendSlider');
  const qrBlendLabel = document.getElementById('qrBlendLabel');

  // Preview & Exports
  const qrPreviewCanvas = document.getElementById('qrPreviewCanvas');
  const qrPreviewMount = document.getElementById('qrPreviewMount');
  const qrEmptyState = document.getElementById('qrEmptyState');
  const qrPayloadPreview = document.getElementById('qrPayloadPreview');

  const qrDownloadPng = document.getElementById('qrDownloadPng');
  const qrDownloadSvg = document.getElementById('qrDownloadSvg');
  const qrCopyBtn = document.getElementById('qrCopyBtn');

  let activeMode = 'url';
  let imgMode = 'blend'; // 'blend' | 'mosaic' | 'center'
  let currentPayload = '';
  let currentSvgString = '';
  let logoDataUrl = '';
  let logoImageEl = null;

  function escapeWifi(val) {
    return String(val || '').replace(/([\\;,:"])/g, '\\$1');
  }

  function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    const num = parseInt(full, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  }

  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastRatio(hexA, hexB) {
    const l1 = luminance(hexA);
    const l2 = luminance(hexB);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  function buildPayload() {
    switch (activeMode) {
      case 'url':
        return (qrUrlInput.value || '').trim();
      case 'wifi': {
        const ssid = (wifiSsid.value || '').trim();
        if (!ssid) return '';
        const sec = wifiSec.value || 'WPA';
        const pass = sec === 'nopass' ? '' : (wifiPass.value || '');
        const hidden = wifiHidden.checked ? 'true' : 'false';
        return `WIFI:T:${sec};S:${escapeWifi(ssid)};P:${escapeWifi(pass)};H:${hidden};;`;
      }
      case 'vcard': {
        const name = (vcName.value || '').trim();
        const org = (vcOrg.value || '').trim();
        const phone = (vcPhone.value || '').trim();
        const email = (vcEmail.value || '').trim();
        if (!name && !phone && !email && !org) return '';
        const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
        if (name) lines.push(`FN:${name}`);
        if (org) lines.push(`ORG:${org}`);
        if (phone) lines.push(`TEL:${phone}`);
        if (email) lines.push(`EMAIL:${email}`);
        lines.push('END:VCARD');
        return lines.join('\n');
      }
      case 'text':
        return (qrTextArea.value || '').trim();
      case 'email': {
        const to = (emTo.value || '').trim();
        if (!to) return '';
        const params = [];
        const subj = (emSubject.value || '').trim();
        const body = (emBody.value || '').trim();
        if (subj) params.push(`subject=${encodeURIComponent(subj)}`);
        if (body) params.push(`body=${encodeURIComponent(body)}`);
        return `mailto:${to}${params.length ? '?' + params.join('&') : ''}`;
      }
      default:
        return '';
    }
  }

  function isFinderOrTiming(r, c, count) {
    const inTopLeft = r < 8 && c < 8;
    const inTopRight = r < 8 && c >= count - 8;
    const inBottomLeft = r >= count - 8 && c < 8;
    const onTiming = r === 6 || c === 6;
    return inTopLeft || inTopRight || inBottomLeft || onTiming;
  }

  function isFinderOnly(r, c, count) {
    const top = r < 7;
    const bottom = r >= count - 7;
    const left = c < 7;
    const right = c >= count - 7;
    return (top && left) || (top && right) || (bottom && left);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Draw cover-cropped square image onto ctx inside (dx, dy, dw, dh)
  function drawCoverImage(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || dw;
    const ih = img.naturalHeight || dh;
    const side = Math.min(iw, ih);
    const sx = (iw - side) / 2;
    const sy = (ih - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, dx, dy, dw, dh);
  }

  // Sample image colors on a count x count grid for Color Mosaic mode
  function sampleModuleColors(img, count) {
    const off = document.createElement('canvas');
    off.width = count;
    off.height = count;
    const octx = off.getContext('2d');
    drawCoverImage(octx, img, 0, 0, count, count);
    return octx.getImageData(0, 0, count, count).data;
  }

  function clampDarkHex(r, g, b) {
    // Ensure dark modules stay noticeably darker than white background so phones scan cleanly
    const maxLum = 135;
    const perceived = 0.299 * r + 0.587 * g + 0.114 * b;
    const factor = perceived > maxLum ? maxLum / perceived : 1;
    const rr = Math.round(r * factor).toString(16).padStart(2, '0');
    const gg = Math.round(g * factor).toString(16).padStart(2, '0');
    const bb = Math.round(b * factor).toString(16).padStart(2, '0');
    return `#${rr}${gg}${bb}`;
  }

  function renderQR() {
    if (!window.QRCode) return;
    const payload = buildPayload();
    currentPayload = payload;

    const size = Number(qrSizeSlider.value || 512);
    const hasImg = Boolean(logoImageEl && logoImageEl.complete && logoDataUrl);
    const ec = hasImg ? 'H' : (qrEcSelect.value || 'M');
    const fg = qrFgColor.value || '#0a0a0a';
    const bg = qrBgColor.value || '#ffffff';
    const margin = qrMarginCheck.checked ? 4 : 1;
    const rounded = qrRoundCheck.checked;
    const blendPct = Number(qrBlendSlider.value || 80);

    qrSizeLabel.textContent = `${size} px`;
    qrBlendLabel.textContent = `${blendPct}%`;

    const ratio = contrastRatio(fg, bg);
    const badContrast = ratio < 3.0 || luminance(fg) >= luminance(bg);
    qrContrastAlert.classList.toggle('show', badContrast);

    if (!payload) {
      qrPreviewMount.style.display = 'none';
      qrEmptyState.style.display = 'block';
      qrPayloadPreview.textContent = 'Enter details on the left to preview.';
      currentSvgString = '';
      return;
    }

    qrPreviewMount.style.display = 'block';
    qrEmptyState.style.display = 'none';
    qrPayloadPreview.textContent = payload;

    let qrData;
    try {
      qrData = window.QRCode.create(payload, { errorCorrectionLevel: ec });
    } catch {
      qrPayloadPreview.textContent = 'Content is too long for a QR code.';
      return;
    }

    const modules = qrData.modules;
    const count = modules.size;
    const totalUnits = count + margin * 2;
    const canvas = qrPreviewCanvas;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);

    const cell = size / totalUnits;
    const qrAreaOrigin = margin * cell;
    const qrAreaSize = count * cell;
    const svgParts = [`<rect width="${size}" height="${size}" fill="${bg}"/>`];

    // MODE A: FULL IMAGE BLEND (entire QR aligns to uploaded image)
    if (hasImg && imgMode === 'blend') {
      const alpha = blendPct / 100;
      ctx.save();
      ctx.globalAlpha = alpha;
      drawCoverImage(ctx, logoImageEl, qrAreaOrigin, qrAreaOrigin, qrAreaSize, qrAreaSize);
      ctx.restore();

      svgParts.push(
        `<image href="${logoDataUrl}" x="${qrAreaOrigin.toFixed(2)}" y="${qrAreaOrigin.toFixed(2)}" width="${qrAreaSize.toFixed(2)}" height="${qrAreaSize.toFixed(2)}" preserveAspectRatio="xMidYMid slice" opacity="${alpha.toFixed(2)}"/>`
      );

      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          const dark = Boolean(modules.data[r * count + c]);
          const x = (c + margin) * cell;
          const y = (r + margin) * cell;
          const structural = isFinderOrTiming(r, c, count);

          if (structural) {
            ctx.fillStyle = dark ? fg : bg;
            const s = cell + 0.35;
            ctx.fillRect(x, y, s, s);
            svgParts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${dark ? fg : bg}"/>`);
          } else {
            // Crisp sub-module center core preserves scan reliability while image shows around it
            const coreScale = 0.44;
            const coreSize = cell * coreScale;
            const offset = (cell - coreSize) / 2;
            const fillColor = dark ? fg : bg;

            ctx.fillStyle = fillColor;
            if (rounded) {
              const cx = x + cell / 2;
              const cy = y + cell / 2;
              const rad = coreSize * 0.52;
              ctx.beginPath();
              ctx.arc(cx, cy, rad, 0, Math.PI * 2);
              ctx.fill();
              svgParts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rad.toFixed(2)}" fill="${fillColor}"/>`);
            } else {
              ctx.fillRect(x + offset, y + offset, coreSize, coreSize);
              svgParts.push(`<rect x="${(x + offset).toFixed(2)}" y="${(y + offset).toFixed(2)}" width="${coreSize.toFixed(2)}" height="${coreSize.toFixed(2)}" fill="${fillColor}"/>`);
            }
          }
        }
      }
    }
    // MODE B: COLOR MOSAIC (each QR module adopts the uploaded image's color)
    else if (hasImg && imgMode === 'mosaic') {
      const pxData = sampleModuleColors(logoImageEl, count);
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          const dark = Boolean(modules.data[r * count + c]);
          if (!dark) continue;

          const x = (c + margin) * cell;
          const y = (r + margin) * cell;
          const pIdx = (r * count + c) * 4;
          const modColor = isFinderOnly(r, c, count)
            ? fg
            : clampDarkHex(pxData[pIdx], pxData[pIdx + 1], pxData[pIdx + 2]);

          ctx.fillStyle = modColor;
          if (rounded && !isFinderOnly(r, c, count)) {
            const cx = x + cell / 2;
            const cy = y + cell / 2;
            const rad = cell * 0.44;
            ctx.beginPath();
            ctx.arc(cx, cy, rad, 0, Math.PI * 2);
            ctx.fill();
            svgParts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rad.toFixed(2)}" fill="${modColor}"/>`);
          } else {
            const s = cell + 0.35;
            ctx.fillRect(x, y, s, s);
            svgParts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${modColor}"/>`);
          }
        }
      }
    }
    // STANDARD QR OR CENTER LOGO CUTOUT
    else {
      const centerActive = hasImg && imgMode === 'center';
      const cutoutRadiusModules = centerActive ? Math.max(2.6, count * 0.145) : 0;
      const centerIdx = (count - 1) / 2;

      ctx.fillStyle = fg;
      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (!modules.data[r * count + c]) continue;
          if (centerActive) {
            if (Math.abs(r - centerIdx) < cutoutRadiusModules && Math.abs(c - centerIdx) < cutoutRadiusModules) {
              continue;
            }
          }
          const x = (c + margin) * cell;
          const y = (r + margin) * cell;
          if (rounded && !isFinderOnly(r, c, count)) {
            const cx = x + cell / 2;
            const cy = y + cell / 2;
            const rad = cell * 0.44;
            ctx.beginPath();
            ctx.arc(cx, cy, rad, 0, Math.PI * 2);
            ctx.fill();
            svgParts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${rad.toFixed(2)}" fill="${fg}"/>`);
          } else {
            const s = cell + 0.35;
            ctx.fillRect(x, y, s, s);
            svgParts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${fg}"/>`);
          }
        }
      }

      if (centerActive) {
        const boxSize = Math.round(size * 0.22);
        const bx = (size - boxSize) / 2;
        const by = (size - boxSize) / 2;
        const br = Math.round(boxSize * 0.18);
        const pad = Math.round(boxSize * 0.1);
        const inner = boxSize - pad * 2;
        const ix = bx + pad;
        const iy = by + pad;
        const ir = Math.max(4, Math.round(br * 0.65));

        ctx.save();
        ctx.fillStyle = bg;
        roundRectPath(ctx, bx, by, boxSize, boxSize, br);
        ctx.fill();
        ctx.lineWidth = Math.max(2, Math.round(size * 0.006));
        ctx.strokeStyle = fg;
        ctx.stroke();

        roundRectPath(ctx, ix, iy, inner, inner, ir);
        ctx.clip();
        drawCoverImage(ctx, logoImageEl, ix, iy, inner, inner);
        ctx.restore();

        svgParts.push(`
          <defs><clipPath id="qrCenterClip"><rect x="${ix.toFixed(2)}" y="${iy.toFixed(2)}" width="${inner}" height="${inner}" rx="${ir}"/></clipPath></defs>
          <rect x="${bx.toFixed(2)}" y="${by.toFixed(2)}" width="${boxSize}" height="${boxSize}" rx="${br}" fill="${bg}" stroke="${fg}" stroke-width="${Math.max(2, Math.round(size * 0.006))}"/>
          <image href="${logoDataUrl}" x="${ix.toFixed(2)}" y="${iy.toFixed(2)}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid slice" clip-path="url(#qrCenterClip)"/>
        `);
      }
    }

    currentSvgString = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${svgParts.join('')}</svg>`;
  }

  // Content tab switching
  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.qrMode;
      activeMode = mode;
      modeBtns.forEach((b) => {
        const on = b === btn;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      Object.entries(qrSubpanels).forEach(([k, el]) => el.classList.toggle('active', k === mode));
      renderQR();
    });
  });

  // Image mode switching
  imgModeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      imgMode = btn.dataset.imgMode;
      imgModeBtns.forEach((b) => b.classList.toggle('active', b === btn));
      qrBlendSliderWrap.style.display = imgMode === 'blend' ? 'block' : 'none';
      renderQR();
    });
  });

  // Upload image
  qrLogoUploadBtn?.addEventListener('click', () => qrLogoFileInput.click());

  qrLogoFileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      logoDataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        logoImageEl = img;
        qrLogoThumb.src = logoDataUrl;
        qrLogoPreviewChip.style.display = 'inline-flex';
        qrImageOptions.style.display = 'block';
        renderQR();
        window.CleanLab?.toast('Image applied to QR');
      };
      img.src = logoDataUrl;
    };
    reader.readAsDataURL(file);
    qrLogoFileInput.value = '';
  });

  qrLogoClearBtn?.addEventListener('click', () => {
    logoDataUrl = '';
    logoImageEl = null;
    qrLogoPreviewChip.style.display = 'none';
    qrImageOptions.style.display = 'none';
    qrLogoThumb.removeAttribute('src');
    renderQR();
    window.CleanLab?.toast('Image removed');
  });

  qrHttpsBtn?.addEventListener('click', () => {
    const val = (qrUrlInput.value || '').trim();
    if (val && !/^https?:\/\//i.test(val)) {
      qrUrlInput.value = 'https://' + val;
      renderQR();
    }
  });

  // Live bindings
  [qrUrlInput, wifiSsid, wifiPass, vcName, vcOrg, vcPhone, vcEmail, qrTextArea, emTo, emSubject, emBody].forEach((el) => {
    el?.addEventListener('input', renderQR);
  });
  [wifiSec, wifiHidden, qrEcSelect, qrMarginCheck, qrRoundCheck].forEach((el) => {
    el?.addEventListener('change', renderQR);
  });
  [qrSizeSlider, qrBlendSlider].forEach((el) => {
    el?.addEventListener('input', renderQR);
  });

  swatchBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      swatchBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      qrFgColor.value = btn.dataset.fg;
      qrBgColor.value = btn.dataset.bg;
      renderQR();
    });
  });

  [qrFgColor, qrBgColor].forEach((inp) => {
    inp?.addEventListener('input', () => {
      swatchBtns.forEach((b) => b.classList.remove('active'));
      renderQR();
    });
  });

  // Exports
  qrDownloadPng?.addEventListener('click', () => {
    if (!currentPayload) {
      window.CleanLab?.toast('Enter details first');
      return;
    }
    const link = document.createElement('a');
    link.download = `qr-code-${qrSizeSlider.value || 512}px.png`;
    link.href = qrPreviewCanvas.toDataURL('image/png');
    link.click();
    window.CleanLab?.toast('PNG downloaded');
  });

  qrDownloadSvg?.addEventListener('click', () => {
    if (!currentSvgString) {
      window.CleanLab?.toast('Enter details first');
      return;
    }
    const blob = new Blob([currentSvgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'qr-code.svg';
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    window.CleanLab?.toast('SVG downloaded');
  });

  qrCopyBtn?.addEventListener('click', async () => {
    if (!currentPayload) return;
    try {
      const blob = await new Promise((resolve) => qrPreviewCanvas.toBlob(resolve, 'image/png'));
      if (navigator.clipboard && window.ClipboardItem && blob) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        window.CleanLab?.toast('Image copied');
      } else {
        await navigator.clipboard.writeText(currentPayload);
        window.CleanLab?.toast('Text copied');
      }
    } catch {
      window.CleanLab?.toast('Use Download instead');
    }
  });

  renderQR();
})();
