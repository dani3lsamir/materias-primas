(() => {
  const key = 'materials-display-theme';
  const themes = new Set(['system', 'light', 'dark']);
  let preference = 'system';
  try {
    const saved = localStorage.getItem(key);
    if (themes.has(saved)) preference = saved;
  } catch {
    // The file can still use the system theme if the browser blocks storage.
  }
  document.documentElement.dataset.theme = preference;
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('theme');
    select.value = preference;
    select.addEventListener('change', () => {
      document.documentElement.dataset.theme = select.value;
      try { localStorage.setItem(key, select.value); } catch { /* Keep the choice for this page. */ }
    });
  });
})();
