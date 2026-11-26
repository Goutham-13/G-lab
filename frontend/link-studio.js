/* ==========================================================================
   CleanLab — Universal Link Downloader (Video/Audio/Image Preview & Lively Status)
   ========================================================================== */

(() => {
  'use strict';

  const linkFetchForm = document.getElementById('linkFetchForm');
  const linkUrlInput = document.getElementById('linkUrlInput');
  const linkFetchBtn = document.getElementById('linkFetchBtn');

  const linkProgressWrap = document.getElementById('linkProgressWrap');
  const linkProgressFill = document.getElementById('linkProgressFill');
  const linkProgressText = document.getElementById('linkProgressText');
  const linkErrorBox = document.getElementById('linkErrorBox');

  const linkResultWrap = document.getElementById('linkResultWrap');
  const linkKindMeta = document.getElementById('linkKindMeta');
  const linkPreviewTabs = document.getElementById('linkPreviewTabs');
  const linkPreviewBox = document.getElementById('linkPreviewBox');
  const linkPlatformLine = document.getElementById('linkPlatformLine');
  const linkTitle = document.getElementById('linkTitle');
  const linkSubLine = document.getElementById('linkSubLine');
  const linkFilterTabs = document.getElementById('linkFilterTabs');
  const linkOptionsList = document.getElementById('linkOptionsList');

  let activeData = null;
  let activeApiBase = null;
  let activeFilter = 'all';
  let activePreviewMode = 'video';
  let progressTicker = null;

  function getConfiguredApiBase() {
    if (window.CLEANLAB_API_BASE) return String(window.CLEANLAB_API_BASE).replace(/\/$/, '');
    if (location.protocol === 'file:') return 'http://127.0.0.1:8000';
    return '';
  }

  async function resolveApiBase() {
    const primary = getConfiguredApiBase();
    try {
      const r = await fetch(`${primary}/api/health`);
      if (r.ok) return primary;
    } catch {}
    if (primary !== 'http://127.0.0.1:8000') {
      try {
        const r2 = await fetch('http://127.0.0.1:8000/api/health');
        if (r2.ok) return 'http://127.0.0.1:8000';
      } catch {}
    }
    return null;
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch]));
  }

  function showError(msg) {
    linkErrorBox.textContent = msg || '';
    linkErrorBox.classList.toggle('show', Boolean(msg));
  }

  function stopProgressTicker() {
    if (progressTicker) {
      clearInterval(progressTicker);
      progressTicker = null;
    }
  }

  function setProgress(show, pct = 0, text = '') {
    linkProgressWrap.style.display = show ? 'block' : 'none';
    linkProgressFill.style.width = `${pct}%`;
    if (text) linkProgressText.textContent = text;
  }

  function startProgressSequence(steps) {
    stopProgressTicker();
    let idx = 0;
    setProgress(true, steps[0].pct, steps[0].text);
    progressTicker = setInterval(() => {
      idx++;
      if (idx < steps.length) {
        setProgress(true, steps[idx].pct, steps[idx].text);
      } else {
        stopProgressTicker();
      }
    }, 650);
  }

  function finishProgress(text = 'All ready!') {
    stopProgressTicker();
    setProgress(true, 100, text);
    setTimeout(() => setProgress(false), 550);
  }

  function inspectDirectClientUrl(url) {
    const parsed = new URL(url);
    const path = parsed.pathname || '';
    const fileName = decodeURIComponent(path.split('/').pop() || '') || parsed.hostname;
    const ext = (fileName.includes('.') ? fileName.split('.').pop() : '').toLowerCase();
    const host = parsed.hostname.replace(/^www\./, '');

    if (/^(youtube\.com|youtu\.be|instagram\.com|x\.com|twitter\.com|tiktok\.com|reddit\.com|vimeo\.com|soundcloud\.com)$/i.test(host)) {
      return { isPlatformNeedingBackend: true };
    }

    let kind = 'file';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'].includes(ext)) kind = 'image';
    else if (['mp4', 'webm', 'mov', 'm4v'].includes(ext)) kind = 'video';
    else if (['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext)) kind = 'audio';
    else if (ext === 'pdf') kind = 'pdf';

    if (kind === 'file' && !ext) {
      return { isPlatformNeedingBackend: true };
    }

    const previews = {};
    if (kind === 'image') previews.image = url;
    else if (kind === 'video') previews.video = url;
    else if (kind === 'audio') previews.audio = url;
    else if (kind === 'pdf') previews.pdf = url;

    return {
      sourceUrl: url,
      kind,
      platform: host,
      title: fileName,
      uploader: host,
      duration: '',
      previewUrl: url,
      thumbnailUrl: kind === 'image' ? url : '',
      previews,
      options: [
        {
          id: 'client_direct',
          targetUrl: url,
          label: `Download ${kind.toUpperCase()} (${(ext || 'file').toUpperCase()})`,
          ext: ext || 'bin',
          kind,
        },
      ],
    };
  }

  function getPreviewMap(data) {
    const map = { ...(data.previews || {}) };
    if (!Object.keys(map).length && data.previewUrl) {
      map[data.kind === 'video_thumb' ? 'image' : data.kind] = data.previewUrl;
    }
    return map;
  }

  function renderPreviewTabs(data) {
    const map = getPreviewMap(data);
    const order = ['video', 'audio', 'image', 'pdf'].filter((k) => Boolean(map[k]));
    if (order.length <= 1) {
      linkPreviewTabs.style.display = 'none';
      linkPreviewTabs.innerHTML = '';
      activePreviewMode = order[0] || data.kind;
      return;
    }

    const labels = { video: 'Watch Video', audio: 'Listen Audio', image: 'View Image', pdf: 'View PDF' };
    activePreviewMode = order.includes(data.kind) ? data.kind : order[0];
    linkPreviewTabs.innerHTML = '';
    order.forEach((mode) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = mode === activePreviewMode ? 'seg-tab active' : 'seg-tab';
      btn.dataset.previewMode = mode;
      btn.textContent = labels[mode];
      btn.addEventListener('click', () => switchPreviewMode(mode));
      linkPreviewTabs.appendChild(btn);
    });
    linkPreviewTabs.style.display = 'inline-flex';
  }

  function switchPreviewMode(mode) {
    if (!activeData) return;
    const map = getPreviewMap(activeData);
    if (!map[mode]) return;
    activePreviewMode = mode;
    [...linkPreviewTabs.children].forEach((b) => {
      b.classList.toggle('active', b.dataset.previewMode === mode);
    });
    renderPreviewContent(activeData, activeApiBase, mode);
  }

  function renderPreviewContent(data, apiBase, mode) {
    linkPreviewBox.innerHTML = '';
    const map = getPreviewMap(data);
    const prefixUrl = (u) => (u && u.startsWith('/') && apiBase !== null ? `${apiBase}${u}` : u);
    const mediaUrl = prefixUrl(map[mode] || data.previewUrl);
    const thumbUrl = prefixUrl(map.image || data.thumbnailUrl);

    if (mode === 'video' && mediaUrl) {
      const vid = document.createElement('video');
      vid.controls = true;
      vid.playsInline = true;
      vid.preload = 'metadata';
      if (thumbUrl) vid.poster = thumbUrl;
      vid.src = mediaUrl;
      vid.addEventListener('error', () => {
        if (thumbUrl) {
          linkPreviewBox.innerHTML = '';
          const img = document.createElement('img');
          img.src = thumbUrl;
          img.alt = data.title || 'Preview';
          linkPreviewBox.appendChild(img);
          linkKindMeta.textContent = 'Preview Image';
        }
      });
      linkPreviewBox.appendChild(vid);
      linkKindMeta.textContent = 'Video';
    } else if (mode === 'embed' && mediaUrl) {
      const frame = document.createElement('iframe');
      frame.src = mediaUrl;
      frame.title = data.title || 'Video Preview';
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      frame.allowFullscreen = true;
      linkPreviewBox.appendChild(frame);
      linkKindMeta.textContent = 'Video';
    } else if (mode === 'audio' && mediaUrl) {
      if (thumbUrl) {
        const img = document.createElement('img');
        img.src = thumbUrl;
        img.alt = data.title || 'Audio cover';
        img.style.maxHeight = '210px';
        img.style.marginBottom = '12px';
        linkPreviewBox.appendChild(img);
      }
      const aud = document.createElement('audio');
      aud.controls = true;
      aud.preload = 'metadata';
      aud.src = mediaUrl;
      linkPreviewBox.appendChild(aud);
      linkKindMeta.textContent = 'Audio';
    } else if (mode === 'image' && mediaUrl) {
      const img = document.createElement('img');
      img.src = mediaUrl;
      img.alt = data.title || 'Preview';
      linkPreviewBox.appendChild(img);
      linkKindMeta.textContent = 'Image';
    } else if (mode === 'pdf' && mediaUrl) {
      const frame = document.createElement('iframe');
      frame.src = mediaUrl;
      frame.title = data.title || 'PDF Preview';
      linkPreviewBox.appendChild(frame);
      linkKindMeta.textContent = 'PDF Document';
    } else {
      const box = document.createElement('div');
      box.className = 'link-file-preview';
      box.innerHTML = `
        <p style="margin:0 0 6px;font-weight:600;">${escapeHtml(data.title || 'File ready')}</p>
        <p class="muted-val" style="margin:0;">${escapeHtml(data.contentType || data.platform || 'Ready to download')}</p>
      `;
      linkPreviewBox.appendChild(box);
      linkKindMeta.textContent = data.kind === 'webpage' ? 'Webpage' : 'File';
    }
  }

  function renderFilterTabs(options) {
    const kinds = [...new Set(options.map((o) => o.kind).filter(Boolean))];
    if (kinds.length <= 1) {
      linkFilterTabs.style.display = 'none';
      linkFilterTabs.innerHTML = '';
      activeFilter = 'all';
      return;
    }

    const tabs = [{ key: 'all', label: 'All' }];
    if (kinds.includes('video')) tabs.push({ key: 'video', label: 'Video' });
    if (kinds.includes('audio')) tabs.push({ key: 'audio', label: 'Audio' });
    if (kinds.includes('image')) tabs.push({ key: 'image', label: 'Image' });
    if (kinds.includes('file')) tabs.push({ key: 'file', label: 'File' });

    activeFilter = 'all';
    linkFilterTabs.innerHTML = '';
    tabs.forEach((t, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = idx === 0 ? 'seg-tab active' : 'seg-tab';
      btn.textContent = t.label;
      btn.addEventListener('click', () => {
        activeFilter = t.key;
        [...linkFilterTabs.children].forEach((b) => b.classList.toggle('active', b === btn));
        renderOptionsList();
        if (t.key !== 'all') switchPreviewMode(t.key);
      });
      linkFilterTabs.appendChild(btn);
    });
    linkFilterTabs.style.display = 'inline-flex';
  }

  function renderOptionsList() {
    if (!activeData) return;
    const allOpts = activeData.options || [];
    const filtered = activeFilter === 'all' ? allOpts : allOpts.filter((o) => o.kind === activeFilter);

    linkOptionsList.innerHTML = '';
    filtered.forEach((opt, idx) => {
      const row = document.createElement('div');
      row.className = 'result-item';

      const info = document.createElement('div');
      info.className = 'result-item-info';
      info.innerHTML = `
        <div class="result-item-name"></div>
        <div class="muted-val"></div>
      `;
      info.querySelector('.result-item-name').textContent = opt.label;
      info.querySelector('.muted-val').textContent = (opt.ext || 'file').toUpperCase();

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = idx === 0 ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
      btn.textContent = 'Download';
      btn.addEventListener('click', () => triggerDownload(opt, activeApiBase, btn));

      row.append(info, btn);
      linkOptionsList.appendChild(row);
    });
  }

  async function triggerDownload(option, apiBase, btn) {
    if (!activeData) return;
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing...';
    showError('');

    if (option.id === 'client_direct' || apiBase === null) {
      try {
        const res = await fetch(option.targetUrl);
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = activeData.title || `download.${option.ext || 'bin'}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
        window.CleanLab?.toast('Download started!');
      } catch {
        window.open(option.targetUrl, '_blank', 'noopener');
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
      return;
    }

    startProgressSequence([
      { pct: 20, text: `Starting ${option.label}...` },
      { pct: 46, text: 'Fetching media stream...' },
      { pct: 70, text: 'Preparing your file...' },
      { pct: 88, text: 'Almost ready, wrapping up...' },
    ]);

    try {
      const res = await fetch(`${apiBase}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: activeData.sourceUrl,
          optionId: option.id,
          targetUrl: option.targetUrl || activeData.sourceUrl,
          title: activeData.title || 'download',
          ext: option.ext || 'bin',
        }),
      });
      const out = await res.json();
      if (!res.ok) {
        throw new Error(out.error || 'Download failed.');
      }

      finishProgress('Sending download to your device!');
      const dlUrl = out.downloadUrl.startsWith('/') ? `${apiBase}${out.downloadUrl}` : out.downloadUrl;
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = out.filename || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.CleanLab?.toast('Download started!');
    } catch (err) {
      stopProgressTicker();
      setProgress(false);
      showError(err?.message || 'Could not download this item.');
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  linkFetchForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = (linkUrlInput.value || '').trim();
    if (!url) return;

    showError('');
    linkResultWrap.style.display = 'none';
    linkFetchBtn.disabled = true;
    linkFetchBtn.textContent = 'Fetching...';

    startProgressSequence([
      { pct: 18, text: 'Inspecting link...' },
      { pct: 42, text: 'Yeah, got the link!' },
      { pct: 66, text: 'Checking video, audio & image streams...' },
      { pct: 86, text: 'Building your live preview...' },
    ]);

    try {
      const apiBase = await resolveApiBase();
      let data = null;

      if (apiBase !== null) {
        const res = await fetch(`${apiBase}/api/inspect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Could not inspect this link.');
        }
      } else {
        const fallback = inspectDirectClientUrl(url);
        if (fallback.isPlatformNeedingBackend) {
          throw new Error('Platform links (YouTube, Instagram, X) require the local server. Open http://127.0.0.1:8000 after running: python backend/app/server.py (or python ../backend/app/server.py inside frontend).');
        }
        data = fallback;
      }

      activeData = data;
      activeApiBase = apiBase;
      renderPreviewTabs(data);
      renderPreviewContent(data, apiBase, activePreviewMode);

      const metaParts = [data.platform, data.duration, formatBytes(data.sizeBytes)].filter(Boolean);
      linkPlatformLine.textContent = metaParts.join(' · ');
      linkTitle.textContent = data.title || 'Link Content';
      linkSubLine.textContent = data.uploader || data.description || '';

      renderFilterTabs(data.options || []);
      renderOptionsList();

      finishProgress('All ready!');
      linkResultWrap.style.display = 'grid';
      window.CleanLab?.toast('Preview ready!');
    } catch (err) {
      stopProgressTicker();
      setProgress(false);
      showError(err?.message || 'Failed to fetch link.');
    } finally {
      linkFetchBtn.disabled = false;
      linkFetchBtn.textContent = 'Fetch';
    }
  });
})();
