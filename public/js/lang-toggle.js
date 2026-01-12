// Simple language toggle for pages without custom i18n handling.
// Persists selection in localStorage and reloads the page.
(() => {
  const button = document.getElementById('lang-toggle');
  if (!button) return;

  const getLang = () => localStorage.getItem('lang') || 'es';
  const setLabel = (lang) => {
    button.textContent = lang === 'es' ? 'EN' : 'ES';
  };

  setLabel(getLang());

  button.addEventListener('click', () => {
    const next = getLang() === 'es' ? 'en' : 'es';
    localStorage.setItem('lang', next);
    setLabel(next);
    window.location.reload();
  });
})();
