const PersistenceError = require('./persistenceError');
const norm = value => String(value ?? '').trim().toUpperCase();
function selectItem(items, { itemId, sku, barcode, location, almacen, warehouse, isNewLocation, allowNewItem = false } = {}) {
  // Barrido can pass an ID from its product catalogue before that row exists.
  if (allowNewItem && itemId && !items.some(item => String(item.id) === String(itemId))) {
    return selectItem(items, { sku, barcode, location, almacen, warehouse, isNewLocation });
  }
  let matches = items.filter(item => itemId ? String(item.id) === String(itemId) :
    (sku ? norm(item.SKU) === norm(sku) : barcode && norm(item.Codigo_Barras) === norm(barcode)));
  if (sku) matches = matches.filter(item => norm(item.SKU) === norm(sku));
  const war = almacen || warehouse;
  if (war) matches = matches.filter(item => norm(item.Almacen || item.almacen || item.warehouse) === norm(war));
  if (!itemId && location != null && !isNewLocation) matches = matches.filter(item =>
    [item.Ubicacion, item.Ubicacion_1, item.Ubicacion_2].some(loc => norm(loc) === norm(location)));
  if (matches.length > 1) throw new PersistenceError('Hay varias filas para este SKU. Seleccione el ítem, almacén y ubicación exactos.', 'AMBIGUOUS_ITEM', 409);
  if (itemId && !matches.length) throw new PersistenceError('El ítem ya no corresponde a esta fila. Actualice el inventario.', 'ITEM_NOT_FOUND', 409);
  return matches[0] || null;
}
function quantity(value, name, optional = false) {
  if (value === '' || value == null) {
    if (optional) return null;
    throw new PersistenceError(`${name} es obligatorio.`, 'INVALID_QUANTITY', 400);
  }
  const number = Number(value);
  if (typeof value === 'boolean' || !Number.isSafeInteger(number) || number < 0) {
    throw new PersistenceError(`${name} debe ser un entero mayor o igual a cero.`, 'INVALID_QUANTITY', 400);
  }
  return number;
}
module.exports = { selectItem, quantity };
