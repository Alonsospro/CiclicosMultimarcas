const contract = require('./inventoryContract');
const {createHash,randomUUID}=require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const storagePath = require('./storagePath');
const auditService = require('./auditService');
const driveService = require('./driveService');
const gasService = require('./gasService');
const metricsService = require('./metricsService');
const snapshotService = require('./snapshotService');

class InventoryService {
  constructor() {
    this.invDir = storagePath.getInventoriesDirectory();
    this.justDir = storagePath.getJustificationsDirectory();
  }

  seedSampleInventories() {
    // Zero sample inventories - completely clean state
    return [];
  }

  getAllInventoryFiles() {
    try {
      const files = storagePath.listFiles(this.invDir);
      return files.filter(f => f.endsWith('.json'));
    } catch (e) {
      return [];
    }
  }

  saveInventory(inventory) {
    const filePath = path.join(this.invDir, `${inventory.id}.json`);
    storagePath.writeJson(filePath, inventory);
    if (metricsService && typeof metricsService.invalidateCache === 'function') {
      metricsService.invalidateCache();
    }
    return inventory;
  }

  getInventoryRaw(id) {
    const filePath = path.join(this.invDir, `${id}.json`);
    const inv = storagePath.readJson(filePath, null);
    if (inv) {
      if (!Array.isArray(inv.items)) {
        inv.items = [];
      }
      inv.items.forEach((it, idx) => {
        if (!it.id) {
          it.id = `ITEM-${it.SKU ? String(it.SKU).replace(/[^a-zA-Z0-9_-]/g, '_') : (idx + 1)}-${idx + 1}`;
        }
      });
    }
    return inv;
  }

  async getInventories(user, filterCenter = null, filterType = null) {
    let files = this.getAllInventoryFiles();

    let list = [];

    files.forEach(file => {
      if (snapshotService.isSnapshotDeleted(file)) return;
      const inv = storagePath.readJson(path.join(this.invDir, file), null);
      if (inv && inv.id && inv.name && !snapshotService.isSnapshotDeleted(inv)) {
        if (!Array.isArray(inv.items)) {
          inv.items = [];
        }

        const u = String(user.username || '').toLowerCase().trim();
        const c = String(user.clave || '').toLowerCase().trim();
        const d = String(user.displayName || '').toLowerCase().trim();

        const isDirectlyAssigned = Array.isArray(inv.assignedAuxiliars) && inv.assignedAuxiliars.some(a => {
          const s = String(a || '').toLowerCase().trim();
          return s === u || (c && s === c) || (d && (s === d || d.includes(s) || s.includes(d)));
        });

        const hasAssignedItems = inv.items.some(it => {
          if (!it || !it.Responsable) return false;
          const r = String(it.Responsable || '').toLowerCase().trim();
          return r === u || (c && r === c) || (d && (r === d || d.includes(r) || r.includes(d)));
        });

        const isAssigned = isDirectlyAssigned || hasAssignedItems;

        // Role-based visibility
        if (user.role === 'AUXILIAR') {
          // Auxiliares strictly see only active/in-progress inventories assigned to them
          // (Una vez terminado el conteo o reconteo, ya no aparece en su bandeja)
          if (!isAssigned || inv.status !== 'EN_PROGRESO') {
            return;
          }
        } else if (user.role !== 'ADMIN' && !user.isSuperadmin) {
          // Encargados see inventories belonging to their operational center
          if (!config.isSameCenter(inv.center, user.center)) return;
        }

        // Dropdown Center filter (only apply if not an assigned auxiliar or if center matches)
        if (filterCenter && filterCenter !== 'TODOS' && filterCenter !== 'GLOBAL') {
          if (user.role !== 'AUXILIAR') {
            if (!config.isSameCenter(inv.center, filterCenter)) return;
          }
        }

        // Type filtering
        if (filterType && filterType !== 'TODOS') {
          if (inv.type !== filterType) return;
        }

        const isReconteoInv = !!(inv.isReconteo || inv.phase === 'RECONTEO' || inv.phase === 'RECONTEO_2' || String(inv.id).startsWith('REC-'));
        const isItemCounted = (it) => {
          if (!it) return false;
          if (isReconteoInv) {
            return (it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined) || (it.Stock_Fisico !== null && it.Stock_Fisico !== undefined);
          }
          return it.Stock_Fisico !== null && it.Stock_Fisico !== undefined;
        };

        // Generate summary stats for list view
        let totalItems = inv.items.length;
        let countedItems = inv.items.filter(isItemCounted).length;

        if (user.role === 'AUXILIAR') {
          const userMatches = (respStr) => {
            if (!respStr) return false;
            const r = String(respStr).toLowerCase().trim();
            return r === u || (c && r === c) || (d && (r === d || d.includes(r) || r.includes(d)));
          };

          const isAssignedToOtherAuxiliar = (respStr) => {
            if (!respStr) return false;
            if (userMatches(respStr)) return false;
            const r = String(respStr).toLowerCase().trim();
            if (r === 'alonso' || r.includes('alonso rios') || r === 'juan carlos' || r === 'admin' ||
                r === 'sin asignar' || r === 'pendiente' || r === 'google drive sync' ||
                (inv.createdBy && r === String(inv.createdBy).toLowerCase().trim())) {
              return false;
            }
            if (Array.isArray(inv.assignedAuxiliars)) {
              return inv.assignedAuxiliars.some(otherA => {
                const oa = String(otherA || '').toLowerCase().trim();
                if (oa === u || (c && oa === c) || (d && (oa === d || d.includes(oa) || oa.includes(d)))) return false;
                return oa === r || r.includes(oa);
              });
            }
            return false;
          };

          const userItems = inv.items.filter(it => {
            if (!it) return false;
            if (it.Responsable && userMatches(it.Responsable)) return true;
            if (isDirectlyAssigned) return !isAssignedToOtherAuxiliar(it.Responsable);
            return false;
          });
          totalItems = userItems.length;
          countedItems = userItems.filter(isItemCounted).length;
        }

        const pendingItems = Math.max(0, totalItems - countedItems);

        list.push({
          id: inv.id,
          name: inv.name,
          type: inv.type,
          center: inv.center,
          status: inv.status,
          createdAt: inv.createdAt,
          createdBy: inv.createdBy,
          assignedAuxiliars: inv.assignedAuxiliars || [],
          totalItems,
          countedItems,
          pendingItems,
          isCompleted: totalItems > 0 && countedItems === totalItems
        });
      }
    });

    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async getInventoryById(id, user) {
    const inv = this.getInventoryRaw(id);

    if (!inv) {
      throw new Error(`Inventario con ID '${id}' no encontrado`);
    }

    const isReconteoInv = !!(inv.isReconteo || inv.phase === 'RECONTEO' || inv.phase === 'RECONTEO_2' || String(inv.id).startsWith('REC-'));
    if (isReconteoInv && Array.isArray(inv.items)) {
      inv.items.forEach(it => {
        if (!it) return;
        if (it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined) {
          if (it.Stock_Fisico === null || it.Stock_Fisico === undefined) {
            it.Stock_Fisico = it.Reconteo_Fisico;
          }
          if (it.Mal_estado === null || it.Mal_estado === undefined || it.Mal_estado === 0) {
            if (it.Reconteo_Mal_Estado !== null && it.Reconteo_Mal_Estado !== undefined) {
              it.Mal_estado = it.Reconteo_Mal_Estado;
            }
          }
          if (!it.Estado || it.Estado === 'Pendiente') {
            it.Estado = 'Recontado';
          }
        }
      });
    }

    const u = String(user.username || '').toLowerCase().trim();
    const c = String(user.clave || '').toLowerCase().trim();
    const d = String(user.displayName || '').toLowerCase().trim();

    const isAssignedToInv = Array.isArray(inv.assignedAuxiliars) && inv.assignedAuxiliars.some(a => {
      const s = String(a || '').toLowerCase().trim();
      return s === u || (c && s === c) || (d && (s === d || d.includes(s) || s.includes(d)));
    });

    const hasAssignedItems = Array.isArray(inv.items) && inv.items.some(it => {
      if (!it || !it.Responsable) return false;
      const r = String(it.Responsable || '').toLowerCase().trim();
      return r === u || (c && r === c) || (d && (r === d || d.includes(r) || r.includes(d)));
    });

    const isAssigned = isAssignedToInv || hasAssignedItems;

    // Check strict center authorization
    if (user.role !== 'ADMIN' && !user.isSuperadmin) {
      if (user.role === 'AUXILIAR') {
        if (!isAssigned && !config.isSameCenter(inv.center, user.center)) {
          throw new Error(`No tiene permisos para acceder a inventarios del centro ${inv.center}`);
        }
      } else if (!config.isSameCenter(inv.center, user.center)) {
        throw new Error(`No tiene permisos para acceder a inventarios del centro ${inv.center}`);
      }
    }

    // If role is AUXILIAR:
    // 1. Filter items strictly to those assigned to this auxiliary (or unassigned/creator rows if user is assigned)
    // 2. Hide columns H, I, K, L, O (Blind Count)
    if (user.role === 'AUXILIAR') {
      if (inv.status !== 'EN_PROGRESO') {
        throw new Error('Este inventario ya ha sido completado y finalizado. Ya no está disponible para conteo.');
      }
      const isConteoPhase = inv.status !== 'REVISADO';

      const userMatches = (respStr) => {
        if (!respStr) return false;
        const r = String(respStr).toLowerCase().trim();
        return r === u || (c && r === c) || (d && (r === d || d.includes(r) || r.includes(d)));
      };

      const isAssignedToOtherAuxiliar = (respStr) => {
        if (!respStr) return false;
        if (userMatches(respStr)) return false;
        const r = String(respStr).toLowerCase().trim();
        if (r === 'alonso' || r.includes('alonso rios') || r === 'juan carlos' || r === 'admin' ||
            r === 'sin asignar' || r === 'pendiente' || r === 'google drive sync' ||
            (inv.createdBy && r === String(inv.createdBy).toLowerCase().trim())) {
          return false;
        }
        if (Array.isArray(inv.assignedAuxiliars)) {
          return inv.assignedAuxiliars.some(otherA => {
            const oa = String(otherA || '').toLowerCase().trim();
            if (oa === u || (c && oa === c) || (d && (oa === d || d.includes(oa) || oa.includes(d)))) return false;
            return oa === r || r.includes(oa);
          });
        }
        return false;
      };

      const userItems = inv.items.filter(it => {
        if (!it) return false;
        if (it.Responsable && userMatches(it.Responsable)) {
          return true;
        }
        if (isAssignedToInv) {
          return !isAssignedToOtherAuxiliar(it.Responsable);
        }
        return false;
      });

      return {
        ...inv,
        items: userItems.map(item => {
          if (isConteoPhase) {
            const {
              Costo_Unitario,
              Stock_Sistema,
              Diferencia,
              Costo_Diferencia,
              Estado,
              ...safeBlindItem
            } = item;
            return safeBlindItem;
          }
          return item;
        }),
        isBlindCount: isConteoPhase
      };
    }

    // ADMIN and ENCARGADO see complete inventory with full columns
    return {
      ...inv,
      isBlindCount: false
    };
  }

  canCreateInventory(user) {
    if (!user) return false;
    if (user.isSuperadmin || user.role === 'ADMIN' || user.role === 'ENCARGADO') return true;
    const u = String(user.username || '').toLowerCase().trim();
    const d = String(user.displayName || '').toLowerCase().trim();
    if (u === 'alonso' || d.includes('alonso rios') || user.clave === 'ADM') return true;
    if (u === 'jcarlos' || u === 'juancarlos' || u === 'juan carlos' || u === 'juan_carlos' || u === 'juan.carlos' || d.includes('juan carlos') || user.clave === 'JCS') return true;
    return false;
  }

  async createInventory({ type, center, name, items, user, assignedAuxiliar }) {
    if (!type || !center) {
      throw new Error('Tipo y Centro son requeridos');
    }

    if (!this.canCreateInventory(user)) {
      throw new Error('Acceso denegado: Solo Juan Carlos y Alonso están autorizados para crear nuevos inventarios.');
    }

    const cleanType = type.toUpperCase();
    const targetCenter = center;

    let mappedItems = [];
    if (items && items.length > 0) {
      mappedItems = gasService.mapRawRowsToColumns(items);
    } else {
      mappedItems=await gasService.fetchProductsFromScript(cleanType,targetCenter);
      if(!mappedItems.length)throw new Error('La hoja del centro está vacía; no se creó el inventario.');
      mappedItems=mappedItems.map((item,index)=>({
        ...Object.fromEntries(contract.columns.slice(0,11).map(key=>[key,item[key]??''])),
        id:'ITEM-'+index,Stock_Fisico:null,Stock_Buen_Estado:null,Stock_Total:null,Mal_estado:0,Estado:'Pendiente',locked:false
      }));
    }

    // Resolve assigned Auxiliar if selected during creation
    let assignedAuxiliars = [];
    if (assignedAuxiliar) {
      const authService = require('./authService');
      const allUsers = authService.getUsersList();
      const targetUser = allUsers.find(u =>
        u.username?.toLowerCase() === String(assignedAuxiliar).toLowerCase().trim() ||
        (u.displayName && u.displayName.toLowerCase() === String(assignedAuxiliar).toLowerCase().trim()) ||
        (u.clave && u.clave.toLowerCase() === String(assignedAuxiliar).toLowerCase().trim()) ||
        u.id === assignedAuxiliar
      );

      const targetUsername = targetUser ? targetUser.username : String(assignedAuxiliar).trim();
      const targetDisplayName = targetUser?.displayName || targetUsername;
      const targetClave = targetUser?.clave || '';

      [targetUsername, targetDisplayName, targetClave].forEach(val => {
        if (val && !assignedAuxiliars.includes(val)) assignedAuxiliars.push(val);
      });

      mappedItems.forEach(it => {
        it.Responsable = targetUsername;
      });
    }

    const centerObj = config.findCenter(targetCenter);
    const centerCode = centerObj ? centerObj.code : targetCenter;
    const invId = `INV-${cleanType}-${centerCode}-${Date.now().toString(36).toUpperCase()}`;

    const newInventory = {
      id: invId,
      name: name || `Inventario ${cleanType} - ${centerObj ? centerObj.displayName : targetCenter} (${new Date().toLocaleDateString()})`,
      type: cleanType,
      center: targetCenter,
      status: 'EN_PROGRESO',
      createdAt: new Date().toISOString(),
      createdBy: user.username,
      assignedAuxiliars,
      items: mappedItems
    };

    this.saveInventory(newInventory);
    auditService.logAction({
      action: 'INVENTORY_CREATED',
      details: `Inventario ${newInventory.name} creado con ${mappedItems.length} ítems`,
      user: user.username,
      center: targetCenter,
      targetId: invId
    });

    return newInventory;
  }

  async bulkCreateInventories({type='CICLICO',date=null,centers=null,user}) {
    const {isBulkInventoryCreator}=require('../middlewares/authMiddleware');
    if(!isBulkInventoryCreator(user))throw new Error('No tiene permiso para creación masiva.');
    const cleanType=String(type).trim().toUpperCase();
    if(!['CICLICO','BARRIDO','SEMANAL','MENSUAL'].includes(cleanType))throw new Error('Tipo inválido');
    const targetDate=date||new Intl.DateTimeFormat('en-CA',{timeZone:'America/La_Paz',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    if(!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)||!Number.isFinite(Date.parse(targetDate+'T12:00:00Z'))||new Date(targetDate+'T12:00:00Z').toISOString().slice(0,10)!==targetDate)throw new Error('Fecha inválida');
    if(centers!==null && (!Array.isArray(centers)||!centers.length))throw new Error('Seleccione al menos un centro');
    const requested=centers===null?config.centersList.map(c=>c.code):centers;
    const codes=[...new Set(requested.map(center=>{
      const found=config.findCenter(center);
      if(!found)throw new Error('Centro inválido: '+center);
      return found.code;
    }))];
    const results=[];
    for(const center of codes){
      const id='BULK-'+cleanType+'-'+center+'-'+targetDate;
      const existing=this.getInventoryRaw(id);
      if(existing){results.push({center,status:'existing',inventory:existing});continue;}
      try{
        const fetched=await gasService.fetchProductsFromScript(cleanType,center);
        if(!fetched.length)throw new Error('La hoja del centro está vacía; no se creó el inventario.');
        const items=fetched.map(contract.normalize);
        const identities=items.map(contract.member);
        if(new Set(identities).size!==identities.length)throw new Error('La hoja contiene SKU/almacén/ubicación duplicados.');
        // The sheet is the source list. Keep master fields, start a new count without inherited reviews.
        const prepared=items.map((item,index)=>{
          const master=Object.fromEntries(contract.columns.slice(0,11).map(key=>[key,item[key]??'']));
          if(!master.SKU||!master.Almacen)throw new Error('Fila sin SKU o almacén');
          return {...master,id:id+'-'+index,Stock_Fisico:null,Stock_Buen_Estado:null,Stock_Total:null,Mal_estado:0,Estado:'Pendiente',locked:false};
        });
        // Recheck after the network wait; stable ids make a repeated request reuse the same inventory.
        const raced=this.getInventoryRaw(id);
        if(raced){results.push({center,status:'existing',inventory:raced});continue;}
        const inventory={id,name:cleanType+'-'+center+'-'+targetDate,type:cleanType,center,status:'EN_PROGRESO',
          inventoryDate:targetDate,createdAt:new Date().toISOString(),createdBy:user.username,assignedAuxiliars:[],items:prepared};
        this.saveInventory(inventory);
        results.push({center,status:'created',inventory});
      }catch(e){results.push({center,status:'failed',error:e.message});}
    }
    auditService.logAction({action:'BULK_INVENTORIES_CREATED',details:JSON.stringify(results.map(({center,status,error})=>({center,status,error}))),user:user.username,center:'GLOBAL'});
    return {success:results.every(r=>r.status!=='failed'),count:results.filter(r=>r.status==='created').length,
      existingCount:results.filter(r=>r.status==='existing').length,failedCount:results.filter(r=>r.status==='failed').length,results};
  }

  canModifyInventory(inv, user) {
    if (!inv || !user) return false;
    if (user.role === 'ADMIN' || user.isSuperadmin) return true;

    const u = String(user.username || '').toLowerCase().trim();
    const c = String(user.clave || '').toLowerCase().trim();
    const d = String(user.displayName || '').toLowerCase().trim();

    // Check if user is the creator of the inventory
    if (inv.createdBy && String(inv.createdBy).toLowerCase().trim() === u) {
      return true;
    }

    // Check if user is an assigned auxiliar for this inventory
    const isAssignedToInv = Array.isArray(inv.assignedAuxiliars) && inv.assignedAuxiliars.some(a => {
      const s = String(a || '').toLowerCase().trim();
      return s === u || (c && s === c) || (d && (s === d || d.includes(s) || s.includes(d)));
    });

    // Check if user is assigned to any item in this inventory
    const hasAssignedItems = Array.isArray(inv.items) && inv.items.some(it => {
      if (!it || !it.Responsable) return false;
      const r = String(it.Responsable || '').toLowerCase().trim();
      return r === u || (c && r === c) || (d && (r === d || d.includes(r) || r.includes(d)));
    });

    const isAssigned = isAssignedToInv || hasAssignedItems;

    // Check if user belongs to the same center
    const isSameCenter = !!(user.center && config.isSameCenter(inv.center, user.center));

    // Encargados/supervisors of the same operational center (or global/unassigned center)
    if (user.role === 'ENCARGADO' || user.role === 'SUPERVISOR') {
      if (!user.center || user.center === 'GLOBAL' || !inv.center || isSameCenter) {
        return true;
      }
    }

    // Assigned auxiliary (even cross-center) or auxiliary/user of same center
    if (isAssigned || isSameCenter) {
      return true;
    }

    return false;
  }

  async updateCount({
    inventoryId,
    itemId,
    sku,
    barcode = null,
    codigoBarras = null,
    descripcion = null,
    description = null,
    stockFisico,
    malEstado = 0,
    location = null,
    almacen = null,
    warehouse = null,
    isNewLocation = false,
    user,
    reason,
    photoUrl = null,
    photoBase64 = null,
    justificationPhotoUrl = null,
    justificationPhoto = null,
    locked = true,
    comentario = null,
    categoria = null,
    clasificacionAbc = null,
    unidad = null,
    costoUnitario = null,
    stockSistema = null
  }) {
    let inv = this.getInventoryRaw(inventoryId);
    if (!inv) {
      if (inventoryId.startsWith('INV-BARRIDO-') || inventoryId.includes('BARRIDO')) {
        const centerMatch = inventoryId.split('-')[2] || (user.center !== 'GLOBAL' ? user.center : '1120');
        const cleanCenter = config.getCenterCode ? config.getCenterCode(centerMatch) : centerMatch;
        const centerObj = config.findCenter ? config.findCenter(cleanCenter) : null;
        inv = {
          id: inventoryId,
          name: `Barrido Operativo ${centerObj ? centerObj.name : cleanCenter}`,
          type: 'BARRIDO',
          center: cleanCenter,
          status: 'EN_PROGRESO',
          createdAt: new Date().toISOString(),
          createdBy: user.username,
          assignedAuxiliars: [user.username],
          items: []
        };
        this.saveInventory(inv);
      } else {
        throw new Error(`Inventario '${inventoryId}' no encontrado`);
      }
    }

    if (!this.canModifyInventory(inv, user)) {
      throw new Error(`No tiene permisos para modificar inventarios del centro ${inv.center}`);
    }

    // Normalizar Categoria: Debe ser 'repuesto' y nunca el tipo de inventario (BARRIDO, CICLICO, etc.)
    const cleanCategoria = (categoria && !['BARRIDO', 'CICLICO', 'GENERAL', 'EXPRESS'].includes(String(categoria).toUpperCase().trim()))
      ? categoria
      : 'repuesto';

    const isCountProvided = (stockFisico !== null && stockFisico !== undefined && stockFisico !== '');
    let qty = isCountProvided ? contract.quantity(stockFisico,'stockFisico') : null;
    const damagedQty = contract.quantity(malEstado,'malEstado');

    // Strict boolean check: NEVER auto-generate new locations unless explicitly requested
    const isExplicitNewLocation = (isNewLocation === true || isNewLocation === 'true');

    let targetItem = null;
    if (itemId) {
      targetItem = inv.items.find(it => it.id === itemId || String(it.id).trim() === String(itemId).trim());
    }

    const cleanTargetWarehouse = String(almacen || warehouse || '').trim().toUpperCase();

    if(!targetItem){
      const matches=inv.items.filter(it=>{
        if(sku?contract.identity(it.SKU)!==contract.identity(sku):contract.identity(it.Codigo_Barras)!==contract.identity(barcode||codigoBarras))return false;
        if(cleanTargetWarehouse&&contract.identity(it.Almacen)!==cleanTargetWarehouse)return false;
        return isExplicitNewLocation||!location||[it.Ubicacion,it.Ubicacion_1,it.Ubicacion_2].some(loc=>contract.identity(loc)===contract.identity(location));
      });
      if(matches.length>1)throw new Error('Ítem ambiguo: especifique almacén y ubicación');
      targetItem=matches[0]||null;
    }
    let previousQty = targetItem ? targetItem.Stock_Fisico : null;

    if (isExplicitNewLocation) {
      // MULTIPLE LOCATIONS: Add additional location to the existing item (up to 2: Col E & Col F)
      // NO new item row is created in the appweb nor in the sheet, avoiding duplicate counts.
      if (!targetItem) {
        throw new Error(`Ítem con SKU ${sku || ''} no encontrado para agregarle ubicación adicional.`);
      }

      const cleanNewLoc = String(location || '').trim().toUpperCase();
      if (!cleanNewLoc) {
        throw new Error('Debe especificar una ubicación válida.');
      }

      // Check if this location is already assigned as main or additional location
      const existingLocs = [
        String(targetItem.Ubicacion || '').trim().toUpperCase(),
        String(targetItem.Ubicacion_1 || '').trim().toUpperCase(),
        String(targetItem.Ubicacion_2 || '').trim().toUpperCase()
      ].filter(Boolean);

      if (existingLocs.includes(cleanNewLoc)) {
        throw new Error(`El ítem ya tiene registrada la ubicación ${cleanNewLoc}.`);
      }

      // Assign to Ubicacion_1 (Col E) or Ubicacion_2 (Col F)
      if (!targetItem.Ubicacion_1 || String(targetItem.Ubicacion_1).trim() === '') {
        targetItem.Ubicacion_1 = cleanNewLoc;
      } else if (!targetItem.Ubicacion_2 || String(targetItem.Ubicacion_2).trim() === '') {
        targetItem.Ubicacion_2 = cleanNewLoc;
      } else {
        throw new Error('Este ítem ya cuenta con el máximo permitido de 2 ubicaciones adicionales (Columnas E y F).');
      }

      targetItem.additionalLocations = [targetItem.Ubicacion_1, targetItem.Ubicacion_2].filter(Boolean);

      // Sync to GAS (Updates Col E and Col F on the existing row in Google Sheets)
      const synced=await gasService.upsertCountToGAS(inv.type,{center:inv.center,sku:targetItem.SKU,
        almacen:targetItem.Almacen,location:targetItem.Ubicacion,ubicacion1:targetItem.Ubicacion_1,
        ubicacion2:targetItem.Ubicacion_2,inventoryId:inv.id,itemId:targetItem.id});
      if(!synced.item)throw new Error('Google no devolvió la fila confirmada');
      Object.assign(targetItem,contract.normalize(synced.item));delete inv.closeOperationId;this.saveInventory(inv);
      if(inv.parentInventoryId){
        const parent=this.getInventoryRaw(inv.parentInventoryId);
        const original=parent?.items.find(it=>contract.member(it)===contract.member(targetItem));
        if(original){Object.assign(original,contract.normalize(synced.item));delete parent.closeOperationId;this.saveInventory(parent);}
      }

      auditService.logAction({
        action: 'ADDITIONAL_LOCATION_ADDED',
        details: `Ubicación adicional '${cleanNewLoc}' agregada al SKU ${targetItem.SKU} (${targetItem.Ubicacion_2 === cleanNewLoc ? 'Col F / Ubic 2' : 'Col E / Ubic 1'})`,
        user: user.username,
        center: inv.center,
        targetId: inv.id
      });

      return {
        success: true,
        message: `Ubicación adicional '${cleanNewLoc}' agregada al SKU ${targetItem.SKU}`,
        item: targetItem
      };
    } else {
      if (!targetItem) {
        if (inv.type === 'BARRIDO') {
          // In BARRIDO, create the item with primary location
          const newItemId = itemId || `ITEM-BARRIDO-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
          const cleanSku = sku || (barcode ? String(barcode).toUpperCase() : 'SKU-DESCUBIERTO');
          const cleanBarcode = barcode || codigoBarras || sku || '';
          const cleanDesc = descripcion || description || `Ítem Barrido ${cleanSku}`;
          const unitCost = costoUnitario !== null && costoUnitario !== undefined ? Number(costoUnitario) : 0;
          const sysStock = stockSistema !== null && stockSistema !== undefined ? Number(stockSistema) : 0;
          const diff = isCountProvided ? (qty - sysStock) : 0;

          targetItem = {
            id: newItemId,
            SKU: cleanSku,
            Codigo_Barras: cleanBarcode,
            Descripcion: cleanDesc,
            Ubicacion: location || '',
            Almacen: almacen || warehouse || '',
            Stock_Buen_Estado: qty,
            Stock_Total: isCountProvided ? qty+damagedQty : null,
            Categoria: cleanCategoria,
            Clasificacion_ABC: clasificacionAbc || 'C',
            Unidad: unidad || 'PZA',
            Costo_Unitario: unitCost,
            Stock_Sistema: sysStock,
            Stock_Fisico: qty,
            Diferencia: diff,
            Costo_Diferencia: diff * unitCost,
            Fecha_Ultimo_Conteo: isCountProvided ? new Date().toISOString() : null,
            Responsable: user.displayName || user.username,
            Estado: locked !== false ? (damagedQty > 0 ? 'Dañado' : 'Contado') : 'Pendiente',
            Mal_estado: damagedQty,
            Comentario: comentario !== null ? comentario : '',
            foto_mal_estado: photoUrl || null,
            foto_justificacion: justificationPhotoUrl || null,
            isAdditionalLocation: false,
            locked: !!locked
          };
          inv.items.push(targetItem);
        } else {
          throw new Error('Ítem no encontrado en ese almacén y ubicación');
        }
      } else {
        // Update description or barcode if they were provided and missing/placeholder
        if (descripcion || description) {
          const newDesc = descripcion || description;
          if (!targetItem.Descripcion || targetItem.Descripcion.includes('Descubierto') || targetItem.Descripcion.includes('Ítem Barrido')) {
            targetItem.Descripcion = newDesc;
          }
        }
        if ((barcode || codigoBarras) && !targetItem.Codigo_Barras) {
          targetItem.Codigo_Barras = barcode || codigoBarras;
        }
        if (justificationPhotoUrl) {
          targetItem.foto_justificacion = justificationPhotoUrl;
        }
        // Asegurar que si Categoria era el tipo de inventario se actualice a repuesto
        if (!targetItem.Categoria || ['BARRIDO', 'CICLICO', 'GENERAL', 'EXPRESS'].includes(String(targetItem.Categoria).toUpperCase().trim())) {
          targetItem.Categoria = cleanCategoria;
        }
        // Auxiliar can only count items assigned to them (or unassigned/creator items if assigned to the inventory)
        if (user.role === 'AUXILIAR' && inv.type !== 'BARRIDO' && targetItem.Responsable) {
          const resp = String(targetItem.Responsable).toLowerCase().trim();
          const u = String(user.username || '').toLowerCase().trim();
          const c = String(user.clave || '').toLowerCase().trim();
          const d = String(user.displayName || '').toLowerCase().trim();

          const matchesSelf = resp === u || (c && resp === c) || (d && (resp === d || d.includes(resp) || resp.includes(d)));
          const isCreatorOrGeneric = resp === 'alonso' || resp.includes('alonso rios') || resp === 'juan carlos' ||
            resp === 'admin' || resp === 'sin asignar' || resp === 'pendiente' || resp === 'google drive sync' ||
            (inv.createdBy && resp === String(inv.createdBy).toLowerCase().trim());

          if (!matchesSelf && !isCreatorOrGeneric) {
            const isAssignedToOther = Array.isArray(inv.assignedAuxiliars) && inv.assignedAuxiliars.some(otherA => {
              const oa = String(otherA || '').toLowerCase().trim();
              if (oa === u || (c && oa === c) || (d && (oa === d || d.includes(oa) || oa.includes(d)))) return false;
              return oa === resp || resp.includes(oa);
            });
            if (isAssignedToOther) {
              throw new Error(`Este ítem está asignado al auxiliar ${targetItem.Responsable}`);
            }
          }
        }

        // Si se envió una ubicación y el ítem no tenía ubicación asignada, o si se envió explícitamente para este ítem específico
        if (location && (!targetItem.Ubicacion || String(targetItem.Ubicacion).trim() === '' || isExplicitNewLocation)) {
          targetItem.Ubicacion = location;
        }

        const isReconteoMode = !!(inv.isReconteo || inv.phase === 'RECONTEO' || inv.phase === 'RECONTEO_2' || String(inv.id).startsWith('REC-'));

        if (isCountProvided) {
          if (isReconteoMode) {
            targetItem.Reconteo_Fisico = qty;
            targetItem.Reconteo = qty; // Col Z (Buen Estado Reconteo 1)
            targetItem.Reconteo_Mal_Estado = damagedQty;
            targetItem.Malestado_Reconteo = damagedQty; // Col AA (Mal Estado Reconteo 1)
            const sys = Number(targetItem.Stock_Sistema || 0);
            const isNegativeStockMatch = (sys < 0 && qty === 0 && damagedQty === 0);
            targetItem.Stock_Total_Reconteo = (qty + damagedQty); // Col Y (Total Reconteo 1)
            // Preservar Stock_Fisico original del 1er conteo para nunca sobreescribir la columna M/N
            if (targetItem.Stock_Fisico_1erConteo === undefined || targetItem.Stock_Fisico_1erConteo === null) {
              targetItem.Stock_Fisico_1erConteo = targetItem.Stock_Fisico;
            }
            if (targetItem.Stock_Buen_Estado_1erConteo === undefined || targetItem.Stock_Buen_Estado_1erConteo === null) {
              targetItem.Stock_Buen_Estado_1erConteo = targetItem.Stock_Buen_Estado !== undefined ? targetItem.Stock_Buen_Estado : targetItem.Stock_Fisico;
            }
            if (targetItem.Mal_estado_1erConteo === undefined || targetItem.Mal_estado_1erConteo === null) {
              targetItem.Mal_estado_1erConteo = targetItem.Mal_estado;
            }
            targetItem.Stock_Fisico = qty;
            targetItem.Mal_estado = damagedQty;
            targetItem.Diferencia_Final = targetItem.Stock_Total_Reconteo - sys;
            targetItem.Costo_Diferencia_Final = targetItem.Diferencia_Final * (targetItem.Costo_Unitario || 0);
            targetItem.Diferencia = targetItem.Diferencia_Final;
            targetItem.Costo_Diferencia = targetItem.Costo_Diferencia_Final;
            targetItem.Fecha_Reconteo = new Date().toISOString();
            targetItem.Fecha_Ultimo_Conteo = new Date().toISOString();
            targetItem.Responsable = user.displayName || user.username;
            targetItem.Estado = locked !== false ? 'Recontado' : 'Pendiente';


          } else {
            targetItem.Stock_Buen_Estado = qty; // Col M (Buen Estado 1er Conteo)
            targetItem.Stock_Fisico = qty;
            targetItem.Mal_estado = damagedQty; // Col N (Mal Estado 1er Conteo)
            const sys = Number(targetItem.Stock_Sistema || 0);
            const isNegativeStockMatch = (sys < 0 && qty === 0 && damagedQty === 0);
            targetItem.Stock_Total = (qty + damagedQty); // Col L (Total 1er Conteo: toma negativo si buen estado es 0)
            targetItem.Diferencia = targetItem.Stock_Total - sys; // Col O
            targetItem.Costo_Diferencia = targetItem.Diferencia * (targetItem.Costo_Unitario || 0); // Col P
            targetItem.Fecha_Ultimo_Conteo = new Date().toISOString();
            targetItem.Responsable = user.displayName || user.username;
            targetItem.Estado = locked !== false ? 'Contado' : 'Pendiente';
          }
        }

        if (previousQty !== null && previousQty !== undefined && isCountProvided) {
          targetItem.modificationCount = (targetItem.modificationCount || 0) + 1;
          targetItem.modificationHistory = targetItem.modificationHistory || [];
          targetItem.modificationHistory.push({
            previousQty,
            newQty: qty,
            previousDamaged: targetItem.Mal_estado || 0,
            newDamaged: damagedQty,
            user: user.username,
            userDisplayName: user.displayName || user.username,
            timestamp: new Date().toISOString(),
            reason: reason || 'Modificación de conteo ya realizado'
          });
        }

        if (malEstado !== null && malEstado !== undefined) {
          targetItem.Mal_estado = damagedQty;
        }
        if (comentario !== null && comentario !== undefined) {
          targetItem.Comentario = comentario;
        }
        if (photoUrl !== null && photoUrl !== undefined) {
          targetItem.foto_mal_estado = photoUrl;
          if (isReconteoMode) {
            targetItem.foto_mal_estado_reconteo = photoUrl;
          }
        }
        if (locked !== undefined) {
          targetItem.locked = !!locked;
        }
      }
    }

    // Audit log
    auditService.logCount({
      inventoryId: inv.id,
      sku: targetItem.SKU,
      previousQty,
      newQty: qty,
      user: user.username,
      center: inv.center,
      location: targetItem.Ubicacion,
      malEstado: damagedQty,
      reason: reason || (isNewLocation ? 'Nueva ubicación detectada' : (previousQty !== null ? 'Modificación de conteo previo' : 'Conteo físico confirmado'))
    });

    // Real-time synchronization to Google Drive / Sheets via Google Apps Script (Primary cloud storage)
    try {
      const driveService = require('./driveService');
      const resolvedPhotoBase64 = (photoBase64 && String(photoBase64).startsWith('data:image'))
        ? photoBase64
        : (driveService.getPhotoAsDataUri(photoUrl || targetItem.foto_mal_estado) || (photoBase64 && !photoBase64.startsWith('/') ? photoBase64 : ''));
      const resolvedJustPhotoBase64 = (justificationPhoto && String(justificationPhoto).startsWith('data:image'))
        ? justificationPhoto
        : (driveService.getPhotoAsDataUri(justificationPhotoUrl || targetItem.foto_justificacion) || (justificationPhoto && !justificationPhoto.startsWith('/') ? justificationPhoto : ''));

      const isReconteoMode = !!(inv.isReconteo || inv.phase === 'RECONTEO' || inv.phase === 'RECONTEO_2' || String(inv.id).startsWith('REC-'));
      const synced = await gasService.upsertCountToGAS(inv.type, {
        inventoryId:inv.id,itemId:targetItem.id,
        center: inv.center,
        type: inv.type,
        sku: targetItem.SKU,
        barcode: targetItem.Codigo_Barras,
        descripcion: targetItem.Descripcion,
        location: targetItem.Ubicacion,
        almacen: targetItem.Almacen || targetItem.almacen || targetItem.warehouse || almacen || warehouse || '',
        warehouse: targetItem.Almacen || targetItem.almacen || targetItem.warehouse || almacen || warehouse || '',
        isNewLocation: isExplicitNewLocation,
        ...(inv.phase==='RECONTEO_2'||inv.recountRound===2 ? {
          isReconteo2:true,reconteo2:qty,malestadoReconteo2:damagedQty
        } : isReconteoMode ? {
          isReconteo:true,reconteo:qty,malestadoReconteo:damagedQty
        } : {stockBuenEstado:qty,malEstado:damagedQty}),
        reviewer:targetItem.Revisado_Por||inv.reviewedBy||'',
        comentario: targetItem.Comentario || '',
        fechaUltimoConteo: targetItem.Fecha_Ultimo_Conteo,
        responsable: targetItem.Responsable || user.displayName || user.username,
        categoria: targetItem.Categoria || cleanCategoria,
        clasificacionAbc: targetItem.Clasificacion_ABC || 'C',
        unidad: targetItem.Unidad || 'PZA',
        costoUnitario: targetItem.Costo_Unitario || 0,
        stockSistema: targetItem.Stock_Sistema || 0,
        photoBase64: resolvedPhotoBase64,
        justificationPhoto: resolvedJustPhotoBase64
      });
      if(!synced.item)throw new Error('Google no devolvió la fila confirmada');
      Object.assign(targetItem,contract.normalize(synced.item));delete inv.closeOperationId;this.saveInventory(inv);
      if(inv.parentInventoryId){
        const parent=this.getInventoryRaw(inv.parentInventoryId);
        const original=parent?.items.find(it=>contract.member(it)===contract.member(targetItem));
        if(original){Object.assign(original,contract.normalize(synced.item));delete parent.closeOperationId;this.saveInventory(parent);}
      }
    } catch (gasErr) {
      throw gasErr;
    }

    return {
      success: true,
      item: targetItem,
      inventoryStatus: inv.status
    };
  }

  requestUnlockItem({ inventoryId, itemId, user, reason }) {
    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) {
      throw new Error(`Inventario '${inventoryId}' no encontrado`);
    }

    if (!this.canModifyInventory(inv, user)) {
      throw new Error(`No tiene permisos para modificar inventarios del centro ${inv.center}`);
    }

    const targetItem = inv.items.find(it => it.id === itemId || it.SKU === itemId || String(it.id) === String(itemId) || String(it.SKU) === String(itemId));
    if (!targetItem) {
      throw new Error(`Ítem '${itemId}' no encontrado en el inventario`);
    }

    targetItem.locked = false;
    targetItem.unlockRequestCount = (targetItem.unlockRequestCount || 0) + 1;
    targetItem.unlockRequests = targetItem.unlockRequests || [];
    targetItem.unlockRequests.push({
      user: user.username,
      userDisplayName: user.displayName || user.username,
      timestamp: new Date().toISOString(),
      previousQty: targetItem.Stock_Fisico,
      reason: reason || 'Solicitud de modificación de conteo'
    });

    this.saveInventory(inv);

    auditService.logUnlockRequest({
      inventoryId: inv.id,
      itemId: targetItem.id,
      sku: targetItem.SKU,
      user: user.username,
      center: inv.center,
      location: targetItem.Ubicacion,
      previousQty: targetItem.Stock_Fisico,
      reason: reason || 'Solicitud de modificación de conteo'
    });

    return {
      success: true,
      message: `Ítem ${targetItem.SKU} desbloqueado para modificación`,
      item: targetItem
    };
  }

  reassignTasks({ inventoryId, itemIds, toUser, requestingUser, reason, assignAll }) {
    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) {
      throw new Error('Inventario no encontrado');
    }

    const isAdmin = requestingUser.role === 'ADMIN' || requestingUser.isSuperadmin;

    if (!isAdmin) {
      if (requestingUser.role === 'ENCARGADO') {
        if (!config.isSameCenter(inv.center, requestingUser.center)) {
          throw new Error(`Acceso denegado: Como Encargado solo puede reasignar tareas en su propio centro (${requestingUser.centerName || requestingUser.center}).`);
        }
      } else {
        throw new Error('Los auxiliares no tienen permisos para reasignar tareas');
      }
    }

    if (!toUser) {
      throw new Error('Debe especificar el auxiliar destino');
    }

    const authService = require('./authService');
    const allUsers = authService.getUsersList();
    const targetUser = allUsers.find(u =>
      u.username?.toLowerCase() === String(toUser).toLowerCase().trim() ||
      (u.displayName && u.displayName.toLowerCase() === String(toUser).toLowerCase().trim()) ||
      (u.clave && u.clave.toLowerCase() === String(toUser).toLowerCase().trim()) ||
      u.id === toUser
    );

    if (!targetUser) {
      throw new Error(`El usuario auxiliar '${toUser}' no fue encontrado en el sistema`);
    }

    // Role check on target user: must be an AUXILIAR (or staff member)
    if (targetUser.role !== 'AUXILIAR' && targetUser.role !== 'ENCARGADO' && targetUser.role !== 'ADMIN') {
      throw new Error('El usuario seleccionado no tiene un perfil operativo válido para asignaciones');
    }

    // Crucial restriction: Encargado can ONLY assign to Auxiliars in their OWN center
    if (!isAdmin && requestingUser.role === 'ENCARGADO') {
      if (!config.isSameCenter(targetUser.center, requestingUser.center)) {
        throw new Error(`Acceso denegado: Como Encargado solo puede asignar tareas a auxiliares de su propio centro (${requestingUser.centerName || requestingUser.center}). El auxiliar seleccionado pertenece a ${targetUser.centerName || targetUser.center}.`);
      }
    }

    // Administrator: Can assign to ANY auxiliary of ANY center without restriction

    const targetUsername = targetUser ? targetUser.username : String(toUser).trim();
    const targetDisplayName = targetUser?.displayName || targetUsername;
    const targetClave = targetUser?.clave || '';

    const isAll = assignAll === true || itemIds === 'ALL' || (Array.isArray(itemIds) && (itemIds.length === 0 || itemIds.includes('ALL')));

    if (!isAll && (!Array.isArray(itemIds) || itemIds.length === 0)) {
      throw new Error('Debe especificar los ítems a reasignar o seleccionar asignar todo el inventario');
    }

    let count = 0;
    if (!Array.isArray(inv.items)) inv.items = [];

    inv.items.forEach(item => {
      if (isAll || itemIds.includes(item.id)) {
        item.Responsable = targetUsername;
        count++;
      }
    });

    // Rebuild assignedAuxiliars list so that only active responsibles have visibility
    if (isAll) {
      inv.assignedAuxiliars = [targetUsername, targetDisplayName, targetClave].filter(Boolean);
    } else {
      const activeResponsibles = new Set();
      inv.items.forEach(it => {
        if (it && it.Responsable) {
          const uObj = allUsers.find(usr =>
            usr.username?.toLowerCase() === String(it.Responsable).toLowerCase().trim() ||
            usr.displayName?.toLowerCase() === String(it.Responsable).toLowerCase().trim() ||
            usr.clave?.toLowerCase() === String(it.Responsable).toLowerCase().trim()
          );
          if (uObj) {
            activeResponsibles.add(uObj.username);
            if (uObj.displayName) activeResponsibles.add(uObj.displayName);
            if (uObj.clave) activeResponsibles.add(uObj.clave);
          } else {
            activeResponsibles.add(it.Responsable);
          }
        }
      });
      inv.assignedAuxiliars = Array.from(activeResponsibles);
    }

    this.saveInventory(inv);

    auditService.logReassignment({
      inventoryId: inv.id,
      fromUser: 'Varios',
      toUser: targetUsername,
      adminUser: requestingUser.username,
      center: inv.center,
      affectedCount: count,
      reason: reason || 'Reasignación de tareas operativas'
    });

    return { success: true, count, toUser: targetUsername, targetDisplayName };
  }

  submitInventoryForReview({ inventoryId, user, signature }) {
    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) throw new Error('Inventario no encontrado');

    if (!this.canModifyInventory(inv, user)) {
      throw new Error(`No tiene permisos para modificar o finalizar inventarios del centro ${inv.center}`);
    }

    if (!Array.isArray(inv.items) || inv.items.length === 0) {
      throw new Error('No se puede finalizar un inventario sin ítems.');
    }

    const isReconteoMode = !!(inv.isReconteo || inv.phase === 'RECONTEO' || inv.phase === 'RECONTEO_2' || String(inv.id).startsWith('REC-'));
    const uncounted = inv.items.filter(it => {
      if (isReconteoMode) {
        const hasRec = it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined;
        const hasPhys = it.Stock_Fisico !== null && it.Stock_Fisico !== undefined;
        return !hasRec && !hasPhys;
      }
      return it.Stock_Fisico === null || it.Stock_Fisico === undefined;
    });
    if (uncounted.length > 0) {
      throw new Error(`No se puede finalizar el inventario: aún quedan ${uncounted.length} ítems pendientes de conteo. El inventario debe completarse al 100%.`);
    }

    if (isReconteoMode) {
      inv.status = 'RECONTEO_COMPLETADO';
      inv.submittedAt = new Date().toISOString();
      inv.submittedBy = user.username;
      inv.signature = signature || 'Firma digital operativa';
      this.saveInventory(inv);

      // Sync reconteo items to parent inventory
      if (inv.parentInventoryId) {
        try {
          const parentInv = this.getInventoryRaw(inv.parentInventoryId);
          if (parentInv) {
            parentInv.status = 'RECONTEO_COMPLETADO';
            parentInv.items.forEach(pItem => {
              const recItem=inv.items.find(r=>contract.member(r)===contract.member(pItem));
              if(recItem)Object.assign(pItem,contract.normalize(recItem),{id:pItem.id,Estado_Reconteo:'Recontado'});
            });
            this.saveInventory(parentInv);
          }
        } catch (e) {
          console.warn('[inventoryService] Notice updating parent inventory status:', e.message);
        }
      }

      auditService.logAction({
        action: 'RECOUNT_SUBMITTED',
        details: `Reconteo finalizado por el auxiliar. Retirado de su bandeja operativa.`,
        user: user.username,
        center: inv.center,
        targetId: inv.id
      });
      return inv;
    }

    inv.status = 'PENDIENTE_JUSTIFICACION';
    inv.submittedAt = new Date().toISOString();
    inv.submittedBy = user.username;
    inv.signature = signature || 'Firma digital operativa';

    this.saveInventory(inv);
    auditService.logAction({
      action: 'INVENTORY_SUBMITTED_FOR_REVIEW',
      details: `Inventario finalizado y firmado al 100% por ${user.role} (${user.username}). Enviado a revisión de justificaciones.`,
      user: user.username,
      center: inv.center,
      targetId: inv.id
    });

    return inv;
  }

  async saveJustification(p) {
    const inv=this.getInventoryRaw(p.inventoryId);
    if(!inv||!this.canModifyInventory(inv,p.user))throw new Error('Inventario inexistente o fuera de su centro');
    const candidates=inv.items.filter(it=>contract.identity(it.SKU)===contract.identity(p.sku)&&
      (!p.itemId||it.id===p.itemId)&&(!p.almacen||contract.identity(it.Almacen)===contract.identity(p.almacen))&&
      (!p.location||contract.identity(it.Ubicacion)===contract.identity(p.location)));
    if(candidates.length!==1)throw new Error('Ítem ambiguo o inexistente; indique almacén y ubicación');
    const item=candidates[0],round=Number(p.round||(p.isJustification2?2:1)),reviewer=p.user.displayName||p.user.username;
    const payload={action:'saveJustification',center:inv.center,inventoryId:inv.id,itemId:item.id,sku:item.SKU,
      almacen:item.Almacen,location:item.Ubicacion,round,isJustification2:round===2,
      corroboracion:contract.status(p),razon:p.reasonType,comentarioJustificacion:p.justification,reviewedBy:reviewer,
      originalStockSistema:item.Stock_Sistema_Original??item.Stock_Sistema,fecha:new Date().toISOString(),
      photoJustificacion:p.driveUrl||p.photoUrl||''};
    const result=await gasService.saveJustificationToGAS(inv.type,payload);
    if(!result.item)throw new Error('Apps Script no devolvió la fila confirmada');
    Object.assign(item,contract.normalize(result.item),{Stock_Sistema_Original:payload.originalStockSistema,
      corroboracion:payload.corroboracion,corroborationStatus:payload.corroboracion,isCuadra:payload.corroboracion==='CUADRA',
      requiereReconteo:payload.corroboracion!=='CUADRA',reviewedAt:payload.fecha,Revisado_Por:reviewer});
    item[round===2?'foto_justificacion_2':'foto_justificacion']=p.driveUrl||p.photoUrl||null;
    const id='JUST-'+createHash('sha256').update(JSON.stringify([inv.id,contract.member(item),round])).digest('hex');
    const record={id,inventoryId:inv.id,itemId:item.id,sku:item.SKU,almacen:item.Almacen,ubicacion:item.Ubicacion,
      round,corroboracion:payload.corroboracion,isCuadra:item.isCuadra,reasonType:p.reasonType,justification:p.justification,
      reviewedBy:reviewer,reviewedAt:payload.fecha,fechaPrimeraJustificacion:item.Fecha_Primera_Justificacion,
      fechaJustificacion2:item.Fecha_Justificacion_2,photoUrl:p.driveUrl||p.photoUrl||null,driveUrl:p.driveUrl||null,
      driveFileId:p.driveFileId||null,center:inv.center,type:inv.type,status:'REVISADO'};
    storagePath.writeJson(path.join(this.justDir,id+'.json'),record);
    inv.reviewedBy=reviewer;delete inv.closeOperationId;this.saveInventory(inv);
    const linkedId=inv.parentInventoryId||inv.recountInventoryId;
    if(linkedId){
      const linked=this.getInventoryRaw(linkedId);
      const match=linked?.items?.find(it=>contract.member(it)===contract.member(item));
      if(match){Object.assign(match,contract.normalize(result.item),{Stock_Sistema_Original:payload.originalStockSistema,
        corroboracion:payload.corroboracion,requiereReconteo:item.requiereReconteo});this.saveInventory(linked);}
    }
    auditService.logJustification({inventoryId:inv.id,sku:item.SKU,justification:p.justification,photoUrl:record.photoUrl,
      user:p.user.username,reviewerName:reviewer,center:inv.center,diffQty:item.Diferencia,diffCost:item.Costo_Diferencia});
    return {...record,item};
  }

  async corroborateItem(p) {
    const inv=this.getInventoryRaw(p.inventoryId);
    const item=inv?.items?.find(it=>(p.itemId?it.id===p.itemId:contract.identity(it.SKU)===contract.identity(p.sku))&&
      (!p.almacen||contract.identity(it.Almacen)===contract.identity(p.almacen))&&(!p.location||contract.identity(it.Ubicacion)===contract.identity(p.location)));
    if(!item)throw new Error('Ítem inexistente');
    const result=await this.saveJustification({...p,round:1,corroboracion:p.status,
      reasonType:item.Razon||'AJUSTE_INVENTARIO',justification:item.Comentario_Justificacion||'',photoUrl:item.foto_justificacion});
    return {success:true,sku:p.sku,status:result.corroboracion,justification:result};
  }

  enableRecount({ inventoryId, user, skusToRecount }) {
    if (user.role !== 'ADMIN' && user.role !== 'ENCARGADO' && !user.isSuperadmin) {
      throw new Error('Solo un Administrador o Encargado puede habilitar el reconteo');
    }

    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) throw new Error('Inventario no encontrado');

    const reviewerName = user.displayName || user.username;
    inv.reviewedBy = reviewerName;
    inv.recountEnabledBy = reviewerName;
    inv.recountEnabledAt = new Date().toISOString();

    // Identify items requiring recount:
    // Only items with differences that were either marked NO_CUADRA or not marked CUADRA
    let itemsToRecount = [];
    if (Array.isArray(skusToRecount) && skusToRecount.length > 0) {
      itemsToRecount = inv.items.filter(it => skusToRecount.includes(it.SKU));
    } else {
      itemsToRecount = inv.items.filter(it => {
        const corr = String(it.corroboracion || it.corroborationStatus || it.Estado || '').toUpperCase().trim();
        const isCuadra = corr === 'CUADRA' || corr === 'JUSTIFICADO';
        const isNoCuadra = corr === 'NO_CUADRA' || corr === 'NO CUADRA' || corr === 'A_RECONTEO';
        const hasDiff = Math.abs(Number(it.Costo_Diferencia ?? it.costoDiferencia ?? 0)) > 0.001 || (Number(it.Diferencia) || 0) !== 0 || (Number(it.Mal_estado) || 0) > 0;
        return isNoCuadra || (hasDiff && !isCuadra);
      });
    }

    if (itemsToRecount.length === 0) {
      throw new Error('No hay ítems con diferencias pendientes de reconteo (o todos fueron marcados como "Cuadra")');
    }

    // Set Col T on original items
    itemsToRecount.forEach(it => {
      it.Revisado_Por = reviewerName;
      it.requiereReconteo = true;
    });

    inv.hasRecount = true;
    inv.status = 'EN_RECONTEO';
    this.saveInventory(inv);

    // Create the specialized Reconteo inventory assigned to the SAME counter(s)
    const recountId = `REC-${inv.id}`;
    const recountItems = itemsToRecount.map((it, idx) => ({
      ...it,
      id: `REC-${it.id || idx}-${Date.now().toString(36)}`,
      Stock_Fisico_1erConteo: it.Stock_Fisico,
      Mal_estado_1erConteo: it.Mal_estado,
      Diferencia_1erConteo: it.Diferencia,
      Stock_Fisico: null,
      Mal_estado: 0,
      Reconteo_Fisico: null,
      Reconteo_Mal_Estado: 0,
      Revisado_Por: reviewerName,
      locked: false,
      Estado: 'Pendiente',
      isReconteoItem: true
    }));

    const recountInventory = {
      id: recountId,
      name: `[RECONTEO] ${inv.name.replace(/^\[RECONTEO\]\s*/, '')}`,
      type: inv.type,
      center: inv.center,
      status: 'EN_PROGRESO', // Active for counter
      phase: 'RECONTEO',
      isReconteo: true,
      parentInventoryId: inv.id,
      assignedAuxiliar: inv.assignedAuxiliar,
      assignedAuxiliars: inv.assignedAuxiliars || [inv.assignedAuxiliar].filter(Boolean),
      createdBy: inv.createdBy,
      recountEnabledBy: reviewerName,
      createdAt: new Date().toISOString(),
      items: recountItems,
      reviewedBy: reviewerName
    };

    this.saveInventory(recountInventory);

    auditService.logAction({
      action: 'RECOUNT_ENABLED',
      details: `Reconteo habilitado con ${recountItems.length} ítems con diferencias para el auxiliar asignado`,
      user: user.username,
      center: inv.center,
      targetId: recountId
    });

    return {
      success: true,
      message: `Reconteo habilitado con ${recountItems.length} ítems para el contador asignado`,
      recountInventoryId: recountId,
      recountInventory,
      itemsCount: recountItems.length
    };
  }

  getJustificationsForInventory(inventoryId) {
    try {
      const files = storagePath.listFiles(this.justDir).filter(f => f.endsWith('.json'));
      const list = [];
      files.forEach(f => {
        const j = storagePath.readJson(path.join(this.justDir, f), null);
        if (j && j.inventoryId === inventoryId) {
          list.push(j);
        }
      });
      return list;
    } catch (e) {
      return [];
    }
  }

  getPendingJustifications(user, centerFilter = null, options = {}) {
    if (user.role !== 'ADMIN' && user.role !== 'ENCARGADO' && !user.isSuperadmin) {
      throw new Error('No tiene permisos para acceder a las justificaciones');
    }

    const includeFinalized = options.includeFinalized === true || options.status === 'ALL' || options.status === 'REVISADO';
    const files = this.getAllInventoryFiles();
    const tasks = [];

    files.forEach(f => {
      const inv = storagePath.readJson(path.join(this.invDir, f), null);
      if (!inv) return;
      if (centerFilter && centerFilter !== 'TODOS' && centerFilter !== 'GLOBAL' && inv.center !== centerFilter) return;
      
      // Enforce center assignment for ENCARGADO
      if (user.role === 'ENCARGADO' && inv.center !== user.center) return;

      // Helper: Determina si un ítem tiene discrepancia (Columna P > 0 o < 0, diferencia física != 0 o daño)
      const isItemDiscrepant = (it) => {
        // Excluir si ya fue corroborado o cerrado como CUADRA
        const corr = String(it.corroborationStatus || it.corroboracion || it.Estado || '').toUpperCase().trim();
        if (corr === 'CUADRA' || it.isCuadra === true) return false;

        const sys = Number(it.Stock_Sistema ?? it.stockSistema ?? 0);
        const physCount = (it.Stock_Buen_Estado !== null && it.Stock_Buen_Estado !== undefined && String(it.Stock_Buen_Estado).trim() !== '')
          ? Number(it.Stock_Buen_Estado)
          : ((it.Stock_Fisico !== null && it.Stock_Fisico !== undefined && String(it.Stock_Fisico).trim() !== '') ? Number(it.Stock_Fisico) : null);
        const damaged = Number(it.Mal_estado ?? it.malEstado ?? 0);

        const hasRec2 = (it.Stock_Total_Reconteo_2 !== null && it.Stock_Total_Reconteo_2 !== undefined && String(it.Stock_Total_Reconteo_2).trim() !== '') ||
                        (it.Diferencia_Final_2 !== null && it.Diferencia_Final_2 !== undefined && String(it.Diferencia_Final_2).trim() !== '') ||
                        (it.Reconteo_2 !== null && it.Reconteo_2 !== undefined && String(it.Reconteo_2).trim() !== '');

        const hasRec1 = (it.Stock_Total_Reconteo !== null && it.Stock_Total_Reconteo !== undefined && String(it.Stock_Total_Reconteo).trim() !== '') ||
                        (it.Diferencia_Final !== null && it.Diferencia_Final !== undefined && String(it.Diferencia_Final).trim() !== '') ||
                        (it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined && String(it.Reconteo_Fisico).trim() !== '') ||
                        (it.Reconteo !== null && it.Reconteo !== undefined && String(it.Reconteo).trim() !== '');

        // 1. Prioridad: Si tiene Reconteo 2 (Col AJ para stock total y Col AM para diferencia final)
        if (hasRec2) {
          const recDam2 = (it.Malestado_Reconteo_2 !== null && it.Malestado_Reconteo_2 !== undefined && String(it.Malestado_Reconteo_2).trim() !== '')
            ? Number(it.Malestado_Reconteo_2)
            : 0;
          const recPhys2 = (it.Reconteo_2 !== null && it.Reconteo_2 !== undefined && String(it.Reconteo_2).trim() !== '')
            ? Number(it.Reconteo_2)
            : 0;

          if (sys < 0 && recPhys2 === 0 && recDam2 === 0) return false;

          const recTot2 = (it.Stock_Total_Reconteo_2 !== null && it.Stock_Total_Reconteo_2 !== undefined && String(it.Stock_Total_Reconteo_2).trim() !== '')
            ? Number(it.Stock_Total_Reconteo_2)
            : (recPhys2 + recDam2);

          const finalDiff2 = (it.Diferencia_Final_2 !== null && it.Diferencia_Final_2 !== undefined && String(it.Diferencia_Final_2).trim() !== '')
            ? Number(it.Diferencia_Final_2)
            : (recTot2 - sys);

          // Si cuadró en reconteo 2 (diferencia 0 y sin daño), NO es discrepancia
          return (finalDiff2 !== 0 || recDam2 > 0);
        }

        // 2. Si tiene Reconteo 1 (Col Y para stock total y Col AB para diferencia final)
        if (hasRec1) {
          const recDam1 = (it.Reconteo_Mal_Estado !== null && it.Reconteo_Mal_Estado !== undefined && String(it.Reconteo_Mal_Estado).trim() !== '')
            ? Number(it.Reconteo_Mal_Estado)
            : ((it.Malestado_Reconteo !== null && it.Malestado_Reconteo !== undefined && String(it.Malestado_Reconteo).trim() !== '')
                ? Number(it.Malestado_Reconteo)
                : damaged);

          const recPhys1 = (it.Reconteo !== null && it.Reconteo !== undefined && String(it.Reconteo).trim() !== '')
            ? Number(it.Reconteo)
            : ((it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined && String(it.Reconteo_Fisico).trim() !== '') ? Number(it.Reconteo_Fisico) : 0);

          if (sys < 0 && recPhys1 === 0 && recDam1 === 0) return false;

          const recTot1 = (it.Stock_Total_Reconteo !== null && it.Stock_Total_Reconteo !== undefined && String(it.Stock_Total_Reconteo).trim() !== '')
            ? Number(it.Stock_Total_Reconteo)
            : (recPhys1 + recDam1);

          const finalDiff1 = (it.Diferencia_Final !== null && it.Diferencia_Final !== undefined && String(it.Diferencia_Final).trim() !== '')
            ? Number(it.Diferencia_Final)
            : (recTot1 - sys);

          // Si cuadró en reconteo 1 (diferencia 0 y sin daño), NO es discrepancia
          return (finalDiff1 !== 0 || recDam1 > 0);
        }

        // 3. Regla de Negativos primer conteo
        if (sys < 0 && damaged === 0 && (physCount === 0 || physCount === null)) return false;

        // 4. Daño / mal estado
        if (damaged > 0) return true;

        // 5. Verificación primer conteo (Col O Diferencia o Stock_Total vs Stock_Sistema)
        const diffVal = (it.Diferencia !== null && it.Diferencia !== undefined && String(it.Diferencia).trim() !== '')
          ? Number(it.Diferencia)
          : null;
        if (diffVal !== null) {
          return diffVal !== 0;
        }

        const hasPhys = it.Stock_Fisico !== null && it.Stock_Fisico !== undefined && String(it.Stock_Fisico).trim() !== '';
        if (hasPhys) {
          const phys = Number(it.Stock_Fisico);
          const total = (it.Stock_Total !== null && it.Stock_Total !== undefined && String(it.Stock_Total).trim() !== '')
            ? Number(it.Stock_Total)
            : (phys + damaged);
          return (total - sys) !== 0;
        }

        const costDiff = Number(it.Costo_Diferencia ?? it.costoDiferencia ?? 0);
        if (Math.abs(costDiff) > 0.001) return true;

        return false;
      };

      // Si este es el inventario hijo de reconteo y tiene un inventario padre, no mostrar como tarjeta separada
      // ya que el inventario principal se actualiza a RECONTEO_COMPLETADO y consolida toda la justificación final
      if (inv.isReconteo && inv.parentInventoryId) {
        return;
      }

      // Don't show recount inventories while still being actively counted by auxiliary
      if (inv.isReconteo && inv.status === 'EN_PROGRESO') {
        return;
      }

      // Si el inventario ya fue revisado y finalizado (cerrado en Drive), filtrar solo si no se solicitó includeFinalized
      const isFinalized = inv.status === 'REVISADO' || inv.isFinalized === true;
      if (isFinalized && !includeFinalized) {
        return;
      }

      const existingJustifications = this.getJustificationsForInventory(inv.id);

      const findJustificationForItem = (item) => {
        const itemSku = String(item.SKU || '').trim().toUpperCase();
        const itemWar = String(item.Almacen || item.almacen || item.warehouse || '').trim().toUpperCase();
        const itemLoc = String(item.Ubicacion || '').trim().toUpperCase();

        if (item.id) {
          const byId = existingJustifications.find(j => j.itemId === item.id);
          if (byId) return byId;
        }
        if (itemWar && itemLoc) {
          const byWarLoc = existingJustifications.find(j =>
            String(j.sku || '').trim().toUpperCase() === itemSku &&
            String(j.almacen || j.warehouse || '').trim().toUpperCase() === itemWar &&
            String(j.ubicacion || '').trim().toUpperCase() === itemLoc
          );
          if (byWarLoc) return byWarLoc;
        }
        if (itemWar) {
          const byWar = existingJustifications.find(j =>
            String(j.sku || '').trim().toUpperCase() === itemSku &&
            String(j.almacen || j.warehouse || '').trim().toUpperCase() === itemWar
          );
          if (byWar) return byWar;
        }
        const bySku = existingJustifications.filter(j => String(j.sku || '').trim().toUpperCase() === itemSku);
        if (bySku.length === 1 && (!bySku[0].almacen || !itemWar)) {
          return bySku[0];
        }
        return null;
      };

      // Incluir tanto discrepancias pendientes como ítems ya justificados para dar visibilidad completa
      const isItemRelevantForJustifications = (it) => {
        if (isItemDiscrepant(it)) return true;
        const j = findJustificationForItem(it);
        const corr = String(it.corroborationStatus || it.corroboracion || it.Estado || '').toUpperCase().trim();
        const hasJustData = !!(j || it.Comentario_Justificacion || it.justification || it.Razon || it.Razon_Justificacion || it.isCuadra === true || corr === 'CUADRA' || corr === 'JUSTIFICADO');
        return hasJustData;
      };

      const validItemsToJustify = (inv.items || []).filter(isItemRelevantForJustifications);

      const pendingDiscrepancies = validItemsToJustify.filter(it => {
        const j = findJustificationForItem(it);
        const corr = String(it.corroborationStatus || it.corroboracion || it.Estado || '').toUpperCase().trim();
        return !j && corr !== 'CUADRA' && corr !== 'JUSTIFICADO' && it.isCuadra !== true && !it.Comentario_Justificacion && !it.justification;
      });

      if (validItemsToJustify.length > 0 || inv.status === 'PENDIENTE_JUSTIFICACION' || inv.status === 'EN_RECONTEO' || inv.status === 'RECONTEO_COMPLETADO' || isFinalized) {
        if (inv.status === 'EN_RECONTEO') {
          const recId = inv.recountInventoryId || `REC-${inv.id}`;
          try {
            const childRec = this.getInventoryRaw(recId);
            if (childRec && (childRec.status === 'RECONTEO_COMPLETADO' || childRec.status === 'REVISADO')) {
              inv.status = 'RECONTEO_COMPLETADO';
              this.saveInventory(inv);
            } else if (pendingDiscrepancies.length === 0 && (inv.hasRecount || inv.isReconteo)) {
              inv.status = 'RECONTEO_COMPLETADO';
              this.saveInventory(inv);
            }
          } catch (e) {}
        }
        tasks.push({
          inventoryId: inv.id,
          inventoryName: inv.name,
          type: inv.type,
          center: inv.center,
          status: inv.status,
          isFinalized,
          closedAt: inv.closedAt || null,
          closedBy: inv.closedBy || null,
          phase: inv.phase || (inv.isReconteo ? 'RECONTEO' : 'CONTEO'),
          isReconteo: !!(inv.isReconteo || inv.phase === 'RECONTEO' || inv.phase === 'RECONTEO_2' || String(inv.id).startsWith('REC-')),
          parentInventoryId: inv.parentInventoryId || null,
          hasRecount: inv.hasRecount || false,
          hasRecount2: inv.hasRecount2 || false,
          recountRound: inv.recountRound || (inv.hasRecount2 ? 2 : (inv.hasRecount ? 1 : 0)),
          reopenedPhase: inv.reopenedPhase || null,
          recountInventoryId: inv.recountInventoryId || `REC-${inv.id}`,
          assignedTo: inv.assignedTo || [],
          totalItems: inv.items.length,
          totalDiscrepancies: validItemsToJustify.length,
          pendingJustificationsCount: pendingDiscrepancies.length,
          justifiedItemsCount: validItemsToJustify.length - pendingDiscrepancies.length,
          items: validItemsToJustify.map(it => {
            const jDetails = findJustificationForItem(it);
            const corr = String(it.corroborationStatus || it.corroboracion || it.Estado || '').toUpperCase().trim();
            const hasText = !!(it.Comentario_Justificacion || it.justification || (jDetails && jDetails.justification));
            const isJustified = !!jDetails || corr === 'CUADRA' || corr === 'JUSTIFICADO' || it.isCuadra === true || hasText;
            return {
              ...it,
              Razon: it.Razon || it.Razon_Justificacion || (jDetails ? jDetails.reasonType : ''),
              Comentario_Justificacion: it.Comentario_Justificacion || (jDetails ? jDetails.justification : (it.justification || '')),
              isJustified,
              corroborationStatus: it.corroborationStatus || it.corroboracion || (isJustified ? 'CUADRA' : null),
              corroboratedBy: it.corroboratedBy || it.Revisado_Por || (jDetails ? jDetails.reviewedBy : null),
              justificationDetails: jDetails
            };
          })
        });
      }
    });

    return tasks;
  }

  async finishReviewAndClose({ inventoryId, user, reviewNotes }) {
    if (user.role !== 'ADMIN' && user.role !== 'ENCARGADO' && !user.isSuperadmin) {
      throw new Error('Solo los administradores o encargados pueden terminar la revisión y crear el archivo final en Google Drive');
    }

    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) throw new Error('Inventario no encontrado');

    let primaryInv = inv;
    let parentInv = null;
    let childRecountInv = null;

    if (inv.isReconteo && inv.parentInventoryId) {
      childRecountInv = inv;
      parentInv = this.getInventoryRaw(inv.parentInventoryId);
      if (parentInv) {
        primaryInv = parentInv;
      }
    } else if (inv.hasRecount || inv.recountInventoryId) {
      parentInv = inv;
      const recId = inv.recountInventoryId || `REC-${inv.id}`;
      childRecountInv = this.getInventoryRaw(recId);
    }

    // If recount exists, merge recount values into primary inventory
    if (childRecountInv && Array.isArray(childRecountInv.items) && Array.isArray(primaryInv.items)) {
      primaryInv.items.forEach(pItem => {
        const pSku = String(pItem.SKU || '').trim().toUpperCase();
        const pWar = String(pItem.Almacen || pItem.almacen || pItem.warehouse || '').trim().toUpperCase();
        const pLoc = String(pItem.Ubicacion || '').trim().toUpperCase();

        const recItem = childRecountInv.items.find(r => {
          const rSku = String(r.SKU || '').trim().toUpperCase();
          const rWar = String(r.Almacen || r.almacen || r.warehouse || '').trim().toUpperCase();
          const rLoc = String(r.Ubicacion || '').trim().toUpperCase();
          if (rSku !== pSku) return false;
          if (pWar && rWar && pWar !== rWar) return false;
          if (pLoc && rLoc && pLoc !== rLoc) return false;
          return true;
        });
        if (recItem) {
          if (recItem.Reconteo_Fisico !== null && recItem.Reconteo_Fisico !== undefined) {
            pItem.Reconteo_Fisico = recItem.Reconteo_Fisico;
          } else if (recItem.Stock_Fisico !== null && recItem.Stock_Fisico !== undefined) {
            pItem.Reconteo_Fisico = recItem.Stock_Fisico;
          }
          if (recItem.Reconteo_Mal_Estado !== null && recItem.Reconteo_Mal_Estado !== undefined) {
            pItem.Reconteo_Mal_Estado = recItem.Reconteo_Mal_Estado;
          } else if (recItem.Mal_estado !== null && recItem.Mal_estado !== undefined) {
            pItem.Reconteo_Mal_Estado = recItem.Mal_estado;
          }
          pItem.Estado_Reconteo = 'Recontado';
          if (childRecountInv.reviewedBy) pItem.Revisado_Por = childRecountInv.reviewedBy;
          const finalRecQty = pItem.Reconteo_Fisico !== null && pItem.Reconteo_Fisico !== undefined ? Number(pItem.Reconteo_Fisico) : Number(pItem.Stock_Fisico || 0);
          pItem.Reconteo=pItem.Reconteo_Fisico;
          pItem.Malestado_Reconteo=pItem.Reconteo_Mal_Estado;
          pItem.Stock_Total_Reconteo=finalRecQty+Number(pItem.Reconteo_Mal_Estado||0);
          pItem.Diferencia_Final = (pItem.Estado_Justificacion_2||pItem.Estado)==='CUADRA'?0:pItem.Stock_Total_Reconteo - Number(pItem.Stock_Sistema || 0);
          pItem.Costo_Diferencia_Final = pItem.Diferencia_Final * Number(pItem.Costo_Unitario || 0);
        }
      });
    }

    // Gather combined justifications from primary and recount
    const justPrimary = this.getJustificationsForInventory(primaryInv.id);
    const justChild = childRecountInv ? this.getJustificationsForInventory(childRecountInv.id) : [];
    const justMap = new Map();
    const makeJustKey = (j) => j.id || (String(j.round||1)+'___') + `${String(j.sku || '').trim().toUpperCase()}___${String(j.almacen || j.warehouse || '').trim().toUpperCase()}___${String(j.ubicacion || '').trim().toUpperCase()}`;
    justPrimary.forEach(j => justMap.set(makeJustKey(j), j));
    justChild.forEach(j => justMap.set(makeJustKey(j), j));
    const justifications = Array.from(justMap.values());

    if(!this.canModifyInventory(primaryInv,user))throw new Error('Inventario fuera de su centro');
    primaryInv.closeOperationId ||= randomUUID();
    this.saveInventory(primaryInv);
    // 1. Create final file in Google Drive via driveService
    const driveResult = await driveService.createFinalDriveFile({
      inventory: primaryInv,
      justifications,
      user,
      reviewNotes
    });

    // 2. Mark primary inventory as reviewed and closed
    const closedAt = new Date().toISOString();
    primaryInv.status = 'REVISADO';
    primaryInv.closedAt = closedAt;
    primaryInv.closedBy = user.username;
    primaryInv.driveFileId = driveResult.fileId;
    primaryInv.driveFileName = driveResult.fileName;
    primaryInv.driveUrl = driveResult.driveUrl || null;
    primaryInv.spreadsheetUrl=driveResult.spreadsheetUrl;
    primaryInv.manifest=driveResult.manifest;
    this.saveInventory(primaryInv);

    // If child recount inventory exists, close it as well
    if (childRecountInv && childRecountInv.id !== primaryInv.id) {
      childRecountInv.status = 'REVISADO';
      childRecountInv.closedAt = closedAt;
      childRecountInv.closedBy = user.username;
      childRecountInv.driveFileId = driveResult.fileId;
      childRecountInv.driveFileName = driveResult.fileName;
      childRecountInv.driveUrl = driveResult.driveUrl || null;
      this.saveInventory(childRecountInv);
    }

    auditService.logAction({
      action: 'INVENTORY_REVIEW_FINISHED',
      details: `Revisión completada por ${user.username}. Archivo final Drive creado: ${driveResult.fileName}`,
      user: user.username,
      center: primaryInv.center,
      targetId: primaryInv.id
    });

    return {
      success: true,
      message: 'Revisión finalizada con éxito. Archivo de inventario creado en Google Drive.',
      drive: driveResult,
      inventory: primaryInv
    };
  }

  async reopenInventory({ inventoryId, user, reason, targetPhase = '1ER_CONTEO', syncFromGAS = true }) {
    const isAdmin = user.role === 'ADMIN' || user.isSuperadmin || ['alonso', 'jcarlos', 'absael', 'admin'].includes(String(user.username || '').toLowerCase());
    const isEncargado = user.role === 'ENCARGADO';

    if (!isAdmin && !isEncargado) {
      throw new Error('Solo administradores y encargados de centro pueden reabrir inventarios');
    }

    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) throw new Error('Inventario no encontrado');

    if (isEncargado && inv.center && !config.isSameCenter(inv.center, user.center)) {
      throw new Error(`No tiene permisos para reabrir inventarios del centro ${inv.center}. Su centro es ${user.center}`);
    }

    // Configurar fase solicitada
    const cleanPhase = String(targetPhase || '1ER_CONTEO').toUpperCase().trim();
    if (cleanPhase === 'RECONTEO_2' || cleanPhase === 'RECONTEO 2') {
      inv.status = 'EN_RECONTEO';
      inv.phase = 'RECONTEO_2';
      inv.hasRecount = true;
      inv.hasRecount2 = true;
      inv.recountRound = 2;
      inv.reopenedPhase = 'RECONTEO_2';
    } else if (cleanPhase === 'RECONTEO_1' || cleanPhase === 'RECONTEO' || cleanPhase === 'RECONTEO 1') {
      inv.status = 'EN_RECONTEO';
      inv.phase = 'RECONTEO';
      inv.hasRecount = true;
      inv.recountRound = 1;
      inv.reopenedPhase = 'RECONTEO_1';
    } else if (cleanPhase === 'JUSTIFICACION' || cleanPhase === 'JUSTIFICACIONES') {
      inv.status = 'PENDIENTE_JUSTIFICACION';
      inv.reopenedPhase = 'JUSTIFICACION';
    } else {
      // 1er Conteo por defecto
      inv.status = 'EN_PROGRESO';
      inv.phase = 'CONTEO';
      inv.reopenedPhase = '1ER_CONTEO';
    }

    inv.isFinalized = false;
    inv.reopenedAt = new Date().toISOString();
    inv.reopenedBy = user.displayName || user.username;
    inv.reopenReason = reason || `Reapertura para actualizar cantidades (${inv.reopenedPhase})`;

    // Sincronizar las cantidades más recientes desde Google Sheets si está habilitado
    let gasSyncDetails = { synced: false, itemsUpdated: 0 };
    if (syncFromGAS !== false) {
      try {
        let remoteRows = [];
        if (inv.spreadsheetUrl || inv.driveUrl) {
          remoteRows = await gasService.fetchSpreadsheetItems(inv.spreadsheetUrl || inv.driveUrl,inv);
        }
        if ((!remoteRows || remoteRows.length === 0) && inv.type && inv.center) {
          remoteRows = await gasService.fetchProductsFromScript(inv.type, inv.center);
        }

        if (Array.isArray(remoteRows) && remoteRows.length > 0) {
          let updatedCount = 0;
          inv.items.forEach(it => {
            const itSku = String(it.SKU || '').trim().toUpperCase();
            const itLoc = String(it.Ubicacion || '').trim().toUpperCase();
            const itWar = String(it.Almacen || it.almacen || it.warehouse || '').trim().toUpperCase();

            // Buscar coincidencia exacta por SKU + Ubicación + Almacén, o fallback a SKU
            const match=remoteRows.find(r=>contract.member(r)===contract.member(it));

            if (match) {
              // 1er Conteo
              if (match.Stock_Fisico !== null && match.Stock_Fisico !== undefined) it.Stock_Fisico = match.Stock_Fisico;
              if (match.Stock_Buen_Estado !== null && match.Stock_Buen_Estado !== undefined) it.Stock_Buen_Estado = match.Stock_Buen_Estado;
              if (match.Mal_estado !== null && match.Mal_estado !== undefined) it.Mal_estado = match.Mal_estado;
              if (match.Stock_Total !== null && match.Stock_Total !== undefined) it.Stock_Total = match.Stock_Total;
              if (match.Diferencia !== null && match.Diferencia !== undefined) it.Diferencia = match.Diferencia;
              if (match.Costo_Diferencia !== null && match.Costo_Diferencia !== undefined) it.Costo_Diferencia = match.Costo_Diferencia;

              // Reconteo 1
              if (match.Reconteo_Fisico !== null && match.Reconteo_Fisico !== undefined) it.Reconteo_Fisico = match.Reconteo_Fisico;
              if (match.Reconteo !== null && match.Reconteo !== undefined) it.Reconteo = match.Reconteo;
              if (match.Reconteo_Mal_Estado !== null && match.Reconteo_Mal_Estado !== undefined) it.Reconteo_Mal_Estado = match.Reconteo_Mal_Estado;
              if (match.Malestado_Reconteo !== null && match.Malestado_Reconteo !== undefined) it.Malestado_Reconteo = match.Malestado_Reconteo;
              if (match.Stock_Total_Reconteo !== null && match.Stock_Total_Reconteo !== undefined) it.Stock_Total_Reconteo = match.Stock_Total_Reconteo;
              if (match.Diferencia_Final !== null && match.Diferencia_Final !== undefined) it.Diferencia_Final = match.Diferencia_Final;
              if (match.Costo_Diferencia_Final !== null && match.Costo_Diferencia_Final !== undefined) it.Costo_Diferencia_Final = match.Costo_Diferencia_Final;
              if (match.Fecha_Reconteo) it.Fecha_Reconteo = match.Fecha_Reconteo;

              // Reconteo 2
              if (match.Reconteo_2 !== null && match.Reconteo_2 !== undefined) it.Reconteo_2 = match.Reconteo_2;
              if (match.Malestado_Reconteo_2 !== null && match.Malestado_Reconteo_2 !== undefined) it.Malestado_Reconteo_2 = match.Malestado_Reconteo_2;
              if (match.Stock_Total_Reconteo_2 !== null && match.Stock_Total_Reconteo_2 !== undefined) it.Stock_Total_Reconteo_2 = match.Stock_Total_Reconteo_2;
              if (match.Diferencia_Final_2 !== null && match.Diferencia_Final_2 !== undefined) it.Diferencia_Final_2 = match.Diferencia_Final_2;
              if (match.Costo_Diferencia_Final_2 !== null && match.Costo_Diferencia_Final_2 !== undefined) it.Costo_Diferencia_Final_2 = match.Costo_Diferencia_Final_2;
              if (match.Fecha_Reconteo_2) it.Fecha_Reconteo_2 = match.Fecha_Reconteo_2;

              // Si en Sheets está marcado CUADRA / NO CUADRA
              if (match.corroboracion) it.corroboracion = match.corroboracion;
              if (match.corroborationStatus) it.corroborationStatus = match.corroborationStatus;

              updatedCount++;
            }
          });
          inv.lastGasSyncAt = new Date().toISOString();
          gasSyncDetails = { synced: true, itemsUpdated: updatedCount };
        }
      } catch (gasErr) {
        console.warn('[reopenInventory] Aviso sincronizando con Sheets:', gasErr.message);
        gasSyncDetails = { synced: false, error: gasErr.message };
      }
    }

    // Si tiene un inventario hijo de reconteo o padre, mantener coherencia de estados
    if (inv.recountInventoryId) {
      const childRec = this.getInventoryRaw(inv.recountInventoryId);
      if (childRec) {
        childRec.status = inv.status === 'EN_RECONTEO' ? 'EN_PROGRESO' : inv.status;
        childRec.isFinalized = false;
        this.saveInventory(childRec);
      }
    }

    delete inv.closeOperationId;
    this.saveInventory(inv);
    auditService.logReopen({
      inventoryId: inv.id,
      user: user.username,
      center: inv.center,
      reason: inv.reopenReason
    });

    return {
      success: true,
      inventory: inv,
      targetPhase: inv.reopenedPhase,
      gasSync: gasSyncDetails,
      message: `Inventario ${inv.id} reabierto con éxito en fase '${inv.reopenedPhase}'.`
    };
  }

  async syncInventoryFromSheet({inventoryId,user}) {
    const inv=this.getInventoryRaw(inventoryId);
    if(!inv||!this.canModifyInventory(inv,user))throw new Error('Inventario fuera de su centro');
    const rows=inv.spreadsheetUrl?await gasService.fetchSpreadsheetItems(inv.spreadsheetUrl):await gasService.fetchProductsFromScript(inv.type,inv.center);
    const map=new Map();
    rows.forEach(raw=>{const item=contract.normalize(raw),key=contract.member(item);if(map.has(key))throw new Error('Identidad duplicada en Google Sheets');map.set(key,item);});
    let updatedCount=0;
    inv.items.forEach(item=>{
      const found=map.get(contract.member(item));if(!found)return;
      Object.assign(item,found);item.locked=contract.has(found.Stock_Total);
      const state=found.Estado_Justificacion_2||found.Estado;
      item.corroboracion=state;item.corroborationStatus=state;item.isCuadra=state==='CUADRA';
      updatedCount++;
    });
    inv.lastGasSyncAt=new Date().toISOString();this.saveInventory(inv);
    return {success:true,inventoryId:inv.id,itemsUpdated:updatedCount,updatedCount,totalItems:inv.items.length,syncedAt:inv.lastGasSyncAt};
  }

  async syncAllActiveInventoriesFromSheets(user) {
    const files = this.getAllInventoryFiles();
    const results = [];
    for (const f of files) {
      if (snapshotService.isSnapshotDeleted(f)) continue;
      const inv = storagePath.readJson(path.join(this.invDir, f), null);
      if (!inv || !inv.id || !inv.center) continue;
      if (inv.status === 'ARCHIVADO' || inv.status === 'COMPLETADO' || inv.status === 'CERRADO') continue;
      try {
        const res = await this.syncInventoryFromSheet({ inventoryId: inv.id, user });
        results.push({ id: inv.id, center: inv.center, updated: res.itemsUpdated, success: true });
      } catch (err) {
        results.push({ id: inv.id, center: inv.center, error: err.message, success: false });
      }
    }
    return results;
  }

  async updateItemQuantityInInventory({ inventoryId, user, sku, itemId, location, almacen, countPhase = '1ER_CONTEO', stockFisico, malEstado = 0, reason = '' }) {
    const isAdmin = user.role === 'ADMIN' || user.isSuperadmin || ['alonso', 'jcarlos', 'absael', 'admin'].includes(String(user.username || '').toLowerCase());
    const isEncargado = user.role === 'ENCARGADO';

    if (!isAdmin && !isEncargado) {
      throw new Error('Solo administradores y encargados pueden actualizar cantidades');
    }

    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) throw new Error('Inventario no encontrado');

    if (isEncargado && inv.center && !config.isSameCenter(inv.center, user.center)) {
      throw new Error(`No tiene permisos para modificar inventarios del centro ${inv.center}`);
    }

    const cleanSku = String(sku || '').trim().toUpperCase();
    const cleanLoc = String(location || '').trim().toUpperCase();
    const cleanWar = String(almacen || '').trim().toUpperCase();

    let targetItem = null;
    if (itemId) {
      targetItem = inv.items.find(it => String(it.id) === String(itemId));
    }
    if (!targetItem && cleanSku) {
      targetItem = inv.items.find(it => {
        const iSku = String(it.SKU || '').trim().toUpperCase();
        if (iSku !== cleanSku) return false;
        const iLoc = String(it.Ubicacion || '').trim().toUpperCase();
        const iWar = String(it.Almacen || it.almacen || it.warehouse || '').trim().toUpperCase();
        if (cleanLoc && iLoc && cleanLoc !== iLoc) return false;
        if (cleanWar && iWar && cleanWar !== iWar) return false;
        return true;
      }) || inv.items.find(it => String(it.SKU || '').trim().toUpperCase() === cleanSku);
    }

    if (!targetItem) {
      throw new Error(`Ítem con SKU ${sku} no encontrado en el inventario`);
    }

    const qty = contract.quantity(stockFisico,'stockFisico');
    const damagedQty = contract.quantity(malEstado,'malEstado');
    const unitCost = Number(targetItem.Costo_Unitario) || 0;
    const sysStock = Number(targetItem.Stock_Sistema) || 0;
    const phaseClean = String(countPhase || '1ER_CONTEO').toUpperCase().trim();

    if (phaseClean === 'RECONTEO_2' || phaseClean === 'RECONTEO 2') {
      const isNegRec2Match = (sysStock < 0 && qty === 0 && damagedQty === 0);
      targetItem.Reconteo_2 = qty;
      targetItem.Malestado_Reconteo_2 = damagedQty;
      targetItem.Stock_Total_Reconteo_2 = (qty + damagedQty);
      targetItem.Diferencia_Final_2 = targetItem.Stock_Total_Reconteo_2 - sysStock;
      targetItem.Costo_Diferencia_Final_2 = targetItem.Diferencia_Final_2 * unitCost;
      targetItem.Fecha_Reconteo_2 = new Date().toISOString();
      targetItem.Revisado_Por = user.displayName || user.username;
      inv.hasRecount2 = true;
    } else if (phaseClean === 'RECONTEO_1' || phaseClean === 'RECONTEO' || phaseClean === 'RECONTEO 1') {
      const isNegRec1Match = (sysStock < 0 && qty === 0 && damagedQty === 0);
      targetItem.Reconteo_Fisico = qty;
      targetItem.Reconteo = qty;
      targetItem.Reconteo_Mal_Estado = damagedQty;
      targetItem.Malestado_Reconteo = damagedQty;
      targetItem.Stock_Total_Reconteo = (qty + damagedQty);
      targetItem.Diferencia_Final = targetItem.Stock_Total_Reconteo - sysStock;
      targetItem.Costo_Diferencia_Final = targetItem.Diferencia_Final * unitCost;
      targetItem.Fecha_Reconteo = new Date().toISOString();
      targetItem.Revisado_Por = user.displayName || user.username;
      inv.hasRecount = true;
    } else {
      // 1er Conteo
      const isNeg1Match = (sysStock < 0 && qty === 0 && damagedQty === 0);
      targetItem.Stock_Fisico = qty;
      targetItem.Stock_Buen_Estado = qty;
      targetItem.Mal_estado = damagedQty;
      targetItem.Stock_Total = (qty + damagedQty);
      targetItem.Diferencia = targetItem.Stock_Total - sysStock;
      targetItem.Costo_Diferencia = targetItem.Diferencia * unitCost;
      targetItem.Fecha_Ultimo_Conteo = new Date().toISOString();
      targetItem.Responsable = user.displayName || user.username;
    }

    // Historial de modificaciones
    targetItem.modificationCount = (targetItem.modificationCount || 0) + 1;
    targetItem.modificationHistory = targetItem.modificationHistory || [];
    targetItem.modificationHistory.push({
      phase: phaseClean,
      qty,
      damagedQty,
      user: user.username,
      reason: reason || `Ajuste manual de cantidad en ${phaseClean}`,
      timestamp: new Date().toISOString()
    });



    // Sincronizar únicamente el bloque de columnas correspondiente a la fase editada.
    try {
      const gasPayload = {
        center: inv.center,
        type: inv.type,
        sku: targetItem.SKU,
        barcode: targetItem.Codigo_Barras,
        descripcion: targetItem.Descripcion,
        location: targetItem.Ubicacion,
        almacen: targetItem.Almacen || targetItem.almacen || targetItem.warehouse || cleanWar || '',
        warehouse: targetItem.Almacen || targetItem.almacen || targetItem.warehouse || cleanWar || '',
        countPhase: phaseClean,
        reviewer: user.displayName || user.username,
        costoUnitario: targetItem.Costo_Unitario || 0,
        stockSistema: targetItem.Stock_Sistema || 0
      };

      if (phaseClean === 'RECONTEO_2' || phaseClean === 'RECONTEO 2') {
        Object.assign(gasPayload, {
          isReconteo2: true,
          fechaReconteo2: targetItem.Fecha_Reconteo_2,
          reconteo2: targetItem.Reconteo_2,
          malestadoReconteo2: targetItem.Malestado_Reconteo_2,
          stockTotalReconteo2: targetItem.Stock_Total_Reconteo_2,
          diferenciaFinal2: targetItem.Diferencia_Final_2,
          costoDiferenciaFinal2: targetItem.Costo_Diferencia_Final_2
        });
      } else if (phaseClean === 'RECONTEO_1' || phaseClean === 'RECONTEO' || phaseClean === 'RECONTEO 1') {
        Object.assign(gasPayload, {
          isReconteo: true,
          fechaReconteo: targetItem.Fecha_Reconteo,
          reconteo: targetItem.Reconteo,
          reconteoFisico: targetItem.Reconteo_Fisico,
          reconteoMalEstado: targetItem.Reconteo_Mal_Estado,
          malestadoReconteo: targetItem.Malestado_Reconteo,
          stockTotalReconteo: targetItem.Stock_Total_Reconteo,
          diferenciaFinal: targetItem.Diferencia_Final,
          costoDiferenciaFinal: targetItem.Costo_Diferencia_Final
        });
      } else {
        Object.assign(gasPayload, {
          stockBuenEstado: targetItem.Stock_Buen_Estado,
          stockFisico: targetItem.Stock_Fisico,
          stockTotal: targetItem.Stock_Total,
          malEstado: targetItem.Mal_estado,
          responsable: targetItem.Responsable || user.displayName || user.username,
          comentario: targetItem.Comentario || '',
          fechaUltimoConteo: targetItem.Fecha_Ultimo_Conteo
        });
      }

      const synced=await gasService.upsertCountToGAS(inv.type,{...gasPayload,inventoryId:inv.id,itemId:targetItem.id});
      if(!synced.item)throw new Error('Google no devolvió la fila confirmada');
      Object.assign(targetItem,contract.normalize(synced.item));delete inv.closeOperationId;this.saveInventory(inv);
      if(inv.parentInventoryId){
        const parent=this.getInventoryRaw(inv.parentInventoryId);
        const original=parent?.items.find(it=>contract.member(it)===contract.member(targetItem));
        if(original){Object.assign(original,contract.normalize(synced.item));delete parent.closeOperationId;this.saveInventory(parent);}
      }
    } catch(e){throw e;}

    return {
      success: true,
      item: targetItem,
      inventory: inv,
      message: `Cantidad actualizada para SKU ${targetItem.SKU} en ${phaseClean}`
    };
  }

  deleteInventory({ inventoryId, user, deleteKey, reason }) {
    if (!inventoryId) throw new Error('ID de inventario no proporcionado');

    // Support ALL or ALL_PURGE keyword
    if (inventoryId === 'ALL' || inventoryId === 'ALL_PURGE') {
      return this.purgeAllData(user);
    }

    const cleanId = String(inventoryId).trim();
    let inv = this.getInventoryRaw(cleanId);

    // Search files case-insensitively if not found directly
    let actualFile = `${cleanId}.json`;
    if (!inv) {
      const allFiles = this.getAllInventoryFiles();
      const match = allFiles.find(f => f.toLowerCase() === `${cleanId.toLowerCase()}.json` || f.toLowerCase().includes(cleanId.toLowerCase()));
      if (match) {
        actualFile = match;
        inv = storagePath.readJson(path.join(this.invDir, match), null);
      }
    }

    const isAdmin = user.role === 'ADMIN' || user.isSuperadmin || ['alonso', 'jcarlos', 'absael', 'admin'].includes(String(user.username || '').toLowerCase());

    if (!isAdmin) {
      if (user.role === 'ENCARGADO') {
        if (inv && inv.center && !config.isSameCenter(inv.center, user.center)) {
          throw new Error(`No puede eliminar inventarios del centro ${inv.center}. Su centro asignado es ${user.center}`);
        }
      } else {
        throw new Error('Solo los administradores y encargados pueden eliminar inventarios');
      }
    }

    const inputKey = String(deleteKey || '').trim().toUpperCase();
    const targetKey = String(config.adminDeleteKey || 'ADM26').trim().toUpperCase();

    if (!isAdmin) {
      if (inputKey && inputKey !== targetKey) {
        throw new Error('Clave de confirmación de eliminación incorrecta (Clave requerida: ADM26)');
      }
    } else {
      if (inputKey && inputKey !== targetKey && inputKey !== 'ADM' && inputKey !== 'ADMIN') {
        throw new Error('Clave de confirmación incorrecta');
      }
    }

    // Automatic backup to trash before deleting
    if (inv) {
      try {
        const trashFile = path.join(storagePath.getTrashDirectory(), `${cleanId}.json`);
        storagePath.writeJson(trashFile, {
          deletedAt: new Date().toISOString(),
          deletedBy: user.username,
          reason: reason || 'Eliminación autorizada con clave',
          inventory: inv
        });
      } catch (e) {
        console.warn('[InventoryService] Warning backing up to trash:', e.message);
      }
    }

    const filePath = path.join(this.invDir, actualFile);
    storagePath.deleteFile(filePath);

    // Ensure memory and standard path are also deleted
    try {
      storagePath.deleteFile(path.join(this.invDir, `${cleanId}.json`));
    } catch (_) {}

    // Ensure corresponding snapshot is also removed from history if present
    try {
      const historyDir = storagePath.getHistoryDirectory();
      storagePath.deleteFile(path.join(historyDir, `${cleanId}.json`));
      if (inv && inv.fileId) {
        storagePath.deleteFile(path.join(historyDir, `${inv.fileId}.json`));
      }
      const hFiles = storagePath.listFiles(historyDir).filter(f => f.endsWith('.json'));
      hFiles.forEach(hf => {
        const hr = storagePath.readJson(path.join(historyDir, hf), null);
        if (hr && (hr.inventoryId === cleanId || hr.fileId === cleanId || (inv && inv.fileId && hr.fileId === inv.fileId))) {
          storagePath.deleteFile(path.join(historyDir, hf));
        }
      });
    } catch (_) {}

    try {
      const metricsService = require('./metricsService');
      if (metricsService && typeof metricsService.invalidateCache === 'function') {
        metricsService.invalidateCache();
      }
    } catch (_) {}

    auditService.logDeletion({
      inventoryId: cleanId,
      user: user.username,
      center: inv ? inv.center : 'GLOBAL',
      reason: reason || 'Eliminación autorizada con clave'
    });

    return { success: true, message: `Inventario ${inv ? inv.name : cleanId} eliminado exitosamente` };
  }

  restoreInventoryFromTrash(inventoryId, user) {
    const cleanId = String(inventoryId).trim();
    const trashFile = path.join(storagePath.getTrashDirectory(), `${cleanId}.json`);
    const trashRecord = storagePath.readJson(trashFile, null);
    if (!trashRecord || !trashRecord.inventory) {
      throw new Error(`Inventario '${cleanId}' no encontrado en la papelera de seguridad`);
    }

    const inv = trashRecord.inventory;
    this.saveInventory(inv);
    try {
      storagePath.deleteFile(trashFile);
    } catch (_) {}

    auditService.logAction({
      action: 'INVENTORY_RESTORED',
      details: `Inventario ${inv.name} restaurado de la papelera de seguridad`,
      user: user.username,
      center: inv.center,
      targetId: inv.id
    });

    return inv;
  }

  getTrashInventories(user) {
    try {
      const files = storagePath.listFiles(storagePath.getTrashDirectory());
      const trashList = [];
      files.forEach(f => {
        if (!f.endsWith('.json')) return;
        const data = storagePath.readJson(path.join(storagePath.getTrashDirectory(), f), null);
        if (data && data.inventory) {
          trashList.push({
            id: data.inventory.id,
            name: data.inventory.name,
            type: data.inventory.type,
            center: data.inventory.center,
            deletedAt: data.deletedAt,
            deletedBy: data.deletedBy,
            reason: data.reason,
            itemsCount: Array.isArray(data.inventory.items) ? data.inventory.items.length : 0
          });
        }
      });
      return trashList.sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    } catch (e) {
      return [];
    }
  }

  async purgeAllData(user) {
    const isAdmin = user.role === 'ADMIN' || user.isSuperadmin || ['alonso', 'jcarlos', 'absael', 'admin'].includes(String(user.username || '').toLowerCase());
    if (!isAdmin) {
      throw new Error('Solo los administradores pueden reiniciar el sistema a 0');
    }

    const clearResult = await storagePath.clearAllData(true);

    auditService.logDeletion({
      inventoryId: 'ALL_SYSTEM_DATA',
      user: user.username,
      center: 'GLOBAL',
      reason: 'Limpieza total de historiales y pruebas a 0'
    });

    return {
      success: true,
      firestoreDeletedDocuments: clearResult.firestore.deletedCount,
      preservedUserDocuments: clearResult.firestore.preservedUsersCount,
      message: `Limpieza completada. Se eliminaron ${clearResult.firestore.deletedCount} documentos de Firestore; se conservaron ${clearResult.firestore.preservedUsersCount} documentos de usuarios.`
    };
  }

  async searchProductForBarrido({ barcodeOrSku, center }) {
    if (!barcodeOrSku) {
      throw new Error('Debe proporcionar un código de barras o SKU');
    }

    const raw = String(barcodeOrSku).trim();
    // Normalize code: strip leading JD_ and JD- if exists, also support matching with prefixes
    const stripped = raw.replace(/^JD_/i, '').replace(/^JD-/i, '').trim();
    const withPrefixJD_ = `JD_${stripped}`;
    const withPrefixJDHyphen = `JD-${stripped}`;

    const matchCode = (targetVal) => {
      if (!targetVal) return false;
      const t = String(targetVal).trim();
      const tStripped = t.replace(/^JD_/i, '').replace(/^JD-/i, '').trim();
      const tUpper = t.toUpperCase();
      const rawUpper = raw.toUpperCase();
      const strippedUpper = stripped.toUpperCase();

      return (
        tUpper === rawUpper ||
        tUpper === strippedUpper ||
        tStripped.toUpperCase() === strippedUpper ||
        tUpper === withPrefixJD_.toUpperCase() ||
        tUpper === withPrefixJDHyphen.toUpperCase()
      );
    };

    // 1. Search through all current inventory items in this center
    const files = this.getAllInventoryFiles();
    for (const f of files) {
      const inv = storagePath.readJson(path.join(this.invDir, f), null);
      if (!inv) continue;
      if (center && center !== 'GLOBAL' && !config.isSameCenter(inv.center, center)) continue;

      for (const it of inv.items || []) {
        if (matchCode(it.Codigo_Barras) || matchCode(it.SKU)) {
          return {
            found: true,
            source: 'EXISTING_INVENTORY',
            inventoryId: inv.id,
            center: inv.center,
            item: {
              ...it,
              UbicacionOriginal: it.Ubicacion
            }
          };
        }
      }
    }

    // 2. If not found in local files, fetch directly from Google Apps Script for this center
    const cleanCenter = config.getCenterCode ? config.getCenterCode(center || '1120') : (center || '1120');
    try {
      const gasProducts = await gasService.fetchProductsFromScript('BARRIDO', cleanCenter);
      if (gasProducts && gasProducts.length > 0) {
        for (const it of gasProducts) {
          if (matchCode(it.Codigo_Barras) || matchCode(it.SKU)) {
            return {
              found: true,
              source: 'GOOGLE_SHEETS',
              center: cleanCenter,
              item: {
                ...it,
                UbicacionOriginal: it.Ubicacion
              }
            };
          }
        }
      }
    } catch (err) {
      console.warn(`[searchProductForBarrido] Warning querying GAS:`, err.message);
    }

    // 3. If not found in Google Sheets either, return structured item placeholder for new discovery in barrido
    return {
      found: false,
      source: 'NEW_DISCOVERY',
      center: cleanCenter,
      item: {
        id: `ITEM-NEW-${Date.now().toString(36)}`,
        SKU: raw.toUpperCase(),
        Codigo_Barras: raw,
        Descripcion: `Ítem Descubierto en Barrido (${raw})`,
        Ubicacion: '',
        Categoria: 'repuesto',
        Clasificacion_ABC: 'C',
        Unidad: 'PZA',
        Costo_Unitario: 0,
        Stock_Sistema: 0,
        Stock_Fisico: null,
        Diferencia: 0,
        Costo_Diferencia: 0,
        Estado: 'Pendiente',
        Mal_estado: 0,
        Comentario: ''
      }
    };
  }

  organizeItemsByBlock(items = []) {
    if (!Array.isArray(items) || items.length <= 1) return items;

    const skuOrder = [];
    const skuItemsMap = new Map();

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const sku = String(it.SKU || '').trim();
      if (!skuItemsMap.has(sku)) {
        skuItemsMap.set(sku, []);
        skuOrder.push(sku);
      }
      skuItemsMap.get(sku).push(it);
    }

    const organized = [];
    for (const sku of skuOrder) {
      const group = skuItemsMap.get(sku);
      if (group && group.length > 0) {
        for (let j = 0; j < group.length; j++) {
          organized.push(group[j]);
        }
      }
    }
    return organized;
  }

  async deleteItem({inventoryId,itemId,sku,location,user}) {
    const inv=this.getInventoryRaw(inventoryId);
    if(!inv||!this.canModifyInventory(inv,user))throw new Error('Inventario inexistente o fuera de su centro');
    const matches=inv.items.filter(it=>(itemId?it.id===itemId:contract.identity(it.SKU)===contract.identity(sku))&&
      [it.Ubicacion_1,it.Ubicacion_2].some(loc=>loc&&contract.identity(loc)===contract.identity(location)));
    if(matches.length!==1)throw new Error('Solo se puede eliminar una ubicación adicional identificada exactamente.');
    const item=matches[0];
    const result=await gasService.deleteAdditionalLocationFromGAS(inv.type,{center:inv.center,sku:item.SKU,
      warehouse:item.Almacen,location,originalLocation:item.Ubicacion,inventoryId:inv.id,itemId:item.id});
    if(!result.cleared)throw new Error('Google no confirmó la eliminación');
    item.Ubicacion_1=result.ubicacion1;item.Ubicacion_2=result.ubicacion2;
    item.additionalLocations=[item.Ubicacion_1,item.Ubicacion_2].filter(Boolean);this.saveInventory(inv);
    return {success:true,item,message:'Ubicación eliminada y confirmada en Google Sheets'};
  }


}

module.exports = new InventoryService();
