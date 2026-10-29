const workflow = require('./inventoryWorkflow');
const contract = require('./inventoryContract');
const metricsSources = require('./metricsSourceService');
const getInventoryIdentifier = metricsSources.getInventoryIdentifier;

const state = value => String(value || '').trim().toUpperCase();

function roundFor(inventory) {
  return inventory.phase === 'RECONTEO_2' || inventory.recountRound === 2 || inventory.hasRecount2 ? 2 : 1;
}

function stageFor(inventory, finalized) {
  const status = state(inventory.status);
  const recount = inventory.isReconteo || String(inventory.id || '').startsWith('REC-') ||
    inventory.hasRecount || inventory.hasRecount2 || inventory.phase === 'RECONTEO' || inventory.phase === 'RECONTEO_2';
  const round = roundFor(inventory);
  if (finalized) return {key:'FINALIZADO', label:'Finalizado', kind:'closed', round};
  if (status === 'EN_RECONTEO') return {key:`RECONTEO_${round}`, label:`Reconteo ${round}`, kind:'count', round};
  if (status === 'RECONTEO_COMPLETADO') return {key:`JUSTIFICACION_RECONTEO_${round}`, label:`Justificación del reconteo ${round}`, kind:'justification', round};
  if (status === 'PENDIENTE_JUSTIFICACION') return recount && inventory.recountSubmittedAt
    ? {key:`JUSTIFICACION_RECONTEO_${round}`, label:`Justificación del reconteo ${round}`, kind:'justification', round}
    : {key:'JUSTIFICACION_INICIAL', label:'Justificaciones iniciales', kind:'justification', round:1};
  if (status === 'EN_PROGRESO' && recount) return {key:`RECONTEO_${round}`, label:`Reconteo ${round}`, kind:'count', round};
  if (status === 'EN_PROGRESO') return {key:'CONTEO_INICIAL', label:'Conteo inicial', kind:'count', round:0};
  return {key:status || 'SIN_ESTADO', label:(status || 'Estado no disponible').replace(/_/g, ' '), kind:'unknown', round};
}

function progressFor(inventory, stage) {
  const items = Array.isArray(inventory.items) ? inventory.items : [];
  if (stage.kind === 'closed') {
    const total = items.length || Number(inventory.totalItems) || 0;
    return {completed:total, total, pending:0, percent:100};
  }
  if (stage.kind === 'justification') {
    try {
      const plan = workflow.plan(inventory, null, inventory.justificationRecords || []);
      const total = plan.items.length;
      const pending = plan.pending.length;
      return {completed:Math.max(0, total - pending), total, pending, percent:total ? Math.round((total - pending) / total * 100) : 100};
    } catch (_) {
      return {completed:0, total:0, pending:0, percent:0};
    }
  }

  const countStage = stage.round;
  const members = countStage > 0 ? workflow.recountKeys(inventory) : new Set();
  const scopedItems = countStage > 0 && members.size ? items.filter(item => members.has(contract.member(item))) : items;
  const since = countStage > 0 ? (inventory.countNotBefore || inventory.recountEnabledAt) : inventory.countNotBefore;
  const completed = scopedItems.filter(item => workflow.hasCount(item, countStage, since)).length;
  const total = scopedItems.length || Number(inventory.totalItems) || 0;
  return {completed, total, pending:Math.max(0, total - completed), percent:total ? Math.round(completed / total * 100) : 0};
}

class InventoryTrackingService {
  async getTracking({type = 'TODOS', center = 'TODOS', refresh = false} = {}) {
    const records = await metricsSources.load({type, center, refresh, includeChildren:true});
    const recountRecords = records.filter(record => record.parentInventoryId)
      .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
    const recountsByParent = new Map(recountRecords.map(record => [record.parentInventoryId, record]));
    const recountsById = new Map(recountRecords.map(record => [record.id, record]));
    const groups = new Map();
    const inventories = records.filter(record => !record.parentInventoryId && !String(record.id || '').startsWith('REC-'));

    inventories.forEach(inventory => {
      const suffix = getInventoryIdentifier(inventory);
      const name = inventory.name || inventory.fileName || inventory.id;
      const normalizedName = String(name || '').trim().toLocaleLowerCase('es');
      const groupKey = `${inventory.type || 'OTRO'}:${normalizedName}:${suffix || 'SIN_TERMINACION'}`;
      if (!groups.has(groupKey)) groups.set(groupKey, {
        groupId:suffix || 'SIN_TERMINACION',
        suffix,
        type:inventory.type || 'OTRO',
        name,
        label:name || 'Inventario sin nombre',
        inventories:[]
      });

      const finalized = workflow.isFinalized({...inventory, isFinalized:inventory.isFinalized || inventory.isHistory}) || inventory.isHistory;
      const stage = stageFor(inventory, finalized);
      const recount = stage.kind === 'count' && stage.round > 0
        ? (recountsById.get(inventory.recountInventoryId) || recountsByParent.get(inventory.id)) : null;
      const progress = progressFor(recount || inventory, stage);
      const launch = {
        id:inventory.id,
        name,
        type:inventory.type || 'OTRO',
        center:inventory.center || 'Sin centro',
        status:state(inventory.status) || 'SIN_ESTADO',
        state:finalized ? 'FINALIZADO' : 'ABIERTO',
        stage:stage.key,
        stageLabel:stage.label,
        round:stage.round,
        progress,
        createdAt:inventory.launchedAt || inventory.createdAt || inventory.closedAt || null,
        closedAt:inventory.closedAt || null,
        sourceStatus:inventory.sourceValidation?.status || 'unknown',
        sourceIssues:inventory.sourceValidation?.issues || []
      };

      // Several dated files can represent the same inventory number and center
      // after a reopening. Keep one current row and retain the number of copies
      // so the old closure does not look like a separate completed inventory.
      const group = groups.get(groupKey);
      const seriesKey = `${String(launch.center).trim().toLocaleLowerCase('es')}:${normalizedName}`;
      const existing = group.inventories.find(item => item.seriesKey === seriesKey);
      if (!existing) group.inventories.push({...launch, seriesKey, launchCount:1});
      else {
        existing.launchCount += 1;
        const currentTime = Date.parse(existing.createdAt) || 0;
        const launchTime = Date.parse(launch.createdAt) || 0;
        if ((launch.state === 'ABIERTO' && existing.state !== 'ABIERTO') ||
            (launch.state === existing.state && launchTime >= currentTime)) {
          Object.assign(existing, launch, {seriesKey, launchCount:existing.launchCount});
        }
      }
    });

    const result = [...groups.values()].map(group => ({
      ...group,
      inventories:group.inventories.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)),
      openCount:group.inventories.filter(inventory => inventory.state === 'ABIERTO').length,
      finishedCount:group.inventories.filter(inventory => inventory.state === 'FINALIZADO').length
    })).sort((a, b) => {
      const left = Number(a.suffix), right = Number(b.suffix);
      if (a.suffix && b.suffix && Number.isFinite(left) && Number.isFinite(right)) return right - left;
      return String(b.suffix || '').localeCompare(String(a.suffix || ''));
    });

    return {groups:result, inventoryCount:inventories.length, openCount:inventories.filter(inventory => !workflow.isFinalized({...inventory, isFinalized:inventory.isFinalized || inventory.isHistory}) && !inventory.isHistory).length,
      finishedCount:inventories.filter(inventory => workflow.isFinalized({...inventory, isFinalized:inventory.isFinalized || inventory.isHistory}) || inventory.isHistory).length,
      discoveryIssues:records.discoveryIssues || []};
  }
}

module.exports = new InventoryTrackingService();
