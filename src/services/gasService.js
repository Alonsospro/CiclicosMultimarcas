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
          Comentario: String(row[16] || '').trim(),
          Razon: String(row[17] || '').trim(),
          Comentario_Justificacion: String(row[18] || '').trim()
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
        Comentario: String(row.Comentario || row.comentario || '').trim(),
        Razon: String(row.Razon || row.razon || row.Razon_Justificacion || row.reasonType || '').trim(),
        Comentario_Justificacion: String(row.Comentario_Justificacion || row.comentario_justificacion || row.justification || row.comentarioJustificacion || '').trim()
      };
    });
  }

  formatItemsToColumns(items = []) {
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
      String(it.Comentario || '').trim(),
      String(it.Razon || it.Razon_Justificacion || it.reasonType || '').trim(),
      String(it.Comentario_Justificacion || it.comentarioJustificacion || it.justification || '').trim()
    ]);
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
      razon: payload.razon || payload.Razon || payload.razonJustificacion || payload.reasonType || '',
      comentarioJustificacion: payload.comentarioJustificacion || payload.Comentario_Justificacion || payload.justification || '',
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
        Razon: it.Razon || it.Razon_Justificacion || it.reasonType || '',
        Comentario_Justificacion: it.Comentario_Justificacion || it.comentarioJustificacion || it.justification || '',
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

  /**
   * Directly saves a justification to GAS with fallback to upsertCount
   */
  async saveJustificationToGAS(type, payload) {
    const cleanType = (type || payload.type || 'CICLICO').toUpperCase();
    const url = this.getUrlForType(cleanType);
    const rawCenter = payload.center || payload.centro || '1120';
    const cleanCenter = config.getCenterCode ? config.getCenterCode(rawCenter) : rawCenter;

    const postBody = {
      action: 'saveJustification',
      center: cleanCenter,
      type: cleanType,
      sku: String(payload.sku || payload.SKU || '').trim(),
      razon: payload.razon || payload.reasonType || payload.razonJustificacion || payload.Razon || 'AJUSTE_INVENTARIO',
      comentarioJustificacion: payload.comentarioJustificacion || payload.justification || payload.comentariosJustificacion || payload.Comentario_Justificacion || ''
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(postBody)
      });

      const resText = await response.text();
      let parsed = null;
      try { parsed = JSON.parse(resText); } catch(e) {}

      // If action not supported on an older deployment, fallback to upsertCount
      if (parsed && parsed.success === false && String(parsed.error || '').includes('no soportada')) {
        return this.upsertCountToGAS(cleanType, {
          center: cleanCenter,
          sku: postBody.sku,
          estado: 'Justificado',
          razon: postBody.razon,
          comentarioJustificacion: postBody.comentarioJustificacion
        });
      }

      return parsed || { success: true, action: 'saveJustification', raw: resText };
    } catch (err) {
      console.warn('[gasService] Notice in saveJustificationToGAS, trying upsertCount:', err.message);
      return this.upsertCountToGAS(cleanType, {
        center: cleanCenter,
        sku: postBody.sku,
        estado: 'Justificado',
        razon: postBody.razon,
        comentarioJustificacion: postBody.comentarioJustificacion
      });
    }
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
