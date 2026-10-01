const { createHash } = require('crypto');

const key = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const identityText = value => String(value ?? '').trim().toUpperCase();
const hasValue = value => value !== null && value !== undefined && String(value).trim() !== '';
const fields = {
  SKU: ['sku', 'codigo', 'articulo'], Codigo_Barras: ['codigo_barras', 'barcode'],
  Descripcion: ['descripcion', 'description'], Almacen: ['almacen', 'warehouse'],
  Ubicacion: ['ubicacion', 'location'], Ubicacion_1: ['ubicacion_1'], Ubicacion_2: ['ubicacion_2'],
  Clasificacion_ABC: ['clasificacion_abc', 'abc'], Unidad: ['unidad'], Categoria: ['categoria'],
  Costo_Unitario: ['costo_unitario', 'costo', 'unit_cost'], Stock_Sistema: ['stock_sistema', 'stock_logico', 'stock_teorico'],
  Stock_Total: ['stock_total'], Stock_Fisico: ['stock_fisico', 'primer_conteo'],
  Stock_Buen_Estado: ['stock_b_e', 'stock_buen_estado'], Mal_estado: ['stock_m_e', 'mal_estado', 'malestado'],
  Diferencia: ['diferencia'], Fecha_Ultimo_Conteo: ['fecha_ultimo_conteo', 'fecha_conteo'], Responsable: ['responsable'],
  Estado: ['estado'], corroboracion: ['corroboracion', 'corroborationStatus'],
  Fecha_Primera_Justificacion: ['fecha_primera_justificacion'], Razon: ['razon'],
  Comentario_Justificacion: ['comentario_justificacion'], Revisado_Por: ['responsable_justificacion', 'revisado_por'],
  Fecha_Reconteo: ['fecha_reconteo'], Stock_Total_Reconteo: ['stock_total_reconteo'],
  Reconteo_Fisico: ['reconteo', 'reconteo_fisico'], Reconteo_Mal_Estado: ['malestado_reconteo', 'reconteo_mal_estado'],
  Diferencia_Final: ['diferencia_final'], Fecha_Justificacion_2: ['fecha_justificacion_2'],
  Estado_Justificacion_2: ['estado_justificacion_2'], Fecha_Reconteo_2: ['fecha_reconteo_2'],
  Stock_Total_Reconteo_2: ['stock_total_reconteo_2'], Reconteo_2: ['reconteo_2', 'reconteo_fisico_2'],
  Malestado_Reconteo_2: ['malestado_reconteo_2', 'reconteo_mal_estado_2'], Diferencia_Final_2: ['diferencia_final_2']
};
const aliases = new Map();
for (const [field, names] of Object.entries(fields)) for (const name of [field, ...names]) aliases.set(key(name), field);

function number(value, fallback = null) {
  if (!hasValue(value)) return fallback;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new Error('Número no finito');
  }
  let text = String(value).trim().replace(/^(?:Bs\.?|USD|BOB|\$)\s*/i, '').replace(/\s/g, '');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[+-]?\d+(?:[.,]\d+)*$/.test(text)) throw new Error(`Valor numérico inválido: ${value}`);
  if (text.includes(',') && text.includes('.')) {
    text = text.lastIndexOf(',') > text.lastIndexOf('.') ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (text.includes(',')) {
    text = text.split(',').length > 2 ? text.replace(/,/g, '') : text.replace(',', '.');
  } else if (text.split('.').length > 2) text = text.replace(/\./g, '');
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`Valor numérico inválido: ${value}`);
  return negative ? -parsed : parsed;
}

function normalizeItem(raw, index = 0) {
  const item = { ...raw };
  for (const [name, value] of Object.entries(raw)) {
    const canonical = aliases.get(key(name));
    if (canonical) item[canonical] = value;
  }
  item.SKU = identityText(item.SKU);
  if (!item.SKU) throw new Error(`Fila ${index + 2}: falta SKU`);
  item.id = raw.id || `SHEET-${index + 2}-${item.SKU}`;
  for (const name of ['Stock_Sistema', 'Costo_Unitario']) {
    if (!hasValue(item[name])) throw new Error(`Fila ${index + 2}: falta ${name}`);
    item[name] = number(item[name]);
  }
  for (const name of ['Stock_Total', 'Stock_Fisico', 'Stock_Buen_Estado', 'Reconteo_Fisico', 'Stock_Total_Reconteo', 'Reconteo_2', 'Stock_Total_Reconteo_2']) item[name] = number(item[name]);
  for (const name of ['Mal_estado', 'Reconteo_Mal_Estado', 'Malestado_Reconteo_2']) item[name] = number(item[name], 0);
  if (item.Stock_Buen_Estado !== null) item.Stock_Fisico = item.Stock_Buen_Estado;
  if (item.Stock_Fisico === null && item.Stock_Total !== null) item.Stock_Fisico = item.Stock_Total - item.Mal_estado;
  if (item.Stock_Total === null && item.Stock_Fisico !== null) item.Stock_Total = item.Stock_Fisico + item.Mal_estado;
  if (item.Stock_Total_Reconteo === null && item.Reconteo_Fisico !== null) item.Stock_Total_Reconteo = item.Reconteo_Fisico + item.Reconteo_Mal_Estado;
  if (item.Stock_Total_Reconteo_2 === null && item.Reconteo_2 !== null) item.Stock_Total_Reconteo_2 = item.Reconteo_2 + item.Malestado_Reconteo_2;
  for (const [diff, total, cost] of [
    ['Diferencia', 'Stock_Total', 'Costo_Diferencia'],
    ['Diferencia_Final', 'Stock_Total_Reconteo', 'Costo_Diferencia_Final'],
    ['Diferencia_Final_2', 'Stock_Total_Reconteo_2', 'Costo_Diferencia_Final_2']
  ]) {
    item[diff] = hasValue(item[diff]) ? number(item[diff]) : (item[total] === null ? null : item[total] - item.Stock_Sistema);
    item[cost] = item[diff] === null ? null : item[diff] * item.Costo_Unitario;
  }
  return item;
}

function normalizeTable(headers, rows) {
  const columns = headers.map(h => aliases.get(key(h)));
  const recognized = columns.filter(Boolean);
  if (new Set(recognized).size !== recognized.length) throw new Error('Hay encabezados ambiguos que representan la misma columna');
  for (const required of ['SKU', 'Stock_Sistema', 'Costo_Unitario']) {
    if (!columns.includes(required)) throw new Error(`Falta la columna ${required}`);
  }
  if (!columns.some(c => ['Stock_Total', 'Stock_Fisico', 'Stock_Buen_Estado'].includes(c))) throw new Error('Falta la columna de conteo físico');
  return rows.filter(row => row.some(hasValue)).map((row, index) => {
    const raw = {};
    columns.forEach((field, i) => { if (field) raw[field] = row[i]; });
    return normalizeItem(raw, index);
  });
}

function member(item) {
  return JSON.stringify([identityText(item.SKU || item.sku), identityText(item.Almacen || item.almacen || item.warehouse), identityText(item.Ubicacion || item.ubicacion || item.location)]);
}
function membership(items) { return items.map(member).sort(); }
function createManifest(record, items = record.items || []) {
  const members = membership(items);
  return {
    version: 1, inventoryId: record.inventoryId || record.id, center: String(record.center || ''), type: record.type,
    closedAt: record.closedAt || null, itemCount: items.length,
    skuCount: new Set(items.map(it => identityText(it.SKU || it.sku))).size,
    membershipHash: createHash('sha256').update(JSON.stringify(members)).digest('hex')
  };
}

function validateManifest(manifest, record, items) {
  if (!manifest) return [];
  const actual = createManifest(record, items), issues = [];
  if (manifest.center && String(manifest.center) !== String(record.center)) issues.push('El centro del archivo no coincide con el cierre');
  if (manifest.inventoryId && record.inventoryId && manifest.inventoryId !== record.inventoryId) issues.push('El identificador no coincide con el cierre');
  if (manifest.itemCount !== actual.itemCount || manifest.skuCount !== actual.skuCount) issues.push(`El cierre declara ${manifest.itemCount} filas / ${manifest.skuCount} SKU; la hoja contiene ${actual.itemCount} filas / ${actual.skuCount} SKU`);
  if (manifest.membershipHash && manifest.membershipHash !== actual.membershipHash) issues.push('Los SKU, almacenes o ubicaciones no coinciden con el cierre');
  else if (manifest.members && JSON.stringify([...manifest.members].sort()) !== JSON.stringify(actual.members)) issues.push('Los registros no coinciden con el cierre');
  return issues;
}

module.exports = { number, normalizeItem, normalizeTable, createManifest, validateManifest, member };
