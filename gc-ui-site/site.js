/* Isolated GC UI development preview. No analytics, network calls or legacy adapter. */
(() => {
  'use strict';
  const root = document.documentElement;
  const storageKey = 'goreecloud-mesh-gc-ui-preview-appearance';
  const valid = new Set(['system', 'light', 'dark']);
  const buttons = [...document.querySelectorAll('[data-theme-choice]')];
  const nav = [...document.querySelectorAll('nav[aria-label="Primary navigation"] a[href^="#"]')];
  const apply = choice => {
    const mode = valid.has(choice) ? choice : 'system';
    root.dataset.theme = mode;
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === mode));
    }
  };
  let saved = 'system';
  try { saved = localStorage.getItem(storageKey) || 'system'; } catch (_) { /* restricted storage */ }
  apply(saved);
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const next = button.dataset.themeChoice;
      if (!valid.has(next)) return;
      apply(next);
      try { localStorage.setItem(storageKey, next); } catch (_) { /* restricted storage */ }
    });
  }
  if (typeof IntersectionObserver === 'function' && nav.length) {
    const targets = nav.map(link => document.getElementById(link.hash.slice(1))).filter(Boolean);
    if (targets.length) {
      const observer = new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        for (const link of nav) {
          if (link.hash === '#' + visible.target.id) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        }
      }, {rootMargin: '-12% 0px -65% 0px', threshold: [0, 0.2, 0.5]});
      for (const section of targets) observer.observe(section);
    }
  }
})();
