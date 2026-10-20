'use strict';

// Light theme by default; the choice is remembered on this device. Runs before first paint.
(function () {
  let theme = 'light';
  try {
    theme = localStorage.getItem('mbs-theme') || 'light';
  } catch {
    /* private mode: keep light */
  }
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
})();
