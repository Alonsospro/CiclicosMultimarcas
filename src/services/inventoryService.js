const fs = require('fs');
const path = require('path');
const config = require('../config');
const storagePath = require('./storagePath');
const auditService = require('./auditService');
const driveService = require('./driveService');
const gasService = require('./gasService');

class InventoryService {
  constructor() {
    this.invDir = storagePath.getInventoriesDirectory();
    this.justDir = storagePath.getJustificationsDirectory();
  }

  seedSampleInventories() {
    const existing = this.getAllInventoryFiles();
    if (existing.length === 0) {
      console.log('[inventoryService] Seeding initial sample inventories...');
      const sampleItemsWarnes = [
        {
          id: 'ITEM-W1-01',
          SKU: 'JD-AH12345',
          Codigo_Barras: 'JD_78912345601',
          Descripcion: 'Filtro de Aceite Motor 6068',
          Ubicacion: 'RACK-A1-01',
          Categoria: 'FILTROS',
          Clasificacion_ABC: 'A',
          Unidad: 'PZA',
          Costo_Unitario: 45.50,
          Stock_Sistema: 10,
          Stock_Fisico: null,
          Diferencia: 0,
          Costo_Diferencia: 0,
          Fecha_Ultimo_Conteo: null,
          Responsable: 'auxiliar_warnes',
          Estado: 'Pendiente',
          Mal_estado: 0
        },
        {
          id: 'ITEM-W1-02',
          SKU: 'JD-RE504836',
          Codigo_Barras: '78912345602',
          Descripcion: 'Filtro de Combustible Primario',
          Ubicacion: 'RACK-A1-02',
          Categoria: 'FILTROS',
          Clasificacion_ABC: 'A',
          Unidad: 'PZA',
          Costo_Unitario: 68.20,
          Stock_Sistema: 15,
          Stock_Fisico: null,
          Diferencia: 0,
          Costo_Diferencia: 0,
          Fecha_Ultimo_Conteo: null,
          Responsable: 'auxiliar_warnes',
          Estado: 'Pendiente',
          Mal_estado: 0
        },
        {
          id: 'ITEM-W1-03',
          SKU: 'JD-TY26674',
          Codigo_Barras: 'JD_78912345603',
          Descripcion: 'Aceite Plus 50 II 15W40 Balde',
          Ubicacion: 'PISO-B2-01',
          Categoria: 'LUBRICANTES',
          Clasificacion_ABC: 'B',
          Unidad: 'BALDE',
          Costo_Unitario: 120.00,
          Stock_Sistema: 8,
          Stock_Fisico: null,
          Diferencia: 0,
          Costo_Diferencia: 0,
          Fecha_Ultimo_Conteo: null,
          Responsable: 'auxiliar_warnes2',
          Estado: 'Pendiente',
          Mal_estado: 0
        },
        {
          id: 'ITEM-W1-04',
          SKU: 'JD-AN20456',
          Codigo_Barras: '78912345604',
          Descripcion: 'Cuchilla Rotativa Desbrozadora',
          Ubicacion: 'RACK-C3-05',
          Categoria: 'IMPLEMENTOS',
          Clasificacion_ABC: 'C',
          Unidad: 'PZA',
          Costo_Unitario: 250.00,
          Stock_Sistema: 4,
          Stock_Fisico: null,
          Diferencia: 0,
          Costo_Diferencia: 0,
          Fecha_Ultimo_Conteo: null,
          Responsable: 'auxiliar_warnes',
          Estado: 'Pendiente',
          Mal_estado: 0
        },
        {
          id: 'ITEM-W1-05',
          SKU: 'JD-L114889',
          Codigo_Barras: 'JD_78912345605',
          Descripcion: 'Correa Alternador Ventilador',
          Ubicacion: 'RACK-A2-08',
          Categoria: 'CORREAS',
          Clasificacion_ABC: 'B',
          Unidad: 'PZA',
          Costo_Unitario: 35.00,
          Stock_Sistema: 12,
          Stock_Fisico: null,
          Diferencia: 0,
          Costo_Diferencia: 0,
          Fecha_Ultimo_Conteo: null,
          Responsable: 'auxiliar_warnes',
          Estado: 'Pendiente',
          Mal_estado: 0
        }
      ];

      const sampleCiclico = {
        id: 'INV-CICLICO-WARNES-001',
        name: 'Inventario Cíclico Filtros y Lubricantes - Warnes',
        type: 'CICLICO',
        center: 'WARNES',
        status: 'EN_PROGRESO', // EN_PROGRESO, FIRMADO, REVISADO
        createdAt: new Date().toISOString(),
        createdBy: 'admin',
        assignedAuxiliars: ['auxiliar_warnes', 'auxiliar_warnes2'],
        items: sampleItemsWarnes
      };

      const sampleBarrido = {
        id: 'INV-BARRIDO-WARNES-001',
        name: 'Barrido General Pasillo A - Warnes',
        type: 'BARRIDO',
        center: 'WARNES',
        status: 'EN_PROGRESO',
        createdAt: new Date().toISOString(),
        createdBy: 'encargado_warnes',
        assignedAuxiliars: ['auxiliar_warnes'],
        items: sampleItemsWarnes.slice(0, 3)
      };

      this.saveInventory(sampleCiclico);
      this.saveInventory(sampleBarrido);
    }
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
      const inv = storagePath.readJson(path.join(this.invDir, file), null);
      if (inv) {
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
          // Auxiliares strictly see only inventories assigned to them
          if (!isAssigned) {
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

        // Generate summary stats for list view
        const totalItems = inv.items.length;
        const countedItems = inv.items.filter(it => it && it.Stock_Fisico !== null && it.Stock_Fisico !== undefined).length;
        const pendingItems = totalItems - countedItems;

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
    let inv = this.getInventoryRaw(id);
    if (!inv) {
      // Hydrate directly from Google Apps Script / Google Sheets in Google Drive
      try {
        const parts = String(id).split('-');
        let invType = 'CICLICO';
        let center = '1120';
        if (parts.length >= 3) {
          invType = parts[1] || 'CICLICO';
          center = parts[2] || '1120';
        }
        const cleanCenter = config.getCenterCode ? config.getCenterCode(center) : center;
        const fetchedItems = await gasService.fetchProductsFromScript(invType, cleanCenter);
        if (fetchedItems && fetchedItems.length > 0) {
          const centerObj = config.findCenter ? config.findCenter(cleanCenter) : null;
          inv = {
            id,
            name: `Inventario ${invType} - ${centerObj ? centerObj.name : cleanCenter}`,
            type: invType,
            center: cleanCenter,
            status: 'EN_PROGRESO',
            createdAt: new Date().toISOString(),
            createdBy: 'Google Drive Sync',
            assignedAuxiliars: [],
            items: fetchedItems
          };
          this.saveInventory(inv);
        }
      } catch (hydrateErr) {
        console.warn(`[inventoryService] Notice hydrating inventory from Google Drive: ${hydrateErr.message}`);
      }
    }

    if (!inv) {
      throw new Error(`Inventario con ID '${id}' no encontrado`);
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
    // 1. Filter items strictly to those assigned to this auxiliary
    // 2. Hide columns H, I, K, L, O (Blind Count)
    if (user.role === 'AUXILIAR') {
      const isConteoPhase = inv.status !== 'REVISADO';

      const userItems = inv.items.filter(it => {
        if (!it) return false;
        if (it.Responsable) {
          const r = String(it.Responsable || '').toLowerCase().trim();
          return r === u || (c && r === c) || (d && (r === d || d.includes(r) || r.includes(d)));
        }
        return isAssignedToInv;
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
    if (user.isSuperadmin) return true;
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
      // Auto-fetch products from Google Apps Script for this center and type
      try {
        const fetched = await gasService.fetchProductsFromScript(cleanType, targetCenter);
        if (fetched && fetched.length > 0) {
          mappedItems = fetched;
        }
      } catch (err) {
        console.warn(`[createInventory] Notice fetching GAS products for center ${targetCenter}:`, err.message);
      }
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

  updateCount({ inventoryId, itemId, sku, stockFisico, malEstado = 0, location = null, isNewLocation = false, user, reason, photoUrl = null, locked = true, comentario = null }) {
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

    if (user.role !== 'ADMIN' && !user.isSuperadmin && !config.isSameCenter(inv.center, user.center)) {
      throw new Error(`No tiene permisos para modificar inventarios del centro ${inv.center}`);
    }

    const isCountProvided = (stockFisico !== null && stockFisico !== undefined && stockFisico !== '');
    const qty = isCountProvided ? parseInt(stockFisico, 10) : null;
    const damagedQty = parseInt(malEstado, 10) || 0;

    let targetItem = inv.items.find(it => it.id === itemId || (sku && it.SKU === sku));
    let previousQty = targetItem ? targetItem.Stock_Fisico : null;

    if (isNewLocation) {
      // MULTIPLE LOCATIONS: DO NOT OVERWRITE ORIGINAL ROW.
      // Append a new row at the end of items list.
      const baseItem = targetItem || {
        SKU: sku || 'SKU-EXTRA',
        Codigo_Barras: '',
        Descripcion: 'Ubicación Adicional',
        Categoria: 'GENERAL',
        Clasificacion_ABC: 'C',
        Unidad: 'PZA',
        Costo_Unitario: 0,
        Stock_Sistema: 0,
        Comentario: ''
      };

      const newItemId = `ITEM-NEW-LOC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const isConfirmedCount = isCountProvided && locked !== false;

      const newRow = {
        id: newItemId,
        SKU: baseItem.SKU,
        Codigo_Barras: baseItem.Codigo_Barras || '',
        Descripcion: baseItem.Descripcion,
        Ubicacion: location || 'NUEVA_UBICACION',
        Categoria: baseItem.Categoria,
        Clasificacion_ABC: baseItem.Clasificacion_ABC,
        Unidad: baseItem.Unidad,
        Costo_Unitario: baseItem.Costo_Unitario || 0,
        Stock_Sistema: 0, // Additional location system expected is 0
        Stock_Fisico: qty,
        Diferencia: isCountProvided ? (qty - 0) : 0,
        Costo_Diferencia: isCountProvided ? ((qty - 0) * (baseItem.Costo_Unitario || 0)) : 0,
        Fecha_Ultimo_Conteo: isCountProvided ? new Date().toISOString() : null,
        Responsable: user.displayName || user.username,
        Estado: isConfirmedCount ? 'Contado' : 'Pendiente',
        Mal_estado: damagedQty,
        Comentario: comentario !== null ? comentario : (baseItem.Comentario || ''),
        foto_mal_estado: photoUrl || null,
        isAdditionalLocation: true,
        originalItemId: targetItem ? targetItem.id : null,
        locked: isConfirmedCount
      };

      inv.items.push(newRow);
      targetItem = newRow;
    } else {
      if (!targetItem) {
        // In BARRIDO or dynamic insertion, create the item if not present
        const newItemId = itemId || `ITEM-BARRIDO-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
        targetItem = {
          id: newItemId,
          SKU: sku || 'SKU-DESCUBIERTO',
          Codigo_Barras: '',
          Descripcion: `Ítem Barrido ${sku || ''}`,
          Ubicacion: location || '',
          Categoria: 'BARRIDO',
          Clasificacion_ABC: 'C',
          Unidad: 'PZA',
          Costo_Unitario: 0,
          Stock_Sistema: 0,
          Stock_Fisico: qty,
          Diferencia: isCountProvided ? qty : 0,
          Costo_Diferencia: 0,
          Fecha_Ultimo_Conteo: isCountProvided ? new Date().toISOString() : null,
          Responsable: user.displayName || user.username,
          Estado: locked !== false ? 'Contado' : 'Pendiente',
          Mal_estado: damagedQty,
          Comentario: comentario !== null ? comentario : '',
          foto_mal_estado: photoUrl || null,
          locked: !!locked
        };
        inv.items.push(targetItem);
      } else {
        // Auxiliar can only count items assigned to them (except in BARRIDO mode where scan is open for the center)
        if (user.role === 'AUXILIAR' && inv.type !== 'BARRIDO' && targetItem.Responsable && targetItem.Responsable !== user.username && targetItem.Responsable !== user.clave) {
          throw new Error(`Este ítem está asignado al auxiliar ${targetItem.Responsable}`);
        }

        if (location) {
          targetItem.Ubicacion = location;
        }

        if (isCountProvided) {
          targetItem.Stock_Fisico = qty;
          targetItem.Diferencia = qty - (targetItem.Stock_Sistema || 0);
          targetItem.Costo_Diferencia = targetItem.Diferencia * (targetItem.Costo_Unitario || 0);
          targetItem.Fecha_Ultimo_Conteo = new Date().toISOString();
          targetItem.Responsable = user.displayName || user.username;
          targetItem.Estado = locked !== false ? 'Contado' : 'Pendiente';
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

        targetItem.Mal_estado = damagedQty;
        if (comentario !== null && comentario !== undefined) {
          targetItem.Comentario = comentario;
        }
        if (photoUrl !== null && photoUrl !== undefined) {
          targetItem.foto_mal_estado = photoUrl;
        }
        targetItem.locked = !!locked;
      }
    }

    this.saveInventory(inv);

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
      gasService.upsertCountToGAS(inv.type, {
        center: inv.center,
        sku: targetItem.SKU,
        barcode: targetItem.Codigo_Barras,
        location: targetItem.Ubicacion,
        isNewLocation,
        stockFisico: targetItem.Stock_Fisico,
        malEstado: targetItem.Mal_estado || 0,
        comentario: targetItem.Comentario || '',
        fechaUltimoConteo: targetItem.Fecha_Ultimo_Conteo,
        responsable: user.displayName || user.username,
        estado: targetItem.Estado || 'Contado',
        photoBase64: photoUrl || targetItem.foto_mal_estado || ''
      }).catch(err => {
        console.warn(`[inventoryService] Notice syncing count to Google Drive: ${err.message}`);
      });
    } catch (gasErr) {
      console.warn(`[inventoryService] Notice triggering GAS sync: ${gasErr.message}`);
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

    if (user.role !== 'ADMIN' && !user.isSuperadmin && !config.isSameCenter(inv.center, user.center)) {
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

    const uncounted = inv.items.filter(it => it.Stock_Fisico === null);
    if (uncounted.length > 0) {
      throw new Error(`No se puede cerrar para revisión: aún quedan ${uncounted.length} ítems sin contar`);
    }

    inv.status = 'PENDIENTE_JUSTIFICACION';
    inv.submittedAt = new Date().toISOString();
    inv.submittedBy = user.username;
    inv.signature = signature || 'Firma digital operativa';

    this.saveInventory(inv);
    auditService.logAction({
      action: 'INVENTORY_SUBMITTED_FOR_REVIEW',
      details: `Inventario completado por auxiliares y enviado a revisión de justificaciones`,
      user: user.username,
      center: inv.center,
      targetId: inv.id
    });

    return inv;
  }

  saveJustification({ inventoryId, sku, justification, photoUrl, reasonType, user }) {
    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) throw new Error('Inventario no encontrado');

    const item = inv.items.find(it => it.SKU === sku);
    if (!item) throw new Error(`Ítem ${sku} no encontrado en el inventario`);

    const justId = driveService.formatJustificationName(inv.type, sku, inv.center);
    const justFilePath = path.join(this.justDir, `${justId}.json`);

    const justRecord = {
      id: justId,
      inventoryId: inv.id,
      sku,
      descripcion: item.Descripcion,
      ubicacion: item.Ubicacion,
      stockSistema: item.Stock_Sistema,
      stockFisico: item.Stock_Fisico,
      diferencia: item.Diferencia,
      costoDiferencia: item.Costo_Diferencia,
      malEstado: item.Mal_estado,
      justification: justification || 'Sin observaciones adicionales',
      reasonType: reasonType || 'AJUSTE_INVENTARIO',
      photoUrl: photoUrl || null,
      reviewedBy: user.username,
      reviewedAt: new Date().toISOString(),
      center: inv.center,
      type: inv.type,
      status: 'REVISADO'
    };

    storagePath.writeJson(justFilePath, justRecord);

    item.Estado = 'Justificado';
    item.Razon = reasonType || 'AJUSTE_INVENTARIO';
    item.Razon_Justificacion = reasonType || 'AJUSTE_INVENTARIO';
    item.Comentario_Justificacion = justification || '';
    this.saveInventory(inv);

    // Sync justification to Google Sheets in Google Drive (Updates columns R and S)
    try {
      gasService.upsertCountToGAS(inv.type, {
        center: inv.center,
        sku: item.SKU,
        barcode: item.Codigo_Barras,
        location: item.Ubicacion,
        stockFisico: item.Stock_Fisico,
        malEstado: item.Mal_estado || 0,
        comentario: `[Justificado: ${reasonType || 'Ajuste'}] ${justification}`,
        razon: reasonType || 'AJUSTE_INVENTARIO',
        razonJustificacion: reasonType || 'AJUSTE_INVENTARIO',
        reasonType: reasonType || 'AJUSTE_INVENTARIO',
        comentarioJustificacion: justification || '',
        justification: justification || '',
        fechaUltimoConteo: item.Fecha_Ultimo_Conteo,
        responsable: user.displayName || user.username,
        estado: 'Justificado',
        photoBase64: photoUrl || item.foto_mal_estado || ''
      }).catch(e => console.warn('[inventoryService] Justification GAS sync notice:', e.message));
    } catch (e) {}

    auditService.logJustification({
      inventoryId: inv.id,
      sku,
      justification,
      photoUrl,
      user: user.username,
      center: inv.center,
      diffQty: item.Diferencia,
      diffCost: item.Costo_Diferencia
    });

    return justRecord;
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

  getPendingJustifications(user, centerFilter = null) {
    if (user.role !== 'ADMIN' && !user.isSuperadmin) {
      throw new Error('Solo los administradores pueden acceder a la pestaña de justificaciones');
    }

    const files = this.getAllInventoryFiles();
    const tasks = [];

    files.forEach(f => {
      const inv = storagePath.readJson(path.join(this.invDir, f), null);
      if (!inv) return;
      if (centerFilter && centerFilter !== 'TODOS' && centerFilter !== 'GLOBAL' && inv.center !== centerFilter) return;

      // Check items with differences or damaged goods
      const discrepantItems = inv.items.filter(it => (it.Diferencia !== 0 || it.Mal_estado > 0));
      const existingJustifications = this.getJustificationsForInventory(inv.id);
      const justifiedSkus = new Set(existingJustifications.map(j => j.sku));

      const pendingDiscrepancies = discrepantItems.filter(it => !justifiedSkus.has(it.SKU));

      if (discrepantItems.length > 0 || inv.status === 'PENDIENTE_JUSTIFICACION') {
        tasks.push({
          inventoryId: inv.id,
          inventoryName: inv.name,
          type: inv.type,
          center: inv.center,
          status: inv.status,
          totalItems: inv.items.length,
          totalDiscrepancies: discrepantItems.length,
          pendingJustificationsCount: pendingDiscrepancies.length,
          items: discrepantItems.map(it => {
            const jDetails = existingJustifications.find(j => j.sku === it.SKU) || null;
            return {
              ...it,
              Razon: it.Razon || it.Razon_Justificacion || (jDetails ? jDetails.reasonType : ''),
              Comentario_Justificacion: it.Comentario_Justificacion || (jDetails ? jDetails.justification : ''),
              isJustified: justifiedSkus.has(it.SKU),
              justificationDetails: jDetails
            };
          })
        });
      }
    });

    return tasks;
  }

  async finishReviewAndClose({ inventoryId, user, reviewNotes }) {
    if (user.role !== 'ADMIN' && !user.isSuperadmin) {
      throw new Error('Solo los administradores pueden terminar la revisión y crear el archivo final en Google Drive');
    }

    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) throw new Error('Inventario no encontrado');

    const justifications = this.getJustificationsForInventory(inventoryId);

    // 1. Create final file in Google Drive via driveService
    const driveResult = await driveService.createFinalDriveFile({
      inventory: inv,
      justifications,
      user,
      reviewNotes
    });

    // 2. Mark inventory as reviewed and closed
    inv.status = 'REVISADO';
    inv.closedAt = new Date().toISOString();
    inv.closedBy = user.username;
    inv.driveFileId = driveResult.fileId;
    inv.driveFileName = driveResult.fileName;
    inv.driveUrl = driveResult.driveUrl || null; // Only real Drive URLs, null if GAS didn't provide one

    this.saveInventory(inv);

    auditService.logAction({
      action: 'INVENTORY_REVIEW_FINISHED',
      details: `Revisión completada por ${user.username}. Archivo final Drive creado: ${driveResult.fileName}`,
      user: user.username,
      center: inv.center,
      targetId: inv.id
    });

    return {
      success: true,
      message: 'Revisión finalizada con éxito. Archivo de inventario creado en Google Drive.',
      drive: driveResult,
      inventory: inv
    };
  }

  reopenInventory({ inventoryId, user, reason }) {
    if (user.role !== 'ADMIN' && !user.isSuperadmin) {
      throw new Error('Solo los administradores pueden reabrir inventarios');
    }

    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) throw new Error('Inventario no encontrado');

    inv.status = 'EN_PROGRESO';
    inv.reopenedAt = new Date().toISOString();
    inv.reopenedBy = user.username;

    this.saveInventory(inv);
    auditService.logReopen({
      inventoryId: inv.id,
      user: user.username,
      center: inv.center,
      reason
    });

    return inv;
  }

  deleteInventory({ inventoryId, user, deleteKey, reason }) {
    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) throw new Error('Inventario no encontrado');

    if (user.role !== 'ADMIN' && !user.isSuperadmin) {
      if (user.role === 'ENCARGADO') {
        if (!config.isSameCenter(inv.center, user.center)) {
          throw new Error(`No puede eliminar inventarios del centro ${inv.center}. Su centro asignado es ${user.center}`);
        }
      } else {
        throw new Error('Solo los administradores y encargados pueden eliminar inventarios');
      }
    }

    const inputKey = String(deleteKey || '').trim().toUpperCase();
    const targetKey = String(config.adminDeleteKey || 'ADM26').trim().toUpperCase();

    if (inputKey && inputKey !== targetKey) {
      throw new Error('Clave de confirmación de eliminación incorrecta (Clave requerida: ADM26)');
    }

    const filePath = path.join(this.invDir, `${inventoryId}.json`);
    storagePath.deleteFile(filePath);

    auditService.logDeletion({
      inventoryId,
      user: user.username,
      center: inv.center,
      reason: reason || 'Eliminación autorizada con clave'
    });

    return { success: true, message: `Inventario ${inv.name} (${inventoryId}) eliminado exitosamente` };
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
        Categoria: 'BARRIDO',
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

  deleteItem({ inventoryId, itemId, user }) {
    const inv = this.getInventoryRaw(inventoryId);
    if (!inv) {
      throw new Error(`Inventario '${inventoryId}' no encontrado`);
    }

    if (user.role !== 'ADMIN' && !user.isSuperadmin && !config.isSameCenter(inv.center, user.center)) {
      throw new Error(`No tiene permisos para modificar inventarios del centro ${inv.center}`);
    }

    const itemIdx = inv.items.findIndex(it => it.id === itemId);
    if (itemIdx === -1) {
      throw new Error('Ítem o ubicación no encontrada en este inventario');
    }

    const item = inv.items[itemIdx];
    inv.items.splice(itemIdx, 1);
    this.saveInventory(inv);

    auditService.logAction({
      action: 'LOCATION_DELETED',
      details: `Ubicación eliminada: SKU ${item.SKU} - Ubic: ${item.Ubicacion || 'S/U'}`,
      user: user.username,
      center: inv.center,
      targetId: inventoryId
    });

    return {
      success: true,
      message: `Ubicación '${item.Ubicacion}' del SKU ${item.SKU} eliminada correctamente`
    };
  }
}

module.exports = new InventoryService();
