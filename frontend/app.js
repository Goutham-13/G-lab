/* ==========================================================================
   CleanLab — Minimal Navigation, Hover Tooltip Support & Toast
   ========================================================================== */

(() => {
  'use strict';

  const VALID_VIEWS = ['home', 'qr', 'pdf', 'merge', 'link', 'bg', 'compress', 'color'];

  const panels = {
    home: document.getElementById('panel-home'),
    qr: document.getElementById('panel-qr'),
    pdf: document.getElementById('panel-pdf'),
    merge: document.getElementById('panel-merge'),
    link: document.getElementById('panel-link'),
    bg: document.getElementById('panel-bg'),
    compress: document.getElementById('panel-compress'),
    color: document.getElementById('panel-color'),
  };
  const navBackHomeBtn = document.getElementById('navBackHomeBtn');
  const homeSearchWrap = document.getElementById('homeSearchWrap');
  const globalToast = document.getElementById('globalToast');
  const homeSearchInput = document.getElementById('homeSearchInput');
  const homeSearchEmpty = document.getElementById('homeSearchEmpty');
  const homeCards = [...document.querySelectorAll('#homeFeaturesGrid .feature-card')];
  let toastTimer = null;

  homeSearchInput?.addEventListener('input', () => {
    const q = (homeSearchInput.value || '').trim().toLowerCase();
    let visible = 0;
    homeCards.forEach((card) => {
      const text = `${card.dataset.keywords || ''} ${card.textContent}`.toLowerCase();
      const match = !q || text.includes(q);
      card.classList.toggle('hidden-by-search', !match);
      if (match) visible++;
    });
    if (homeSearchEmpty) {
      homeSearchEmpty.style.display = visible === 0 ? 'block' : 'none';
    }
  });

  window.CleanLab = {
    toast(msg) {
      if (!globalToast) return;
      globalToast.textContent = msg;
      globalToast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        globalToast.classList.remove('show');
      }, 2200);
    },
    switchView(viewId, updateHash = true) {
      if (!panels[viewId]) viewId = 'home';
      Object.entries(panels).forEach(([k, el]) => {
        el.classList.toggle('active', k === viewId);
      });
      if (homeSearchWrap) {
        homeSearchWrap.style.display = viewId === 'home' ? 'block' : 'none';
      }
      if (navBackHomeBtn) {
        navBackHomeBtn.style.display = viewId === 'home' ? 'none' : 'inline-flex';
      }
      if (updateHash) {
        history.replaceState(null, '', '#' + viewId);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
  };

  // Clamp hover popovers on desktop so they never clip outside viewport
  document.querySelectorAll('.help-tip').forEach((wrap) => {
    const trigger = wrap.querySelector('.help-trigger');
    const pop = wrap.querySelector('.help-popover');
    if (!trigger || !pop) return;

    const adjustPos = () => {
      if (window.innerWidth <= 600) {
        pop.classList.remove('flip-down');
        const rect = trigger.getBoundingClientRect();
        pop.style.top = `${Math.min(window.innerHeight - 190, Math.max(12, rect.bottom + 8))}px`;
        return;
      }
      pop.style.top = '';
      pop.style.left = '50%';
      pop.style.right = 'auto';
      pop.style.transform = 'translateX(-50%)';
      pop.classList.remove('flip-down');

      const rect = trigger.getBoundingClientRect();
      const popH = pop.offsetHeight || 160;
      if (rect.top < popH + 20) {
        pop.classList.add('flip-down');
      }

      const pr = pop.getBoundingClientRect();
      if (pr.left < 12) {
        pop.style.left = '0';
        pop.style.transform = 'none';
      } else if (pr.right > window.innerWidth - 12) {
        pop.style.left = 'auto';
        pop.style.right = '0';
        pop.style.transform = 'none';
      }
    };

    wrap.addEventListener('mouseenter', adjustPos);
    trigger.addEventListener('focus', adjustPos);
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !wrap.classList.contains('open');
      document.querySelectorAll('.help-tip.open').forEach((w) => w.classList.remove('open'));
      if (willOpen) {
        wrap.classList.add('open');
        adjustPos();
      }
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.help-tip.open').forEach((w) => w.classList.remove('open'));
  });

  // Home navigation
  document.getElementById('brandHomeLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.CleanLab.switchView('home');
  });
  navBackHomeBtn?.addEventListener('click', () => {
    window.CleanLab.switchView('home');
  });

  // Feature cards navigation
  document.querySelectorAll('.feature-card[data-navigate]').forEach((card) => {
    const target = card.getAttribute('data-navigate');
    card.addEventListener('click', () => window.CleanLab.switchView(target));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.CleanLab.switchView(target);
      }
    });
  });

  const syncFromHash = () => {
    const hash = location.hash.replace('#', '').toLowerCase();
    if (VALID_VIEWS.includes(hash)) {
      window.CleanLab.switchView(hash, false);
    }
  };
  window.addEventListener('hashchange', syncFromHash);
  syncFromHash();
})();
