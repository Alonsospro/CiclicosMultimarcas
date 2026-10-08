const contract = require('./inventoryContract');
const gasRequest = require('./gasTransport');
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
    let isNegative = false;
    if (str.startsWith('(') && str.endsWith(')')) {
      isNegative = true;
      str = str.slice(1, -1).trim();
    }
    // Clean currency symbols, letters, spaces
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
      if (parts.length === 2 && parts[1].length <= 2) {
        // 15,50 -> comma is decimal
        str = str.replace(',', '.');
      } else {
        // 1,000 -> comma is thousands
        str = str.replace(/,/g, '');
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
    const idxFecha1Just = getColIndex(['fecha_primera_justificacion', 'fecha_justificacion', 'fecha_just']);
    const idxCorroboracion = getColIndex(['corroboracion', 'corroboración', 'corroboracionstatus', 'estado_justificacion']);

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
      const rawAbc = (getVal(idxAbc, r[7] || r[5] || '') || '').trim().toUpperCase();
      const unit = getVal(idxUnit, r[8] || r[6] || 'UND');
      const unitCost = this.parseCurrencyOrNumber(getVal(idxCost, r[9] !== undefined ? r[9] : r[7]), 0);
      const sysStock = this.parseCurrencyOrNumber(getVal(idxSys, r[10] !== undefined ? r[10] : r[8]), 0);
      
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
      const costDiffFinal1 = (rawCostDiffFinal1 !== '' && rawCostDiffFinal1 !== undefined && rawCostDiffFinal1 !== null)
        ? this.parseCurrencyOrNumber(rawCostDiffFinal1, null)
        : null;

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
      const costDiffFinal2 = (rawCostDiffFinal2 !== '' && rawCostDiffFinal2 !== undefined && rawCostDiffFinal2 !== null)
        ? this.parseCurrencyOrNumber(rawCostDiffFinal2, null)
        : null;

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
        corroboracion: getVal(idxCorroboracion !== -1 ? idxCorroboracion : idxState, r[19] || ''),
        corroborationStatus: getVal(idxCorroboracion !== -1 ? idxCorroboracion : idxState, r[19] || ''),
        Fecha_Primera_Justificacion: getVal(idxFecha1Just, r[18] || ''),
        Mal_estado: damagedStock,
        Comentario: getVal(idxComment, r[21] || r[16] || ''),
        Razon: getVal(idxReason, r[20] || r[17] || ''),
        Razon_Justificacion: getVal(idxReason, r[20] || r[17] || ''),
        Comentario_Justificacion: getVal(idxJust, r[21] || r[18] || ''),
        Revisado_Por: getVal(idxReviewer, r[22] || r[19] || ''),
        Responsable_Justificacion: getVal(idxReviewer, r[22] || r[19] || ''),
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

  async fetchSpreadsheetItems(spreadsheetUrl, record={}) {
    const source=await this.readInventorySpreadsheet({...record,spreadsheetUrl});
    return source.rows.map(row=>contract.normalize(Object.fromEntries(contract.columns.map((key,i)=>[key,row[i]]))));
  }
  async readInventorySpreadsheet(record) {
    const url=record.spreadsheetUrl||record.driveUrl||'';
    const spreadsheetId=this.extractSpreadsheetId(url)||record.driveFileId;
    if(!spreadsheetId)throw new Error('Falta el identificador de la hoja final');
    const gid=(url.match(/[#&?]gid=(\d+)/)||[])[1];
    return {...await gasRequest(this.getUrlForType(record.type),{action:'readFinalInventory',spreadsheetId,gid,center:record.center,type:record.type}),readAt:new Date().toISOString()};
  }

  async fetchProductsFromScript(type,center) {
    const result=await gasRequest(this.getUrlForType(type),{action:'getProducts',type,center:config.getCenterCode(center)});
    if(!Array.isArray(result.items))throw new Error('Apps Script no devolvió una lista válida.');
    return result.items.map((row,index)=>({...contract.normalize(Array.isArray(row)?Object.fromEntries(contract.columns.map((key,i)=>[key,row[i]])):row),id:row.id||('ITEM-SHEET-'+index)}));
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
        Stock_Fisico: contract.normalize(row).Stock_Fisico,
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

  formatItemsToColumns(items=[]) {
    return items.map(raw=>{const item=contract.normalize(raw);return contract.columns.map(key=>item[key]??'');});
  }

  formatItemsTo17Columns(items = []) {
    return this.formatItemsToColumns(items);
  }

  /**
   * Action: getReferencePhoto
   * Queries reference photo for a SKU directly via Google Drive searchFiles in Apps Script.
   */
  async getReferencePhotoFromGAS(sku,type='CICLICO') {
    const result=await gasRequest(this.getUrlForType(type),{action:'getReferencePhoto',type,sku});
    return result.photo||null;
  }

  async getHistoryFromGAS(type='CICLICO',center=null) {
    const result=await gasRequest(this.getUrlForType(type),{action:'getHistory',type,
      center:center&&!['TODOS','GLOBAL'].includes(center)?config.getCenterCode(center):null});
    if(!Array.isArray(result.history))throw new Error('Historial inválido');
    return result.history;
  }

  async queryItemFromGAS(type,{center,sku,barcode,location='',warehouse=''}) {
    const items=await this.fetchProductsFromScript(type,center);
    const found=items.filter(it=>(sku?contract.identity(it.SKU)===contract.identity(sku):contract.identity(it.Codigo_Barras)===contract.identity(barcode))&&
      (!location||[it.Ubicacion,it.Ubicacion_1,it.Ubicacion_2].some(v=>contract.identity(v)===contract.identity(location)))&&
      (!warehouse||contract.identity(it.Almacen)===contract.identity(warehouse)));
    if(found.length>1)throw new Error('Ítem ambiguo');
    return {success:true,found:found.length===1,item:found[0]||null};
  }

  async upsertCountToGAS(type,payload) {
    const postBody={...payload,action:'upsertCount',type:String(type||payload.type||'CICLICO').toUpperCase(),
      center:config.getCenterCode(payload.center||payload.centro),sku:String(payload.sku||payload.SKU||'').trim(),
      barcode:String(payload.barcode||payload.Codigo_Barras||'').trim(),location:String(payload.location||payload.Ubicacion||'').trim(),
      almacen:String(payload.almacen||payload.warehouse||payload.Almacen||'').trim()};
    return gasRequest(this.getUrlForType(postBody.type),postBody);
  }

  async deleteAdditionalLocationFromGAS(type,payload={}) {
    return gasRequest(this.getUrlForType(type),{...payload,action:'deleteAdditionalLocation',type,center:config.getCenterCode(payload.center)});
  }

  async batchUpsertCountsToGAS(type,payload) {
    return gasRequest(this.getUrlForType(type),{...payload,action:'batchUpsertCounts',type,center:config.getCenterCode(payload.center)});
  }

  async syncFinalInventoryToGAS(type,payload) {
    const record=payload.driveRecord||{};
    const items=(record.items||payload.items||[]).map(contract.finalItem);
    if(!items.length)throw new Error('No se puede cerrar un inventario vacío.');
    return gasRequest(this.getUrlForType(type),{...payload,action:'createFinalFile',type,
      center:config.getCenterCode(payload.center||record.center),
      driveRecord:{...record,items,justifications:record.justifications||payload.justifications||[]}}, {file:true});
  }

  async syncPhotoToGAS({category,date,center,sku,fileBuffer,mimeType,inventoryId,type,itemId,round,almacen,location}) {
    if(!fileBuffer?.length)throw new Error('No se recibió la foto.');
    const result=await gasRequest(this.getUrlForType(type),{action:'savePhoto',category,date,center:config.getCenterCode(center),
      sku,inventoryId,type,itemId,round,almacen,location,photoBase64:'data:'+mimeType+';base64,'+fileBuffer.toString('base64')},{photo:true});
    const photo=result.photo;
    return {...result,driveFileId:photo.id,driveUrl:photo.url,directUrl:'https://drive.google.com/uc?export=view&id='+photo.id};
  }

  async saveJustificationToGAS(type,payload) {
    return gasRequest(this.getUrlForType(type),{...payload,action:'saveJustification',type,center:config.getCenterCode(payload.center)});
  }

  async runGasDiagnostics() {
    const result=await gasRequest(this.getUrlForType('CICLICO'),{action:'diagnostic'});
    return {success:true,...result};
  }

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
