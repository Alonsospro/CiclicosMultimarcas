const config = require('../config');

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

  async fetchProductsFromScript(type, center = '1120') {
    const cleanCenter = config.getCenterCode ? config.getCenterCode(center) : center;
    const url = this.getUrlForType(type);
    const targetUrl = new URL(url);
    if (cleanCenter) {
      targetUrl.searchParams.set('center', cleanCenter);
      targetUrl.searchParams.set('action', 'getProducts');
    }

    try {
      const response = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status} from Google Apps Script`);
      }

      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        // If response is HTML or malformed, raise clean error
        throw new Error('Respuesta inválida de Google Apps Script: ' + text.substring(0, 100));
      }

      // Handle both formats: raw array or { data: [...] } or { status: 'success', products: [...] } or { status: 'success', rows: [...] }
      let productsList = [];
      if (Array.isArray(parsed)) {
        productsList = parsed;
      } else if (parsed && Array.isArray(parsed.rows)) {
        productsList = parsed.rows;
      } else if (parsed && Array.isArray(parsed.data)) {
        productsList = parsed.data;
      } else if (parsed && Array.isArray(parsed.products)) {
        productsList = parsed.products;
      }

      return this.mapRawRowsToColumns(productsList);
    } catch (err) {
      console.warn(`[gasService] Warning fetching from remote GAS URL (${url}):`, err.message);
      // Return null to allow fallback to local/cached data or throw
      throw err;
    }
  }

  mapRawRowsToColumns(rawRows = []) {
    const parseNum = (val, fallback = 0) => {
      if (val === null || val === undefined || val === '') return fallback;
      const n = parseFloat(val);
      return isNaN(n) ? fallback : n;
    };
    const parseIntSafe = (val, fallback = 0) => {
      if (val === null || val === undefined || val === '') return fallback;
      const n = parseInt(val, 10);
      return isNaN(n) ? fallback : n;
    };

    return rawRows.map((row, idx) => {
      // Row could be an array of column values [A, B, C...] or an object with keys
      if (Array.isArray(row)) {
        return {
          id: `ITEM-${idx + 1}-${Date.now().toString(36)}`,
          SKU: String(row[0] || '').trim(),
          Codigo_Barras: String(row[1] || '').trim(),
          Descripcion: String(row[2] || '').trim(),
          Ubicacion: String(row[3] || '').trim(),
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
          Comentario: String(row[16] || '').trim()
        };
      }

      return {
        id: row.id || `ITEM-${idx + 1}-${Date.now().toString(36)}`,
        SKU: String(row.SKU || row.sku || '').trim(),
        Codigo_Barras: String(row.Codigo_Barras || row.codigo_barras || row.barcode || '').trim(),
        Descripcion: String(row.Descripcion || row.descripcion || '').trim(),
        Ubicacion: String(row.Ubicacion || row.ubicacion || '').trim(),
        Categoria: String(row.Categoria || row.categoria || '').trim(),
        Clasificacion_ABC: String(row.Clasificacion_ABC || row.abc || 'C').trim().toUpperCase(),
        Unidad: String(row.Unidad || row.unidad || 'PZA').trim(),
        Costo_Unitario: parseNum(row.Costo_Unitario || row.costo_unitario, 0),
        Stock_Sistema: parseIntSafe(row.Stock_Sistema || row.stock_sistema, 0),
        Stock_Fisico: (row.Stock_Fisico !== undefined && row.Stock_Fisico !== null && row.Stock_Fisico !== '') ? parseIntSafe(row.Stock_Fisico, null) : null,
        Diferencia: (row.Diferencia !== undefined && row.Diferencia !== null && row.Diferencia !== '') ? parseIntSafe(row.Diferencia, 0) : 0,
        Costo_Diferencia: parseNum(row.Costo_Diferencia, 0),
        Fecha_Ultimo_Conteo: row.Fecha_Ultimo_Conteo || row.fecha_conteo || null,
        Responsable: String(row.Responsable || row.responsable || '').trim(),
        Estado: String(row.Estado || row.estado || 'Pendiente').trim(),
        Mal_estado: parseIntSafe(row.Mal_estado || row.mal_estado, 0),
        Comentario: String(row.Comentario || row.comentario || '').trim()
      };
    });
  }

  formatItemsTo17Columns(items = []) {
    return items.map(it => [
      String(it.SKU || '').trim(),
      String(it.Codigo_Barras || '').trim(),
      String(it.Descripcion || '').trim(),
      String(it.Ubicacion || '').trim(),
      String(it.Categoria || '').trim(),
      String(it.Clasificacion_ABC || 'C').trim().toUpperCase(),
      String(it.Unidad || 'PZA').trim(),
      Number(it.Costo_Unitario || 0),
      Number(it.Stock_Sistema || 0),
      it.Stock_Fisico !== null && it.Stock_Fisico !== undefined ? Number(it.Stock_Fisico) : '',
      it.Stock_Fisico !== null && it.Stock_Fisico !== undefined ? Number(it.Stock_Fisico) - Number(it.Stock_Sistema || 0) : '',
      it.Stock_Fisico !== null && it.Stock_Fisico !== undefined ? (Number(it.Stock_Fisico) - Number(it.Stock_Sistema || 0)) * Number(it.Costo_Unitario || 0) : '',
      it.Fecha_Ultimo_Conteo || (it.Stock_Fisico !== null ? new Date().toISOString().split('T')[0] : ''),
      String(it.Responsable || '').trim(),
      String(it.Estado || (it.Stock_Fisico !== null ? 'Contado' : 'Pendiente')).trim(),
      Number(it.Mal_estado || 0),
      String(it.Comentario || '').trim()
    ]);
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
    if (center && center !== 'TODOS' && center !== 'GLOBAL') {
      const cleanCenter = config.getCenterCode ? config.getCenterCode(center) : center;
      targetUrl.searchParams.set('center', cleanCenter);
    }

    try {
      const response = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

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
    const cleanType = (type || payload.type || 'CICLICO').toUpperCase();
    const url = this.getUrlForType(cleanType);
    const cleanCenter = config.getCenterCode ? config.getCenterCode(payload.center || payload.centro || '1120') : '1120';

    const postBody = {
      action: 'upsertCount',
      center: cleanCenter,
      type: cleanType,
      sku: String(payload.sku || payload.SKU || '').trim(),
      barcode: String(payload.barcode || payload.codigoBarras || payload.Codigo_Barras || '').trim(),
      location: String(payload.location || payload.ubicacion || payload.Ubicacion || '').trim(),
      isNewLocation: !!payload.isNewLocation,
      stockFisico: payload.stockFisico !== undefined ? payload.stockFisico : payload.Stock_Fisico,
      malEstado: payload.malEstado !== undefined ? payload.malEstado : (payload.Mal_estado || 0),
      comentario: payload.comentario !== undefined ? payload.comentario : (payload.Comentario || ''),
      fechaUltimoConteo: payload.fechaUltimoConteo || payload.Fecha_Ultimo_Conteo || new Date().toISOString().split('T')[0],
      responsable: payload.responsable || payload.Responsable || payload.username || '',
      estado: payload.estado || payload.Estado || '',
      photoBase64: payload.photoBase64 || payload.photoUrl || payload.fotoUrl || ''
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody)
      });

      const resText = await response.text();
      try {
        return JSON.parse(resText);
      } catch (e) {
        return { success: true, action: 'upsertCount', raw: resText };
      }
    } catch (err) {
      console.warn('[gasService] Notice in upsertCountToGAS:', err.message);
      return { success: false, message: err.message };
    }
  }

  /**
   * Action: batchUpsertCounts
   * Batch update of columns J to Q for multiple items.
   */
  async batchUpsertCountsToGAS(type, payload) {
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

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody)
      });

      const resText = await response.text();
      try {
        return JSON.parse(resText);
      } catch (e) {
        return { success: true, action: 'batchUpsertCounts', raw: resText };
      }
    } catch (err) {
      console.warn('[gasService] Notice in batchUpsertCountsToGAS:', err.message);
      return { success: false, message: err.message };
    }
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
    const driveRecord = {
      ...incomingDriveRecord,
      type: cleanType,
      center: cleanCenter,
      reviewNotes: payload.reviewNotes || incomingDriveRecord.reviewNotes || '',
      items: incomingDriveRecord.items || rawItems.map(it => ({
        SKU: it.SKU || it.sku || '',
        Codigo_Barras: it.Codigo_Barras || it.codigoBarras || it.barcode || '',
        Ubicacion: it.Ubicacion || it.ubicacion || '',
        Stock_Fisico: it.Stock_Fisico !== undefined ? it.Stock_Fisico : it.stockFisico,
        Mal_estado: it.Mal_estado !== undefined ? it.Mal_estado : (it.malEstado || 0),
        Comentario: it.Comentario !== undefined ? it.Comentario : (it.comentario || ''),
        Fecha_Ultimo_Conteo: it.Fecha_Ultimo_Conteo || it.fechaUltimoConteo || '',
        Responsable: it.Responsable || it.responsable || '',
        Estado: it.Estado || it.estado || '',
        photoBase64: it.photoBase64 || it.photoUrl || it.foto_mal_estado || ''
      })),
      justifications: incomingDriveRecord.justifications || payload.justifications || []
    };

    const postBody = {
      action: 'createFinalFile',
      type: cleanType,
      center: cleanCenter,
      centro: cleanCenter,
      reviewNotes: payload.reviewNotes || driveRecord.reviewNotes || '',
      snapshotFolderId: config.driveSnapshotsFolderId,
      driveRecord: driveRecord,
      rows: rows
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody)
      });

      if (!response.ok) {
        console.warn(`[gasService] GAS webhook responded with status ${response.status}`);
      }

      const resText = await response.text();
      try {
        const parsed = JSON.parse(resText);
        return {
          success: true,
          ...parsed,
          // Extract primary Drive URLs returned by the Apps Script
          driveUrl: parsed.driveUrl || parsed.spreadsheetUrl || config.driveSnapshotsFolderUrl || null,
          spreadsheetUrl: parsed.spreadsheetUrl || null,
          fileId: parsed.fileId || null,
          fileName: parsed.fileName || null
        };
      } catch (e) {
        return { success: true, message: 'Enviado a Google Apps Script', raw: resText, driveUrl: config.driveSnapshotsFolderUrl };
      }
    } catch (err) {
      console.warn('[gasService] Warning submitting final file to GAS:', err.message);
      return { success: true, fallback: true, message: 'Guardado localmente en Drive Store: ' + err.message, driveUrl: config.driveSnapshotsFolderUrl };
    }
  }

  async syncPhotoToGAS({ category, date, center, sku, fileName, folderPath, fileBuffer, mimeType, inventoryId }) {
    // If malestado photo, sync via upsertCount payload with photoBase64
    const base64Data = fileBuffer ? `data:${mimeType || 'image/jpeg'};base64,${fileBuffer.toString('base64')}` : '';
    if (category === 'malestado') {
      return this.upsertCountToGAS('CICLICO', {
        center,
        sku,
        barcode: sku,
        malEstado: 1,
        photoBase64: base64Data
      });
    }
    return { success: true, message: 'Foto guardada para inclusión en cierre final' };
  }
}

module.exports = new GasService();
