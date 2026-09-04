const fs = require('fs');
const path = require('path');
const storagePath = require('./storagePath');
const config = require('../config');
const auditService = require('./auditService');
const gasService = require('./gasService');

function parseDateParam(val, isEndOfDay = false) {
  if (!val || val === 'undefined' || val === 'null' || val === '') return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  if (isEndOfDay && typeof val === 'string' && val.length <= 10) {
    d.setHours(23, 59, 59, 999);
  }
  return d;
}

function isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

class MetricsService {
  constructor() {
    this.invDir = storagePath.getInventoriesDirectory();
    this.historyDir = storagePath.getHistoryDirectory();
  }

  async getAllInventoriesData() {
    let activeFiles = [];
    let historyFiles = [];

    try {
      activeFiles = storagePath.listFiles(this.invDir).filter(f => f.endsWith('.json'));
    } catch (e) {
      activeFiles = [];
    }

    try {
      historyFiles = storagePath.listFiles(this.historyDir).filter(f => f.endsWith('.json'));
    } catch (e) {
      historyFiles = [];
    }

    const seenIds = new Set();
    const allInventories = [];

    // 1. Files from active local memory / cache
    activeFiles.forEach(f => {
      const inv = storagePath.readJson(path.join(this.invDir, f), null);
      if (inv && Array.isArray(inv.items)) {
        const id = inv.id || f.replace(/\.json$/, '');
        seenIds.add(id);
        const createdAt = inv.createdAt || inv.created_at || inv.date || (inv.items.find(i => i.Fecha_Ultimo_Conteo)?.Fecha_Ultimo_Conteo) || new Date().toISOString();
        allInventories.push({ ...inv, id, createdAt, isHistory: false });
      }
    });

    // 2. Files from local history cache
    historyFiles.forEach(f => {
      const hist = storagePath.readJson(path.join(this.historyDir, f), null);
      if (hist && Array.isArray(hist.items)) {
        const id = hist.inventoryId || hist.fileId || f.replace(/\.json$/, '');
        if (!seenIds.has(id)) {
          seenIds.add(id);
          const createdAt = hist.closedAt || hist.createdAt || new Date().toISOString();
          allInventories.push({
            id,
            name: hist.fileName || id,
            type: hist.type || 'CICLICO',
            center: hist.center || '1120',
            status: 'REVISADO',
            createdAt,
            items: hist.items,
            isHistory: true
          });
        }
      }
    });

    // 3. Query live history directly from Google Drive / Sheets via Google Apps Script
    try {
      const gasHistory = await gasService.getHistoryFromGAS('CICLICO', null);
      if (Array.isArray(gasHistory) && gasHistory.length > 0) {
        gasHistory.forEach(item => {
          if (!item) return;
          const id = item.fileId || item.fileName || item.inventoryId;
          const dedupeKey = String(id || '').toLowerCase();
          if (dedupeKey && !seenIds.has(dedupeKey)) {
            seenIds.add(dedupeKey);
            const total = Number(item.totalItems || item.processed || 0);
            const diffs = Number(item.itemsWithDiff || 0);

            // Construct items array for metrics calculations
            let items = Array.isArray(item.items) ? item.items : [];
            if (items.length === 0 && total > 0) {
              for (let i = 0; i < total; i++) {
                const hasDiff = i < diffs;
                items.push({
                  SKU: `DRIVE-${item.fileId || 'ITEM'}-${i + 1}`,
                  Stock_Sistema: 1,
                  Stock_Fisico: hasDiff ? 0 : 1,
                  Diferencia: hasDiff ? -1 : 0,
                  Costo_Diferencia: 0,
                  Costo_Unitario: 0,
                  Estado: 'Contado',
                  Fecha_Ultimo_Conteo: item.closedAt || new Date().toISOString(),
                  Responsable: item.closedBy || 'Administrador'
                });
              }
            }

            allInventories.push({
              id: item.fileId || `DRIVE-${Date.now()}`,
              name: item.fileName || `Inventario ${item.type || 'CICLICO'} - ${item.center || '1120'}`,
              type: item.type || 'CICLICO',
              center: item.center || '1120',
              status: 'REVISADO',
              isHistory: true,
              createdAt: item.closedAt || new Date().toISOString(),
              closedAt: item.closedAt,
              closedBy: item.closedBy || 'Administrador',
              driveUrl: item.driveUrl || item.spreadsheetUrl,
              spreadsheetUrl: item.spreadsheetUrl,
              items
            });
          }
        });
      }
    } catch (gasErr) {
      console.warn('[metricsService] Notice querying live history from Google Drive:', gasErr.message);
    }

    // 4. If no active inventory in local storage (cold start), auto-fetch live items from Google Sheets
    if (activeFiles.length === 0) {
      try {
        const liveItems = await gasService.fetchProductsFromScript('CICLICO', '1120');
        if (Array.isArray(liveItems) && liveItems.length > 0) {
          const activeId = 'INV-CICLICO-1120-DRIVE';
          if (!seenIds.has(activeId.toLowerCase())) {
            seenIds.add(activeId.toLowerCase());
            allInventories.push({
              id: activeId,
              name: 'Inventario Cíclico - 1120 (Google Drive Live)',
              type: 'CICLICO',
              center: '1120',
              status: 'EN_PROGRESO',
              createdAt: new Date().toISOString(),
              items: liveItems,
              isHistory: false
            });
          }
        }
      } catch (liveErr) {
        console.warn('[metricsService] Notice fetching live sheet counts:', liveErr.message);
      }
    }

    return allInventories;
  }

  async getDashboardMetrics({ type = 'TODOS', center = 'TODOS', inventoryId = 'TODOS', period = 'TODO', startDate = null, endDate = null }) {
    // Sanitize input values
    const cleanType = (!type || type === 'undefined' || type === 'null') ? 'TODOS' : type;
    const cleanCenter = (!center || center === 'undefined' || center === 'null') ? 'TODOS' : center;
    const cleanInventoryId = (!inventoryId || inventoryId === 'undefined' || inventoryId === 'null') ? 'TODOS' : inventoryId;
    const cleanPeriod = (!period || period === 'undefined' || period === 'null') ? 'TODO' : period;

    const inventories = await this.getAllInventoriesData();

    // Compute start and end dates based on period preset if provided
    let effectiveStartDate = parseDateParam(startDate, false);
    let effectiveEndDate = parseDateParam(endDate, true);

    const now = new Date();
    if (cleanPeriod === 'HOY') {
      effectiveStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      effectiveEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (cleanPeriod === 'ESTA_SEMANA') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const monday = new Date(now);
      monday.setDate(diff);
      monday.setHours(0, 0, 0, 0);
      effectiveStartDate = monday;
      effectiveEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (cleanPeriod === 'ESTE_MES') {
      effectiveStartDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      effectiveEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (cleanPeriod === 'MES_ANTERIOR') {
      effectiveStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      effectiveEndDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    }

    const checkDateRange = (dateVal) => {
      if (!isValidDate(effectiveStartDate) && !isValidDate(effectiveEndDate)) return true;
      const d = dateVal ? new Date(dateVal) : null;
      if (!isValidDate(d)) return true; // Keep record if date is unknown to avoid missing items
      if (isValidDate(effectiveStartDate) && d < effectiveStartDate) return false;
      if (isValidDate(effectiveEndDate) && d > effectiveEndDate) return false;
      return true;
    };

    // List of all inventories available in this period & filters for the dropdown selector
    const availableInventories = inventories.filter(inv => {
      if (cleanType && cleanType !== 'TODOS' && inv.type !== cleanType) return false;
      if (cleanCenter && cleanCenter !== 'TODOS' && cleanCenter !== 'GLOBAL' && !config.isSameCenter(inv.center, cleanCenter)) return false;
      if (!checkDateRange(inv.createdAt)) return false;
      return true;
    }).map(inv => ({
      id: inv.id,
      name: inv.name,
      type: inv.type,
      center: inv.center,
      status: inv.status,
      createdAt: inv.createdAt,
      totalItems: (inv.items || []).length,
      isHistory: !!inv.isHistory
    })).sort((a, b) => {
      const da = new Date(a.createdAt).getTime() || 0;
      const db = new Date(b.createdAt).getTime() || 0;
      return db - da;
    });

    // Filter inventories by inventoryId, type, center, dates
    const filtered = inventories.filter(inv => {
      if (cleanInventoryId && cleanInventoryId !== 'TODOS' && inv.id !== cleanInventoryId) return false;
      if (cleanType && cleanType !== 'TODOS' && inv.type !== cleanType) return false;
      if (cleanCenter && cleanCenter !== 'TODOS' && cleanCenter !== 'GLOBAL' && !config.isSameCenter(inv.center, cleanCenter)) return false;
      if (!checkDateRange(inv.createdAt)) return false;
      return true;
    });

    // Retrieve audit logs for tracking worker edit counts on items
    const auditLogs = auditService.getAuditLogs({
      center: (cleanCenter && cleanCenter !== 'TODOS') ? cleanCenter : 'GLOBAL',
      startDate: isValidDate(effectiveStartDate) ? effectiveStartDate.toISOString() : null,
      endDate: isValidDate(effectiveEndDate) ? effectiveEndDate.toISOString() : null,
      limit: 10000
    });

    // Map worker edits: track how many times each worker re-edited the same item or requested unlocks
    const workerEditsMap = {};
    auditLogs.forEach(log => {
      const isEditAction = log.action === 'COUNT_MODIFIED' || log.action === 'COUNT_UNLOCK_REQUESTED' || (log.action === 'COUNT_REGISTERED' && log.previousQty !== null && log.previousQty !== undefined);
      if (isEditAction && log.user) {
        const u = log.user;
        if (!workerEditsMap[u]) {
          workerEditsMap[u] = {
            totalReEdits: 0,
            reEditedItemsMap: {},
            reEditHistory: []
          };
        }

        workerEditsMap[u].totalReEdits++;
        const itemKey = log.sku || log.itemId || log.targetId || 'UNKNOWN';
        if (!workerEditsMap[u].reEditedItemsMap[itemKey]) {
          workerEditsMap[u].reEditedItemsMap[itemKey] = 0;
        }
        workerEditsMap[u].reEditedItemsMap[itemKey]++;

        workerEditsMap[u].reEditHistory.push({
          inventoryId: log.inventoryId,
          sku: log.sku,
          location: log.location || '-',
          previousQty: log.previousQty,
          newQty: log.newQty !== undefined ? log.newQty : log.previousQty,
          timestamp: log.timestamp,
          reason: log.reason || (log.action === 'COUNT_UNLOCK_REQUESTED' ? 'Solicitud de desbloqueo para rectificación' : 'Modificación de conteo previo'),
          action: log.action,
          malEstado: log.malEstado || 0
        });
      }
    });

    let totalItemsPlanned = 0;
    let totalItemsAudited = 0;
    let totalExactItems = 0; // Ítems cuadrados (Diferencia == 0, Mal estado == 0)
    let totalDiscrepantItems = 0; // Ítems con diferencia o daño
    
    // Ítems cuadrados stats
    let exactItemsTotalUnits = 0;
    let exactItemsTotalValue = 0;

    // Sobrantes y Faltantes
    let sobrantesItemsCount = 0;
    let sobrantesUnits = 0;
    let sobrantesCost = 0;

    let faltantesItemsCount = 0;
    let faltantesUnits = 0;
    let faltantesCost = 0;

    // Impacto Financiero
    let totalAbsoluteDiffCost = 0;
    let totalNetDiffCost = 0;
    let totalDamagedItems = 0;
    let totalDamagedCost = 0;

    // Multi-location ERU tracking
    let totalLocationsEvaluated = 0;
    let exactMatchingLocations = 0;

    // Breakdown maps
    const abcBreakdown = {
      A: { total: 0, exact: 0, diffCost: 0, surplusCost: 0, deficitCost: 0, damagedCost: 0 },
      B: { total: 0, exact: 0, diffCost: 0, surplusCost: 0, deficitCost: 0, damagedCost: 0 },
      C: { total: 0, exact: 0, diffCost: 0, surplusCost: 0, deficitCost: 0, damagedCost: 0 }
    };

    const centerBreakdown = {};
    const workerStatsMap = {};
    const discrepanciesList = [];
    const multiLocationSkusList = [];

    filtered.forEach(inv => {
      const invCenter = inv.center || 'GENERAL';
      const centerObj = config.findCenter(invCenter);
      const centerDisplayName = centerObj ? `${centerObj.code} - ${centerObj.name}` : invCenter;

      if (!centerBreakdown[invCenter]) {
        centerBreakdown[invCenter] = {
          center: invCenter,
          centerName: centerDisplayName,
          totalPlanned: 0,
          totalAudited: 0,
          exact: 0,
          discrepancies: 0,
          sobrantesCount: 0,
          faltantesCount: 0,
          sobrantesUnits: 0,
          faltantesUnits: 0,
          diffCost: 0,
          surplusCost: 0,
          deficitCost: 0,
          locationsEvaluated: 0,
          locationsExact: 0
        };
      }

      // Track multi-locations per inventory & SKU
      const invSkuMap = {};

      inv.items.forEach(item => {
        totalItemsPlanned++;
        centerBreakdown[invCenter].totalPlanned++;

        const isAudited = item.Stock_Fisico !== null && item.Stock_Fisico !== undefined;
        
        // Multi-location grouping by SKU
        const skuKey = item.SKU || item.id;
        if (!invSkuMap[skuKey]) {
          invSkuMap[skuKey] = {
            sku: skuKey,
            descripcion: item.Descripcion || '',
            categoria: item.Categoria || 'GENERAL',
            abc: (item.Clasificacion_ABC || 'C').toUpperCase(),
            unitCost: item.Costo_Unitario || 0,
            center: invCenter,
            inventoryId: inv.id,
            inventoryName: inv.name,
            locations: []
          };
        }

        invSkuMap[skuKey].locations.push({
          id: item.id,
          ubicacion: item.Ubicacion || 'SIN_UBICACION',
          isAdditionalLocation: !!item.isAdditionalLocation,
          stockSistema: item.Stock_Sistema || 0,
          stockFisico: item.Stock_Fisico,
          diferencia: isAudited ? ((item.Stock_Fisico || 0) - (item.Stock_Sistema || 0)) : null,
          malEstado: item.Mal_estado || 0,
          responsable: item.Responsable || 'Sin Asignar',
          estado: item.Estado || 'Pendiente'
        });

        if (!isAudited) return;

        totalItemsAudited++;
        totalLocationsEvaluated++;
        centerBreakdown[invCenter].totalAudited++;
        centerBreakdown[invCenter].locationsEvaluated++;

        const stockFisico = item.Stock_Fisico || 0;
        const stockSistema = item.Stock_Sistema || 0;
        const diff = stockFisico - stockSistema;
        const unitCost = item.Costo_Unitario || 0;
        const diffCost = diff * unitCost;
        const absDiffCost = Math.abs(diffCost);
        const isAdditionalLoc = !!item.isAdditionalLocation;
        const damaged = item.Mal_estado || 0;
        const damagedCost = damaged * unitCost;

        if (damaged > 0) {
          totalDamagedItems += damaged;
          totalDamagedCost += damagedCost;
        }

        // Exact Match (Ítem Cuadrado)
        const isExact = (diff === 0 && damaged === 0 && (!isAdditionalLoc || stockFisico === 0));
        if (isExact) {
          totalExactItems++;
          exactMatchingLocations++;
          exactItemsTotalUnits += stockFisico;
          exactItemsTotalValue += (stockFisico * unitCost);
          centerBreakdown[invCenter].exact++;
          centerBreakdown[invCenter].locationsExact++;
        } else {
          totalDiscrepantItems++;
          centerBreakdown[invCenter].discrepancies++;

          // Classify discrepancy type
          let tipoDiscrepancia = 'CUADRADO';
          if (diff > 0) tipoDiscrepancia = 'SOBRANTE';
          else if (diff < 0) tipoDiscrepancia = 'FALTANTE';
          else if (damaged > 0) tipoDiscrepancia = 'AVERIA_DANADO';

          discrepanciesList.push({
            id: item.id,
            inventoryId: inv.id,
            inventoryName: inv.name,
            center: invCenter,
            centerName: centerDisplayName,
            sku: item.SKU,
            descripcion: item.Descripcion,
            ubicacion: item.Ubicacion || '-',
            isAdditionalLocation: isAdditionalLoc,
            stockSistema,
            stockFisico,
            diferencia: diff,
            costoUnitario: unitCost,
            costoDiferencia: diffCost,
            absCostoDiferencia: absDiffCost,
            malEstado: damaged,
            costoMalEstado: damagedCost,
            tipoDiscrepancia,
            abc: (item.Clasificacion_ABC || 'C').toUpperCase(),
            responsable: item.Responsable || 'Sin Asignar',
            fechaConteo: item.Fecha_Ultimo_Conteo
          });
        }

        // Track financial and discrepancy details
        if (diff > 0) {
          sobrantesItemsCount++;
          sobrantesUnits += diff;
          sobrantesCost += diffCost;
          centerBreakdown[invCenter].sobrantesCount++;
          centerBreakdown[invCenter].sobrantesUnits += diff;
          centerBreakdown[invCenter].surplusCost += diffCost;
        } else if (diff < 0) {
          faltantesItemsCount++;
          faltantesUnits += Math.abs(diff);
          faltantesCost += absDiffCost;
          centerBreakdown[invCenter].faltantesCount++;
          centerBreakdown[invCenter].faltantesUnits += Math.abs(diff);
          centerBreakdown[invCenter].deficitCost += absDiffCost;
        }

        totalAbsoluteDiffCost += absDiffCost;
        totalNetDiffCost += diffCost;
        centerBreakdown[invCenter].diffCost += absDiffCost;

        // ABC breakdown
        const abc = (item.Clasificacion_ABC || 'C').toUpperCase();
        if (abcBreakdown[abc]) {
          abcBreakdown[abc].total++;
          if (isExact) abcBreakdown[abc].exact++;
          abcBreakdown[abc].diffCost += absDiffCost;
          if (diff > 0) abcBreakdown[abc].surplusCost += diffCost;
          if (diff < 0) abcBreakdown[abc].deficitCost += absDiffCost;
          if (damaged > 0) abcBreakdown[abc].damagedCost += damagedCost;
        }

        // Worker stats tracking
        const workerName = item.Responsable || 'Sin Asignar';
        if (!workerStatsMap[workerName]) {
          const workerEditData = workerEditsMap[workerName] || { totalReEdits: 0, reEditedItemsMap: {}, reEditHistory: [] };
          workerStatsMap[workerName] = {
            worker: workerName,
            center: invCenter,
            totalCounted: 0,
            exactCounted: 0,
            sobrantesCounted: 0,
            faltantesCounted: 0,
            discrepanciesCounted: 0,
            damagedFound: 0,
            totalDiffCost: 0,
            reEditCount: workerEditData.totalReEdits,
            reEditedItemsCount: Object.keys(workerEditData.reEditedItemsMap).length,
            reEditHistory: workerEditData.reEditHistory
          };
        }

        workerStatsMap[workerName].totalCounted++;
        if (isExact) {
          workerStatsMap[workerName].exactCounted++;
        } else {
          workerStatsMap[workerName].discrepanciesCounted++;
          if (diff > 0) workerStatsMap[workerName].sobrantesCounted++;
          if (diff < 0) workerStatsMap[workerName].faltantesCounted++;
        }
        workerStatsMap[workerName].damagedFound += damaged;
        workerStatsMap[workerName].totalDiffCost += absDiffCost;
      });

      // Analyze multi-locations for this inventory
      Object.values(invSkuMap).forEach(skuObj => {
        const locationsCount = skuObj.locations.length;
        if (locationsCount > 1) {
          const auditedLocations = skuObj.locations.filter(l => l.stockFisico !== null && l.stockFisico !== undefined);
          const totalStockSistema = skuObj.locations.reduce((acc, l) => acc + (l.stockSistema || 0), 0);
          const totalStockFisico = auditedLocations.reduce((acc, l) => acc + (l.stockFisico || 0), 0);
          const isFullyAudited = auditedLocations.length === locationsCount;
          const allLocationsExact = isFullyAudited && skuObj.locations.every(l => (l.diferencia === 0 && l.malEstado === 0));

          multiLocationSkusList.push({
            sku: skuObj.sku,
            descripcion: skuObj.descripcion,
            categoria: skuObj.categoria,
            abc: skuObj.abc,
            center: skuObj.center,
            inventoryName: skuObj.inventoryName,
            locationsCount,
            locations: skuObj.locations,
            totalStockSistema,
            totalStockFisico: isFullyAudited ? totalStockFisico : null,
            totalDiferencia: isFullyAudited ? (totalStockFisico - totalStockSistema) : null,
            allLocationsExact,
            status: allLocationsExact ? 'EXACTO' : (isFullyAudited ? 'CON_DIFERENCIAS' : 'EN_PROGRESO')
          });
        }
      });
    });

    // 1. ERI (Exactitud de Registro de Inventario %)
    const eriPercent = totalItemsAudited > 0
      ? ((totalExactItems / totalItemsAudited) * 100).toFixed(2)
      : '100.00';

    // 2. ERU (Exactitud de Registro de Ubicación % - evaluando cada ubicación individual y adicional)
    const eruPercent = totalLocationsEvaluated > 0
      ? ((exactMatchingLocations / totalLocationsEvaluated) * 100).toFixed(2)
      : '100.00';

    // Multi-location accuracy
    const multiLocCount = multiLocationSkusList.length;
    const multiLocExactCount = multiLocationSkusList.filter(m => m.allLocationsExact).length;
    const multiLocAccuracy = multiLocCount > 0 ? ((multiLocExactCount / multiLocCount) * 100).toFixed(1) : '100.0';

    // 3. Center Stats with ERI & ERU
    const centerStats = Object.values(centerBreakdown).map(cb => {
      const eri = cb.totalAudited > 0 ? ((cb.exact / cb.totalAudited) * 100).toFixed(1) : '100.0';
      const eru = cb.locationsEvaluated > 0 ? ((cb.locationsExact / cb.locationsEvaluated) * 100).toFixed(1) : '100.0';
      return {
        ...cb,
        eri: parseFloat(eri),
        eru: parseFloat(eru),
        accuracy: eri,
        diffCost: Math.round(cb.diffCost * 100) / 100,
        surplusCost: Math.round(cb.surplusCost * 100) / 100,
        deficitCost: Math.round(cb.deficitCost * 100) / 100
      };
    }).sort((a, b) => b.totalAudited - a.totalAudited);

    // 4. Exactitud y Confiabilidad del Contador (Tracking de cuántas veces pidió modificar o re-editó un ítem ya contado)
    const workerStats = Object.values(workerStatsMap).map(ws => {
      const rawAcc = ws.totalCounted > 0 ? (ws.exactCounted / ws.totalCounted) * 100 : 100;
      
      const firstPassCounted = Math.max(0, ws.totalCounted - ws.reEditedItemsCount);
      const firstPassRate = ws.totalCounted > 0 ? parseFloat(((firstPassCounted / ws.totalCounted) * 100).toFixed(1)) : 100.0;
      const reEditRate = ws.totalCounted > 0 ? parseFloat(((ws.reEditCount / ws.totalCounted) * 100).toFixed(1)) : 0.0;

      // Calculate adjusted reliability accuracy considering modifications on counted items:
      // Penalty proportional to re-editions relative to total counted items
      const reEditRatio = ws.totalCounted > 0 ? (ws.reEditCount / ws.totalCounted) : 0;
      const editPenalty = (ws.reEditCount * 0.35) + (reEditRatio * 5.0);
      const effectiveAccuracy = Math.max(0, Math.min(100, rawAcc - editPenalty)).toFixed(1);

      let rating = '🏆 Sobresaliente';
      let ratingClass = 'badge-success';
      let ratingDescription = 'Alta confiabilidad. Conteo certero al 1er intento sin rectificaciones.';
      const eff = parseFloat(effectiveAccuracy);

      if (eff < 75) {
        rating = '🚨 Requiere Supervisión';
        ratingClass = 'badge-danger';
        ratingDescription = 'Baja confiabilidad. Alta tasa de desvío o reiteradas correcciones.';
      } else if (eff < 90) {
        rating = '⚠️ Conteo Inestable';
        ratingClass = 'badge-warning';
        ratingDescription = 'Conteo variable o reiteradas modificaciones solicitadas.';
      } else if (eff < 98) {
        rating = '✅ Confiable';
        ratingClass = 'badge-info';
        ratingDescription = 'Buen rendimiento y precisión con mínimas correcciones.';
      }

      return {
        ...ws,
        firstPassCounted,
        firstPassRate,
        reEditRate,
        rawAccuracy: parseFloat(rawAcc.toFixed(1)),
        accuracyPercent: parseFloat(rawAcc.toFixed(1)),
        effectiveAccuracy: parseFloat(effectiveAccuracy),
        reliabilityScore: parseFloat(effectiveAccuracy),
        rating,
        ratingClass,
        ratingDescription,
        totalDiffCost: Math.round(ws.totalDiffCost * 100) / 100
      };
    }).sort((a, b) => b.effectiveAccuracy - a.effectiveAccuracy);

    const selectedInventory = (inventoryId && inventoryId !== 'TODOS')
      ? availableInventories.find(inv => inv.id === inventoryId) || (filtered.length === 1 ? {
          id: filtered[0].id,
          name: filtered[0].name,
          type: filtered[0].type,
          center: filtered[0].center,
          status: filtered[0].status,
          createdAt: filtered[0].createdAt,
          totalItems: (filtered[0].items || []).length
        } : null)
      : null;

    return {
      filters: {
        type: cleanType,
        center: cleanCenter,
        inventoryId: cleanInventoryId,
        period: cleanPeriod,
        startDate: isValidDate(effectiveStartDate) ? effectiveStartDate.toISOString().split('T')[0] : null,
        endDate: isValidDate(effectiveEndDate) ? effectiveEndDate.toISOString().split('T')[0] : null
      },
      availableInventories,
      selectedInventory,
      isSingleInventory: !!selectedInventory,
      summary: {
        totalInventories: filtered.length,
        totalItemsPlanned,
        totalItemsAudited,
        // 1. ERI (Exactitud de Registro)
        eriPercent: parseFloat(eriPercent),
        globalAccuracyPercent: parseFloat(eriPercent),
        
        // 2. ERU (Exactitud de Ubicación)
        eruPercent: parseFloat(eruPercent),
        totalLocationsEvaluated,
        exactMatchingLocations,
        multiLocation: {
          totalMultiLocSkus: multiLocCount,
          exactMultiLocSkus: multiLocExactCount,
          accuracyPercent: parseFloat(multiLocAccuracy)
        },

        // 3. Ítems Cuadrados (Concuerdan cantidad)
        totalExactItems,
        exactItemsPercent: totalItemsAudited > 0 ? parseFloat(((totalExactItems / totalItemsAudited) * 100).toFixed(1)) : 100.0,
        exactItemsTotalUnits,
        exactItemsTotalValue: Math.round(exactItemsTotalValue * 100) / 100,

        // 4. Discrepancias Totales (Sobrantes y Faltantes)
        totalDiscrepancies: totalDiscrepantItems,
        discrepanciesPercent: totalItemsAudited > 0 ? parseFloat(((totalDiscrepantItems / totalItemsAudited) * 100).toFixed(1)) : 0.0,
        discrepancias: {
          totalCount: totalDiscrepantItems,
          sobrantes: {
            itemsCount: sobrantesItemsCount,
            units: sobrantesUnits,
            cost: Math.round(sobrantesCost * 100) / 100
          },
          faltantes: {
            itemsCount: faltantesItemsCount,
            units: faltantesUnits,
            cost: Math.round(faltantesCost * 100) / 100
          },
          danados: {
            itemsCount: totalDamagedItems > 0 ? 1 : 0,
            units: totalDamagedItems,
            cost: Math.round(totalDamagedCost * 100) / 100
          }
        },

        // 5. Impacto Financiero
        impactoFinanciero: {
          totalAbsoluteDiffCost: Math.round(totalAbsoluteDiffCost * 100) / 100,
          totalNetDiffCost: Math.round(totalNetDiffCost * 100) / 100,
          sobrantesCost: Math.round(sobrantesCost * 100) / 100,
          faltantesCost: Math.round(faltantesCost * 100) / 100,
          damagedCost: Math.round(totalDamagedCost * 100) / 100,
          damagedItemsCount: totalDamagedItems
        },

        // Legacy compatibility properties
        totalPositiveDiff: sobrantesUnits,
        totalNegativeDiff: faltantesUnits,
        totalAbsoluteDiffCost: Math.round(totalAbsoluteDiffCost * 100) / 100,
        totalNetDiffCost: Math.round(totalNetDiffCost * 100) / 100,
        totalDamagedItems,
        totalDamagedCost: Math.round(totalDamagedCost * 100) / 100
      },
      abcBreakdown: {
        A: {
          ...abcBreakdown.A,
          accuracy: abcBreakdown.A.total > 0 ? ((abcBreakdown.A.exact / abcBreakdown.A.total) * 100).toFixed(1) : '100.0',
          diffCost: Math.round(abcBreakdown.A.diffCost * 100) / 100,
          surplusCost: Math.round(abcBreakdown.A.surplusCost * 100) / 100,
          deficitCost: Math.round(abcBreakdown.A.deficitCost * 100) / 100
        },
        B: {
          ...abcBreakdown.B,
          accuracy: abcBreakdown.B.total > 0 ? ((abcBreakdown.B.exact / abcBreakdown.B.total) * 100).toFixed(1) : '100.0',
          diffCost: Math.round(abcBreakdown.B.diffCost * 100) / 100,
          surplusCost: Math.round(abcBreakdown.B.surplusCost * 100) / 100,
          deficitCost: Math.round(abcBreakdown.B.deficitCost * 100) / 100
        },
        C: {
          ...abcBreakdown.C,
          accuracy: abcBreakdown.C.total > 0 ? ((abcBreakdown.C.exact / abcBreakdown.C.total) * 100).toFixed(1) : '100.0',
          diffCost: Math.round(abcBreakdown.C.diffCost * 100) / 100,
          surplusCost: Math.round(abcBreakdown.C.surplusCost * 100) / 100,
          deficitCost: Math.round(abcBreakdown.C.deficitCost * 100) / 100
        }
      },
      centerStats,
      workerStats,
      multiLocationSkus: multiLocationSkusList,
      discrepanciesList: discrepanciesList.sort((a, b) => b.absCostoDiferencia - a.absCostoDiferencia)
    };
  }
}

module.exports = new MetricsService();
