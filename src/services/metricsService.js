const config = require('../config');
const auditService = require('./auditService');
const metricsSources = require('./metricsSourceService');
const sheetModel = require('./inventorySheetModel');

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

const parseCurrencyOrNumber = sheetModel.number;

// Cache for calculated metrics responses (TTL 30 seconds, keyed by query params)
const metricsCalculationCache = new Map();
const METRICS_CALCULATION_CACHE_TTL = 30000; // 30s TTL

function invalidateMetricsCache() {
  metricsCalculationCache.clear();
  metricsSources.invalidate();
}

class MetricsService {
  async getAllInventoriesData(filters = {}) {
    return metricsSources.load(filters);
  }

  async getDashboardMetrics({ type = 'TODOS', center = 'TODOS', inventoryId = 'TODOS', period = 'TODO', startDate = null, endDate = null, forceRefresh = false }) {
    if (forceRefresh) {
      this.invalidateCache();
    }

    // Sanitize input values
    const cleanType = (!type || type === 'undefined' || type === 'null') ? 'TODOS' : type;
    const cleanCenter = (!center || center === 'undefined' || center === 'null') ? 'TODOS' : center;
    const cleanInventoryId = (!inventoryId || inventoryId === 'undefined' || inventoryId === 'null') ? 'TODOS' : inventoryId;
    const cleanPeriod = (!period || period === 'undefined' || period === 'null') ? 'TODO' : period;

    // Check calculation cache
    const cacheKey = `${cleanType}_${cleanCenter}_${cleanInventoryId}_${cleanPeriod}_${startDate || ''}_${endDate || ''}`;
    const nowTs = Date.now();
    const cachedItem = metricsCalculationCache.get(cacheKey);
    if (!forceRefresh && cachedItem && (nowTs - cachedItem.timestamp < METRICS_CALCULATION_CACHE_TTL)) {
      return cachedItem.data;
    }

    const inventories = await this.getAllInventoriesData({ type: cleanType, center: cleanCenter, inventoryId: cleanInventoryId });

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
    // (Excluding intermediate reconteos "REC-" to avoid duplications and show only the final verified inventory)
    const availableInventories = inventories.filter(inv => {
      if (cleanType && cleanType !== 'TODOS' && inv.type !== cleanType) return false;
      if (cleanCenter && cleanCenter !== 'TODOS' && cleanCenter !== 'GLOBAL' && !config.isSameCenter(inv.center, cleanCenter)) return false;
      if (cleanPeriod !== 'TODO' && !checkDateRange(inv.createdAt)) return false;
      // Do not list separate intermediate reconteos in the dropdown; their data is already consolidated in the finalized inventory
      const idStr = String(inv.id || '');
      if (idStr.startsWith('REC-')) return false;
      return true;
    }).map(inv => ({
      id: inv.id,
      name: inv.name,
      type: inv.type,
      center: inv.center,
      status: inv.status,
      createdAt: inv.createdAt,
      totalItems: inv.totalItems ?? (inv.items || []).length,
      sourceValidation: inv.sourceValidation,
      aliases: inv.aliases,
      isHistory: !!inv.isHistory
    })).sort((a, b) => {
      const da = new Date(a.createdAt).getTime() || 0;
      const db = new Date(b.createdAt).getTime() || 0;
      return db - da;
    });

    if (cleanInventoryId !== 'TODOS' && !availableInventories.some(inv => metricsSources.matchesId(inv, cleanInventoryId))) {
      const match = inventories.find(inv => metricsSources.matchesId(inv, cleanInventoryId));
      if (match) availableInventories.unshift({ id: match.id, name: match.name, type: match.type, center: match.center,
        status: match.status, createdAt: match.createdAt, totalItems: match.totalItems,
        sourceValidation: match.sourceValidation, aliases: match.aliases, isHistory: match.isHistory });
    }

    const requestedInventories = inventories.filter(inv => {
      if (cleanType !== 'TODOS' && inv.type !== cleanType) return false;
      if (cleanCenter !== 'TODOS' && cleanCenter !== 'GLOBAL' && !config.isSameCenter(inv.center, cleanCenter)) return false;
      if (cleanInventoryId !== 'TODOS' && !metricsSources.matchesId(inv, cleanInventoryId)) return false;
      return checkDateRange(inv.createdAt);
    });
    const filtered = requestedInventories.filter(inv => inv.sourceValidation.status === 'valid');
    const sourceDiagnostics = requestedInventories.map(inv => ({ id: inv.id, name: inv.name, center: inv.center,
      spreadsheetUrl: inv.spreadsheetUrl, ...inv.sourceValidation }));
    const metricsValid = cleanInventoryId === 'TODOS' ? filtered.length > 0 : filtered.length === 1;
    const metricsComplete = metricsValid && requestedInventories.every(inv => inv.sourceValidation.status === 'valid');

    // Determine selectedInventory safely here so it is available for all downstream calculations
    const selectedInventory = cleanInventoryId !== 'TODOS'
      ? availableInventories.find(inv => metricsSources.matchesId(inv, cleanInventoryId)) || null : null;

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
    let totalExactItems = 0; // Ubicaciones cuadradas individuales
    let totalDiscrepantItems = 0; // Discrepancias por ubicación o daño
    
    // ERI (Exactitud de Registro de Inventario por SKU sumando todas las ubicaciones físicas)
    let totalSkusPlanned = 0;
    let totalSkusAudited = 0;
    let totalSkusExact = 0;

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
    let totalAuditedSystemValue = 0;
    let totalAuditedSystemUnits = 0;
    let totalAbsoluteDiffCost = 0;
    let totalInitialDiffCost = 0;
    let totalFinalDiffCost = 0;
    let initialSobrantesCost = 0;
    let initialFaltantesCost = 0;
    let finalSobrantesCost = 0;
    let finalFaltantesCost = 0;
    let finalDamagedCost = 0;
    let finalDamagedItems = 0;
    let reconciledCount = 0;
    let totalDamagedItems = 0;
    let totalDamagedCost = 0;

    // Multi-location ERU tracking (Evaluando cada estante/ubicación individual)
    let totalLocationsEvaluated = 0;
    let exactMatchingLocations = 0;

    // ERI 1er Conteo y ERI Final
    let totalSkusExactFirstCount = 0;
    let totalSkusExactFinal = 0;
    let totalRecountsDone = 0;

    // Métricas Pareadas: Primer Conteo (Columna O: Diferencia)
    let itemsCuadrados1erCount = 0;
    let itemsCuadrados1erUnits = 0;
    let itemsCuadrados1erValue = 0;
    let discrepancias1erCount = 0;
    let sobrantes1erCount = 0;
    let sobrantes1erUnits = 0;
    let sobrantes1erCost = 0;
    let faltantes1erCount = 0;
    let faltantes1erUnits = 0;
    let faltantes1erCost = 0;

    // Métricas Pareadas: Estado Final (Última diferencia completada entre Columna AM, AB y O)
    let itemsCuadradosFinalCount = 0;
    let itemsCuadradosFinalUnits = 0;
    let itemsCuadradosFinalValue = 0;
    let discrepanciasFinalCount = 0;
    let sobrantesFinalCount = 0;
    let sobrantesFinalUnits = 0;
    let sobrantesFinalCost = 0;
    let faltantesFinalCount = 0;
    let faltantesFinalUnits = 0;
    let faltantesFinalCost = 0;
    let subsanadosCount = 0;

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
          // ERI: por SKU sumando todo el stock físico de sus ubicaciones
          skusAudited: 0,
          skusExact: 0,
          // ERU: por estante/ubicación individual
          locationsEvaluated: 0,
          locationsExact: 0
        };
      }

      // Track multi-locations per inventory & SKU
      const invSkuMap = {};

      inv.items.forEach(item => {
        totalItemsPlanned++;
        centerBreakdown[invCenter].totalPlanned++;

        const rawUnitCost = item.Costo_Unitario !== undefined ? item.Costo_Unitario :
          (item.costo_unitario !== undefined ? item.costo_unitario :
          (item.costo !== undefined ? item.costo :
          (item.Costo !== undefined ? item.Costo :
          (item.unit_cost !== undefined ? item.unit_cost : 0))));
        const rawSys = item.Stock_Sistema !== undefined ? item.Stock_Sistema : (item.stock_sistema || item.stockSistema || 0);
        let stockSistema = parseCurrencyOrNumber(rawSys, 0);

        let unitCost = parseCurrencyOrNumber(rawUnitCost, 0);
        const rawDamaged = item.Mal_estado !== undefined ? item.Mal_estado : (item.mal_estado || item.malEstado || 0);
        const damaged = parseCurrencyOrNumber(rawDamaged, 0);
        const damagedCost = damaged * unitCost;

        const rawPhys = item.Stock_Fisico !== undefined ? item.Stock_Fisico : (item.stock_fisico || item.stockFisico);
        const isAudited = rawPhys !== null && rawPhys !== undefined && rawPhys !== '';
        let stockFisico = isAudited ? parseCurrencyOrNumber(rawPhys, 0) : null;

        const isCuadra = (String(item.corroboracion || '').toUpperCase().trim() === 'CUADRA' || String(item.corroborationStatus || '').toUpperCase().trim() === 'CUADRA');
        if (isCuadra && isAudited) {
          stockSistema = stockFisico;
        }

        let diff = 0;
        const rawDiff = item.Diferencia !== undefined ? item.Diferencia : (item.diferencia || null);
        if (isCuadra) {
          diff = 0;
        } else if (rawDiff !== null && rawDiff !== undefined && rawDiff !== '') {
          diff = parseCurrencyOrNumber(rawDiff, isAudited ? (stockFisico - stockSistema) : 0);
        } else if (isAudited) {
          diff = stockFisico - stockSistema;
        }

        // Multi-location grouping by SKU & distinct locations across columns D, E, F
        const skuKey = item.SKU || item.id;
        if (!invSkuMap[skuKey]) {
          invSkuMap[skuKey] = {
            sku: skuKey,
            descripcion: item.Descripcion || '',
            categoria: item.Categoria || 'GENERAL',
            abc: (item.Clasificacion_ABC || 'C').toUpperCase(),
            unitCost,
            center: invCenter,
            inventoryId: inv.id,
            inventoryName: inv.name,
            locations: []
          };
        }

        // 1er Conteo: Stock Total (Columna L)
        let stockTotal1 = null;
        if (item.Stock_Total !== undefined && item.Stock_Total !== null && String(item.Stock_Total).trim() !== '') {
          stockTotal1 = parseCurrencyOrNumber(item.Stock_Total, 0);
        } else if (isAudited) {
          stockTotal1 = (stockFisico !== null ? stockFisico : 0) + damaged;
        }

        // Reconteo 1: Stock Total Reconteo 1 (Columna Y)
        const rawStockTotalRec1 = (item.Stock_Total_Reconteo !== undefined && item.Stock_Total_Reconteo !== null && String(item.Stock_Total_Reconteo).trim() !== '') ? item.Stock_Total_Reconteo : null;
        const rawRecPhys1 = (item.Reconteo_Fisico !== undefined && item.Reconteo_Fisico !== null && String(item.Reconteo_Fisico).trim() !== '') ? item.Reconteo_Fisico : ((item.Reconteo !== undefined && item.Reconteo !== null && String(item.Reconteo).trim() !== '') ? item.Reconteo : null);
        const rawRecDam1 = (item.Reconteo_Mal_Estado !== undefined && item.Reconteo_Mal_Estado !== null && String(item.Reconteo_Mal_Estado).trim() !== '') ? item.Reconteo_Mal_Estado : ((item.Malestado_Reconteo !== undefined && item.Malestado_Reconteo !== null && String(item.Malestado_Reconteo).trim() !== '') ? item.Malestado_Reconteo : null);
        const hasDateRec1 = !!(item.Fecha_Reconteo && String(item.Fecha_Reconteo).trim() !== '');

        const hasRec1 = (rawStockTotalRec1 !== null) || (rawRecPhys1 !== null) || hasDateRec1;
        let stockTotalRec1 = null;
        if (rawStockTotalRec1 !== null) {
          stockTotalRec1 = parseCurrencyOrNumber(rawStockTotalRec1, 0);
        } else if (rawRecPhys1 !== null || hasDateRec1) {
          stockTotalRec1 = parseCurrencyOrNumber(rawRecPhys1, 0) + parseCurrencyOrNumber(rawRecDam1, 0);
        }

        // Reconteo 2: Stock Total Reconteo 2 (Columna AJ)
        const rawStockTotalRec2 = (item.Stock_Total_Reconteo_2 !== undefined && item.Stock_Total_Reconteo_2 !== null && String(item.Stock_Total_Reconteo_2).trim() !== '') ? item.Stock_Total_Reconteo_2 : null;
        const rawRecPhys2 = (item.Reconteo_2 !== undefined && item.Reconteo_2 !== null && String(item.Reconteo_2).trim() !== '') ? item.Reconteo_2 : ((item.Reconteo_Fisico_2 !== undefined && item.Reconteo_Fisico_2 !== null && String(item.Reconteo_Fisico_2).trim() !== '') ? item.Reconteo_Fisico_2 : null);
        const rawRecDam2 = (item.Malestado_Reconteo_2 !== undefined && item.Malestado_Reconteo_2 !== null && String(item.Malestado_Reconteo_2).trim() !== '') ? item.Malestado_Reconteo_2 : ((item.Reconteo_Mal_Estado_2 !== undefined && item.Reconteo_Mal_Estado_2 !== null && String(item.Reconteo_Mal_Estado_2).trim() !== '') ? item.Reconteo_Mal_Estado_2 : null);
        const hasDateRec2 = !!(item.Fecha_Reconteo_2 && String(item.Fecha_Reconteo_2).trim() !== '');

        const hasRec2 = (rawStockTotalRec2 !== null) || (rawRecPhys2 !== null) || hasDateRec2;
        let stockTotalRec2 = null;
        if (rawStockTotalRec2 !== null) {
          stockTotalRec2 = parseCurrencyOrNumber(rawStockTotalRec2, 0);
        } else if (rawRecPhys2 !== null || hasDateRec2) {
          stockTotalRec2 = parseCurrencyOrNumber(rawRecPhys2, 0) + parseCurrencyOrNumber(rawRecDam2, 0);
        }

        if (hasRec1 || hasRec2) totalRecountsDone++;

        // Determinación de los últimos datos según los conteos realizados:
        // 1. Si hubo 2do reconteo: Stock Total Reconteo 2 (Columna AJ)
        // 2. Si hubo 1er reconteo: Stock Total Reconteo 1 (Columna Y)
        // 3. Si no hubo reconteo: Stock Total 1er Conteo (Columna L)
        let stockFinal = null;
        let conteoStage = 0; // 0 = 1er conteo, 1 = reconteo 1, 2 = reconteo 2

        if (hasRec2 && stockTotalRec2 !== null) {
          stockFinal = stockTotalRec2;
          conteoStage = 2;
        } else if (hasRec1 && stockTotalRec1 !== null) {
          stockFinal = stockTotalRec1;
          conteoStage = 1;
        } else {
          stockFinal = stockTotal1;
          conteoStage = 0;
        }

        const reconteoMalEstado = hasRec1 ? (rawRecDam1 !== null ? parseCurrencyOrNumber(rawRecDam1, 0) : 0) : 0;
        let reconteoFisico = hasRec1 ? (rawRecPhys1 !== null ? parseCurrencyOrNumber(rawRecPhys1, null) : null) : null;

        // Collect all distinct locations for this item across columns D (Ubicacion), E (Ubicacion_1), F (Ubicacion_2)
        const distinctItemLocations = [];
        const locNameSet = new Set();
        const registerLoc = (lName, isAdd = false) => {
          const cleanLoc = String(lName || '').trim();
          if (cleanLoc && !locNameSet.has(cleanLoc.toUpperCase())) {
            locNameSet.add(cleanLoc.toUpperCase());
            distinctItemLocations.push({ name: cleanLoc, isAdd });
          }
        };

        registerLoc(item.Ubicacion || item.ubicacion, false);
        registerLoc(item.Ubicacion_1 || item.ubicacion1 || item.Ubicacion1, true);
        registerLoc(item.Ubicacion_2 || item.ubicacion2 || item.Ubicacion2, true);
        if (Array.isArray(item.additionalLocations)) {
          item.additionalLocations.forEach(al => {
            const strLoc = (typeof al === 'string' ? al : (al && al.location ? al.location : '')).trim();
            if (strLoc) registerLoc(strLoc, true);
          });
        }
        if (distinctItemLocations.length === 0) {
          distinctItemLocations.push({ name: 'SIN_UBICACION', isAdd: false });
        }

        // 1. PRIMER CONTEO (Columna O: Diferencia)
        // Regla del usuario: cruce entre stock del sistema (Col K) con la diferencia del primer conteo (Col O).
        // Si en Col O el valor == 0 -> se considera que no hay diferencia (exacto / cuadra).
        // Si en Col O es > 0 -> sobrante. Si < 0 -> faltante.
        let diff1 = 0;
        if (item.Diferencia !== undefined && item.Diferencia !== null && String(item.Diferencia).trim() !== '') {
          diff1 = sheetModel.number(item.Diferencia, 0);
        } else if (stockTotal1 !== null) {
          diff1 = stockTotal1 - stockSistema;
        } else if (stockFisico !== null) {
          diff1 = (stockFisico + damaged) - stockSistema;
        }

        const rawDiffCost1 = item.Costo_Diferencia !== undefined ? item.Costo_Diferencia :
          (item.costo_diferencia !== undefined ? item.costo_diferencia :
          (item.Diferencia_Costo !== undefined ? item.Diferencia_Costo : null));
        let diffCost1 = (rawDiffCost1 !== null && rawDiffCost1 !== '' && rawDiffCost1 !== undefined)
          ? parseCurrencyOrNumber(rawDiffCost1, diff1 * unitCost)
          : (diff1 * unitCost);

        if (unitCost > 0 && Math.abs(diff1) > 0) {
          const expectedCost1 = Math.abs(diff1 * unitCost);
          if (diffCost1 === 0 || Math.abs(diffCost1) > expectedCost1 * 2 + 50 || Math.abs(diffCost1) > 50000000) {
            diffCost1 = diff1 * unitCost;
          }
        } else if (diffCost1 === 0 && diff1 !== 0 && unitCost > 0) {
          diffCost1 = diff1 * unitCost;
        } else if (Math.abs(diffCost1) > 50000000) {
          diffCost1 = 0;
        }
        const absDiffCost1 = Math.abs(diffCost1);
        const isExact1 = (diff1 === 0);

        // 2. ESTADO FINAL (Dinámico según Reconteo 2 [Col AM], Reconteo 1 [Col AB] o 1er Conteo [Col O])
        // Regla del usuario: cruce con la diferencia final de Col AB o Col AM (si hay segundo reconteo).
        // Si el valor == 0 -> no hay diferencia. Si > 0 -> sobrante. Si < 0 -> faltante.
        let diffFinal = null;
        let diffCostFinal = null;
        let finalStage = 0; // 0 = 1er conteo, 1 = reconteo 1, 2 = reconteo 2

        const hasColAM = item.Diferencia_Final_2 !== undefined && item.Diferencia_Final_2 !== null && String(item.Diferencia_Final_2).trim() !== '';
        const hasColAB = item.Diferencia_Final !== undefined && item.Diferencia_Final !== null && String(item.Diferencia_Final).trim() !== '';

        if (hasColAM) {
          diffFinal = sheetModel.number(item.Diferencia_Final_2, 0);
          finalStage = 2;
          const rawC2 = item.Costo_Diferencia_Final_2;
          diffCostFinal = (rawC2 !== undefined && rawC2 !== null && String(rawC2).trim() !== '')
            ? parseCurrencyOrNumber(rawC2, diffFinal * unitCost)
            : (diffFinal * unitCost);
        } else if (hasRec2 && stockTotalRec2 !== null) {
          diffFinal = stockTotalRec2 - stockSistema;
          finalStage = 2;
          diffCostFinal = diffFinal * unitCost;
        } else if (hasColAB) {
          diffFinal = sheetModel.number(item.Diferencia_Final, 0);
          finalStage = 1;
          const rawC1 = item.Costo_Diferencia_Final;
          diffCostFinal = (rawC1 !== undefined && rawC1 !== null && String(rawC1).trim() !== '')
            ? parseCurrencyOrNumber(rawC1, diffFinal * unitCost)
            : (diffFinal * unitCost);
        } else if (hasRec1 && stockTotalRec1 !== null) {
          diffFinal = stockTotalRec1 - stockSistema;
          finalStage = 1;
          diffCostFinal = diffFinal * unitCost;
        } else {
          diffFinal = diff1;
          diffCostFinal = diffCost1;
          finalStage = 0;
        }

        if (isCuadra || item.corroboracion === 'CUADRA' || String(item.Estado || '').toLowerCase() === 'justificado') {
          diffFinal = 0;
          diffCostFinal = 0;
        }

        if (unitCost > 0 && Math.abs(diffFinal) > 0) {
          const expectedCostFinal = Math.abs(diffFinal * unitCost);
          if (diffCostFinal === 0 || Math.abs(diffCostFinal) > expectedCostFinal * 2 + 50 || Math.abs(diffCostFinal) > 50000000) {
            diffCostFinal = diffFinal * unitCost;
          }
        } else if (diffCostFinal === 0 && diffFinal !== 0 && unitCost > 0) {
          diffCostFinal = diffFinal * unitCost;
        } else if (Math.abs(diffCostFinal) > 50000000) {
          diffCostFinal = 0;
        }
        const absDiffCostFinal = Math.abs(diffCostFinal);
        const isExactFinal = (diffFinal === 0);

        distinctItemLocations.forEach(locInfo => {
          invSkuMap[skuKey].locations.push({
            id: `${item.id}-${locInfo.name}`,
            itemId: item.id,
            ubicacion: locInfo.name,
            almacen: item.Almacen || item.almacen || '',
            isAdditionalLocation: locInfo.isAdd,
            stockSistema,
            stockFisico,
            reconteoFisico,
            reconteoMalEstado,
            stockTotal1,
            hasRec1,
            stockTotalRec1,
            hasRec2,
            stockTotalRec2,
            stockFinal,
            conteoStage,
            diferencia: isAudited ? diff : null,
            diff1: isAudited ? diff1 : null,
            diffFinal: isAudited ? diffFinal : null,
            isExact1,
            isExactFinal,
            malEstado: damaged,
            responsable: item.Responsable || 'Sin Asignar',
            estado: item.Estado || 'Pendiente',
            modificationCount: item.modificationCount || 0,
            isCuadra,
            corroboracion: item.corroboracion || null
          });
        });

        if (!isAudited) return;

        totalItemsAudited++;
        totalAuditedSystemUnits += stockSistema;
        totalAuditedSystemValue += (stockSistema * unitCost);
        const itemLocationsCount = distinctItemLocations.length;
        totalLocationsEvaluated += itemLocationsCount;
        centerBreakdown[invCenter].totalAudited++;
        centerBreakdown[invCenter].auditedSystemValue = (centerBreakdown[invCenter].auditedSystemValue || 0) + (stockSistema * unitCost);
        centerBreakdown[invCenter].auditedSystemUnits = (centerBreakdown[invCenter].auditedSystemUnits || 0) + stockSistema;
        centerBreakdown[invCenter].locationsEvaluated += itemLocationsCount;

        let matchedUnits1 = 0;
        if (isExact1) {
          itemsCuadrados1erCount++;
          centerBreakdown[invCenter].itemsExactFirstCount = (centerBreakdown[invCenter].itemsExactFirstCount || 0) + 1;
          const stockVal1 = stockTotal1 !== null ? stockTotal1 : (stockFisico || 0);
          matchedUnits1 = stockSistema > 0 ? stockSistema : stockVal1;
          itemsCuadrados1erUnits += matchedUnits1;
          itemsCuadrados1erValue += (matchedUnits1 * unitCost);
          centerBreakdown[invCenter].itemsExactFirstUnits = (centerBreakdown[invCenter].itemsExactFirstUnits || 0) + matchedUnits1;
        } else {
          discrepancias1erCount++;
          if (diff1 > 0) {
            sobrantes1erCount++;
            sobrantes1erUnits += diff1;
            sobrantes1erCost += absDiffCost1;
            initialSobrantesCost += absDiffCost1;
            matchedUnits1 = Math.max(0, stockSistema - diff1);
          } else {
            faltantes1erCount++;
            faltantes1erUnits += Math.abs(diff1);
            faltantes1erCost += absDiffCost1;
            initialFaltantesCost += absDiffCost1;
            matchedUnits1 = Math.max(0, stockSistema - Math.abs(diff1));
          }
          itemsCuadrados1erUnits += matchedUnits1;
          itemsCuadrados1erValue += (matchedUnits1 * unitCost);
          centerBreakdown[invCenter].itemsExactFirstUnits = (centerBreakdown[invCenter].itemsExactFirstUnits || 0) + matchedUnits1;
        }
        totalInitialDiffCost += absDiffCost1;

        let matchedUnitsFinal = 0;
        if (isExactFinal) {
          itemsCuadradosFinalCount++;
          centerBreakdown[invCenter].itemsExactFinal = (centerBreakdown[invCenter].itemsExactFinal || 0) + 1;
          const stockFinalVal = (finalStage === 2 ? stockTotalRec2 : (finalStage === 1 ? stockTotalRec1 : stockTotal1)) || stockFisico || 0;
          matchedUnitsFinal = stockSistema > 0 ? stockSistema : stockFinalVal;
          itemsCuadradosFinalUnits += matchedUnitsFinal;
          itemsCuadradosFinalValue += (matchedUnitsFinal * unitCost);
          centerBreakdown[invCenter].itemsExactFinalUnits = (centerBreakdown[invCenter].itemsExactFinalUnits || 0) + matchedUnitsFinal;
          centerBreakdown[invCenter].exact++;
          centerBreakdown[invCenter].locationsExact += itemLocationsCount;
          exactMatchingLocations += itemLocationsCount;
          if (!isExact1) {
            subsanadosCount++;
          }
        } else {
          discrepanciasFinalCount++;
          centerBreakdown[invCenter].discrepancies++;
          if (diffFinal > 0) {
            sobrantesFinalCount++;
            sobrantesFinalUnits += diffFinal;
            sobrantesFinalCost += absDiffCostFinal;
            finalSobrantesCost += absDiffCostFinal;
            centerBreakdown[invCenter].sobrantesCount++;
            centerBreakdown[invCenter].sobrantesUnits += diffFinal;
            centerBreakdown[invCenter].surplusCost += absDiffCostFinal;
            matchedUnitsFinal = Math.max(0, stockSistema - diffFinal);
          } else {
            faltantesFinalCount++;
            faltantesFinalUnits += Math.abs(diffFinal);
            faltantesFinalCost += absDiffCostFinal;
            finalFaltantesCost += absDiffCostFinal;
            centerBreakdown[invCenter].faltantesCount++;
            centerBreakdown[invCenter].faltantesUnits += Math.abs(diffFinal);
            centerBreakdown[invCenter].deficitCost += absDiffCostFinal;
            matchedUnitsFinal = Math.max(0, stockSistema - Math.abs(diffFinal));
          }
          itemsCuadradosFinalUnits += matchedUnitsFinal;
          itemsCuadradosFinalValue += (matchedUnitsFinal * unitCost);
          centerBreakdown[invCenter].itemsExactFinalUnits = (centerBreakdown[invCenter].itemsExactFinalUnits || 0) + matchedUnitsFinal;
        }
        totalFinalDiffCost += absDiffCostFinal;

        const isAdditionalLoc = !!item.isAdditionalLocation;
        const hasRec = (hasRec1 || hasRec2);
        const finalPhys = (finalStage === 2 ? stockTotalRec2 : (finalStage === 1 ? stockTotalRec1 : stockFisico));
        const finalDamaged = (finalStage === 2 ? (rawRecDam2 !== null ? Number(rawRecDam2) : 0) : (finalStage === 1 ? reconteoMalEstado : damaged));

        if (damaged > 0) {
          totalDamagedItems += damaged;
          totalDamagedCost += damagedCost;
        }
        finalDamagedItems += finalDamaged;
        finalDamagedCost += (finalDamaged * unitCost);

        if (hasRec && isExactFinal && !isExact1) {
          reconciledCount++;
        }

        // Registrar en la lista de discrepancias si hubo discrepancia en 1er conteo o en final
        if (!isExact1 || !isExactFinal || damaged > 0) {
          let tipoDiscrepancia = 'CUADRADO';
          if (diffFinal > 0) tipoDiscrepancia = 'SOBRANTE';
          else if (diffFinal < 0) tipoDiscrepancia = 'FALTANTE';
          else if (!isExact1 && isExactFinal) tipoDiscrepancia = 'SUBSANADO';
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
            reconteoFisico,
            reconteoMalEstado,
            diferencia: diffFinal,
            diferencia1erConteo: diff1,
            diferenciaFinal: diffFinal,
            costoUnitario: unitCost,
            costoDiferencia: diffCostFinal,
            absCostoDiferencia: absDiffCostFinal,
            costoDiferencia1erConteo: diffCost1,
            absCostoDiferencia1erConteo: absDiffCost1,
            costoDiferenciaFinal: diffCostFinal,
            absCostoDiferenciaFinal: absDiffCostFinal,
            estaSubsanado: (!isExact1 && isExactFinal),
            esDiscrepancia1erConteo: !isExact1,
            esDiscrepanciaFinal: !isExactFinal,
            finalStage,
            malEstado: damaged,
            costoMalEstado: damagedCost,
            tipoDiscrepancia,
            abc: (item.Clasificacion_ABC || 'C').toUpperCase(),
            responsable: item.Responsable || 'Sin Asignar',
            fechaConteo: item.Fecha_Ultimo_Conteo,
            almacen: item.Almacen || '',
            justificacion: item.Comentario_Justificacion || item.Razon || item.Comentario || item.Justificacion || ''
          });
        }

        totalAbsoluteDiffCost += absDiffCostFinal;
        centerBreakdown[invCenter].diffCost += absDiffCostFinal;

        const isExact = isExactFinal;
        const diffCost = diffCostFinal;
        const absDiffCost = absDiffCostFinal;
        const finalDiff = diffFinal;

        // ABC breakdown
        const abc = (item.Clasificacion_ABC || 'C').toUpperCase();
        if (abcBreakdown[abc]) {
          abcBreakdown[abc].total++;
          if (isExact) abcBreakdown[abc].exact++;
          abcBreakdown[abc].diffCost += absDiffCost;
          if (finalDiff > 0) abcBreakdown[abc].surplusCost += diffCost;
          if (finalDiff < 0) abcBreakdown[abc].deficitCost += absDiffCost;
          if (damaged > 0) abcBreakdown[abc].damagedCost += damagedCost;
        }

        // Worker stats tracking
        const workerName = item.Responsable || 'Sin Asignar';
        if (!workerStatsMap[workerName]) {
          const normWorker = workerName.toLowerCase().trim();
          let workerEditData = workerEditsMap[workerName];
          if (!workerEditData) {
            for (const [key, val] of Object.entries(workerEditsMap)) {
              const k = key.toLowerCase().trim();
              if (k === normWorker || normWorker.includes(k) || k.includes(normWorker)) {
                workerEditData = val;
                break;
              }
            }
          }
          if (!workerEditData) {
            workerEditData = { totalReEdits: 0, reEditedItemsMap: {}, reEditHistory: [] };
          }

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

        // Multi-location worker tracking item
        const rawRecPhys = (item.Reconteo_Fisico !== undefined && item.Reconteo_Fisico !== null && item.Reconteo_Fisico !== '') ? parseCurrencyOrNumber(item.Reconteo_Fisico, null) : null;
        const rawRecDamaged = (item.Reconteo_Mal_Estado !== undefined && item.Reconteo_Mal_Estado !== null && item.Reconteo_Mal_Estado !== '') ? parseCurrencyOrNumber(item.Reconteo_Mal_Estado, 0) : 0;

        workerStatsMap[workerName].itemsEvaluated = workerStatsMap[workerName].itemsEvaluated || [];
        workerStatsMap[workerName].itemsEvaluated.push({
          sku: item.SKU,
          skuKey,
          ubicacion: item.Ubicacion,
          stockSistema,
          stockFisico,
          reconteoFisico: rawRecPhys,
          reconteoMalEstado: rawRecDamaged,
          damaged,
          diff: finalDiff,
          diff1,
          diffFinal,
          isExact,
          modificationCount: item.modificationCount || 0
        });

        workerStatsMap[workerName].totalCounted++;
        if (isExact) {
          workerStatsMap[workerName].exactCounted++;
        } else {
          workerStatsMap[workerName].discrepanciesCounted++;
          if (finalDiff > 0) workerStatsMap[workerName].sobrantesCounted++;
          if (finalDiff < 0) workerStatsMap[workerName].faltantesCounted++;
        }
        workerStatsMap[workerName].damagedFound += damaged;
        workerStatsMap[workerName].totalDiffCost += absDiffCost;
      });

      // Grouping and ERI Analysis per unique SKU in this inventory
      Object.values(invSkuMap).forEach(skuObj => {
        totalSkusPlanned++;
        const locationsCount = skuObj.locations.length;
        const itemRows = [...new Map(skuObj.locations.map(l => [l.itemId, l])).values()];
        const auditedLocations = itemRows.filter(l => l.stockFisico !== null && l.stockFisico !== undefined);
        const isSkuAudited = auditedLocations.length > 0;

        if (isSkuAudited) {
          totalSkusAudited++;
          centerBreakdown[invCenter].skusAudited++;

          const totalStockSistema = itemRows.reduce((acc, l) => acc + (l.stockSistema || 0), 0);
          const totalStockTotal1 = auditedLocations.reduce((acc, l) => {
            const val = l.stockTotal1 !== null && l.stockTotal1 !== undefined ? l.stockTotal1 : ((l.stockFisico !== null ? l.stockFisico : 0) + (l.malEstado || 0));
            return acc + val;
          }, 0);
          
          // ERI 1er Conteo: Cruce entre Stock Sistema (Col K) y Diferencia Primer Conteo (Col O)
          // Si en la columna O el valor es igual a 0, entonces se considera que no hay diferencia.
          // Pero si es menor o mayor a 0, se considera que la diferencia sí existe (sobrante > 0, faltante < 0).
          const totalDiff1 = auditedLocations.reduce((acc, l) => {
            return acc + (l.diff1 !== undefined && l.diff1 !== null ? Number(l.diff1) : (Number(l.diferencia || 0)));
          }, 0);
          const isSkuExact1 = (totalDiff1 === 0) || skuObj.locations.some(l => l.isCuadra || l.corroboracion === 'CUADRA');

          if (isSkuExact1) {
            totalSkusExactFirstCount++;
            centerBreakdown[invCenter].skusExactFirstCount = (centerBreakdown[invCenter].skusExactFirstCount || 0) + 1;
          }

          // ERI Final: Dinámico según datos del bloque del primer reconteo (Col AB) o segundo reconteo (Col AM)
          // Si hay segundo reconteo, se toma la columna AM. Si hay primer reconteo, se toma la columna AB.
          // Si no hubo reconteo, se toma la diferencia inicial de Col O.
          // Si el valor es igual a 0, entonces no hay diferencia. Si es menor o mayor a 0, la diferencia sí existe.
          const totalDiffFinal = auditedLocations.reduce((acc, l) => {
            return acc + (l.diffFinal !== undefined && l.diffFinal !== null ? Number(l.diffFinal) : 0);
          }, 0);
          const isSkuJustifiedCuadra = skuObj.locations.some(l => l.isCuadra || l.corroboracion === 'CUADRA' || String(l.estado || '').toLowerCase() === 'justificado');
          const isSkuExactFinal = (totalDiffFinal === 0) || isSkuJustifiedCuadra;

          if (isSkuExactFinal) {
            totalSkusExactFinal++;
            totalSkusExact++;
            centerBreakdown[invCenter].skusExact++;
            centerBreakdown[invCenter].skusExactFinal = (centerBreakdown[invCenter].skusExactFinal || 0) + 1;
          }

          // Multi-location tracking
          if (locationsCount > 1) {
            const isFullyAudited = skuObj.locations.every(l => l.stockFisico !== null && l.stockFisico !== undefined);
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
              totalStockFisico: isFullyAudited ? totalStockTotal1 : null,
              totalDiferencia: isFullyAudited ? totalDiff1 : null,
              allLocationsExact,
              isSkuExact: isSkuExact1,
              isSkuExactFinal,
              status: isSkuExactFinal ? 'EXACTO_ERI_FINAL' : (isSkuExact1 ? 'EXACTO_ERI' : (allLocationsExact ? 'EXACTO' : (isFullyAudited ? 'CON_DIFERENCIAS' : 'EN_PROGRESO')))
            });
          }
        }
      });
    });

    // =========================================================================
    // LOS 3 ERIs OFICIALES DE INVENTARIO:
    // 1. ERI de Cantidad de Items (PRINCIPAL): % de registros/ítems físicos exactos sin diferencia
    // 2. ERI de SKU: % de códigos únicos exactos consolidando todas sus ubicaciones
    // 3. ERI Monetario: % de exactitud financiera en valor (100 - % desviación monetaria)
    // =========================================================================

    // 1. ERI de Cantidad de Ítems (Principal)
    // Se calcula sobre la cantidad total de existencias/unidades físicas auditadas que debían haberse contado (totalAuditedSystemUnits, ej: 299 ítems)
    // considerando que 1 SKU puede contener más de 1 ítem/existencia física.
    const eriItemInicial = totalAuditedSystemUnits > 0
      ? parseFloat(((itemsCuadrados1erUnits / totalAuditedSystemUnits) * 100).toFixed(2))
      : (totalItemsAudited > 0 ? parseFloat(((itemsCuadrados1erCount / totalItemsAudited) * 100).toFixed(2)) : 0.0);
    const eriItemFinal = totalAuditedSystemUnits > 0
      ? parseFloat(((itemsCuadradosFinalUnits / totalAuditedSystemUnits) * 100).toFixed(2))
      : (totalItemsAudited > 0 ? parseFloat(((itemsCuadradosFinalCount / totalItemsAudited) * 100).toFixed(2)) : 0.0);

    // 2. ERI de SKU
    const eriSkuInicial = totalSkusAudited > 0
      ? parseFloat(((totalSkusExactFirstCount / totalSkusAudited) * 100).toFixed(2))
      : 0.0;
    const eriSkuFinal = totalSkusAudited > 0
      ? parseFloat(((totalSkusExactFinal / totalSkusAudited) * 100).toFixed(2))
      : 0.0;

    // 3. ERI Monetario
    let eriMonetarioInicial = 100.0;
    let eriMonetarioFinal = 100.0;
    if (totalAuditedSystemValue > 0) {
      eriMonetarioInicial = parseFloat((Math.max(0, Math.min(100, ((totalAuditedSystemValue - totalInitialDiffCost) / totalAuditedSystemValue) * 100))).toFixed(2));
      eriMonetarioFinal = parseFloat((Math.max(0, Math.min(100, ((totalAuditedSystemValue - totalFinalDiffCost) / totalAuditedSystemValue) * 100))).toFixed(2));
    } else {
      eriMonetarioInicial = totalInitialDiffCost === 0 ? 100.0 : 0.0;
      eriMonetarioFinal = totalFinalDiffCost === 0 ? 100.0 : 0.0;
    }

    const eriFirstCountPercent = eriItemInicial.toFixed(2);
    const eriFinalPercent = eriItemFinal.toFixed(2);
    const isReconteoPending = (itemsCuadrados1erUnits < totalAuditedSystemUnits || itemsCuadrados1erCount < totalItemsAudited) && (totalRecountsDone === 0) && selectedInventory && (selectedInventory.status === 'EN_RECONTEO');
    const eriPercent = eriFinalPercent; // El principal es el ERI de Cantidad de Ítems

    // 2. ERU (Exactitud de Registro de Ubicación %) - Evaluando cada estante/ubicación individual y adicional
    const eruPercent = totalLocationsEvaluated > 0
      ? ((exactMatchingLocations / totalLocationsEvaluated) * 100).toFixed(2)
      : '0.00';

    // Multi-location accuracy
    const multiLocCount = multiLocationSkusList.length;
    const multiLocExactCount = multiLocationSkusList.filter(m => m.isSkuExact || m.allLocationsExact).length;
    const multiLocAccuracy = multiLocCount > 0 ? ((multiLocExactCount / multiLocCount) * 100).toFixed(1) : '100.0';

    // 3. Center Stats with los 3 ERIs & ERU
    const centerStats = Object.values(centerBreakdown).map(cb => {
      const cSysUnits = cb.auditedSystemUnits || 0;
      const cItem1 = cSysUnits > 0
        ? (((cb.itemsExactFirstUnits || 0) / cSysUnits) * 100).toFixed(1)
        : (cb.totalAudited > 0 ? (((cb.itemsExactFirstCount || 0) / cb.totalAudited) * 100).toFixed(1) : '0.0');
      const cItemF = cSysUnits > 0
        ? (((cb.itemsExactFinalUnits || 0) / cSysUnits) * 100).toFixed(1)
        : (cb.totalAudited > 0 ? (((cb.itemsExactFinal || cb.exact || 0) / cb.totalAudited) * 100).toFixed(1) : '0.0');
      const cSku1 = cb.skusAudited > 0 ? (((cb.skusExactFirstCount || cb.skusExact || 0) / cb.skusAudited) * 100).toFixed(1) : '0.0';
      const cSkuF = cb.skusAudited > 0 ? (((cb.skusExactFinal || cb.skusExact || 0) / cb.skusAudited) * 100).toFixed(1) : '0.0';
      const cSysVal = cb.auditedSystemValue || 0;
      const cMoney1 = cSysVal > 0 ? Math.max(0, Math.min(100, ((cSysVal - (cb.surplusCost || 0) - (cb.deficitCost || 0)) / cSysVal) * 100)).toFixed(1) : '100.0';
      const cMoneyF = cSysVal > 0 ? Math.max(0, Math.min(100, ((cSysVal - (cb.diffCost || 0)) / cSysVal) * 100)).toFixed(1) : '100.0';
      const eru = cb.locationsEvaluated > 0 ? ((cb.locationsExact / cb.locationsEvaluated) * 100).toFixed(1) : '0.0';

      return {
        ...cb,
        eri: parseFloat(cItemF), // Principal: ERI Cantidad de Ítems
        eriFirstCount: parseFloat(cItem1),
        eriFinal: parseFloat(cItemF),
        eriItemInicial: parseFloat(cItem1),
        eriItemFinal: parseFloat(cItemF),
        eriSkuInicial: parseFloat(cSku1),
        eriSkuFinal: parseFloat(cSkuF),
        eriMonetarioInicial: parseFloat(cMoney1),
        eriMonetarioFinal: parseFloat(cMoneyF),
        eru: parseFloat(eru),
        accuracy: cItemF,
        diffCost: Math.round(cb.diffCost * 100) / 100,
        surplusCost: Math.round(cb.surplusCost * 100) / 100,
        deficitCost: Math.round(cb.deficitCost * 100) / 100
      };
    }).sort((a, b) => b.totalAudited - a.totalAudited);

    // 4. Exactitud y Confiabilidad del Contador (Lógica solicitada por el usuario: Col D Ubicación, Col J Stock Físico y Col U Reconteo)
    // "si un item tiene mas de 1 ubicacion y tiene modificacion un valor mayor a 0 esto no tendrá un valor negativo en su calificacion de exactitud,
    // pero si no tiene mas de 1 una ubicacion y el valor en el reconteo es mayor a 0 entonces tendrá un valor negativo en su calificacion.
    // La medición se hace en % y según el total del inventario a contar esto se vuelve un porcentaje dinámico."
    const workerStats = Object.values(workerStatsMap).map(ws => {
      let penalizedErrors = 0;
      let forgivenMultiLoc = 0;

      (ws.itemsEvaluated || []).forEach(it => {
        // Find how many locations this SKU has across the analyzed dataset
        const matchingMulti = multiLocationSkusList.find(m => m.sku === it.sku);
        const hasMultipleLocations = matchingMulti ? matchingMulti.locationsCount > 1 : false;

        const hasRecountValue = it.reconteoFisico !== null && it.reconteoFisico !== undefined && it.reconteoFisico > 0;
        const hasModification = (it.modificationCount > 0) || hasRecountValue;
        const hasDiscrepancy = !it.isExact || (it.reconteoFisico !== null && it.reconteoFisico !== it.stockSistema);

        if (hasMultipleLocations) {
          // Rule: Si tiene más de 1 ubicación y tiene modificación / reconteo > 0, NO tiene valor negativo en su calificación
          if (hasModification || hasDiscrepancy) {
            forgivenMultiLoc++;
          }
        } else {
          // Rule: Si NO tiene más de 1 ubicación y el valor en reconteo es > 0 o tuvo discrepancia, SÍ tendrá un valor negativo
          if (hasRecountValue || (hasModification && hasDiscrepancy)) {
            penalizedErrors++;
          } else if (!it.isExact && it.reconteoFisico === null) {
            penalizedErrors++;
          }
        }
      });

      const totalLines = ws.totalCounted;
      const accurateLines = Math.max(0, totalLines - penalizedErrors);
      // Dynamic percentage: each counted line/location is (100 / totalLines)%
      const calculatedAccuracy = totalLines > 0
        ? parseFloat(((accurateLines / totalLines) * 100).toFixed(1))
        : 100.0;

      const rawAcc = ws.totalCounted > 0 ? (ws.exactCounted / ws.totalCounted) * 100 : 0;
      const firstPassCounted = Math.max(0, ws.totalCounted - ws.reEditedItemsCount);
      const firstPassRate = ws.totalCounted > 0 ? parseFloat(((firstPassCounted / ws.totalCounted) * 100).toFixed(1)) : 0.0;
      const reEditRate = ws.totalCounted > 0 ? parseFloat(((ws.reEditCount / ws.totalCounted) * 100).toFixed(1)) : 0.0;

      let rating = '🏆 Sobresaliente';
      let ratingClass = 'badge-success';
      let ratingDescription = 'Alta confiabilidad. Conteo certero sin rectificaciones en ubicaciones únicas.';
      const eff = calculatedAccuracy;

      if (ws.totalCounted === 0) {
        rating = '⚪ Sin Conteos';
        ratingClass = 'badge-neutral';
        ratingDescription = 'No registra conteos en este periodo o filtro.';
      } else if (eff < 75) {
        rating = '🚨 Requiere Supervisión';
        ratingClass = 'badge-danger';
        ratingDescription = 'Baja confiabilidad. Discrepancias detectadas en ubicaciones únicas.';
      } else if (eff < 90) {
        rating = '⚠️ Conteo Inestable';
        ratingClass = 'badge-warning';
        ratingDescription = 'Conteo variable o rectificaciones en ítems de ubicación única.';
      } else if (eff < 98) {
        rating = '✅ Confiable';
        ratingClass = 'badge-info';
        ratingDescription = 'Buen rendimiento y precisión.';
      }

      return {
        ...ws,
        firstPassCounted,
        firstPassRate,
        reEditRate,
        penalizedErrors,
        forgivenMultiLoc,
        rawAccuracy: parseFloat(rawAcc.toFixed(1)),
        accuracyPercent: calculatedAccuracy,
        effectiveAccuracy: calculatedAccuracy,
        reliabilityScore: calculatedAccuracy,
        rating,
        ratingClass,
        ratingDescription,
        totalDiffCost: Math.round(ws.totalDiffCost * 100) / 100
      };
    }).sort((a, b) => b.effectiveAccuracy - a.effectiveAccuracy);

    // =========================================================================
    // TENDENCIA HISTÓRICA DEL ERI DE CANTIDAD DE ÍTEMS (ÚLTIMOS 5 INVENTARIOS CERRADOS)
    // =========================================================================
    const closedInventories = [];
    const seenClosedKeys = new Set();

    inventories.filter(inv => inv.sourceValidation.status === 'valid' && checkDateRange(inv.createdAt)).forEach(inv => {
      const isClosed = inv.isHistory || String(inv.status || '').toUpperCase() === 'REVISADO';
      const invIdStr = String(inv.id || inv.fileId || inv.inventoryId || '');
      if (!isClosed || invIdStr.startsWith('REC-')) return;

      const normKey = (inv.fileId || inv.inventoryId || inv.fileName || inv.id || '').toLowerCase().trim();
      if (seenClosedKeys.has(normKey)) return;
      seenClosedKeys.add(normKey);

      let totalUnits = 0, exactUnits = 0, linesCount = 0, exactLines = 0;
      inv.items.forEach(it => {
        if (it.Stock_Fisico === null || it.Stock_Fisico === undefined) return;
        linesCount++;
        let diff = it.Diferencia_Final_2 ?? it.Diferencia_Final ?? it.Diferencia;
        const isCuadra = String(it.corroboracion || it.corroborationStatus || '').toUpperCase() === 'CUADRA';
        if (isCuadra || String(it.Estado || '').toLowerCase() === 'justificado') diff = 0;
        const units = isCuadra ? it.Stock_Fisico : it.Stock_Sistema;
        totalUnits += units;
        if (diff === 0) { exactLines++; exactUnits += units > 0 ? units : (it.Stock_Total || 0); }
        else exactUnits += Math.max(0, units - Math.abs(diff));
      });
      const eriVal = totalUnits > 0 ? Number((exactUnits / totalUnits * 100).toFixed(2))
        : (linesCount > 0 ? Number((exactLines / linesCount * 100).toFixed(2)) : null);

      if (eriVal !== null) {
        const closedDate = inv.closedAt || inv.createdAt;
        if (!closedDate || !isValidDate(new Date(closedDate))) return;
        closedInventories.push({
          id: inv.id || inv.fileId,
          name: inv.name || inv.fileName || inv.id,
          center: inv.center || '1300',
          date: closedDate,
          eri: eriVal,
          totalUnits,
          exactUnits
        });
      }
    });

    // Ordenar cronológicamente ascendente (antiguo -> reciente)
    closedInventories.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const trendSeries = closedInventories.slice(-5);

    const trendLabels = trendSeries.map(item => {
      const d = new Date(item.date);
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = d.toLocaleDateString('es-BO', { month: 'short' }).replace('.', '');
      let cleanName = item.name || item.id || 'Cíclico';
      cleanName = cleanName
        .replace(/Inventario_CICLICO_/gi, 'Inv. Cíclico ')
        .replace(/INV-CICLICO-/gi, 'Inv. Cíclico ')
        .replace(/_FINAL_.*$/gi, '')
        .replace(/\.xlsx$/gi, '')
        .trim();
      if (cleanName.length > 22) cleanName = cleanName.substring(0, 20) + '..';
      return `${cleanName} • ${day}/${month}`;
    });

    // Función de evaluación según la meta corporativa definida por NIBOL:
    // • menos del 90%: MAL
    // • 95%: MÍNIMO ACEPTABLE
    // • 98%: EXCELENTE
    // • 100%: PERFECTO
    function evaluateCorporateTier(eriVal) {
      const val = Number(eriVal);
      if (val >= 100) {
        return {
          tier: 'PERFECTO',
          label: 'Perfecto (100%)',
          shortLabel: 'Perfecto',
          color: '#06b6d4',
          badgeClass: 'badge-cyan',
          icon: 'fa-gem',
          meetsTarget: true,
          description: 'Exactitud del 100% sin discrepancias'
        };
      }
      if (val >= 98) {
        return {
          tier: 'EXCELENTE',
          label: 'Excelente (≥98%)',
          shortLabel: 'Excelente',
          color: '#10b981',
          badgeClass: 'badge-success',
          icon: 'fa-star',
          meetsTarget: true,
          description: 'Exactitud sobresaliente de clase mundial'
        };
      }
      if (val >= 95) {
        return {
          tier: 'MINIMO_ACEPTABLE',
          label: 'Mínimo Aceptable (≥95%)',
          shortLabel: 'Mínimo Aceptable',
          color: '#3b82f6',
          badgeClass: 'badge-info',
          icon: 'fa-check',
          meetsTarget: true,
          description: 'Cumple el estándar corporativo mínimo de NIBOL'
        };
      }
      if (val >= 90) {
        return {
          tier: 'OBSERVACION',
          label: 'En Observación (90% - 94.9%)',
          shortLabel: 'En Observación',
          color: '#f59e0b',
          badgeClass: 'badge-warning',
          icon: 'fa-circle-exclamation',
          meetsTarget: false,
          description: 'Bajo el umbral mínimo aceptable (95%)'
        };
      }
      return {
        tier: 'MAL',
        label: 'Mal (<90%)',
        shortLabel: 'Mal',
        color: '#ef4444',
        badgeClass: 'badge-danger',
        icon: 'fa-triangle-exclamation',
        meetsTarget: false,
        description: 'Exactitud crítica deficiente que requiere plan de acción inmediato'
      };
    }

    const trendSeriesWithEval = trendSeries.map(item => ({
      ...item,
      evaluation: evaluateCorporateTier(item.eri)
    }));

    const trendValues = trendSeriesWithEval.map(item => Number(item.eri.toFixed(2)));
    const latestEri = trendValues[trendValues.length - 1];
    const previousEri = trendValues[trendValues.length - 2];
    const delta = parseFloat((latestEri - previousEri).toFixed(2));
    const trendStatus = delta > 0 ? 'MEJORA' : (delta < 0 ? 'RETROCESO' : 'ESTABLE');

    const historicalEriTrend = {
      labels: trendLabels,
      data: trendValues,
      series: trendSeriesWithEval,
      target: 95.0,
      corporateTargets: {
        mal: 90.0,
        minimoAceptable: 95.0,
        excelente: 98.0,
        perfecto: 100.0,
        scale: [
          { tier: 'MAL', threshold: '< 90%', label: 'Mal', color: '#ef4444' },
          { tier: 'MINIMO_ACEPTABLE', threshold: '95%', label: 'Mínimo Aceptable', color: '#3b82f6' },
          { tier: 'EXCELENTE', threshold: '98%', label: 'Excelente', color: '#10b981' },
          { tier: 'PERFECTO', threshold: '100%', label: 'Perfecto', color: '#06b6d4' }
        ]
      },
      latestEri,
      previousEri,
      latestEvaluation: evaluateCorporateTier(latestEri),
      delta,
      trendStatus,
      average: parseFloat((trendValues.reduce((a, b) => a + b, 0) / trendValues.length).toFixed(2))
    };

    const activeIsFinal = totalRecountsDone > 0;
    const activeExactCount = activeIsFinal ? itemsCuadradosFinalCount : itemsCuadrados1erCount;
    const activeExactUnits = activeIsFinal ? itemsCuadradosFinalUnits : itemsCuadrados1erUnits;
    const activeExactValue = activeIsFinal ? itemsCuadradosFinalValue : itemsCuadrados1erValue;
    const activeDiscrepanciesCount = activeIsFinal ? discrepanciasFinalCount : discrepancias1erCount;
    const activeSobrantesCount = activeIsFinal ? sobrantesFinalCount : sobrantes1erCount;
    const activeSobrantesUnits = activeIsFinal ? sobrantesFinalUnits : sobrantes1erUnits;
    const activeSobrantesCost = activeIsFinal ? sobrantesFinalCost : sobrantes1erCost;
    const activeFaltantesCount = activeIsFinal ? faltantesFinalCount : faltantes1erCount;
    const activeFaltantesUnits = activeIsFinal ? faltantesFinalUnits : faltantes1erUnits;
    const activeFaltantesCost = activeIsFinal ? faltantesFinalCost : faltantes1erCost;

    const result = {
      metricsValid, metricsComplete, sourceDiagnostics,
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
      historicalEriTrend,
      summary: {
        totalInventories: filtered.length,
        totalItemsPlanned,
        totalItemsAudited,
        totalSkusPlanned,
        totalSkusAudited,
        totalSkusExact,
        totalAuditedSystemUnits,
        totalAuditedSystemValue: Math.round(totalAuditedSystemValue * 100) / 100,

        // =========================================================================
        // LOS 3 ERIs OFICIALES:
        // 1. ERI de Cantidad de Items (PRINCIPAL): Inicial y Final
        // 2. ERI de SKU: Inicial y Final
        // 3. ERI Monetario: Inicial y Final
        // =========================================================================
        // ERI PRINCIPAL (ERI de Cantidad de Ítems)
        eri: eriItemFinal,
        eriPercent: eriItemFinal,
        eriInicial: eriItemInicial,
        eriFinal: eriItemFinal,
        eriFirstCountPercent: eriItemInicial,
        eriFinalPercent: eriItemFinal,

        // 1. ERI de Cantidad de Ítems (Principal)
        eriItems: {
          inicial: eriItemInicial,
          final: eriItemFinal,
          exactInicial: itemsCuadrados1erUnits,
          exactFinal: itemsCuadradosFinalUnits,
          total: totalAuditedSystemUnits,
          totalExpected: totalAuditedSystemUnits,
          unitsTotal: totalAuditedSystemUnits,
          unitsExactInicial: itemsCuadrados1erUnits,
          unitsExactFinal: itemsCuadradosFinalUnits,
          linesExactInicial: itemsCuadrados1erCount,
          linesExactFinal: itemsCuadradosFinalCount,
          linesTotal: totalItemsAudited
        },
        eriItemInicial,
        eriItemFinal,

        // 2. ERI de SKU
        eriSku: {
          inicial: eriSkuInicial,
          final: eriSkuFinal,
          exactInicial: totalSkusExactFirstCount,
          exactFinal: totalSkusExactFinal,
          total: totalSkusAudited
        },
        eriSkuInicial,
        eriSkuFinal,

        // 3. ERI Monetario
        eriMonetario: {
          inicial: eriMonetarioInicial,
          final: eriMonetarioFinal,
          totalSystemValue: Math.round(totalAuditedSystemValue * 100) / 100,
          diffCostInicial: Math.round(totalInitialDiffCost * 100) / 100,
          diffCostFinal: Math.round(totalFinalDiffCost * 100) / 100
        },
        eriMonetarioInicial,
        eriMonetarioFinal,

        isReconteoPending,
        totalSkusExactFirstCount,
        totalSkusExactFinal,
        totalItemsAuditedUnits: totalAuditedSystemUnits,
        totalItemsAuditedLines: totalItemsAudited,
        globalAccuracyPercent: eriItemFinal,

        // Métricas Pareadas: Primer Conteo (Columna O: Diferencia)
        itemsCuadrados1er: itemsCuadrados1erCount,
        itemsCuadrados1erConteo: itemsCuadrados1erCount,
        itemsCuadrados1erUnits,
        itemsCuadrados1erValue: Math.round(itemsCuadrados1erValue * 100) / 100,
        itemsCuadrados1erPercent: totalAuditedSystemUnits > 0
          ? parseFloat(((itemsCuadrados1erUnits / totalAuditedSystemUnits) * 100).toFixed(1))
          : (totalItemsAudited > 0 ? parseFloat(((itemsCuadrados1erCount / totalItemsAudited) * 100).toFixed(1)) : 0.0),
        discrepancias1er: discrepancias1erCount,
        discrepancias1erConteo: discrepancias1erCount,
        discrepancias1erPercent: totalAuditedSystemUnits > 0
          ? parseFloat((((sobrantes1erUnits + faltantes1erUnits) / totalAuditedSystemUnits) * 100).toFixed(1))
          : (totalItemsAudited > 0 ? parseFloat(((discrepancias1erCount / totalItemsAudited) * 100).toFixed(1)) : 0.0),
        sobrantes1er: {
          itemsCount: sobrantes1erCount,
          units: sobrantes1erUnits,
          cost: Math.round(sobrantes1erCost * 100) / 100
        },
        faltantes1er: {
          itemsCount: faltantes1erCount,
          units: faltantes1erUnits,
          cost: Math.round(faltantes1erCost * 100) / 100
        },
        impactoFinanciero1er: Math.round(totalInitialDiffCost * 100) / 100,

        // Métricas Pareadas: Estado Final (Última diferencia entre AM, AB y O)
        itemsCuadradosFinal: itemsCuadradosFinalCount,
        itemsCuadradosFinalUnits,
        itemsCuadradosFinalValue: Math.round(itemsCuadradosFinalValue * 100) / 100,
        itemsCuadradosFinalPercent: totalAuditedSystemUnits > 0
          ? parseFloat(((itemsCuadradosFinalUnits / totalAuditedSystemUnits) * 100).toFixed(1))
          : (totalItemsAudited > 0 ? parseFloat(((itemsCuadradosFinalCount / totalItemsAudited) * 100).toFixed(1)) : 0.0),
        subsanadosCount,
        discrepanciasFinal: discrepanciasFinalCount,
        discrepanciasFinalPercent: totalItemsAudited > 0 ? parseFloat(((discrepanciasFinalCount / totalItemsAudited) * 100).toFixed(1)) : 0.0,
        sobrantesFinal: {
          itemsCount: sobrantesFinalCount,
          units: sobrantesFinalUnits,
          cost: Math.round(sobrantesFinalCost * 100) / 100
        },
        faltantesFinal: {
          itemsCount: faltantesFinalCount,
          units: faltantesFinalUnits,
          cost: Math.round(faltantesFinalCost * 100) / 100
        },
        impactoFinancieroFinal: Math.round(totalFinalDiffCost * 100) / 100,
        reduccionDiscrepancias: Math.max(0, discrepancias1erCount - discrepanciasFinalCount),
        reduccionErrorPercent: discrepancias1erCount > 0
          ? parseFloat((((discrepancias1erCount - discrepanciasFinalCount) / discrepancias1erCount) * 100).toFixed(1))
          : 0.0,
        
        // 2. ERU (Exactitud de Registro de Ubicación por cada estante o ubicación individual)
        eruPercent: parseFloat(eruPercent),
        totalLocationsEvaluated,
        exactMatchingLocations,
        multiLocationCount: multiLocCount,
        multiLocationExactCount: multiLocExactCount,
        multiLocationAccuracy: parseFloat(multiLocAccuracy),
        multiLocation: {
          totalMultiLocSkus: multiLocCount,
          exactMultiLocSkus: multiLocExactCount,
          accuracyPercent: parseFloat(multiLocAccuracy)
        },

        // 3. Ítems Cuadrados (ERI a nivel SKU y desglose)
        totalExactItems: activeExactCount,
        exactItemsCount: activeExactCount,
        exactItemsPercent: totalItemsAudited > 0 ? parseFloat(((activeExactCount / totalItemsAudited) * 100).toFixed(1)) : 0.0,
        exactLocationsCount: activeExactCount,
        exactItemsTotalUnits: activeExactUnits,
        exactItemsUnits: activeExactUnits,
        exactItemsTotalValue: Math.round(activeExactValue * 100) / 100,
        exactItemsValue: Math.round(activeExactValue * 100) / 100,

        // 4. Discrepancias Totales (Sobrantes y Faltantes)
        totalDiscrepancies: activeDiscrepanciesCount,
        discrepantItemsCount: activeDiscrepanciesCount,
        discrepanciesPercent: totalItemsAudited > 0 ? parseFloat(((activeDiscrepanciesCount / totalItemsAudited) * 100).toFixed(1)) : 0.0,
        sobrantesItemsCount: activeSobrantesCount,
        sobrantesUnits: activeSobrantesUnits,
        sobrantesCost: Math.round(activeSobrantesCost * 100) / 100,
        faltantesItemsCount: activeFaltantesCount,
        faltantesUnits: activeFaltantesUnits,
        faltantesCost: Math.round(activeFaltantesCost * 100) / 100,
        discrepancias: {
          totalCount: activeDiscrepanciesCount,
          sobrantes: {
            itemsCount: activeSobrantesCount,
            units: activeSobrantesUnits,
            cost: Math.round(activeSobrantesCost * 100) / 100
          },
          faltantes: {
            itemsCount: activeFaltantesCount,
            units: activeFaltantesUnits,
            cost: Math.round(activeFaltantesCost * 100) / 100
          },
          danados: {
            itemsCount: totalDamagedItems > 0 ? 1 : 0,
            units: totalDamagedItems,
            cost: Math.round(totalDamagedCost * 100) / 100
          }
        },

        // 5. Impacto Financiero
        impactoFinanciero: {
          totalAbsoluteDiffCost: Math.round((totalRecountsDone > 0 ? totalFinalDiffCost : totalAbsoluteDiffCost) * 100) / 100,
          initialAbsoluteDiffCost: Math.round(totalInitialDiffCost * 100) / 100,
          finalAbsoluteDiffCost: Math.round(totalFinalDiffCost * 100) / 100,
          clarifiedCost: Math.round(Math.max(0, totalInitialDiffCost - totalFinalDiffCost) * 100) / 100,
          hasRecountData: totalRecountsDone > 0,
          reconciledItemsCount: reconciledCount,
          sobrantesCost: Math.round((totalRecountsDone > 0 ? finalSobrantesCost : activeSobrantesCost) * 100) / 100,
          faltantesCost: Math.round((totalRecountsDone > 0 ? finalFaltantesCost : activeFaltantesCost) * 100) / 100,
          initialSobrantesCost: Math.round(initialSobrantesCost * 100) / 100,
          initialFaltantesCost: Math.round(initialFaltantesCost * 100) / 100,
          damagedCost: Math.round((totalRecountsDone > 0 ? finalDamagedCost : totalDamagedCost) * 100) / 100,
          damagedItemsCount: totalRecountsDone > 0 ? finalDamagedItems : totalDamagedItems
        },

        // Direct compatibility properties
        totalPositiveDiff: activeSobrantesUnits,
        totalNegativeDiff: activeFaltantesUnits,
        totalAbsoluteDiffCost: Math.round((totalRecountsDone > 0 ? totalFinalDiffCost : totalAbsoluteDiffCost) * 100) / 100,
        initialAbsoluteDiffCost: Math.round(totalInitialDiffCost * 100) / 100,
        finalAbsoluteDiffCost: Math.round(totalFinalDiffCost * 100) / 100,
        recountClarifiedAmount: Math.round(Math.max(0, totalInitialDiffCost - totalFinalDiffCost) * 100) / 100,
        hasRecountData: totalRecountsDone > 0,
        totalDamagedItems: totalRecountsDone > 0 ? finalDamagedItems : totalDamagedItems,
        damagedItemsCount: totalRecountsDone > 0 ? finalDamagedItems : totalDamagedItems,
        totalDamagedCost: Math.round((totalRecountsDone > 0 ? finalDamagedCost : totalDamagedCost) * 100) / 100,
        damagedCost: Math.round((totalRecountsDone > 0 ? finalDamagedCost : totalDamagedCost) * 100) / 100
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

    // Cache calculation result
    metricsCalculationCache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    });

    return result;
  }

  invalidateCache() {
    invalidateMetricsCache();
  }

  async recalculateMetrics(params = {}) {
    const opts = typeof params === 'string' ? { inventoryId: params } : (params || {});
    // Reading metrics never replaces the signed closure or operational inventory.
    const metrics = await this.getDashboardMetrics({ ...opts, forceRefresh: true });
    return { ...metrics, recalculated: true,
      resyncedCount: metrics.sourceDiagnostics.filter(source => source.status === 'valid' && source.source === 'GOOGLE_SHEETS').length,
      recalculatedAt: new Date().toISOString() };
  }

}

const metricsServiceInstance = new MetricsService();
metricsServiceInstance.invalidateMetricsCache = invalidateMetricsCache;

module.exports = metricsServiceInstance;
