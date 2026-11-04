// Which justification reasons need a photo. The form and the server read this same list.
(function (root, factory) {
  const rule = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = rule;
  else root.JustificationPhotoRule = rule;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const clean = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  // Any other reason, including the earlier faltante and sobrante names, needs a photo.
  const NO_PHOTO_NEEDED = new Set(['transferencia', 'balanceo', 'error de conteo', 'mal ubicado', 'error de typeo', 'sobrestock',
    'empaque diferente', 'empaque similar', 'sin justificacion', 'otro']);
  return { needsPhoto: reason => !NO_PHOTO_NEEDED.has(clean(reason)) };
});
