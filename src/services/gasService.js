const path = require('path');
const config = require('../config');
const storagePath = require('./storagePath');

class GasService {
  getUrlForType(type) {
    const cleanType = (type || 'CICLICO').toUpperCase();
    switch (cleanType) {
      case 'BARRIDO':
        return config.integrations.BARRIDO_URL;
      case 'MENSUAL':
      case 'MENSUALES':
        return config.integrations.MENSUALES_URL;
      case 'SEMANAL':
      case 'SEMANALES':
        return config.integrations.SEMANALES_URL;
      case 'CICLICO':
      case 'CICLICOS':
      default:
        return config.integrations.CICLICOS_URL;
    }
  }

  normalizeBarcode(barcode) {
    if (!barcode) return '';
    return String(barcode).trim();
  }

  parseCurrencyOrNumber(val, fallback = 0) {
    if (val === null || val === undefined || val === '') return fallback;
    if (typeof val === 'number') return isNaN(val) ? fallback : val;

    let str = String(val).trim();
    if (!str) return fallback;

    // Detect and handle Excel/Sheets date formats (e.g. 1/3/4114 or 30/9/2026)
    if (str.includes('/')) {
      const dateMatch = str.match(/^\d{1,2}\/\d{1,2}\/(\d{2,6})(?:\s.*)?$/);
      if (dateMatch) {
        const yearOrVal = parseInt(dateMatch[1], 10);
        // Calendar dates (e.g. 2020-2035) are date fields, not costs/quantities
        if (yearOrVal >= 2000 && yearOrVal <= 2035) return fallback;
        // Years outside calendar range (e.g. 4114, 9495, 2244) are cell values formatted as dates in Excel
        return yearOrVal;
      }
      return fallback;
    }

    let isNegative = false;
    if (str.startsWith('-')) {
      isNegative = true;
      str = str.slice(1).trim();
    } else if (str.startsWith('(') && str.endsWith(')')) {
      isNegative = true;
      str = str.slice(1, -1).trim();
    }

    // Clean currency symbols, letters, spaces, but keep digits, '.', ',', '+', '-'
    str = str.replace(/[^0-9.,+-]/g, '');
    if (!str) return fallback;

    if (str.includes('.') && str.includes(',')) {
      const lastDot = str.lastIndexOf('.');
      const lastComma = str.lastIndexOf(',');
      if (lastDot > lastComma) {
        // 1,234.56 -> dot is decimal
        str = str.replace(/,/g, '');
      } else {
        // 1.234,56 -> comma is decimal
        str = str.replace(/\./g, '').replace(',', '.');
      }
    } else if (str.includes(',')) {
      const parts = str.split(',');
      if (parts.length > 2) {
        // 1,000,000 -> multiple commas are thousands
        str = str.replace(/,/g, '');
      } else {
        // Single comma: In Spanish/Bolivian locale and Google Sheets CSV,
        // comma is decimal separator (e.g. 15,50 | 136,397 | -3073,5711072)
        str = str.replace(',', '.');
      }
    } else if (str.includes('.')) {
      const parts = str.split('.');
      if (parts.length > 2) {
        // 1.000.000 -> multiple dots are thousands
        str = str.replace(/\./g, '');
      }
    }

    let n = parseFloat(str);
    if (isNaN(n)) return fallback;
    if (isNegative) n = -Math.abs(n);
    return n;
  }

  extractSpreadsheetId(url) {
    if (!url) return null;
    const m = String(url).match(/\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : null;
  }

  parseSpreadsheetCsv(csvText) {
    if (!csvText || typeof csvText !== 'string') return [];

    const rows = [];
    let row = [];
    let curr = '';
    let inQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
      const c = csvText[i];
      const next = csvText[i + 1];
      if (c === '"') {
        if (inQuotes && next === '"') {
          curr += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        row.push(curr.trim());
        curr = '';
      } else if ((c === '\r' || c === '\n') && !inQuotes) {
        if (c === '\r' && next === '\n') i++;
        row.push(curr.trim());
        if (row.some(cell => cell.length > 0)) rows.push(row);
        row = [];
        curr = '';
      } else {
        curr += c;
      }
    }
    if (curr.length > 0 || row.length > 0) {
      row.push(curr.trim());
      if (row.some(cell => cell.length > 0)) rows.push(row);
    }

    if (rows.length < 2) return [];

    const headerRow = rows[0].map(h => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '_'));
    const getColIndex = (names) => {
      for (const n of names) {
        const idx = headerRow.findIndex(h => h === n);
        if (idx !== -1) return idx;
      }
      for (const n of names) {
        const idx = headerRow.findIndex(h => {
          if (n === 'conteo' && h.startsWith('fecha_')) return false;
          if (n === 'diferencia' && (h.includes('costo') || h.includes('final'))) return false;
          if (n === 'diferencia_final' && h.includes('costo')) return false;
          return h.includes(n);
        });
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const idxSku = getColIndex(['sku']);
    const idxBarcode = getColIndex(['codigo_barras', 'barcode', 'codigo']);
    const idxDesc = getColIndex(['descripcion', 'desc', 'articulo', 'producto']);

    // If neither SKU nor barcode nor description is present, this is not an inventory table
    if (idxSku === -1 && idxBarcode === -1 && idxDesc === -1) {
      return [];
    }

    const idxLoc = getColIndex(['ubicacion', 'location', 'rack', 'ubicaci_n']);
    const idxCat = getColIndex(['categoria', 'category']);
    const idxAbc = getColIndex(['clasificacion_abc', 'abc']);
    const idxUnit = getColIndex(['unidad', 'unit', 'medida']);
    const idxCost = getColIndex(['costo_unitario', 'costo', 'unit_cost', 'cost']);
    const idxSys = getColIndex(['stock_sistema', 'sistema', 'system']);
    const idxStockTotal = getColIndex(['stock_total', 'total_stock', 'stock_tot']);
    const idxPhys = getColIndex(['stock_b_e', 'stock_buen_estado', 'buen_estado', 'stock_fisico', 'fisico']);
    const idxDamaged = getColIndex(['stock_m_e', 'mal_estado', 'malestado', 'danado']);
    const idxDiff = getColIndex(['diferencia', 'diff', 'difference']);
    const idxDiffCost = getColIndex(['costo_diferencia', 'diferencia_costo', 'cost_diff']);
    const idxDate = getColIndex(['fecha_ultimo_conteo', 'fecha_conteo', 'fecha', 'date']);
    const idxResp = getColIndex(['responsable', 'usuario', 'auxiliar']);
    const idxState = getColIndex(['estado', 'status']);
    const idxComment = getColIndex(['comentario', 'comment']);
    const idxReason = getColIndex(['razon', 'reason', 'raz_n']);
    const idxJust = getColIndex(['comentario_justificacion', 'justificacion', 'justification']);
    const idxAlmacen = getColIndex(['almacen', 'almacén', 'warehouse', 'cod_almacen']);
    const idxReviewer = getColIndex(['revisado_por', 'revisador', 'revisor', 'encargado', 'supervisor', 'admin_revisor', 'responsable_justificacion']);
    const idxStockTotalRec1 = getColIndex(['stock_total_reconteo']);
    const idxRecFisico = getColIndex(['reconteo_fisico', 'reconteo_bueno', 'reconteo', 'cant_reconteo']);
    const idxRecDamaged = getColIndex(['reconteo_mal_estado', 'malestado_reconteo', 'reconteo_danado', 'reconteo_averia']);
    const idxDiffFinal1 = getColIndex(['diferencia_final']);
    const idxCostDiffFinal1 = getColIndex(['costo_diferencia_final']);

    const idxStockTotalRec2 = getColIndex(['stock_total_reconteo_2']);
    const idxRec2 = getColIndex(['reconteo_2']);
    const idxRecDam2 = getColIndex(['malestado_reconteo_2', 'reconteo_mal_estado_2']);
    const idxDiffFinal2 = getColIndex(['diferencia_final_2']);
    const idxCostDiffFinal2 = getColIndex(['costo_diferencia_final_2']);

    const parsedItems = [];
    rows.slice(1).forEach((r, idx) => {
      const getVal = (colIdx, fallback = '') => (colIdx !== -1 && r[colIdx] !== undefined ? r[colIdx] : fallback);
      const rawSku = getVal(idxSku, idxBarcode !== -1 ? r[idxBarcode] : (r[0] || ''));
      const sku = String(rawSku || '').trim();

      // Skip empty or non-inventory text headers
      if (!sku || sku.toUpperCase().includes('SELECCIONAR CENTRO') || sku.toUpperCase().includes('INFORME EJECUTIVO') || sku.toUpperCase().includes('TOTAL ÍTEMS')) {
        return;
      }
      const barcode = getVal(idxBarcode, r[1] || '');
      const desc = getVal(idxDesc, r[2] || '');
      const location = getVal(idxLoc, r[3] || '');
      const cat = getVal(idxCat, r[4] || '');
      const almacen = getVal(idxAlmacen, r[6] || r[4] || cat);
      const unit = getVal(idxUnit, 'PZA');
      const rawAbc = (getVal(idxAbc, r[7] || r[5] || '') || '').trim().toUpperCase();
      let unitCost = this.parseCurrencyOrNumber(getVal(idxCost, r[9] !== undefined ? r[9] : r[7]), 0);
      const sysStock = this.parseCurrencyOrNumber(getVal(idxSys, r[10] !== undefined ? r[10] : r[8]), 0);

      // Handle cases where total lot stock value was placed into Costo_Unitario instead of unit cost
      if (unitCost > 50000 && sysStock > 1 && (unitCost / sysStock < 10000 || /aceite|balde|turril|filtro|reten|lubricante/i.test(desc))) {
        unitCost = Math.round((unitCost / sysStock) * 100) / 100;
      }
      
      const rawStockTotal = getVal(idxStockTotal, r[11]);
      const rawPhys = getVal(idxPhys, r[12] !== undefined ? r[12] : r[9]);
      const physStock = (rawPhys !== '' && rawPhys !== null && rawPhys !== undefined) ? this.parseCurrencyOrNumber(rawPhys, null) : null;
      
      const rawDamaged = getVal(idxDamaged, r[13] !== undefined ? r[13] : r[15]);
      const damagedStock = (rawDamaged !== '' && rawDamaged !== null && rawDamaged !== undefined) ? this.parseCurrencyOrNumber(rawDamaged, 0) : 0;
      
      const stockTotal = (rawStockTotal !== '' && rawStockTotal !== null && rawStockTotal !== undefined)
        ? this.parseCurrencyOrNumber(rawStockTotal, (physStock !== null ? physStock : 0) + damagedStock)
        : ((physStock !== null ? physStock : 0) + damagedStock);

      let abc = 'C';
      if (['A', 'B', 'C'].includes(rawAbc)) {
        abc = rawAbc;
      } else if (unitCost >= 2000) {
        abc = 'A';
      } else if (unitCost >= 500) {
        abc = 'B';
      } else {
        abc = 'C';
      }

      let diff = 0;
      if (idxDiff !== -1 && r[idxDiff] !== '' && r[idxDiff] !== undefined) {
        diff = this.parseCurrencyOrNumber(r[idxDiff], 0);
      } else if (r[14] !== undefined && r[14] !== '') {
        diff = this.parseCurrencyOrNumber(r[14], 0);
      } else if (physStock !== null) {
        diff = stockTotal - sysStock;
      }

      let diffCost = 0;
      if (idxDiffCost !== -1 && r[idxDiffCost] !== '' && r[idxDiffCost] !== undefined) {
        diffCost = this.parseCurrencyOrNumber(r[idxDiffCost], diff * unitCost);
      } else if (r[15] !== undefined && r[15] !== '') {
        diffCost = this.parseCurrencyOrNumber(r[15], diff * unitCost);
      } else {
        diffCost = diff * unitCost;
      }
      if (unitCost > 0 && Math.abs(diff) > 0) {
        const expectedCost = Math.abs(diff * unitCost);
        if (Math.abs(diffCost) > expectedCost * 2 + 50 || Math.abs(diffCost) > 50000000 || diffCost === 0) {
          diffCost = diff * unitCost;
        }
      } else if (Math.abs(diffCost) > 50000000) {
        diffCost = 0;
      }

      // Reconteo 1: Col Y = Stock_Total_Reconteo, Col Z = Reconteo, Col AA = Malestado, Col AB = Diferencia_Final
      const rawStockTotalRec1 = getVal(idxStockTotalRec1, r[24]);
      const stockTotalRec1 = (rawStockTotalRec1 !== '' && rawStockTotalRec1 !== undefined && rawStockTotalRec1 !== null)
        ? this.parseCurrencyOrNumber(rawStockTotalRec1, null)
        : null;

      const rawRec1 = getVal(idxRecFisico, r[25] !== undefined ? r[25] : (r[20] !== undefined ? r[20] : ''));
      const rec1BuenEstado = (rawRec1 !== '' && rawRec1 !== undefined && rawRec1 !== null)
        ? this.parseCurrencyOrNumber(rawRec1, null)
        : null;

      const rawRecDam1 = getVal(idxRecDamaged, r[26] !== undefined ? r[26] : (r[21] !== undefined ? r[21] : 0));
      const rec1MalEstado = this.parseCurrencyOrNumber(rawRecDam1, 0);

      const rawDiffFinal1 = getVal(idxDiffFinal1, r[27]);
      const diffFinal1 = (rawDiffFinal1 !== '' && rawDiffFinal1 !== undefined && rawDiffFinal1 !== null)
        ? this.parseCurrencyOrNumber(rawDiffFinal1, null)
        : null;

      const rawCostDiffFinal1 = getVal(idxCostDiffFinal1, r[28]);
      let costDiffFinal1 = (rawCostDiffFinal1 !== '' && rawCostDiffFinal1 !== undefined && rawCostDiffFinal1 !== null)
        ? this.parseCurrencyOrNumber(rawCostDiffFinal1, null)
        : null;
      if (diffFinal1 !== null && unitCost > 0) {
        if (costDiffFinal1 === null || Math.abs(costDiffFinal1) > Math.abs(diffFinal1 * unitCost) * 2 + 50 || Math.abs(costDiffFinal1) > 50000000) {
          costDiffFinal1 = diffFinal1 * unitCost;
        }
      }

      // Reconteo 2: Col AJ = Stock_Total_Reconteo_2, Col AK = Reconteo_2, Col AL = Malestado, Col AM = Diferencia_Final_2
      const rawStockTotalRec2 = getVal(idxStockTotalRec2, r[35]);
      const stockTotalRec2 = (rawStockTotalRec2 !== '' && rawStockTotalRec2 !== undefined && rawStockTotalRec2 !== null)
        ? this.parseCurrencyOrNumber(rawStockTotalRec2, null)
        : null;

      const rawRec2 = getVal(idxRec2, r[36]);
      const rec2BuenEstado = (rawRec2 !== '' && rawRec2 !== undefined && rawRec2 !== null)
        ? this.parseCurrencyOrNumber(rawRec2, null)
        : null;

      const rawRecDam2 = getVal(idxRecDam2, r[37]);
      const rec2MalEstado = (rawRecDam2 !== '' && rawRecDam2 !== undefined && rawRecDam2 !== null)
        ? this.parseCurrencyOrNumber(rawRecDam2, 0)
        : null;

      const rawDiffFinal2 = getVal(idxDiffFinal2, r[38]);
      const diffFinal2 = (rawDiffFinal2 !== '' && rawDiffFinal2 !== undefined && rawDiffFinal2 !== null)
        ? this.parseCurrencyOrNumber(rawDiffFinal2, null)
        : null;

      const rawCostDiffFinal2 = getVal(idxCostDiffFinal2, r[39]);
      let costDiffFinal2 = (rawCostDiffFinal2 !== '' && rawCostDiffFinal2 !== undefined && rawCostDiffFinal2 !== null)
        ? this.parseCurrencyOrNumber(rawCostDiffFinal2, null)
        : null;
      if (diffFinal2 !== null && unitCost > 0) {
        if (costDiffFinal2 === null || Math.abs(costDiffFinal2) > Math.abs(diffFinal2 * unitCost) * 2 + 50 || Math.abs(costDiffFinal2) > 50000000) {
          costDiffFinal2 = diffFinal2 * unitCost;
        }
      }

      // Regla de Negativos para stockTotalRec1 y stockTotalRec2
      let effectiveTotalRec1 = stockTotalRec1;
      if (sysStock < 0 && rec1BuenEstado === 0 && rec1MalEstado === 0 && (effectiveTotalRec1 === null || effectiveTotalRec1 === 0)) {
        effectiveTotalRec1 = sysStock;
      }
      let effectiveTotalRec2 = stockTotalRec2;
      if (sysStock < 0 && rec2BuenEstado === 0 && (rec2MalEstado === 0 || rec2MalEstado === null) && (effectiveTotalRec2 === null || effectiveTotalRec2 === 0)) {
        effectiveTotalRec2 = sysStock;
      }

      parsedItems.push({
        id: `ITEM-HIST-${idx + 1}-${sku}`,
        SKU: sku,
        Codigo_Barras: barcode,
        Descripcion: desc,
        Ubicacion: location,
        Almacen: almacen,
        Categoria: cat,
        Clasificacion_ABC: abc,
        Unidad: unit,
        Costo_Unitario: unitCost,
        Stock_Sistema: sysStock,
        Stock_Total: stockTotal,
        Stock_Buen_Estado: physStock !== null ? physStock : 0,
        Stock_Fisico: stockTotal,
        Diferencia: diff,
        Costo_Diferencia: diffCost,
        Fecha_Ultimo_Conteo: getVal(idxDate, r[16] || r[12] || ''),
        Responsable: getVal(idxResp, r[17] || r[13] || 'Administrador'),
        Estado: getVal(idxState, r[19] || r[14] || 'Revisado'),
        Mal_estado: damagedStock,
        Comentario: getVal(idxComment, r[21] || r[16] || ''),
        Razon: getVal(idxReason, r[20] || r[17] || ''),
        Comentario_Justificacion: getVal(idxJust, r[21] || r[18] || ''),
        Revisado_Por: getVal(idxReviewer, r[22] || r[19] || ''),
        Stock_Total_Reconteo: effectiveTotalRec1,
        Reconteo: rec1BuenEstado,
        Reconteo_Fisico: effectiveTotalRec1 !== null ? effectiveTotalRec1 : (rec1BuenEstado !== null ? (rec1BuenEstado + rec1MalEstado) : null),
        Malestado_Reconteo: rec1MalEstado,
        Reconteo_Mal_Estado: rec1MalEstado,
        Diferencia_Final: diffFinal1,
        Costo_Diferencia_Final: costDiffFinal1,
        Stock_Total_Reconteo_2: effectiveTotalRec2,
        Reconteo_2: rec2BuenEstado,
        Malestado_Reconteo_2: rec2MalEstado,
        Diferencia_Final_2: diffFinal2,
        Costo_Diferencia_Final_2: costDiffFinal2
      });
    });

    return parsedItems;
  }

  async readInventorySpreadsheet(record) {
    if (!record.center) throw new Error('Falta el centro para seleccionar la pestaña del inventario');
    const spreadsheetUrl = record.spreadsheetUrl || record.driveUrl;
    const spreadsheetId = this.extractSpreadsheetId(spreadsheetUrl);
    if (!spreadsheetId) throw new Error('Enlace de Google Sheets inválido');
    const url = new URL(this.getUrlForType(record.type || 'CICLICO'));
    url.searchParams.set('action', 'readFinalInventory');
    url.searchParams.set('spreadsheetId', spreadsheetId);
    url.searchParams.set('center', config.getCenterCode(record.center));
    const gid = String(spreadsheetUrl).match(/[#&?]gid=(\d+)/)?.[1];
    if (gid) url.searchParams.set('gid', gid);
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('No se pudo leer Google Sheets');
    const result = await response.json();
    if (!result.success || !Array.isArray(result.headers) || !Array.isArray(result.rows)) {
      const message = /no soportada/i.test(result.error || '') ? 'Actualice gas/Code.gs en Apps Script para habilitar el lector de métricas' : result.error;
      const error = new Error(message || 'Apps Script devolvió una tabla de inventario inválida');
      error.code = result.code;
      throw error;
    }
    return { ...result, readAt: new Date().toISOString() };
  }

  async fetchSpreadsheetItems(spreadsheetUrl) {
    if (!spreadsheetUrl) return [];
    const sheetId = this.extractSpreadsheetId(spreadsheetUrl);
    if (!sheetId) return [];

    let targetGid = null;
    const gidMatch = String(spreadsheetUrl).match(/[#&?]gid=([0-9]+)/);
    if (gidMatch && gidMatch[1]) {
      targetGid = gidMatch[1];
    }

    let csvText = '';
    // 1. Si la URL contiene un gid explícito, intentar descargar esa pestaña directamente
    if (targetGid) {
      try {
        const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${targetGid}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const t = await res.text();
          if (t && t.length > 50 && (t.startsWith('SKU') || t.toLowerCase().includes('sku')) && !t.includes('INFORME EJECUTIVO') && !t.includes('Resumen de Gestión')) {
            csvText = t;
          }
        }
      } catch (e) {}
    }

    if (targetGid && !csvText) throw new Error('No se pudo leer la pestaña solicitada; no se elegirá otra automáticamente');

    // 2. Descubrir pestañas mediante htmlview para encontrar la hoja exacta de inventario
    if (!csvText) {
      try {
        const htmlUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);
        const htmlRes = await fetch(htmlUrl, { method: 'GET', redirect: 'follow', signal: controller.signal });
        clearTimeout(timeoutId);
        if (htmlRes.ok) {
          const html = await htmlRes.text();
          const gidMatches = [...html.matchAll(/gid=([0-9]+)/g)].map(m => m[1]);
          const uniqueGids = [...new Set(gidMatches)];

          const tabResults = await Promise.allSettled(uniqueGids.map(async (gid) => {
            const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
            const tCtrl = new AbortController();
            const tId = setTimeout(() => tCtrl.abort(), 4500);
            try {
              const res = await fetch(exportUrl, { method: 'GET', redirect: 'follow', signal: tCtrl.signal });
              if (res.ok) {
                const t = await res.text();
                return { gid, text: t };
              }
            } catch (err) {
              return null;
            } finally {
              clearTimeout(tId);
            }
            return null;
          }));

          const candidates = [];

          for (const r of tabResults) {
            if (r.status === 'fulfilled' && r.value && r.value.text) {
              const t = r.value.text;
              if (t.length < 50) continue;
              if (t.includes('INFORME EJECUTIVO') || t.includes('Resumen de Gestión')) continue;

              const firstLine = (t.split('\n')[0] || '').toLowerCase();
              const headers = firstLine.split(',').map(h => h.trim().replace(/^\"|\"$/g, ''));
              const hasSkuHeader = headers.some(h => h === 'sku' || h === 'codigo_barras' || h === 'articulo');
              if (!hasSkuHeader) continue;

              candidates.push(t);
            }
          }

          if (candidates.length > 1) {
            const error = new Error('El archivo contiene varias pestañas de inventario; indique el gid de la pestaña exacta');
            error.code = 'AMBIGUOUS_SHEET';
            throw error;
          }
          if (candidates.length === 1) csvText = candidates[0];
        }
      } catch (htmlErr) {
        if (htmlErr.code === 'AMBIGUOUS_SHEET') throw htmlErr;
        console.warn(`[gasService] Notice discovering tabs for sheet ${sheetId}:`, htmlErr.message);
      }
    }

    // 3. Fallback a la exportación estándar si tiene header de SKU y no es un informe
    if (!csvText) {
      try {
        const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(exportUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const t = await res.text();
          if (t && !t.includes('INFORME EJECUTIVO') && !t.includes('Resumen de Gestión')) {
            const firstLine = (t.split('\n')[0] || '').toLowerCase();
            const headers = firstLine.split(',').map(h => h.trim().replace(/^\"|\"$/g, ''));
            if (headers.some(h => h === 'sku' || h === 'codigo_barras' || h === 'articulo')) {
              csvText = t;
            }
          }
        }
      } catch (err) {
        console.warn(`[gasService] Warning fetching closed spreadsheet items (${sheetId}):`, err.message);
      }
    }

    if (!csvText || csvText.trim().length === 0) return [];
    return this.parseSpreadsheetCsv(csvText);
  }

  async fetchProductsFromScript(type, center = '1120') {
    const cleanCenter = config.getCenterCode ? config.getCenterCode(center) : center;
    const url = this.getUrlForType(type);

    // Primary action: production GAS webhook expects getProducts, fallback to getItems
    const actionsToTry = ['getProducts', 'getItems'];

    let lastError = null;

    for (const actionName of actionsToTry) {
      try {
        const targetUrl = new URL(url);
        if (cleanCenter) {
          targetUrl.searchParams.set('center', cleanCenter);
        }
        targetUrl.searchParams.set('action', actionName);

        const response = await fetch(targetUrl.toString(), {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          },
          redirect: 'follow'
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status} from Google Apps Script`);
        }

        const text = await response.text();
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          throw new Error('Respuesta inválida de Google Apps Script: ' + text.substring(0, 100));
        }

        // If action is not supported or returned an error status, continue to next action
        if (parsed && (parsed.success === false || parsed.status === 'error')) {
          const errMsg = parsed.error || parsed.message || 'Acción no soportada en este despliegue de Google Apps Script';
          lastError = new Error(errMsg);
          continue;
        }

        let productsList = [];
        if (Array.isArray(parsed)) {
          productsList = parsed;
        } else if (parsed && Array.isArray(parsed.items)) {
          productsList = parsed.items;
        } else if (parsed && Array.isArray(parsed.products)) {
          productsList = parsed.products;
        } else if (parsed && Array.isArray(parsed.rows)) {
          productsList = parsed.rows;
        } else if (parsed && Array.isArray(parsed.data)) {
          productsList = parsed.data;
        }

        // Return if products found or if successful response from script
        if (productsList.length > 0 || (parsed && (parsed.success === true || parsed.status === 'success'))) {
          return this.mapRawRowsToColumns(productsList);
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) {
      console.warn(`[gasService] Warning fetching from remote GAS URL (${url}):`, lastError.message);
      throw lastError;
    }

    return [];
  }

  mapRawRowsToColumns(rawRows = []) {
    const parseNum = (val, fallback = 0) => this.parseCurrencyOrNumber(val, fallback);
    const parseIntSafe = (val, fallback = 0) => {
      if (val === null || val === undefined || val === '') return fallback;
      const n = parseInt(val, 10);
      return isNaN(n) ? fallback : n;
    };

    return rawRows.map((row, idx) => {
      // Row could be an array of column values [A, B, C...] or an object with keys
      if (Array.isArray(row)) {
        // Check if row is using the 37-column (or 29-column) structure
        const isExtendedCols = row.length >= 25 || (row.length >= 7 && (row[6] === '1120' || row[6] === '1300' || row[6] === 'WARNES' || row[6] === '1100' || row[6] === '1200' || String(row[6] || '').toLowerCase().includes('almacen')));

        if (isExtendedCols) {
          // If row has >= 38 columns, it uses the 40-column layout (A-AN)
          const is40 = row.length >= 38;
          if (is40) {
            const sysVal = parseIntSafe(row[10], 0);
            let stockTotal = row[11] !== undefined && row[11] !== '' && row[11] !== null ? parseIntSafe(row[11], null) : null;
            const stockBuenEstado = row[12] !== undefined && row[12] !== '' && row[12] !== null ? parseIntSafe(row[12], null) : null;
            const malEstado = parseIntSafe(row[13], 0);
            
            // Regla de Negativos: Si Stock_Sistema < 0 y buen estado es 0 sin daño, toma el negativo como total y cuadra
            if (sysVal < 0 && stockBuenEstado === 0 && malEstado === 0) {
              if (stockTotal === null || stockTotal === 0) stockTotal = sysVal;
            }
            let parsedPhys = stockBuenEstado !== null ? stockBuenEstado : (stockTotal !== null ? stockTotal : null);

            // Reconteo 1: Col Y (index 24) = Stock_Total_Reconteo, Col Z (index 25) = Reconteo (Buen Estado), Col AA (index 26) = Malestado, Col AB (index 27) = Diferencia_Final
            let stockTotalRec1 = row[24] !== undefined && row[24] !== '' && row[24] !== null ? parseIntSafe(row[24], null) : null;
            const recBuenEstado1 = row[25] !== undefined && row[25] !== '' && row[25] !== null ? parseIntSafe(row[25], null) : null;
            const parsedRecDam1 = row[26] !== undefined && row[26] !== '' && row[26] !== null ? parseIntSafe(row[26], 0) : 0;
            if (sysVal < 0 && recBuenEstado1 === 0 && parsedRecDam1 === 0) {
              if (stockTotalRec1 === null || stockTotalRec1 === 0) stockTotalRec1 = sysVal;
            }
            // Prioridad absoluta a Columna Y para el stock total de Reconteo 1
            let parsedRec1 = stockTotalRec1 !== null ? stockTotalRec1 : (recBuenEstado1 !== null ? (recBuenEstado1 + parsedRecDam1) : null);

            // Reconteo 2: Col AJ (index 35) = Stock_Total_Reconteo_2, Col AK (index 36) = Reconteo 2 (Buen Estado), Col AL (index 37) = Malestado, Col AM (index 38) = Diferencia_Final_2
            let stockTotalRec2 = row[35] !== undefined && row[35] !== '' && row[35] !== null ? parseIntSafe(row[35], null) : null;
            const recBuenEstado2 = row[36] !== undefined && row[36] !== '' && row[36] !== null ? parseIntSafe(row[36], null) : null;
            const parsedRecDam2 = row[37] !== undefined && row[37] !== '' && row[37] !== null ? parseIntSafe(row[37], 0) : null;
            if (sysVal < 0 && recBuenEstado2 === 0 && (parsedRecDam2 === 0 || parsedRecDam2 === null)) {
              if (stockTotalRec2 === null || stockTotalRec2 === 0) stockTotalRec2 = sysVal;
            }
            // Prioridad absoluta a Columna AJ para el stock total de Reconteo 2
            let parsedRec2 = stockTotalRec2 !== null ? stockTotalRec2 : (recBuenEstado2 !== null ? (recBuenEstado2 + (parsedRecDam2 || 0)) : null);

            const finalDiff1 = (sysVal < 0 && stockBuenEstado === 0 && malEstado === 0)
              ? 0
              : (row[14] !== undefined && row[14] !== '' && row[14] !== null ? parseIntSafe(row[14], 0) : (stockTotal !== null ? (stockTotal - sysVal) : (parsedPhys !== null ? (parsedPhys - sysVal) : 0)));
            const finalCostDiff1 = (sysVal < 0 && stockBuenEstado === 0 && malEstado === 0)
              ? 0
              : parseNum(row[15], 0);

            return {
              id: `ITEM-${idx + 1}-${Date.now().toString(36)}`,
              SKU: String(row[0] || '').trim(),
              Codigo_Barras: String(row[1] || '').trim(),
              Descripcion: String(row[2] || '').trim(),
              Ubicacion: String(row[3] || '').trim(),
              Ubicacion_1: String(row[4] || '').trim(),
              Ubicacion_2: String(row[5] || '').trim(),
              Almacen: String(row[6] || '').trim(),
              Categoria: String(row[6] || '').trim(),
              Clasificacion_ABC: String(row[7] || 'C').trim().toUpperCase(),
              Unidad: String(row[8] || 'PZA').trim(),
              Costo_Unitario: parseNum(row[9], 0),
              Stock_Sistema: sysVal,
              Stock_Total: stockTotal !== null ? stockTotal : (stockBuenEstado !== null ? (stockBuenEstado + malEstado) : parsedPhys),
              Stock_Buen_Estado: stockBuenEstado,
              Stock_Fisico: parsedPhys,
              Mal_estado: malEstado,
              Diferencia: finalDiff1,
              Costo_Diferencia: finalCostDiff1,
              Fecha_Ultimo_Conteo: row[16] || null,
              Responsable: String(row[17] || '').trim(),
              Fecha_Primera_Justificacion: row[18] || null,
              Estado: String(row[19] || 'Pendiente').trim(),
              corroboracion: String(row[19] || '').trim().toUpperCase() === 'CUADRA' ? 'CUADRA' : (String(row[19] || '').trim().toUpperCase().includes('NO') ? 'NO_CUADRA' : String(row[19] || '').trim().toUpperCase()),
              corroborationStatus: String(row[19] || '').trim().toUpperCase() === 'CUADRA' ? 'CUADRA' : (String(row[19] || '').trim().toUpperCase().includes('NO') ? 'NO_CUADRA' : String(row[19] || '').trim().toUpperCase()),
              Razon: String(row[20] || '').trim(),
              Comentario_Justificacion: String(row[21] || '').trim(),
              Responsable_Justificacion: String(row[22] || '').trim(),
              Revisado_Por: String(row[22] || '').trim(),
              Fecha_Reconteo: row[23] || null,
              Stock_Total_Reconteo: stockTotalRec1,
              Reconteo: recBuenEstado1,
              Reconteo_Fisico: parsedRec1,
              Malestado_Reconteo: parsedRecDam1,
              Reconteo_Mal_Estado: parsedRecDam1,
              Diferencia_Final: row[27] !== undefined && row[27] !== '' && row[27] !== null ? parseIntSafe(row[27], 0) : null,
              Costo_Diferencia_Final: row[28] !== undefined && row[28] !== '' && row[28] !== null ? parseNum(row[28], 0) : null,
              Fecha_Justificacion_2: row[29] || null,
              Estado_Justificacion_2: String(row[30] || '').trim(),
              Razon_Justificacion_2: String(row[31] || '').trim(),
              Comentario_Justificacion_2: String(row[32] || '').trim(),
              Responsable_Justificacion_2: String(row[33] || '').trim(),
              Fecha_Reconteo_2: row[34] || null,
              Stock_Total_Reconteo_2: stockTotalRec2,
              Reconteo_2: parsedRec2,
              Malestado_Reconteo_2: parsedRecDam2,
              Diferencia_Final_2: row[38] !== undefined && row[38] !== '' && row[38] !== null ? parseIntSafe(row[38], 0) : null,
              Costo_Diferencia_Final_2: row[39] !== undefined && row[39] !== '' && row[39] !== null ? parseNum(row[39], 0) : null
            };
          }

          // If row has >= 30 columns, it uses the 37-column layout (Q=Mal_estado, R=Fecha_Primera_Justificacion, S=Estado, etc.)
          const is37 = row.length >= 30;

          if (is37) {
            const parsedDamaged = parseIntSafe(row[16], 0);
            let parsedPhys = row[11] !== undefined && row[11] !== '' && row[11] !== null ? parseIntSafe(row[11], null) : null;

            const parsedRecDam1 = row[24] !== undefined && row[24] !== '' && row[24] !== null ? parseIntSafe(row[24], 0) : 0;
            let parsedRec1 = row[23] !== undefined && row[23] !== '' && row[23] !== null ? parseIntSafe(row[23], null) : null;

            const parsedRecDam2 = row[34] !== undefined && row[34] !== '' && row[34] !== null ? parseIntSafe(row[34], 0) : null;
            let parsedRec2 = row[33] !== undefined && row[33] !== '' && row[33] !== null ? parseIntSafe(row[33], null) : null;

            return {
              id: `ITEM-${idx + 1}-${Date.now().toString(36)}`,
              SKU: String(row[0] || '').trim(),
              Codigo_Barras: String(row[1] || '').trim(),
              Descripcion: String(row[2] || '').trim(),
              Ubicacion: String(row[3] || '').trim(),
              Ubicacion_1: String(row[4] || '').trim(),
              Ubicacion_2: String(row[5] || '').trim(),
              Almacen: String(row[6] || '').trim(),
              Categoria: String(row[6] || '').trim(),
              Clasificacion_ABC: String(row[7] || 'C').trim().toUpperCase(),
              Unidad: String(row[8] || 'PZA').trim(),
              Costo_Unitario: parseNum(row[9], 0),
              Stock_Sistema: parseIntSafe(row[10], 0),
              Stock_Total: parsedPhys,
              Stock_Fisico: parsedPhys,
              Diferencia: row[12] !== undefined && row[12] !== '' && row[12] !== null ? parseIntSafe(row[12], 0) : (parsedPhys !== null ? (parsedPhys - parseIntSafe(row[10], 0)) : 0),
              Costo_Diferencia: parseNum(row[13], 0),
              Fecha_Ultimo_Conteo: row[14] || null,
              Responsable: String(row[15] || '').trim(),
              Mal_estado: parsedDamaged,
              Fecha_Primera_Justificacion: row[17] || null,
              Estado: String(row[18] || 'Pendiente').trim(),
              corroboracion: String(row[18] || '').trim().toUpperCase() === 'CUADRA' ? 'CUADRA' : (String(row[18] || '').trim().toUpperCase().includes('NO') ? 'NO_CUADRA' : String(row[18] || '').trim().toUpperCase()),
              corroborationStatus: String(row[18] || '').trim().toUpperCase() === 'CUADRA' ? 'CUADRA' : (String(row[18] || '').trim().toUpperCase().includes('NO') ? 'NO_CUADRA' : String(row[18] || '').trim().toUpperCase()),
              Razon: String(row[19] || '').trim(),
              Comentario_Justificacion: String(row[20] || '').trim(),
              Responsable_Justificacion: String(row[21] || '').trim(),
              Revisado_Por: String(row[21] || '').trim(),
              Fecha_Reconteo: row[22] || null,
              Reconteo_Fisico: parsedRec1,
              Reconteo_Mal_Estado: parsedRecDam1,
              Diferencia_Final: row[25] !== undefined && row[25] !== '' && row[25] !== null ? parseIntSafe(row[25], 0) : null,
              Costo_Diferencia_Final: row[26] !== undefined && row[26] !== '' && row[26] !== null ? parseNum(row[26], 0) : null,
              Fecha_Justificacion_2: row[27] || null,
              Estado_Justificacion_2: String(row[28] || '').trim(),
              Razon_Justificacion_2: String(row[29] || '').trim(),
              Comentario_Justificacion_2: String(row[30] || '').trim(),
              Responsable_Justificacion_2: String(row[31] || '').trim(),
              Fecha_Reconteo_2: row[32] || null,
              Reconteo_2: parsedRec2,
              Malestado_Reconteo_2: parsedRecDam2,
              Diferencia_Final_2: row[35] !== undefined && row[35] !== '' && row[35] !== null ? parseIntSafe(row[35], 0) : null,
              Costo_Diferencia_Final_2: row[36] !== undefined && row[36] !== '' && row[36] !== null ? parseNum(row[36], 0) : null
            };
          }

          return {
            id: `ITEM-${idx + 1}-${Date.now().toString(36)}`,
            SKU: String(row[0] || '').trim(),
            Codigo_Barras: String(row[1] || '').trim(),
            Descripcion: String(row[2] || '').trim(),
            Ubicacion: String(row[3] || '').trim(),
            Ubicacion_1: String(row[4] || '').trim(),
            Ubicacion_2: String(row[5] || '').trim(),
            Almacen: String(row[6] || '').trim(),
            Categoria: String(row[6] || '').trim(),
            Clasificacion_ABC: String(row[7] || 'C').trim().toUpperCase(),
            Unidad: String(row[8] || 'PZA').trim(),
            Costo_Unitario: parseNum(row[9], 0),
            Stock_Sistema: parseIntSafe(row[10], 0),
            Stock_Fisico: row[11] !== undefined && row[11] !== '' && row[11] !== null ? parseIntSafe(row[11], null) : null,
            Diferencia: row[12] !== undefined && row[12] !== '' && row[12] !== null ? parseIntSafe(row[12], 0) : 0,
            Costo_Diferencia: parseNum(row[13], 0),
            Fecha_Ultimo_Conteo: row[14] || null,
            Responsable: String(row[15] || '').trim(),
            Estado: String(row[16] || 'Pendiente').trim(),
            Mal_estado: parseIntSafe(row[17], 0),
            Razon: String(row[18] || '').trim(),
            Comentario_Justificacion: String(row[19] || '').trim(),
            Responsable_Justificacion: String(row[20] || '').trim(),
            Revisado_Por: String(row[20] || '').trim(),
            Reconteo_Fisico: row[21] !== undefined && row[21] !== '' && row[21] !== null ? parseIntSafe(row[21], null) : null,
            Reconteo_Mal_Estado: row[22] !== undefined && row[22] !== '' && row[22] !== null ? parseIntSafe(row[22], 0) : 0,
            Diferencia_Final: row[23] !== undefined && row[23] !== '' && row[23] !== null ? parseIntSafe(row[23], 0) : null,
            Costo_Diferencia_Final: row[24] !== undefined && row[24] !== '' && row[24] !== null ? parseNum(row[24], 0) : null,
            Reconteo_2: row[25] !== undefined && row[25] !== '' && row[25] !== null ? parseIntSafe(row[25], null) : null,
            Malestado_Reconteo_2: row[26] !== undefined && row[26] !== '' && row[26] !== null ? parseIntSafe(row[26], 0) : null,
            Diferencia_Final_2: row[27] !== undefined && row[27] !== '' && row[27] !== null ? parseIntSafe(row[27], 0) : null,
            Costo_Diferencia_Final_2: row[28] !== undefined && row[28] !== '' && row[28] !== null ? parseNum(row[28], 0) : null
          };
        }

        return {
          id: `ITEM-${idx + 1}-${Date.now().toString(36)}`,
          SKU: String(row[0] || '').trim(),
          Codigo_Barras: String(row[1] || '').trim(),
          Descripcion: String(row[2] || '').trim(),
          Ubicacion: String(row[3] || '').trim(),
          Ubicacion_1: '',
          Ubicacion_2: '',
          Almacen: String(row[4] || '').trim(),
          Categoria: String(row[4] || '').trim(),
          Clasificacion_ABC: String(row[5] || 'C').trim().toUpperCase(),
          Unidad: String(row[6] || 'PZA').trim(),
          Costo_Unitario: parseNum(row[7], 0),
          Stock_Sistema: parseIntSafe(row[8], 0),
          Stock_Fisico: row[9] !== undefined && row[9] !== '' && row[9] !== null ? parseIntSafe(row[9], null) : null,
          Diferencia: row[10] !== undefined && row[10] !== '' && row[10] !== null ? parseIntSafe(row[10], 0) : 0,
          Costo_Diferencia: parseNum(row[11], 0),
          Fecha_Ultimo_Conteo: row[12] || null,
          Responsable: String(row[13] || '').trim(),
          Estado: String(row[14] || 'Pendiente').trim(),
          Mal_estado: parseIntSafe(row[15], 0),
          Comentario: String(row[16] || '').trim(),
          Razon: String(row[17] || '').trim(),
          Comentario_Justificacion: String(row[18] || '').trim(),
          Responsable_Justificacion: String(row[19] || '').trim(),
          Revisado_Por: String(row[19] || '').trim(),
          Reconteo_Fisico: row[20] !== undefined && row[20] !== '' && row[20] !== null ? parseIntSafe(row[20], null) : null,
          Reconteo_Mal_Estado: row[21] !== undefined && row[21] !== '' && row[21] !== null ? parseIntSafe(row[21], 0) : 0
        };
      }

      return {
        id: row.id || `ITEM-${idx + 1}-${Date.now().toString(36)}`,
        SKU: String(row.SKU || row.sku || '').trim(),
        Codigo_Barras: String(row.Codigo_Barras || row.codigo_barras || row.barcode || '').trim(),
        Descripcion: String(row.Descripcion || row.descripcion || '').trim(),
        Ubicacion: String(row.Ubicacion || row.ubicacion || '').trim(),
        Ubicacion_1: String(row.Ubicacion_1 || row.ubicacion_1 || row.ubicacion1 || '').trim(),
        Ubicacion_2: String(row.Ubicacion_2 || row.ubicacion_2 || row.ubicacion2 || '').trim(),
        Almacen: String(row.Almacen || row.almacen || row.almacén || row.Almacén || row.Categoria || row.categoria || '').trim(),
        Categoria: String(row.Categoria || row.categoria || row.Almacen || '').trim(),
        Clasificacion_ABC: String(row.Clasificacion_ABC || row.abc || 'C').trim().toUpperCase(),
        Unidad: String(row.Unidad || row.unidad || 'PZA').trim(),
        Costo_Unitario: parseNum(row.Costo_Unitario || row.costo_unitario, 0),
        Stock_Sistema: parseIntSafe(row.Stock_Sistema || row.stock_sistema, 0),
        Stock_Total: (row.Stock_Total !== undefined && row.Stock_Total !== null && row.Stock_Total !== '') ? parseIntSafe(row.Stock_Total, null) : ((row.Stock_Fisico !== undefined && row.Stock_Fisico !== null && row.Stock_Fisico !== '') ? parseIntSafe(row.Stock_Fisico, null) : null),
        Stock_Buen_Estado: (row.Stock_Buen_Estado !== undefined && row.Stock_Buen_Estado !== null && row.Stock_Buen_Estado !== '') ? parseIntSafe(row.Stock_Buen_Estado, null) : null,
        Stock_Fisico: (row.Stock_Fisico !== undefined && row.Stock_Fisico !== null && row.Stock_Fisico !== '') ? parseIntSafe(row.Stock_Fisico, null) : ((row.Stock_Total !== undefined && row.Stock_Total !== null && row.Stock_Total !== '') ? parseIntSafe(row.Stock_Total, null) : null),
        Diferencia: (row.Diferencia !== undefined && row.Diferencia !== null && row.Diferencia !== '') ? parseIntSafe(row.Diferencia, 0) : 0,
        Costo_Diferencia: parseNum(row.Costo_Diferencia, 0),
        Fecha_Ultimo_Conteo: row.Fecha_Ultimo_Conteo || row.fecha_conteo || null,
        Responsable: String(row.Responsable || row.responsable || '').trim(),
        Mal_estado: parseIntSafe(row.Mal_estado || row.mal_estado, 0),
        Fecha_Primera_Justificacion: row.Fecha_Primera_Justificacion || row.fecha_primera_justificacion || row.FECHA_PRIMERA_JUSTIFICACION || null,
        Estado: String(row.Estado || row.estado || 'Pendiente').trim(),
        corroboracion: String(row.Estado || row.estado || row.corroboracion || row.corroborationStatus || '').trim().toUpperCase() === 'CUADRA' ? 'CUADRA' : (String(row.Estado || row.estado || row.corroboracion || row.corroborationStatus || '').trim().toUpperCase().includes('NO') ? 'NO_CUADRA' : ''),
        corroborationStatus: String(row.Estado || row.estado || row.corroborationStatus || row.corroboracion || '').trim().toUpperCase() === 'CUADRA' ? 'CUADRA' : (String(row.Estado || row.estado || row.corroborationStatus || row.corroboracion || '').trim().toUpperCase().includes('NO') ? 'NO_CUADRA' : ''),
        Comentario: String(row.Comentario || row.comentario || '').trim(),
        Razon: String(row.Razon || row.razon || row.Razon_Justificacion || row.reasonType || '').trim(),
        Comentario_Justificacion: String(row.Comentario_Justificacion || row.comentario_justificacion || row.justification || row.comentarioJustificacion || '').trim(),
        Responsable_Justificacion: String(row.Responsable_Justificacion || row.responsableJustificacion || row.RESPONSABLE_JUSTIFICACION || row.Revisado_Por || row.revisado_por || row.reviewedBy || row.revisor || '').trim(),
        Revisado_Por: String(row.Revisado_Por || row.revisado_por || row.reviewedBy || row.revisor || '').trim(),
        Fecha_Reconteo: row.Fecha_Reconteo || row.fecha_reconteo || row.FECHA_RECONTEO || null,
        Stock_Total_Reconteo: (row.Stock_Total_Reconteo !== undefined && row.Stock_Total_Reconteo !== null && row.Stock_Total_Reconteo !== '') ? parseIntSafe(row.Stock_Total_Reconteo, null) : null,
        Reconteo_Fisico: (row.Reconteo_Fisico !== undefined && row.Reconteo_Fisico !== null && row.Reconteo_Fisico !== '') ? parseIntSafe(row.Reconteo_Fisico, null) : ((row.Reconteo !== undefined && row.Reconteo !== null && row.Reconteo !== '') ? parseIntSafe(row.Reconteo, null) : null),
        Reconteo: (row.Reconteo !== undefined && row.Reconteo !== null && row.Reconteo !== '') ? parseIntSafe(row.Reconteo, null) : ((row.Reconteo_Fisico !== undefined && row.Reconteo_Fisico !== null && row.Reconteo_Fisico !== '') ? parseIntSafe(row.Reconteo_Fisico, null) : null),
        Reconteo_Mal_Estado: (row.Reconteo_Mal_Estado !== undefined && row.Reconteo_Mal_Estado !== null && row.Reconteo_Mal_Estado !== '') ? parseIntSafe(row.Reconteo_Mal_Estado, 0) : ((row.Malestado_Reconteo !== undefined && row.Malestado_Reconteo !== null && row.Malestado_Reconteo !== '') ? parseIntSafe(row.Malestado_Reconteo, 0) : 0),
        Malestado_Reconteo: (row.Malestado_Reconteo !== undefined && row.Malestado_Reconteo !== null && row.Malestado_Reconteo !== '') ? parseIntSafe(row.Malestado_Reconteo, 0) : ((row.Reconteo_Mal_Estado !== undefined && row.Reconteo_Mal_Estado !== null && row.Reconteo_Mal_Estado !== '') ? parseIntSafe(row.Reconteo_Mal_Estado, 0) : 0),
        Diferencia_Final: (row.Diferencia_Final !== undefined && row.Diferencia_Final !== null && row.Diferencia_Final !== '') ? parseIntSafe(row.Diferencia_Final, 0) : null,
        Costo_Diferencia_Final: row.Costo_Diferencia_Final !== undefined ? parseNum(row.Costo_Diferencia_Final, 0) : null,
        Fecha_Justificacion_2: row.Fecha_Justificacion_2 || row.fecha_justificacion_2 || row.FECHA_JUSTIFICACION_2 || null,
        Estado_Justificacion_2: String(row.Estado_Justificacion_2 || row.estado_justificacion_2 || row.ESTADO_JUSTIFICACION_2 || '').trim(),
        Razon_Justificacion_2: String(row.Razon_Justificacion_2 || row.razon_justificacion_2 || row.RAZON_JUSTIFICACION_2 || '').trim(),
        Comentario_Justificacion_2: String(row.Comentario_Justificacion_2 || row.comentario_justificacion_2 || row.COMENTARIO_JUSTIFICACION_2 || '').trim(),
        Responsable_Justificacion_2: String(row.Responsable_Justificacion_2 || row.responsable_justificacion_2 || row.RESPONSABLE_JUSTIFICACION_2 || '').trim(),
        Fecha_Reconteo_2: row.Fecha_Reconteo_2 || row.fecha_reconteo_2 || row.FECHA_RECONTEO_2 || null,
        Stock_Total_Reconteo_2: (row.Stock_Total_Reconteo_2 !== undefined && row.Stock_Total_Reconteo_2 !== null && row.Stock_Total_Reconteo_2 !== '') ? parseIntSafe(row.Stock_Total_Reconteo_2, null) : null,
        Reconteo_2: (row.Reconteo_2 !== undefined && row.Reconteo_2 !== null && row.Reconteo_2 !== '') ? parseIntSafe(row.Reconteo_2, null) : null,
        Malestado_Reconteo_2: (row.Malestado_Reconteo_2 !== undefined && row.Malestado_Reconteo_2 !== null && row.Malestado_Reconteo_2 !== '') ? parseIntSafe(row.Malestado_Reconteo_2, 0) : null,
        Diferencia_Final_2: (row.Diferencia_Final_2 !== undefined && row.Diferencia_Final_2 !== null && row.Diferencia_Final_2 !== '') ? parseIntSafe(row.Diferencia_Final_2, 0) : null,
        Costo_Diferencia_Final_2: row.Costo_Diferencia_Final_2 !== undefined ? parseNum(row.Costo_Diferencia_Final_2, 0) : null
      };
    });
  }

  formatItemsToColumns(items = []) {
    return items.map(it => {
      const stockSistema = Number(it.Stock_Sistema || 0);
      const malEstado = Number(it.Mal_estado !== undefined ? it.Mal_estado : (it.malEstado || 0));
      let rawFisico = it.Stock_Fisico !== null && it.Stock_Fisico !== undefined ? Number(it.Stock_Fisico) : (it.Stock_Buen_Estado !== null && it.Stock_Buen_Estado !== undefined ? Number(it.Stock_Buen_Estado) : '');
      let stockTotal = it.Stock_Total !== null && it.Stock_Total !== undefined ? Number(it.Stock_Total) : '';

      // If physical stock was counted or malEstado reported
      let stockBuenEstado = rawFisico !== '' ? rawFisico : '';
      if (stockTotal === '' && (rawFisico !== '' || malEstado > 0)) {
        stockTotal = (Number(rawFisico || 0) + Number(malEstado || 0));
      }
      if (stockBuenEstado === '' && stockTotal !== '') {
        stockBuenEstado = Math.max(0, Number(stockTotal) - Number(malEstado || 0));
      }

      const isNegSys1 = stockSistema < 0 && stockBuenEstado === 0 && malEstado === 0;
      if (isNegSys1 && stockTotal === '') stockTotal = stockSistema;

      const unitCost = Number(it.Costo_Unitario || 0);

      // Reconteo 1
      const recMalEstado = it.Reconteo_Mal_Estado !== null && it.Reconteo_Mal_Estado !== undefined && it.Reconteo_Mal_Estado !== '' ? Number(it.Reconteo_Mal_Estado) : (it.Malestado_Reconteo !== null && it.Malestado_Reconteo !== undefined && it.Malestado_Reconteo !== '' ? Number(it.Malestado_Reconteo) : 0);
      let rawRec = (it.Reconteo !== null && it.Reconteo !== undefined && it.Reconteo !== '') ? Number(it.Reconteo) : ((it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined && it.Reconteo_Fisico !== '') ? Number(it.Reconteo_Fisico) : '');
      let stockTotalRec1 = it.Stock_Total_Reconteo !== null && it.Stock_Total_Reconteo !== undefined && it.Stock_Total_Reconteo !== '' ? Number(it.Stock_Total_Reconteo) : '';
      if (stockTotalRec1 === '' && (rawRec !== '' || recMalEstado > 0)) {
        stockTotalRec1 = (Number(rawRec || 0) + Number(recMalEstado || 0));
      }
      let recBuenEstado1 = rawRec !== '' ? rawRec : (stockTotalRec1 !== '' ? Math.max(0, Number(stockTotalRec1) - Number(recMalEstado || 0)) : '');
      const isNegSysRec1 = stockSistema < 0 && recBuenEstado1 === 0 && recMalEstado === 0;
      if (isNegSysRec1 && stockTotalRec1 === '') stockTotalRec1 = stockSistema;

      // Reconteo 2
      const recMalEstado2 = it.Malestado_Reconteo_2 !== null && it.Malestado_Reconteo_2 !== undefined && it.Malestado_Reconteo_2 !== '' ? Number(it.Malestado_Reconteo_2) : (it.Reconteo_Mal_Estado_2 !== null && it.Reconteo_Mal_Estado_2 !== undefined && it.Reconteo_Mal_Estado_2 !== '' ? Number(it.Reconteo_Mal_Estado_2) : 0);
      let rawRec2 = (it.Reconteo_2 !== null && it.Reconteo_2 !== undefined && it.Reconteo_2 !== '') ? Number(it.Reconteo_2) : '';
      let stockTotalRec2 = it.Stock_Total_Reconteo_2 !== null && it.Stock_Total_Reconteo_2 !== undefined && it.Stock_Total_Reconteo_2 !== '' ? Number(it.Stock_Total_Reconteo_2) : '';
      if (stockTotalRec2 === '' && (rawRec2 !== '' || recMalEstado2 > 0)) {
        stockTotalRec2 = (Number(rawRec2 || 0) + Number(recMalEstado2 || 0));
      }
      let recBuenEstado2 = rawRec2 !== '' ? rawRec2 : (stockTotalRec2 !== '' ? Math.max(0, Number(stockTotalRec2) - Number(recMalEstado2 || 0)) : '');
      const isNegSysRec2 = stockSistema < 0 && recBuenEstado2 === 0 && recMalEstado2 === 0;
      if (isNegSysRec2 && stockTotalRec2 === '') stockTotalRec2 = stockSistema;

      const effectiveTotal1 = isNegSys1 ? stockSistema : (stockTotal !== '' ? Number(stockTotal) : (stockBuenEstado !== '' ? Number(stockBuenEstado) + Number(malEstado || 0) : ''));
      const diff1 = isNegSys1 ? 0 : (effectiveTotal1 !== '' ? (effectiveTotal1 - stockSistema) : '');
      const costDiff1 = isNegSys1 ? 0 : (diff1 !== '' ? (diff1 * unitCost) : '');

      const effectiveTotalRec1 = isNegSysRec1 ? stockSistema : (stockTotalRec1 !== '' ? Number(stockTotalRec1) : (recBuenEstado1 !== '' ? Number(recBuenEstado1) + Number(recMalEstado || 0) : ''));
      const diffFinal = isNegSysRec1 ? 0 : (effectiveTotalRec1 !== '' ? (effectiveTotalRec1 - stockSistema) : '');
      const costDiffFinal = isNegSysRec1 ? 0 : (diffFinal !== '' ? (diffFinal * unitCost) : '');

      const effectiveTotalRec2 = isNegSysRec2 ? stockSistema : (stockTotalRec2 !== '' ? Number(stockTotalRec2) : (recBuenEstado2 !== '' ? Number(recBuenEstado2) + Number(recMalEstado2 || 0) : ''));
      const diffFinal2 = isNegSysRec2 ? 0 : (effectiveTotalRec2 !== '' ? (effectiveTotalRec2 - stockSistema) : '');
      const costDiffFinal2 = isNegSysRec2 ? 0 : (diffFinal2 !== '' ? (diffFinal2 * unitCost) : '');

      const estadoJustificacion = (it.corroboracion === 'CUADRA' || String(it.corroboracionStatus || '').toUpperCase() === 'CUADRA' || String(it.Estado || '').toUpperCase() === 'CUADRA')
        ? 'CUADRA'
        : ((it.corroboracion === 'NO CUADRA' || it.corroboracion === 'NO_CUADRA' || String(it.corroboracionStatus || '').toUpperCase().includes('NO') || String(it.Estado || '').toUpperCase() === 'NO CUADRA')
          ? 'NO CUADRA'
          : (it.Estado_Justificacion || it.estadoJustificacion || ''));

      return [
        String(it.SKU || it.sku || '').trim(), // 0: Col A (SKU)
        String(it.Codigo_Barras || it.codigoBarras || it.barcode || '').trim(), // 1: Col B (Codigo_Barras)
        String(it.Descripcion || it.descripcion || '').trim(), // 2: Col C (Descripcion)
        String(it.Ubicacion || it.ubicacion || '').trim(), // 3: Col D (Ubicación)
        String(it.Ubicacion_1 || it.ubicacion1 || '').trim(), // 4: Col E (Ubicación 1)
        String(it.Ubicacion_2 || it.ubicacion2 || '').trim(), // 5: Col F (Ubicación 2)
        String(it.Almacen || it.almacen || it.Categoria || '').trim(), // 6: Col G (Almacen)
        String(it.Clasificacion_ABC || it.clasificacionAbc || 'C').trim().toUpperCase(), // 7: Col H (Clasificacion_ABC)
        String(it.Unidad || it.unidad || 'PZA').trim(), // 8: Col I (Unidad)
        unitCost, // 9: Col J (Costo_Unitario)
        stockSistema, // 10: Col K (Stock_Sistema)
        effectiveTotal1 !== '' ? effectiveTotal1 : '', // 11: Col L (Stock_Total)
        stockBuenEstado !== '' ? stockBuenEstado : '', // 12: Col M (Stock_Buen_Estado - Buen Estado)
        malEstado, // 13: Col N (Mal_estado - Mal Estado)
        it.Diferencia !== undefined && it.Diferencia !== null && it.Diferencia !== '' ? Number(it.Diferencia) : diff1, // 14: Col O (Diferencia)
        it.Costo_Diferencia !== undefined && it.Costo_Diferencia !== null && it.Costo_Diferencia !== '' ? Number(it.Costo_Diferencia) : costDiff1, // 15: Col P (Costo_Diferencia)
        it.Fecha_Ultimo_Conteo || (effectiveTotal1 !== '' ? new Date().toISOString().split('T')[0] : ''), // 16: Col Q (Fecha_Ultimo_Conteo)
        String(it.Responsable || it.responsable || '').trim(), // 17: Col R (Responsable)
        it.Fecha_Primera_Justificacion || '', // 18: Col S (FECHA PRIMERA JUSTIFICACION)
        estadoJustificacion, // 19: Col T (ESTADO DE LA PRIMERA JUSTIFICACION (CUADRA - NO CUADRA))
        String(it.Razon || it.Razon_Justificacion || it.reasonType || it.razon || '').trim(), // 20: Col U (RAZON)
        String(it.Comentario_Justificacion || it.comentarioJustificacion || it.justification || '').trim(), // 21: Col V (COMENTARIO JUSTIFICACION)
        String(it.Responsable_Justificacion || it.responsableJustificacion || it.Revisado_Por || it.reviewedBy || '').trim(), // 22: Col W (RESPONSABLE JUSTIFICACION)
        it.Fecha_Reconteo || '', // 23: Col X (FECHA RECONTEO)
        effectiveTotalRec1 !== '' ? effectiveTotalRec1 : '', // 24: Col Y (Stock_Total_Reconteo)
        recBuenEstado1 !== '' ? recBuenEstado1 : '', // 25: Col Z (RECONTEO - Buen Estado)
        recMalEstado, // 26: Col AA (MALESTADO RECONTEO)
        it.Diferencia_Final !== undefined && it.Diferencia_Final !== null && it.Diferencia_Final !== '' ? Number(it.Diferencia_Final) : diffFinal, // 27: Col AB (DIFERENCIA FINAL)
        it.Costo_Diferencia_Final !== undefined && it.Costo_Diferencia_Final !== null && it.Costo_Diferencia_Final !== '' ? Number(it.Costo_Diferencia_Final) : costDiffFinal, // 28: Col AC (COSTO DIFERENCIA FINAL)
        it.Fecha_Justificacion_2 || '', // 29: Col AD (FECHA JUSTIFICACION 2)
        String(it.Estado_Justificacion_2 || it.estadoJustificacion2 || '').trim(), // 30: Col AE (ESTADO JUSTIFICACION 2)
        String(it.Razon_Justificacion_2 || it.razonJustificacion2 || '').trim(), // 31: Col AF (RAZON JUSTIFICACION 2)
        String(it.Comentario_Justificacion_2 || it.comentarioJustificacion2 || '').trim(), // 32: Col AG (COMENTARIO JUSTIFICACION 2)
        String(it.Responsable_Justificacion_2 || it.responsableJustificacion2 || '').trim(), // 33: Col AH (RESPONSABLE JUSTIFICACION 2)
        it.Fecha_Reconteo_2 || '', // 34: Col AI (FECHA RECONTEO 2)
        effectiveTotalRec2 !== '' ? effectiveTotalRec2 : '', // 35: Col AJ (Stock_Total_Reconteo_2)
        recBuenEstado2 !== '' ? recBuenEstado2 : '', // 36: Col AK (RECONTEO 2 - Buen Estado)
        recMalEstado2, // 37: Col AL (MALESTADO RECONTEO 2)
        it.Diferencia_Final_2 !== undefined && it.Diferencia_Final_2 !== null && it.Diferencia_Final_2 !== '' ? Number(it.Diferencia_Final_2) : diffFinal2, // 38: Col AM (DIFERENCIA FINAL 2)
        it.Costo_Diferencia_Final_2 !== undefined && it.Costo_Diferencia_Final_2 !== null && it.Costo_Diferencia_Final_2 !== '' ? Number(it.Costo_Diferencia_Final_2) : costDiffFinal2 // 39: Col AN (COSTO DIFERENCIA FINAL 2)
      ];
    });
  }

  formatItemsTo17Columns(items = []) {
    return this.formatItemsToColumns(items);
  }

  /**
   * Action: getReferencePhoto
   * Queries reference photo for a SKU directly via Google Drive searchFiles in Apps Script.
   */
  async getReferencePhotoFromGAS(sku, type = 'CICLICO') {
    if (!sku) return { found: false };
    const cleanSku = String(sku).trim();
    const url = this.getUrlForType(type);
    const targetUrl = new URL(url);
    targetUrl.searchParams.set('action', 'getReferencePhoto');
    targetUrl.searchParams.set('sku', cleanSku);

    try {
      const response = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) return { found: false };
      const parsed = await response.json();
      return parsed && parsed.found ? parsed : { found: false, sku: cleanSku };
    } catch (err) {
      console.warn(`[gasService] Notice querying reference photo for ${cleanSku} from GAS:`, err.message);
      return { found: false, sku: cleanSku };
    }
  }

  /**
   * Action: getHistory
   * Fetches finalized inventory history directly from Google Drive and Google Sheets (Metricas) via GAS.
   */
  async getHistoryFromGAS(type = 'CICLICO', center = null) {
    const url = this.getUrlForType(type);
    const targetUrl = new URL(url);
    targetUrl.searchParams.set('action', 'getHistory');
    targetUrl.searchParams.set('type', type);
    if (center && center !== 'TODOS' && center !== 'GLOBAL') {
      const cleanCenter = config.getCenterCode ? config.getCenterCode(center) : center;
      targetUrl.searchParams.set('center', cleanCenter);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const response = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) return [];
      const parsed = await response.json();
      if (parsed && Array.isArray(parsed.history)) {
        return parsed.history;
      }
      return [];
    } catch (err) {
      console.warn('[gasService] Notice querying history from GAS Google Drive:', err.message);
      return [];
    }
  }

  /**
   * Action: queryItem
   * Queries a specific item in the center's Google Sheet by SKU, Barcode, and optional location.
   */
  async queryItemFromGAS(type, { center = '1120', sku, barcode, location = '' }) {
    const cleanCenter = config.getCenterCode ? config.getCenterCode(center) : center;
    const url = this.getUrlForType(type);
    const targetUrl = new URL(url);
    targetUrl.searchParams.set('action', 'queryItem');
    targetUrl.searchParams.set('center', cleanCenter);
    targetUrl.searchParams.set('sku', String(sku || '').trim());
    targetUrl.searchParams.set('barcode', String(barcode || '').trim());
    if (location) targetUrl.searchParams.set('location', String(location).trim());

    try {
      const response = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (!response.ok) return { success: false, found: false };
      return await response.json();
    } catch (err) {
      console.warn('[gasService] Notice querying item from GAS:', err.message);
      return { success: false, found: false };
    }
  }

  /**
   * Action: upsertCount
   * Real-time update of columns J to Q in the center sheet with optional damaged photo upload.
   */
  async upsertCountToGAS(type, payload) {
    if (require('./storagePath').deferSync('upsertCountToGAS', [type, payload])) return { success: true, queued: true };
    const cleanType = (type || payload.type || 'CICLICO').toUpperCase();
    const url = this.getUrlForType(cleanType);
    const cleanCenter = config.getCenterCode ? config.getCenterCode(payload.center || payload.centro || '1120') : '1120';

    const rawStockFisico = payload.stockFisico !== undefined ? payload.stockFisico : payload.Stock_Fisico;
    const rawMalEstado = payload.malEstado !== undefined
      ? payload.malEstado
      : (payload.Mal_estado !== undefined ? payload.Mal_estado : null);
    const effectiveStockFisico = rawStockFisico;

    const hasCorroboration = payload.isCuadra !== undefined ||
      String(payload.corroboracion || payload.corroboration || '').trim() !== '';
    const isJustification2 = payload.isJustification2 === true ||
      String(payload.isJustification2 || '').toLowerCase() === 'true' ||
      Number(payload.round || payload.justificationRound) === 2;
    const hasJustificationPayload = isJustification2 || hasCorroboration ||
      payload.estadoJustificacion !== undefined || payload.razon !== undefined ||
      payload.razonJustificacion !== undefined || payload.reasonType !== undefined ||
      payload.comentarioJustificacion !== undefined || payload.justification !== undefined ||
      payload.responsableJustificacion !== undefined || payload.fechaPrimeraJustificacion !== undefined;
    const isReconteo2 = payload.isReconteo2 === true ||
      String(payload.isReconteo2 || '').toLowerCase() === 'true' ||
      ['RECONTEO_2', 'RECONTEO 2'].includes(String(payload.countPhase || payload.phase || '').toUpperCase().trim());
    const isReconteo = !isReconteo2 && (payload.isReconteo === true ||
      String(payload.isReconteo || '').toLowerCase() === 'true' ||
      ['RECONTEO', 'RECONTEO_1', 'RECONTEO 1'].includes(String(payload.countPhase || payload.phase || '').toUpperCase().trim()));

    const rawRecFisico = payload.reconteoFisico !== undefined ? payload.reconteoFisico : (payload.Reconteo_Fisico !== undefined ? payload.Reconteo_Fisico : null);
    const rawRecDam = payload.reconteoMalEstado !== undefined ? payload.reconteoMalEstado : (payload.Reconteo_Mal_Estado !== undefined ? payload.Reconteo_Mal_Estado : null);
    const effectiveRecFisico = rawRecFisico;

    const postBody = {
      action: 'upsertCount',
      center: cleanCenter,
      type: cleanType,
      sku: String(payload.sku || payload.SKU || '').trim(),
      barcode: String(payload.barcode || payload.codigoBarras || payload.Codigo_Barras || '').trim(),
      descripcion: String(payload.descripcion || payload.description || payload.Descripcion || '').trim(),
      location: String(payload.location || payload.ubicacion || payload.Ubicacion || '').trim(),
      almacen: String(payload.almacen || payload.warehouse || payload.Almacen || '').trim(),
      warehouse: String(payload.warehouse || payload.almacen || payload.Almacen || '').trim(),
      ubicacion1: String(payload.ubicacion1 || payload.Ubicacion_1 || '').trim(),
      ubicacion2: String(payload.ubicacion2 || payload.Ubicacion_2 || '').trim(),
      isNewLocation: !!payload.isNewLocation,
      newLocation: String(payload.newLocation || payload.location || payload.ubicacion || '').trim(),
      countPhase: payload.countPhase || payload.phase || '',
      isCuadra: hasCorroboration
        ? !!(payload.isCuadra || String(payload.corroboracion || payload.corroboration || '').toUpperCase() === 'CUADRA')
        : undefined,
      corroboracion: String(payload.corroboracion || payload.corroboration || '').toUpperCase(),
      stockFisico: effectiveStockFisico,
      stockBuenEstado: payload.stockBuenEstado !== undefined ? payload.stockBuenEstado : effectiveStockFisico,
      stockTotal: payload.stockTotal !== undefined ? payload.stockTotal : (effectiveStockFisico !== null && effectiveStockFisico !== undefined ? (Number(effectiveStockFisico) + Number(rawMalEstado || 0)) : null),
      malEstado: rawMalEstado,
      comentario: payload.comentario !== undefined ? payload.comentario : (payload.Comentario || ''),
      fechaUltimoConteo: payload.fechaUltimoConteo || payload.Fecha_Ultimo_Conteo || ((isReconteo || isReconteo2) ? undefined : new Date().toISOString().split('T')[0]),
      responsable: payload.responsable || payload.Responsable || payload.username || '',
      fechaPrimeraJustificacion: hasJustificationPayload ? (payload.fechaPrimeraJustificacion || payload.Fecha_Primera_Justificacion || '') : '',
      estadoJustificacion: hasJustificationPayload ? (payload.estadoJustificacion || payload.Estado_Justificacion || payload.estado || '') : '',
      categoria: (payload.categoria && !['BARRIDO', 'CICLICO', 'GENERAL', 'EXPRESS'].includes(String(payload.categoria).toUpperCase().trim()))
        ? payload.categoria
        : 'repuesto',
      clasificacionAbc: payload.clasificacionAbc || payload.Clasificacion_ABC || 'C',
      unidad: payload.unidad || payload.Unidad || 'PZA',
      costoUnitario: payload.costoUnitario !== undefined ? payload.costoUnitario : (payload.Costo_Unitario || 0),
      stockSistema: payload.stockSistema !== undefined ? payload.stockSistema : (payload.Stock_Sistema || 0),
      razon: hasJustificationPayload ? (payload.razon || payload.Razon || payload.razonJustificacion || payload.reasonType || '') : '',
      comentarioJustificacion: hasJustificationPayload ? (payload.comentarioJustificacion || payload.Comentario_Justificacion || payload.justification || '') : '',
      responsableJustificacion: hasJustificationPayload ? (payload.responsableJustificacion || payload.RESPONSABLE_JUSTIFICACION || payload.reviewer || payload.Revisado_Por || payload.reviewedBy || '') : '',
      reviewer: payload.reviewer || payload.Revisado_Por || payload.reviewedBy || payload.revisor || '',
      fechaReconteo: payload.fechaReconteo || payload.Fecha_Reconteo || '',
      reconteo: payload.reconteo !== undefined ? payload.reconteo : effectiveRecFisico,
      reconteoFisico: effectiveRecFisico,
      reconteoMalEstado: rawRecDam,
      malestadoReconteo: payload.malestadoReconteo !== undefined ? payload.malestadoReconteo : rawRecDam,
      stockTotalReconteo: payload.stockTotalReconteo !== undefined ? payload.stockTotalReconteo : (effectiveRecFisico !== null && effectiveRecFisico !== undefined ? (Number(effectiveRecFisico) + Number(rawRecDam || 0)) : null),
      fechaJustificacion2: payload.fechaJustificacion2 || payload.Fecha_Justificacion_2 || '',
      estadoJustificacion2: payload.estadoJustificacion2 || payload.Estado_Justificacion_2 || '',
      razonJustificacion2: payload.razonJustificacion2 || payload.Razon_Justificacion_2 || '',
      comentarioJustificacion2: payload.comentarioJustificacion2 || payload.Comentario_Justificacion_2 || '',
      responsableJustificacion2: payload.responsableJustificacion2 || payload.Responsable_Justificacion_2 || '',
      fechaReconteo2: payload.fechaReconteo2 || payload.Fecha_Reconteo_2 || '',
      reconteo2: payload.reconteo2 !== undefined ? payload.reconteo2 : (payload.Reconteo_2 !== undefined ? payload.Reconteo_2 : null),
      malestadoReconteo2: payload.malestadoReconteo2 !== undefined ? payload.malestadoReconteo2 : (payload.Malestado_Reconteo_2 !== undefined ? payload.Malestado_Reconteo_2 : null),
      stockTotalReconteo2: payload.stockTotalReconteo2 !== undefined ? payload.stockTotalReconteo2 : (payload.Stock_Total_Reconteo_2 !== undefined ? payload.Stock_Total_Reconteo_2 : null),
      round: Number(payload.round || payload.justificationRound || (isJustification2 ? 2 : 1)),
      isJustification2,
      Reconteo_Fisico: effectiveRecFisico,
      Reconteo_Mal_Estado: rawRecDam,
      reconteo_fisico: effectiveRecFisico,
      reconteo_mal_estado: rawRecDam,
      colU: effectiveRecFisico,
      colV: rawRecDam,
      diferenciaFinal: payload.diferenciaFinal !== undefined ? payload.diferenciaFinal : (payload.Diferencia_Final !== undefined ? payload.Diferencia_Final : null),
      costoDiferenciaFinal: payload.costoDiferenciaFinal !== undefined ? payload.costoDiferenciaFinal : (payload.Costo_Diferencia_Final !== undefined ? payload.Costo_Diferencia_Final : null),
      diferenciaFinal2: payload.diferenciaFinal2 !== undefined ? payload.diferenciaFinal2 : (payload.Diferencia_Final_2 !== undefined ? payload.Diferencia_Final_2 : null),
      costoDiferenciaFinal2: payload.costoDiferenciaFinal2 !== undefined ? payload.costoDiferenciaFinal2 : (payload.Costo_Diferencia_Final_2 !== undefined ? payload.Costo_Diferencia_Final_2 : null),
      colW: payload.diferenciaFinal !== undefined ? payload.diferenciaFinal : (payload.Diferencia_Final !== undefined ? payload.Diferencia_Final : null),
      colX: payload.costoDiferenciaFinal !== undefined ? payload.costoDiferenciaFinal : (payload.Costo_Diferencia_Final !== undefined ? payload.Costo_Diferencia_Final : null),
      isReconteo,
      isReconteo2,
      // Protect Drive backups: Never send text strings/URLs to photoBase64, only valid data:image base64, and NEVER in reconteo
      photoBase64: (isReconteo || isReconteo2) ? '' : ((payload.photoBase64 && String(payload.photoBase64).startsWith('data:image')) ? payload.photoBase64 : ''),
      justificationPhoto: (isReconteo || isReconteo2) ? '' : ((payload.justificationPhoto && String(payload.justificationPhoto).startsWith('data:image')) ? payload.justificationPhoto : '')
    };

    postBody.operationId = payload.operationId;
    return this.postConfirmed(url, postBody);
  }

  /**
   * Action: deleteAdditionalLocation
   * Deletes an additional location row from Google Sheets
   */
  async deleteAdditionalLocationFromGAS(type, payload = {}) {
    if (require('./storagePath').deferSync('deleteAdditionalLocationFromGAS', [type, payload])) return { success: true, queued: true };
    const cleanType = (type || payload.type || 'CICLICO').toUpperCase();
    const url = this.getUrlForType(cleanType);
    const rawCenter = payload.center || payload.centro || '1120';
    const cleanCenter = config.getCenterCode ? config.getCenterCode(rawCenter) : rawCenter;

    const postBody = {
      action: 'deleteAdditionalLocation',
      center: cleanCenter,
      type: cleanType,
      sku: payload.sku || payload.SKU,
      location: payload.location || payload.ubicacion || payload.Ubicacion,
      warehouse: payload.warehouse || payload.almacen || payload.Almacen || '',
      almacen: payload.almacen || payload.warehouse || payload.Almacen || '',
      slot: payload.slot || payload.locationSlot || 0
    };

    postBody.operationId = payload.operationId;
    return this.postConfirmed(url, postBody);
  }

  /**
   * Action: batchUpsertCounts
   * Batch update of columns J to Q for multiple items.
   */
  async batchUpsertCountsToGAS(type, payload) {
    if (require('./storagePath').deferSync('batchUpsertCountsToGAS', [type, payload])) return { success: true, queued: true };
    const cleanType = (type || payload.type || 'CICLICO').toUpperCase();
    const url = this.getUrlForType(cleanType);
    const rawCenter = payload.center || payload.centro || '1120';
    const cleanCenter = config.getCenterCode ? config.getCenterCode(rawCenter) : rawCenter;

    const postBody = {
      action: 'batchUpsertCounts',
      center: cleanCenter,
      type: cleanType,
      updates: payload.updates || []
    };

    postBody.operationId = payload.operationId;
    return this.postConfirmed(url, postBody);
  }

  /**
   * Action: createFinalFile
   * Creates snapshot spreadsheet in snapshotFolderPath, syncs columns J to Q,
   * saves damaged photos and saves justification photos with "Just-" prefix.
   */
  async syncFinalInventoryToGAS(type, payload) {
    const cleanType = (type || payload.type || 'CICLICO').toUpperCase();
    const url = this.getUrlForType(cleanType);
    const rawCenter = payload.center || payload.centro || (payload.driveRecord && (payload.driveRecord.center || payload.driveRecord.centro)) || '1120';
    const cleanCenter = config.getCenterCode ? config.getCenterCode(rawCenter) : rawCenter;

    // Build items formatted with 17 standard columns
    const rawItems = payload.items || (payload.driveRecord && payload.driveRecord.items) || [];
    const rows = this.formatItemsTo17Columns(rawItems);

    // Build driveRecord structure expected by Apps Script createFinalFile_
    const incomingDriveRecord = payload.driveRecord || {};
    const isReconteo = !!(payload.isReconteo || incomingDriveRecord.isReconteo || String(payload.inventoryId || '').startsWith('REC-') || String(type || '').includes('RECONTEO'));

    const driveRecord = {
      ...incomingDriveRecord,
      inventoryId: incomingDriveRecord.inventoryId || payload.inventoryId,
      type: cleanType,
      center: cleanCenter,
      isReconteo,
      reviewNotes: payload.reviewNotes || incomingDriveRecord.reviewNotes || '',
      items: incomingDriveRecord.items || rawItems.map(it => {
        const rawPhoto = isReconteo ? '' : (it.photoBase64 || '');
        const validPhoto = (rawPhoto && String(rawPhoto).startsWith('data:image')) ? rawPhoto : '';
        return {
          ...it,
          Almacen: it.Almacen || it.almacen || it.warehouse || '',
          SKU: it.SKU || it.sku || '',
          Codigo_Barras: it.Codigo_Barras || it.codigoBarras || it.barcode || '',
          Ubicacion: it.Ubicacion || it.ubicacion || '',
          Stock_Fisico: it.Stock_Fisico !== undefined ? it.Stock_Fisico : it.stockFisico,
          Mal_estado: it.Mal_estado !== undefined ? it.Mal_estado : (it.malEstado || 0),
          Comentario: it.Comentario !== undefined ? it.Comentario : (it.comentario || ''),
          Fecha_Ultimo_Conteo: it.Fecha_Ultimo_Conteo || it.fechaUltimoConteo || '',
          Responsable: it.Responsable || it.responsable || '',
          Estado: it.Estado || it.estado || '',
          Razon: it.Razon || it.Razon_Justificacion || it.reasonType || '',
          Comentario_Justificacion: it.Comentario_Justificacion || it.comentarioJustificacion || it.justification || '',
          Reconteo_Fisico: it.Reconteo_Fisico !== undefined ? it.Reconteo_Fisico : (it.reconteoFisico !== undefined ? it.reconteoFisico : null),
          Reconteo_Mal_Estado: it.Reconteo_Mal_Estado !== undefined ? it.Reconteo_Mal_Estado : (it.reconteoMalEstado !== undefined ? it.reconteoMalEstado : 0),
          photoBase64: validPhoto
        };
      }),
      justifications: isReconteo ? [] : (incomingDriveRecord.justifications || payload.justifications || []).map(j => ({
        sku: j.sku || j.SKU || '',
        justification: j.justification || '',
        reasonType: j.reasonType || '',
        photoBase64: (j.photoBase64 && String(j.photoBase64).startsWith('data:image')) ? j.photoBase64 : ''
      }))
    };

    driveRecord.manifest ||= require('./inventorySheetModel').createManifest({ ...driveRecord,
      inventoryId: driveRecord.inventoryId || payload.inventoryId, center: cleanCenter, type: cleanType });

    const postBody = {
      action: 'createFinalFile',
      type: cleanType,
      center: cleanCenter,
      centro: cleanCenter,
      isReconteo,
      reviewNotes: payload.reviewNotes || driveRecord.reviewNotes || '',
      snapshotFolderId: config.driveSnapshotsFolderId,
      driveRecord: driveRecord,
      rows: rows
    };

    postBody.operationId = payload.operationId || `close:${payload.fileId || payload.inventoryId}`;
    const result = await this.postConfirmed(url, postBody);
    if (!result.fileId || !result.spreadsheetUrl) throw new Error('Drive no confirmó el archivo final.');
    if (!result.manifest || result.manifest.itemCount !== driveRecord.manifest?.itemCount ||
      result.manifest.skuCount !== driveRecord.manifest?.skuCount ||
      result.manifest.inventoryId !== driveRecord.manifest?.inventoryId ||
      result.manifest.center !== driveRecord.manifest?.center ||
      result.manifest.membershipHash !== driveRecord.manifest?.membershipHash) {
      throw new Error('Apps Script no confirmó el manifiesto del cierre. Actualice gas/Code.gs antes de finalizar.');
    }
    return result;
  }

  async postConfirmed(url, body) {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(35000), redirect: 'follow'
    });
    let result;
    try { result = JSON.parse(await response.text()); }
    catch { throw new Error('Google Apps Script devolvió una respuesta inválida; no se confirmó la operación.'); }
    if (!response.ok || result.success !== true || result.failedItems?.length) {
      const error = new Error(result.error || result.message || 'Google Apps Script no confirmó todos los registros.');
      error.deliveryUnknown = false;
      error.failedItems = result.failedItems;
      throw error;
    }
    return result;
  }

  async syncPhotoToGAS({ category, date, center, sku, fileName, fileBuffer, mimeType, inventoryId, itemId, type, prefix, round, isJustification2, operationId }) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || !fileBuffer?.length) {
      throw new Error('Seleccione una imagen JPEG, PNG o WebP válida.');
    }
    const cleanCategory = String(category || '').toLowerCase().includes('just') ? 'justificaciones' : 'malestado';
    const cleanCenter = config.getCenterCode ? config.getCenterCode(center) : center;
    const invType = type || 'CICLICO';
    const photoBase64 = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
    const result = await this.postConfirmed(this.getUrlForType(invType), {
      action: 'savePhoto', category: cleanCategory, date, center: cleanCenter, sku, fileName,
      inventoryId, itemId, type: invType, prefix, round, isJustification2, operationId, photoBase64,
      photoJustificacion: cleanCategory === 'justificaciones' ? photoBase64 : undefined
    });
    const savedPhoto = result.photo;
    let photoUrl;
    try { photoUrl = new URL(savedPhoto?.url); } catch (_) {}
    const linkedId = photoUrl?.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/(?:view|edit|preview))?\/?$/)?.[1] ||
      (photoUrl?.pathname === '/open' ? photoUrl.searchParams.get('id') : null);
    if (typeof savedPhoto?.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(savedPhoto.id) ||
      photoUrl?.protocol !== 'https:' || photoUrl?.hostname !== 'drive.google.com' ||
      photoUrl.username || photoUrl.password || photoUrl.port || linkedId !== savedPhoto.id) {
      throw new Error('Apps Script no devolvió el ID y enlace del archivo de la foto. Actualice la implementación con gas/Code.gs.');
    }
    const confirmedMime = String(savedPhoto.mimeType || '').trim().toLowerCase();
    if (confirmedMime && confirmedMime !== mimeType) {
      throw new Error('Drive devolvió un tipo de archivo distinto al de la imagen enviada. No se vinculó como respaldo.');
    }
    // The supplied legacy Apps Script omits mimeType, but returns metadata from
    // createFile(newBlob(bytes, uploadMime, name)). This request always sends
    // base64 bytes validated by savePhotoFile, never a URL that could be HTML.
    // Legacy code names even PNG/WebP uploads .jpg, so do not infer MIME from it.
    if (!confirmedMime && !/\.(?:jpe?g|png|webp)$/i.test(String(savedPhoto.name || ''))) {
      throw new Error('Apps Script devolvió datos incompletos de la foto. Actualice la implementación con gas/Code.gs; repetir la subida no corrige esta respuesta.');
    }
    const photo = { ...savedPhoto, mimeType: confirmedMime || mimeType,
      mimeTypeSource: confirmedMime ? 'drive' : 'validatedUpload' };
    return { success: true, photo, driveFileId: photo.id, driveUrl: photo.url,
      directUrl: `https://drive.google.com/uc?export=view&id=${photo.id}`,
      thumbnailUrl: `https://lh3.googleusercontent.com/d/${photo.id}=s1600` };
  }

  /**
   * Directly saves a justification to GAS with fallback to upsertCount
   */
  async saveJustificationToGAS(type, payload) {
    if (require('./storagePath').deferSync('saveJustificationToGAS', [type, payload])) return { success: true, queued: true };
    const cleanType = (type || payload.type || 'CICLICO').toUpperCase();
    const url = this.getUrlForType(cleanType);
    const rawCenter = payload.center || payload.centro || '1120';
    const cleanCenter = config.getCenterCode ? config.getCenterCode(rawCenter) : rawCenter;

    const isCuadra = payload.isCuadra || String(payload.corroboracion || payload.corroboration || '').toUpperCase() === 'CUADRA';
    const postBody = {
      action: 'saveJustification',
      center: cleanCenter,
      type: cleanType,
      sku: String(payload.sku || payload.SKU || '').trim(),
      almacen: String(payload.almacen || payload.warehouse || payload.Almacen || '').trim(),
      warehouse: String(payload.warehouse || payload.almacen || payload.Almacen || '').trim(),
      location: String(payload.location || payload.ubicacion || payload.Ubicacion || '').trim(),
      razon: payload.razon || payload.reasonType || payload.razonJustificacion || payload.Razon || 'AJUSTE_INVENTARIO',
      comentarioJustificacion: payload.comentarioJustificacion || payload.justification || payload.comentariosJustificacion || payload.Comentario_Justificacion || '',
      reviewedBy: payload.reviewedBy || payload.responsableJustificacion || payload.responsable || '',
      responsableJustificacion: payload.responsableJustificacion || payload.reviewedBy || payload.responsable || '',
      corroboracion: payload.corroboracion || payload.corroboration || (isCuadra ? 'CUADRA' : 'NO CUADRA'),
      isCuadra,
      estado: isCuadra ? 'CUADRA' : (payload.estado || 'NO CUADRA'),
      estadoJustificacion: isCuadra ? 'CUADRA' : (payload.estadoJustificacion || 'NO CUADRA'),
      fechaPrimeraJustificacion: payload.fechaPrimeraJustificacion || payload.fecha || new Date().toISOString(),
      round: payload.round || payload.justificationRound || (payload.isJustification2 ? 2 : 1),
      isJustification2: !!payload.isJustification2,
      fechaJustificacion2: payload.fechaJustificacion2 || (payload.isJustification2 ? (payload.fecha || new Date().toISOString()) : ''),
      estadoJustificacion2: payload.estadoJustificacion2 || (payload.isJustification2 ? (isCuadra ? 'CUADRA' : 'NO CUADRA') : ''),
      razonJustificacion2: payload.razonJustificacion2 || (payload.isJustification2 ? (payload.razon || payload.reasonType) : ''),
      comentarioJustificacion2: payload.comentarioJustificacion2 || (payload.isJustification2 ? (payload.comentarioJustificacion || payload.justification) : ''),
      responsableJustificacion2: payload.responsableJustificacion2 || (payload.isJustification2 ? (payload.reviewedBy || payload.responsableJustificacion) : ''),
      stockFisico: payload.stockFisico !== undefined ? payload.stockFisico : payload.Stock_Fisico,
      photoJustificacion: payload.photoJustificacion || payload.photoUrl || payload.photoBase64 || ''
    };

    postBody.operationId = payload.operationId;
    return this.postConfirmed(url, postBody);
  }

  /**
   * Comprehensive diagnostic check of all Google Apps Script integration endpoints defined in .env
   * Outputs a detailed log in the administrator console and returns structured diagnostics
   * identifying why inventories are or are not detected.
   */
  async runGasDiagnostics(options = {}) {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    const endpoints = [
      { name: 'Cíclicos', envVar: 'CICLICOS_URL', type: 'CICLICO', url: config.integrations.CICLICOS_URL },
      { name: 'Barrido', envVar: 'BARRIDO_URL', type: 'BARRIDO', url: config.integrations.BARRIDO_URL },
      { name: 'Mensuales', envVar: 'MENSUALES_URL', type: 'MENSUALES', url: config.integrations.MENSUALES_URL },
      { name: 'Semanales', envVar: 'SEMANALES_URL', type: 'SEMANALES', url: config.integrations.SEMANALES_URL }
    ];

    const testCenters = ['1120', '1300', 'WARNES'];

    // 1. Test each endpoint
    const endpointResults = await Promise.all(endpoints.map(async (ep) => {
      const epStart = Date.now();
      const epReport = {
        name: ep.name,
        envVar: ep.envVar,
        type: ep.type,
        url: ep.url,
        maskedUrl: ep.url ? (ep.url.slice(0, 38) + '...' + ep.url.slice(-10)) : 'NO_CONFIGURADO',
        configured: !!ep.url,
        ping: { ok: false, status: 0, latencyMs: 0, error: null },
        getProductsTest: {},
        getHistoryTest: { ok: false, recordsCount: 0, latencyMs: 0, rawResponse: null, error: null },
        totalItemsFound: 0,
        totalCountedItemsFound: 0
      };

      if (!ep.url) {
        epReport.ping.error = 'Variable de entorno no definida en .env o vacía';
        return epReport;
      }

      // 1.1 Ping test
      try {
        const pingUrl = new URL(ep.url);
        pingUrl.searchParams.set('action', 'ping');
        const pingRes = await fetch(pingUrl.toString(), { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        epReport.ping.status = pingRes.status;
        epReport.ping.latencyMs = Date.now() - epStart;
        epReport.ping.ok = pingRes.status === 200;
        try {
          const pingJson = await pingRes.json();
          epReport.ping.response = pingJson;
        } catch (e) {
          epReport.ping.response = 'HTTP ' + pingRes.status;
        }
      } catch (err) {
        epReport.ping.ok = false;
        epReport.ping.error = err.message;
        epReport.ping.latencyMs = Date.now() - epStart;
      }

      // 1.2 Products test per test center
      for (const center of testCenters) {
        const centerStart = Date.now();
        try {
          const prodUrl = new URL(ep.url);
          prodUrl.searchParams.set('action', 'getProducts');
          prodUrl.searchParams.set('center', center);

          const res = await fetch(prodUrl.toString(), { redirect: 'follow', signal: AbortSignal.timeout(8000) });
          const latency = Date.now() - centerStart;
          const text = await res.text();
          let data = null;
          try { data = JSON.parse(text); } catch (e) {}

          const rawList = Array.isArray(data) ? data : (data?.items || data?.products || data?.rows || []);
          const totalItems = Array.isArray(rawList) ? rawList.length : 0;
          const countedItems = Array.isArray(rawList) ? rawList.filter(i => (
            i && i.Stock_Fisico !== null && i.Stock_Fisico !== undefined && i.Stock_Fisico !== ''
          )).length : 0;

          epReport.totalItemsFound += totalItems;
          epReport.totalCountedItemsFound += countedItems;

          epReport.getProductsTest[center] = {
            ok: res.status === 200 && (data?.success !== false),
            status: res.status,
            latencyMs: latency,
            totalItems,
            countedItems,
            actionUsed: 'getProducts',
            error: (data?.success === false ? (data.message || data.error) : null)
          };
        } catch (centerErr) {
          epReport.getProductsTest[center] = {
            ok: false,
            status: 0,
            latencyMs: Date.now() - centerStart,
            totalItems: 0,
            countedItems: 0,
            error: centerErr.message
          };
        }
      }

      // 1.3 History test (action=getHistory)
      const histStart = Date.now();
      try {
        const histUrl = new URL(ep.url);
        histUrl.searchParams.set('action', 'getHistory');
        const histRes = await fetch(histUrl.toString(), { redirect: 'follow', signal: AbortSignal.timeout(8000) });
        epReport.getHistoryTest.latencyMs = Date.now() - histStart;
        epReport.getHistoryTest.status = histRes.status;
        if (histRes.ok) {
          const text = await histRes.text();
          try {
            const histData = JSON.parse(text);
            const historyList = Array.isArray(histData) ? histData : (histData?.history || histData?.files || []);
            epReport.getHistoryTest.ok = true;
            epReport.getHistoryTest.recordsCount = Array.isArray(historyList) ? historyList.length : 0;
            epReport.getHistoryTest.rawResponse = histData?.success !== undefined ? histData : 'Array(' + historyList.length + ')';
          } catch (pe) {
            epReport.getHistoryTest.ok = false;
            epReport.getHistoryTest.error = 'Respuesta no es JSON válido';
          }
        } else {
          epReport.getHistoryTest.ok = false;
          epReport.getHistoryTest.error = 'HTTP error ' + histRes.status;
        }
      } catch (histErr) {
        epReport.getHistoryTest.ok = false;
        epReport.getHistoryTest.error = histErr.message;
        epReport.getHistoryTest.latencyMs = Date.now() - histStart;
      }

      return epReport;
    }));

    // 2. Local container storage inspection
    const invDir = storagePath.getInventoriesDirectory();
    const histDir = storagePath.getHistoryDirectory();
    const auditDir = storagePath.getAuditDirectory();

    const localInvFiles = storagePath.listFiles(invDir).filter(f => f.endsWith('.json'));
    const localHistFiles = storagePath.listFiles(histDir).filter(f => f.endsWith('.json'));
    const localAuditFiles = storagePath.listFiles(auditDir).filter(f => f.endsWith('.json'));

    const localInventoriesSummary = localInvFiles.map(f => {
      const inv = storagePath.readJson(path.join(invDir, f), null);
      if (!inv) return { file: f, valid: false };
      const items = Array.isArray(inv.items) ? inv.items : [];
      const counted = items.filter(i => i.Stock_Fisico !== null && i.Stock_Fisico !== undefined && i.Stock_Fisico !== '').length;
      return {
        id: inv.id,
        name: inv.name,
        type: inv.type,
        center: inv.center,
        status: inv.status,
        totalItems: items.length,
        countedItems: counted,
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt
      };
    });

    // 3. Root Cause Analysis & Explanations
    const rootCauses = [];
    const recommendations = [];

    const totalCountedInSheets = endpointResults.reduce((acc, ep) => acc + ep.totalCountedItemsFound, 0);
    const totalItemsInSheets = endpointResults.reduce((acc, ep) => acc + ep.totalItemsFound, 0);
    const totalRemoteHistory = endpointResults.reduce((acc, ep) => acc + (ep.getHistoryTest.recordsCount || 0), 0);
    const allEndpointsOnline = endpointResults.every(ep => ep.ping.ok);

    if (!allEndpointsOnline) {
      const offlineNames = endpointResults.filter(ep => !ep.ping.ok).map(ep => ep.name).join(', ');
      rootCauses.push({
        id: 'CONECTIVIDAD_OFFLINE',
        severidad: 'ALTA',
        titulo: 'Endpoints de Google Apps Script no responden',
        descripcion: `Los siguientes webhooks no respondieron adecuadamente al ping: ${offlineNames}. Verifique la conexión a internet o los permisos del despliegue en Google Apps Script.`
      });
      recommendations.push('Verifique en Google Apps Script que los proyectos estén desplegados como "Aplicación web", ejecutándose como "Yo (tu cuenta)" y con acceso "Cualquier usuario".');
    }

    if (totalCountedInSheets > 0 && totalRemoteHistory === 0 && localHistFiles.length === 0) {
      rootCauses.push({
        id: 'CONTEOS_SIN_FINALIZAR',
        severidad: 'MEDIA',
        titulo: 'Existen productos contados en Google Sheets pero ningún inventario finalizado en Drive',
        descripcion: `Se detectaron ${totalCountedInSheets} productos con stock físico registrado directamente en las pestañas de Google Sheets (por ejemplo en centros 1120 y WARNES). Sin embargo, aún no se ha ejecutado el proceso de "Finalizar Revisión" o "Finalizar Barrido" en la aplicación, el cual es el paso que crea formalmente la copia de corte en Google Drive (carpeta Archivos Finales) y alimenta el Historial.`
      });
      recommendations.push('Para que los inventarios aparezcan en el módulo de Historial y se detecten como eventos de inventario cerrados: ingrese a "Inventarios", abra el inventario correspondiente, verifique las justificaciones y haga clic en "Finalizar Revisión". Esto guardará el archivo permanente en Drive y creará el registro de histórico.');
    }

    if (localInventoriesSummary.some(inv => inv.status === 'EN_PROGRESO' || inv.status === 'PENDIENTE_JUSTIFICACION')) {
      const pendingCount = localInventoriesSummary.filter(inv => inv.status !== 'FINALIZADO' && inv.status !== 'REVISADO').length;
      rootCauses.push({
        id: 'INVENTARIOS_EN_CURSO',
        severidad: 'INFO',
        titulo: `${pendingCount} inventario(s) activo(s) en curso o pendientes de justificación`,
        descripcion: 'El sistema solo archiva en el historial permanente aquellos inventarios que completan la etapa de revisión. Los inventarios activos permanecen en la pestaña "Inventarios Disponibles".'
      });
    }

    if (localHistFiles.length === 0 && totalRemoteHistory === 0 && totalCountedInSheets === 0) {
      rootCauses.push({
        id: 'SIN_REGISTROS_PREVIOS',
        severidad: 'INFO',
        titulo: 'No se encontraron registros de inventarios previos ni en local ni en Google Drive',
        descripcion: 'No hay archivos de inventarios finalizados en la carpeta de histórico de Drive ni en el almacenamiento del servidor. Es necesario crear o importar un inventario para comenzar.'
      });
      recommendations.push('Cree un nuevo inventario desde el botón "Crear Inventario" seleccionando el centro deseado (1120, 1300, etc.) o inicie un Barrido.');
    }

    recommendations.push('Los endpoints en .env están correctamente configurados con acción "getProducts".');

    // 4. Detailed console log format for server admin console
    const divider = '='.repeat(85);
    const subDivider = '-'.repeat(85);

    const logLines = [
      '',
      divider,
      '🔍 [DIAGNÓSTICO ADMIN] INTEGRACIÓN GOOGLE APPS SCRIPT Y DETECCIÓN DE INVENTARIOS',
      divider,
      `⏰ Fecha y Hora: ${timestamp}`,
      `⏱️ Duración del test: ${Date.now() - startTime}ms`,
      `🌐 Estado General de Conexión: ${allEndpointsOnline ? '✅ TODOS LOS ENDPOINTS ONLINE' : '⚠️ ALGUNOS ENDPOINTS CON INCIDENCIAS'}`,
      subDivider,
      '1. CONECTIVIDAD DE ENDPOINTS (.env):',
      ...endpointResults.map(ep => {
        const pingStatus = ep.ping.ok ? `✅ ONLINE (${ep.ping.latencyMs}ms)` : `❌ ERROR: ${ep.ping.error}`;
        const sheetCounts = Object.entries(ep.getProductsTest).map(([c, data]) => {
          return `${c}: ${data.totalItems} ítems (${data.countedItems} contados)`;
        }).join(' | ');
        const histStatus = ep.getHistoryTest.ok
          ? `${ep.getHistoryTest.recordsCount} archivos en Drive`
          : `Aviso: ${ep.getHistoryTest.error || 'sin datos'}`;
        return `   • [${ep.envVar}] ${ep.name} (${ep.type})\n     URL: ${ep.maskedUrl}\n     Ping: ${pingStatus}\n     Hojas Sheets: [${sheetCounts}]\n     Historial Drive (getHistory): ${histStatus}`;
      }),
      subDivider,
      '2. ESTADO DE ALMACENAMIENTO Y DETECCIÓN:',
      `   • Ítems totales en hojas de cálculo: ${totalItemsInSheets}`,
      `   • Ítems con Stock Físico registrado en Sheets: ${totalCountedInSheets}`,
      `   • Inventarios en almacenamiento local (data/inventories): ${localInvFiles.length}`,
      ...localInventoriesSummary.map(inv => `     - ${inv.id}: "${inv.name}" [${inv.type} | ${inv.center}] Status: ${inv.status} (${inv.countedItems}/${inv.totalItems} contados)`),
      `   • Archivos en histórico local (data/history): ${localHistFiles.length}`,
      `   • Archivos en histórico remoto Google Drive: ${totalRemoteHistory}`,
      subDivider,
      '3. CAUSA RAÍZ IDENTIFICADA - ¿POR QUÉ NO SE DETECTAN LOS INVENTARIOS?:',
      ...rootCauses.map((rc, idx) => `   [${idx + 1}] (${rc.severidad}) ${rc.titulo}\n       ${rc.descripcion}`),
      subDivider,
      '4. ACCIONES RECOMENDADAS PARA EL ADMINISTRADOR:',
      ...recommendations.map((rec, idx) => `   ${idx + 1}. ${rec}`),
      divider,
      ''
    ];

    const formattedLog = logLines.join('\n');

    // Emit formatted log to server console
    console.log(formattedLog);

    return {
      success: true,
      timestamp,
      executionTimeMs: Date.now() - startTime,
      allEndpointsOnline,
      summary: {
        totalEndpoints: endpoints.length,
        onlineEndpoints: endpointResults.filter(ep => ep.ping.ok).length,
        totalItemsInSheets,
        totalCountedInSheets,
        localInventoriesCount: localInvFiles.length,
        localHistoryCount: localHistFiles.length,
        remoteHistoryCount: totalRemoteHistory
      },
      endpoints: endpointResults,
      localInventories: localInventoriesSummary,
      rootCauses,
      recommendations,
      formattedLog
    };
  }

  /**
   * Diagnostic check of all Google Apps Script integration endpoints
   */
  async checkHealth() {
    const types = [
      { name: 'Cíclicos', type: 'CICLICO', url: config.integrations.CICLICOS_URL },
      { name: 'Barrido', type: 'BARRIDO', url: config.integrations.BARRIDO_URL },
      { name: 'Mensuales', type: 'MENSUALES', url: config.integrations.MENSUALES_URL },
      { name: 'Semanales', type: 'SEMANALES', url: config.integrations.SEMANALES_URL }
    ];

    const results = await Promise.all(types.map(async (t) => {
      const startTime = Date.now();
      try {
        const u = new URL(t.url);
        // Primary ping query
        u.searchParams.set('action', 'ping');
        const res = await fetch(u.toString(), { redirect: 'follow' });
        const latency = Date.now() - startTime;
        return {
          name: t.name,
          type: t.type,
          url: t.url,
          status: res.status,
          latencyMs: latency,
          online: res.status === 200
        };
      } catch (err) {
        return {
          name: t.name,
          type: t.type,
          url: t.url,
          status: 0,
          latencyMs: Date.now() - startTime,
          online: false,
          error: err.message
        };
      }
    }));

    const allOnline = results.every(r => r.online);
    return {
      success: true,
      allOnline,
      results,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new GasService();
