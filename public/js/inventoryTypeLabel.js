// How an inventory type is shown. The stored type stays the same (MENSUAL keeps its IDs, sheets and script);
// only its visible name changes.
(function () {
  const NAMES = { MENSUAL: 'LUBRICANTES' };
  const TITLES = { CICLICO: 'Cíclico', BARRIDO: 'Barrido', SEMANAL: 'Semanal', MENSUAL: 'Lubricantes' };
  const code = type => String(type || '').trim().toUpperCase();
  window.InventoryTypeLabel = {
    // Upper-case badge text, e.g. "LUBRICANTES".
    label(type) { return NAMES[code(type)] || String(type || ''); },
    // Sentence-case text for lists and options, e.g. "Lubricantes".
    title(type) { return TITLES[code(type)] || String(type || ''); },
    // A text that starts with the stored type, e.g. "MENSUAL · 3" or "MENSUAL-1120-2026-11-16".
    text(value) { return String(value ?? '').replace(/^MENSUAL(?=\b|[-_ ·])/i, 'LUBRICANTES'); }
  };
})();
