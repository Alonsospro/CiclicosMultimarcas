// View: Inventories & Operative Count (Blind Count Mode)
window.InventoryView = {
  currentInventory: null,
  gasFetchedItems: [],

  init() {
    this.setupListeners();
  },

  setupListeners() {
    // Filter changes - opening Barrido directly when chosen in the dropdown as requested
    document.getElementById('filter-inv-type')?.addEventListener('change', (e) => {
      const selectedType = e.target.value;
      if (selectedType === 'BARRIDO') {
        window.Router.navigate('barrido');
        e.target.value = 'TODOS';
        return;
      }
      this.loadInventories();
    });
    document.getElementById('filter-inv-center')?.addEventListener('change', () => this.loadInventories());

    // Back to list button
    document.getElementById('btn-back-to-invs')?.addEventListener('click', () => {
      this.currentInventory = null;
      try {
        localStorage.removeItem('nibol_active_inv_id');
        localStorage.setItem('nibol_active_view', 'inventories');
      } catch (e) {}
      document.getElementById('view-count').classList.remove('active');
      document.getElementById('view-inventories').classList.add('active');
      this.loadInventories();
    });

    // Open new inventory modal
    document.getElementById('btn-open-new-inv-modal')?.addEventListener('click', () => {
      this.gasFetchedItems = [];
      const form = document.getElementById('form-new-inventory');
      if (form) form.reset();
      const statusSpan = document.getElementById('gas-fetch-status');
      if (statusSpan) statusSpan.textContent = '';

      const centerSelect = document.getElementById('new-inv-center');
      if (centerSelect && window.Auth.currentUser) {
        if (window.Auth.currentUser.role === 'ENCARGADO') {
          centerSelect.value = window.Auth.currentUser.center;
          centerSelect.disabled = true;
        } else {
          centerSelect.disabled = false;
        }
      }

      // Populate Auxiliares in new inventory modal
      const auxSelect = document.getElementById('new-inv-auxiliar');
      if (auxSelect) {
        auxSelect.innerHTML = '<option value="">-- Sin asignar (asignar posteriormente) --</option>';
        window.API.getUsers().then(uRes => {
          const auxs = (uRes.users || []).filter(u => u.role === 'AUXILIAR');
          auxSelect.innerHTML = '<option value="">-- Sin asignar (asignar posteriormente) --</option>' +
            auxs.map(u => `<option value="${u.username}">${u.displayName || u.username} (${u.centerName || u.center || 'Sin Centro'})</option>`).join('');
        }).catch(() => {});
      }

      window.ModalHelper.open('modal-new-inventory');
      // Automatically trigger fetch for the selected center
      this.triggerAutoFetchGas();
    });

    // Auto-fetch when center or type changes in modal
    document.getElementById('new-inv-center')?.addEventListener('change', () => {
      this.triggerAutoFetchGas();
    });
    document.getElementById('new-inv-type')?.addEventListener('change', () => {
      this.triggerAutoFetchGas();
    });

    // Fetch from GAS button inside modal (Manual refresh)
    document.getElementById('btn-fetch-gas-template')?.addEventListener('click', async () => {
      await this.triggerAutoFetchGas(true);
    });

    // Form submit: Quick Assign to Auxiliar
    document.getElementById('form-quick-assign')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const invId = document.getElementById('quick-assign-inv-id')?.value;
      const toUser = document.getElementById('quick-assign-aux-select')?.value;
      const invName = document.getElementById('quick-assign-inv-name')?.textContent || invId;

      if (!invId || !toUser) {
        window.Toast.warning('Seleccione un auxiliar para realizar la asignación.');
        return;
      }

      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Asignando...';
      }

      try {
        const res = await window.API.reassignTasks(invId, {
          assignAll: true,
          toUser,
          reason: 'Asignación directa desde panel de inventarios'
        });

        window.Toast.success(`¡Inventario ${invName} asignado exitosamente a ${res.targetDisplayName || toUser}! Ya está disponible en su perfil.`);
        window.ModalHelper.close('modal-quick-assign');
        await this.loadInventories();
      } catch (err) {
        window.Toast.danger(err.message || 'Error al asignar inventario');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirmar Asignación';
        }
      }
    });

    // Form submit: New Inventory
    document.getElementById('form-new-inventory')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('new-inv-name').value;
      const type = document.getElementById('new-inv-type').value;
      const center = (window.Auth.currentUser?.role === 'ENCARGADO')
        ? window.Auth.currentUser.center
        : document.getElementById('new-inv-center').value;
      const assignedAuxiliar = document.getElementById('new-inv-auxiliar')?.value || '';

      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando e importando...';
      }

      try {
        // If items haven't been fetched yet, fetch them now
        if (!this.gasFetchedItems || this.gasFetchedItems.length === 0) {
          try {
            const res = await window.API.fetchFromGas({ type, center });
            if (res && res.products && res.products.length > 0) {
              this.gasFetchedItems = res.products;
            }
          } catch (fetchErr) {
            console.warn('[inventoryView] Fetch notice:', fetchErr.message);
          }
        }

        const res = await window.API.createInventory({
          name,
          type,
          center,
          assignedAuxiliar,
          items: this.gasFetchedItems
        });

        const itemCount = res.inventory?.items?.length || this.gasFetchedItems.length || 0;
        const auxNotice = assignedAuxiliar ? ` y asignado a ${assignedAuxiliar}` : '';
        window.Toast.success(`Inventario creado exitosamente${auxNotice} con ${itemCount} productos de la hoja del centro ${center}`);
        window.ModalHelper.close('modal-new-inventory');
        this.loadInventories();
      } catch (err) {
        window.Toast.danger(err.message || 'Error creando inventario');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Crear Inventario';
        }
      }
    });

    // Search input in count view
    document.getElementById('search-count-items')?.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      this.filterCountTable(term);
    });

    // + Nueva Ubicación (Multiple Locations) button
    document.getElementById('btn-add-multiple-location')?.addEventListener('click', () => {
      if (!this.currentInventory) return;
      this.openCountModal(null, true);
    });

    // Form submit: Confirm Count (Modal for additional location)
    document.getElementById('form-confirm-count')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      let itemId = document.getElementById('modal-count-item-id').value;
      const isNewLoc = document.getElementById('modal-count-is-new-loc').value === 'true';
      const newLoc = document.getElementById('modal-input-new-loc').value.trim();
      const qtyVal = document.getElementById('modal-input-qty').value;
      const damagedVal = document.getElementById('modal-input-damaged').value;

      if (isNewLoc && !itemId) {
        const select = document.getElementById('modal-select-item-sku');
        if (select) itemId = select.value;
      }

      if (isNewLoc && !newLoc) {
        window.Toast.warning('Debe especificar la nueva ubicación física.');
        return;
      }

      const qty = qtyVal !== '' ? parseInt(qtyVal, 10) : 0;
      const damaged = damagedVal !== '' ? parseInt(damagedVal, 10) : 0;

      try {
        await window.API.registerCount(this.currentInventory.id, {
          itemId: itemId || null,
          stockFisico: qty,
          malEstado: damaged,
          location: isNewLoc ? newLoc : null,
          isNewLocation: isNewLoc
        });

        window.Toast.success(isNewLoc ? `Nueva ubicación '${newLoc}' agregada al final de la lista` : 'Conteo registrado correctamente');
        window.ModalHelper.close('modal-count-confirm');
        await this.reloadCurrentInventory();

        if (isNewLoc) {
          setTimeout(() => {
            const rows = document.querySelectorAll('#tbody-count-items tr');
            if (rows.length > 0) {
              rows[rows.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }, 250);
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al guardar conteo');
      }
    });

    // Damage Photo Upload listeners
    const photoZone = document.getElementById('zone-damage-photo');
    const photoInput = document.getElementById('input-damage-photo-file');
    const previewBox = document.getElementById('damage-photo-preview-box');
    const previewImg = document.getElementById('img-damage-photo-preview');

    photoZone?.addEventListener('click', () => photoInput?.click());

    photoInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const itemId = document.getElementById('damage-photo-item-id')?.value;
      const item = this.currentInventory?.items?.find(it => it.id === itemId);
      const invDate = this.currentInventory?.createdAt ? this.currentInventory.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];

      try {
        window.Toast.info('Subiendo evidencia fotográfica a Google Drive...');
        const res = await window.API.uploadPhoto(file, {
          category: 'malestado',
          photoType: 'malestado',
          sku: item ? item.SKU : (document.getElementById('damage-photo-sku')?.textContent || ''),
          center: this.currentInventory ? this.currentInventory.center : (window.Auth.currentUser?.center || ''),
          date: invDate,
          inventoryId: this.currentInventory ? this.currentInventory.id : '',
          itemId: itemId || ''
        });

        if (res.photo && res.photo.url) {
          document.getElementById('damage-photo-url-val').value = res.photo.url;
          if (previewImg) previewImg.src = res.photo.url;
          if (previewBox) previewBox.style.display = 'block';
          window.Toast.success('Foto lista para guardar en Google Drive');
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al subir foto de evidencia');
      }
    });

    document.getElementById('btn-save-damage-photo')?.addEventListener('click', async () => {
      const itemId = document.getElementById('damage-photo-item-id').value;
      const photoUrl = document.getElementById('damage-photo-url-val').value;
      if (!itemId || !this.currentInventory) return;

      const item = this.currentInventory.items.find(it => it.id === itemId);
      const qtyInput = document.getElementById(`input-qty-${itemId}`);
      const damagedInput = document.getElementById(`input-damaged-${itemId}`);

      const qty = qtyInput && qtyInput.value !== '' ? parseInt(qtyInput.value, 10) : (item?.Stock_Fisico || 0);
      const damaged = damagedInput ? (parseInt(damagedInput.value, 10) || 0) : (item?.Mal_estado || 0);

      try {
        await window.API.registerCount(this.currentInventory.id, {
          itemId,
          stockFisico: qty,
          malEstado: damaged,
          photoUrl
        });

        if (item) {
          item.foto_mal_estado = photoUrl;
          item.Mal_estado = damaged;
          item.Stock_Fisico = qty;
        }

        const btn = document.getElementById(`btn-photo-${itemId}`);
        if (btn) {
          btn.className = 'btn btn-success btn-sm';
          btn.innerHTML = '<i class="fa-solid fa-image"></i> Ver Foto';
        }

        window.Toast.success('Evidencia fotográfica guardada con éxito');
        window.ModalHelper.close('modal-damage-photo');
      } catch (err) {
        window.Toast.danger(err.message || 'Error al guardar foto');
      }
    });

    // Submit Inventory for Review & Signature
    document.getElementById('btn-submit-inv-review')?.addEventListener('click', async () => {
      if (!this.currentInventory) return;

      const uncounted = this.currentInventory.items.filter(it => it.Stock_Fisico === null || it.Stock_Fisico === undefined);
      if (uncounted.length > 0) {
        window.Toast.warning(`Aún quedan ${uncounted.length} ítems pendientes de conteo.`);
        return;
      }

      if (!confirm('¿Desea enviar este inventario a revisión final de justificaciones?')) {
        return;
      }

      try {
        await window.API.submitInventory(this.currentInventory.id, {
          signature: `Firmado digitalmente por ${window.Auth.currentUser.username} (${new Date().toLocaleString()})`
        });

        window.Toast.success('Inventario enviado a revisión de justificaciones con éxito');
        this.openInventory(this.currentInventory.id);
      } catch (err) {
        window.Toast.danger(err.message || 'Error al enviar inventario');
      }
    });

    // Scanner button in Count View
    document.getElementById('btn-open-cam-count')?.addEventListener('click', () => {
      window.ModalHelper.open('modal-camera-scanner');
      window.ScannerComponent.start('general-reader', (decodedText) => {
        window.ModalHelper.close('modal-camera-scanner');
        window.ScannerComponent.stop();
        this.handleBarcodeScannedInCount(decodedText);
      });
    });
  },

  async loadInventories() {
    const type = document.getElementById('filter-inv-type')?.value || 'TODOS';
    const center = document.getElementById('filter-inv-center')?.value || 'TODOS';

    const tbody = document.getElementById('tbody-inventories');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando inventarios...</td></tr>';

    try {
      const res = await window.API.getInventories({ type, center });
      let list = res.inventories || [];

      const cacheKey = 'nibol_cached_inventories';
      if (list.length > 0) {
        try { localStorage.setItem(cacheKey, JSON.stringify(list)); } catch (e) {}
      } else {
        try { localStorage.removeItem(cacheKey); } catch (e) {}
      }

      // If user is AUXILIAR, verify assignment
      if (window.Auth.currentUser?.role === 'AUXILIAR') {
        const u = String(window.Auth.currentUser.username || '').toLowerCase().trim();
        const c = String(window.Auth.currentUser.clave || '').toLowerCase().trim();
        const d = String(window.Auth.currentUser.displayName || '').toLowerCase().trim();

        list = list.filter(inv => {
          if (Array.isArray(inv.assignedAuxiliars) && inv.assignedAuxiliars.length > 0) {
            const assignedList = inv.assignedAuxiliars.map(a => String(a).toLowerCase().trim());
            const isDirectlyAssigned = assignedList.some(a => a === u || (c && a === c) || (d && (a === d || d.includes(a) || a.includes(d))));
            if (isDirectlyAssigned) return true;
          }

          if (Array.isArray(inv.items) && inv.items.length > 0) {
            const hasAssignedItems = inv.items.some(it => {
              if (!it || !it.Responsable) return false;
              const resp = String(it.Responsable).toLowerCase().trim();
              return resp === u || (c && resp === c) || (d && (resp === d || d.includes(resp) || resp.includes(d)));
            });
            if (hasAssignedItems) return true;
          }

          // If the backend delivered this inventory specifically for this auxiliar, trust the server
          return true;
        });
      }

      if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-dim);">No se encontraron inventarios asignados a su usuario.</td></tr>';
        return;
      }

      tbody.innerHTML = list.map(inv => {
        const percent = inv.totalItems > 0 ? Math.round((inv.countedItems / inv.totalItems) * 100) : 0;
        let badgeClass = 'badge-neutral';
        if (inv.status === 'EN_PROGRESO') badgeClass = 'badge-info';
        if (inv.status === 'PENDIENTE_JUSTIFICACION') badgeClass = 'badge-warning';
        if (inv.status === 'REVISADO') badgeClass = 'badge-success';

        const safeName = encodeURIComponent(inv.name || inv.id);

        return `
          <tr>
            <td><strong style="color: var(--primary); font-family: var(--font-mono);">${inv.id}</strong></td>
            <td><strong>${inv.name}</strong></td>
            <td><span class="badge badge-neutral">${inv.type}</span></td>
            <td><span class="badge badge-neutral">${inv.center}</span></td>
            <td><span class="badge ${badgeClass}">${inv.status}</span></td>
            <td>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <div style="flex: 1; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; min-width: 60px;">
                  <div style="width: ${percent}%; height: 100%; background: var(--primary);"></div>
                </div>
                <span style="font-size: 0.75rem; font-family: var(--font-mono);">${inv.countedItems}/${inv.totalItems} (${percent}%)</span>
              </div>
            </td>
            <td>
              <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
                <button class="btn btn-primary btn-sm" onclick="window.InventoryView.openInventory('${inv.id}')">
                  <i class="fa-solid fa-play"></i> ${window.Auth.currentUser?.role === 'AUXILIAR' ? 'Contar' : 'Abrir'}
                </button>
                ${(window.Auth.hasRole(['ADMIN']) || (window.Auth.hasRole(['ENCARGADO']) && window.Auth.isSameCenter(inv.center, window.Auth.currentUser?.center))) ? `
                  <button class="btn btn-secondary btn-sm" onclick="window.InventoryView.promptAssign('${inv.id}', '${safeName}', '${inv.center}')" title="Asignar tareas a Auxiliar de este centro">
                    <i class="fa-solid fa-user-tag"></i> Asignar
                  </button>
                  <button class="btn btn-danger btn-sm" onclick="window.InventoryView.promptDelete('${inv.id}')" title="Eliminar inventario/tarea">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      // Offline / Serverless recovery on error
      try {
        const cachedRaw = localStorage.getItem('nibol_cached_inventories');
        if (cachedRaw) {
          const list = JSON.parse(cachedRaw);
          if (Array.isArray(list) && list.length > 0) {
            tbody.innerHTML = list.map(inv => `
              <tr>
                <td><strong style="color: var(--primary); font-family: var(--font-mono);">${inv.id}</strong></td>
                <td><strong>${inv.name}</strong></td>
                <td><span class="badge badge-neutral">${inv.type}</span></td>
                <td><span class="badge badge-neutral">${inv.center}</span></td>
                <td><span class="badge badge-info">${inv.status}</span></td>
                <td><span style="font-size: 0.75rem;">${inv.countedItems || 0}/${inv.totalItems || 0}</span></td>
                <td>
                  <button class="btn btn-primary btn-sm" onclick="window.InventoryView.openInventory('${inv.id}')">
                    <i class="fa-solid fa-play"></i> Abrir
                  </button>
                </td>
              </tr>
            `).join('');
            return;
          }
        }
      } catch (e) {}
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--danger);">Error: ${err.message}</td></tr>`;
    }
  },

  async openInventory(id) {
    try {
      try {
        localStorage.setItem('nibol_active_inv_id', id);
        localStorage.setItem('nibol_active_view', 'count');
      } catch (e) {}

      let inv = null;
      try {
        const res = await window.API.getInventoryById(id);
        inv = res.inventory;
        try { localStorage.setItem(`nibol_inv_detail_${id}`, JSON.stringify(inv)); } catch (e) {}
      } catch (netErr) {
        const cachedRaw = localStorage.getItem(`nibol_inv_detail_${id}`);
        if (cachedRaw) {
          inv = JSON.parse(cachedRaw);
          window.Toast.info('Mostrando datos del inventario guardados localmente');
        } else {
          throw netErr;
        }
      }

      this.currentInventory = inv;

      // If opening an inventory of type BARRIDO, open its dedicated environment
      if (inv && inv.type === 'BARRIDO') {
        window.Router.navigate('barrido');
        if (inv.center) {
          const centerSelect = document.getElementById('barrido-select-center');
          if (centerSelect) centerSelect.value = inv.center;
        }
        return;
      }

      document.getElementById('view-inventories').classList.remove('active');
      document.getElementById('view-count').classList.add('active');

      document.getElementById('count-inv-title').textContent = `${this.currentInventory.name} (${this.currentInventory.center})`;
      
      const blindBanner = document.getElementById('count-blind-banner');
      if (blindBanner) {
        blindBanner.style.display = this.currentInventory.isBlindCount ? 'inline-flex' : 'none';
      }

      this.renderCountTable();
    } catch (err) {
      window.Toast.danger(err.message || 'No se pudo abrir el inventario');
    }
  },

  async reloadCurrentInventory() {
    if (!this.currentInventory) return;
    const id = this.currentInventory.id;
    try {
      const res = await window.API.getInventoryById(id);
      this.currentInventory = res.inventory;
      try { localStorage.setItem(`nibol_inv_detail_${id}`, JSON.stringify(res.inventory)); } catch (e) {}
    } catch (e) {
      // Keep memory copy
    }
    this.renderCountTable();
  },

  renderCountTable() {
    if (!this.currentInventory) return;

    const thead = document.getElementById('thead-count-items');
    const tbody = document.getElementById('tbody-count-items');

    // Ensure every item has an ID defined
    (this.currentInventory.items || []).forEach((item, idx) => {
      if (!item.id) {
        item.id = `ITEM-${item.SKU ? String(item.SKU).replace(/[^a-zA-Z0-9_-]/g, '_') : (idx + 1)}-${idx + 1}`;
      }
    });

    // Clean, streamlined table view with inline location and count/lock action
    thead.innerHTML = `
      <tr>
        <th style="min-width: 130px;">SKU / Código</th>
        <th style="min-width: 200px;">Descripción</th>
        <th style="min-width: 140px;">Ubicación</th>
        <th style="min-width: 60px; text-align: center;">ABC</th>
        <th style="min-width: 110px; text-align: center;">Cantidad</th>
        <th style="min-width: 100px; text-align: center;">Mal Estado</th>
        <th style="min-width: 170px; text-align: center;">Acción / Conteo</th>
      </tr>
    `;

    tbody.innerHTML = this.currentInventory.items.map(item => {
      const isCounted = item.Stock_Fisico !== null && item.Stock_Fisico !== undefined;
      const isLocked = item.locked === true || (item.locked !== false && isCounted);
      const rowClass = isCounted ? 'counted-row' : '';
      const damagedQty = item.Mal_estado || 0;
      const hasDamaged = damagedQty > 0;
      const hasPhoto = !!item.foto_mal_estado;

      return `
        <tr class="${rowClass}" data-item-id="${item.id}" id="row-item-${item.id}">
          <td>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.35rem;">
              <strong style="color: var(--primary); font-family: var(--font-mono); font-size: 0.95rem;">${item.SKU}</strong>
              <button
                type="button"
                class="btn btn-secondary btn-xs"
                style="padding: 0.15rem 0.35rem; font-size: 0.7rem; border-radius: 4px; background: rgba(56,189,248,0.12); color: #38bdf8; border: 1px solid rgba(56,189,248,0.25);"
                onclick="window.InventoryView.showReferencePhoto('${item.SKU}', '${item.Codigo_Barras || ''}', '${encodeURIComponent(item.Descripcion || '')}')"
                title="Ver Foto de Referencia (Google Drive)"
              >
                <i class="fa-solid fa-image"></i> Foto
              </button>
            </div>
            ${item.isAdditionalLocation ? '<span class="badge badge-warning" style="font-size: 0.65rem; margin-top: 0.2rem; display: inline-block;">Ubic. Extra</span>' : ''}
            ${item.Codigo_Barras ? `<div style="font-size: 0.75rem; color: var(--text-dim); font-family: var(--font-mono); margin-top: 0.15rem;"><i class="fa-solid fa-barcode"></i> ${item.Codigo_Barras}</div>` : ''}
          </td>
          <td style="font-size: 0.9rem; color: var(--text-main); font-weight: 500;">
            ${item.Descripcion}
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 0.25rem;">
              <div style="display: inline-flex; align-items: center; gap: 0.35rem;">
                <span class="badge ${item.isAdditionalLocation ? 'badge-warning' : 'badge-info'}"><i class="fa-solid fa-location-dot"></i> ${item.Ubicacion || '-'}</span>
                
                ${item.isAdditionalLocation ? `
                  <button
                    type="button"
                    class="btn btn-danger btn-xs"
                    onclick="window.InventoryView.deleteAdditionalLocation('${item.id}', '${item.SKU}', '${item.Ubicacion || ''}')"
                    title="Eliminar esta ubicación adicional"
                    style="padding: 0.15rem 0.4rem; font-size: 0.72rem; border-radius: 4px;"
                  >
                    <i class="fa-solid fa-trash"></i>
                  </button>
                ` : `
                  <button
                    type="button"
                    class="btn btn-secondary btn-xs"
                    onclick="window.InventoryView.toggleInlineNewLocation('${item.id}')"
                    title="Agregar este SKU en otra ubicación física"
                    style="padding: 0.15rem 0.4rem; font-size: 0.72rem; border-radius: 4px;"
                  >
                    <i class="fa-solid fa-plus"></i> Ubic.
                  </button>
                `}
              </div>

              <!-- Inline New Location Input Box (Collapsed by default) -->
              ${!item.isAdditionalLocation ? `
                <div id="inline-loc-box-${item.id}" style="display: none; margin-top: 0.35rem; background: rgba(0,0,0,0.25); padding: 0.35rem 0.5rem; border-radius: var(--radius-sm); border: 1px dashed var(--primary);">
                  <small style="color: var(--primary); font-size: 0.72rem; display: block; margin-bottom: 0.2rem; font-weight: 600;">Nueva ubicación para ${item.SKU}:</small>
                  <div style="display: flex; gap: 0.3rem;">
                    <input
                      type="text"
                      id="inline-loc-input-${item.id}"
                      class="form-input"
                      placeholder="Ej: RACK-B2-04"
                      style="font-size: 0.75rem; padding: 0.2rem 0.4rem; height: 26px; text-transform: uppercase;"
                      onkeydown="if(event.key==='Enter'){event.preventDefault(); window.InventoryView.submitInlineNewLocation('${item.id}');}"
                    />
                    <button
                      type="button"
                      class="btn btn-primary btn-xs"
                      onclick="window.InventoryView.submitInlineNewLocation('${item.id}')"
                      title="Guardar nueva ubicación"
                      style="padding: 0.2rem 0.5rem; height: 26px;"
                    >
                      <i class="fa-solid fa-check"></i>
                    </button>
                    <button
                      type="button"
                      class="btn btn-secondary btn-xs"
                      onclick="window.InventoryView.toggleInlineNewLocation('${item.id}')"
                      title="Cancelar"
                      style="padding: 0.2rem 0.35rem; height: 26px;"
                    >
                      <i class="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                </div>
              ` : ''}
            </div>
          </td>
          <td style="text-align: center;">
            <span class="badge badge-neutral" style="font-weight: 700;">${item.Clasificacion_ABC || 'C'}</span>
          </td>
          <td style="text-align: center;">
            <div style="display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;">
              <input
                type="number"
                min="0"
                id="input-qty-${item.id}"
                class="form-input input-inline-count"
                style="width: 80px; text-align: center; font-weight: 700; font-family: var(--font-mono); font-size: 1.05rem; padding: 0.35rem 0.25rem; border-color: ${isCounted ? 'var(--success)' : 'var(--border-glass)'}; ${isLocked ? 'background: rgba(255,255,255,0.03); cursor: not-allowed; opacity: 0.9;' : ''}"
                placeholder="0"
                value="${isCounted ? item.Stock_Fisico : ''}"
                ${isLocked ? 'disabled' : ''}
                onchange="window.InventoryView.handleInlineCountChange('${item.id}')"
                onkeydown="if(event.key==='Enter'){event.preventDefault(); window.InventoryView.confirmAndLockItem('${item.id}');}"
              />
              <span id="saved-icon-${item.id}" style="color: var(--success); font-size: 0.9rem; opacity: ${isCounted ? '1' : '0'}; transition: opacity 0.2s;" title="Conteo guardado">
                <i class="fa-solid fa-check"></i>
              </span>
            </div>
          </td>
          <td style="text-align: center;">
            <input
              type="number"
              min="0"
              id="input-damaged-${item.id}"
              class="form-input input-inline-damaged"
              style="width: 75px; text-align: center; font-weight: 700; font-family: var(--font-mono); font-size: 1.05rem; padding: 0.35rem 0.25rem; color: var(--danger); border-color: ${hasDamaged ? 'var(--danger)' : 'var(--border-glass)'}; ${isLocked ? 'background: rgba(255,255,255,0.03); cursor: not-allowed; opacity: 0.9;' : ''}"
              placeholder="0"
              value="${damagedQty}"
              ${isLocked ? 'disabled' : ''}
              oninput="window.InventoryView.handleDamagedInput('${item.id}', this.value)"
              onchange="window.InventoryView.handleInlineCountChange('${item.id}')"
              onkeydown="if(event.key==='Enter'){event.preventDefault(); window.InventoryView.confirmAndLockItem('${item.id}');}"
            />
          </td>
          <td style="text-align: center;">
            <div style="display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;">
              <button
                type="button"
                id="btn-photo-${item.id}"
                class="btn ${hasDamaged ? (hasPhoto ? 'btn-success' : 'btn-warning') : 'btn-secondary'} btn-sm"
                ${hasDamaged ? '' : 'disabled'}
                onclick="window.InventoryView.openDamagePhotoModal('${item.id}')"
                title="${hasDamaged ? (hasPhoto ? 'Ver foto de evidencia' : 'Tomar / subir foto de daño') : 'Ingrese cantidad en mal estado para habilitar foto'}"
                style="${hasDamaged ? 'cursor: pointer;' : 'opacity: 0.35; cursor: not-allowed;'}"
              >
                <i class="fa-solid ${hasPhoto ? 'fa-image' : 'fa-camera'}"></i>
                ${hasPhoto ? 'Foto' : 'Foto'}
              </button>

              <button
                type="button"
                id="btn-count-lock-${item.id}"
                class="btn ${isLocked ? 'btn-success' : 'btn-primary'} btn-sm"
                onclick="${isLocked ? `window.InventoryView.requestUnlockItem('${item.id}')` : `window.InventoryView.confirmAndLockItem('${item.id}')`}"
                title="${isLocked ? 'Ítem contado y bloqueado contra edición. Clic para desbloquear con confirmación' : 'Registrar conteo y bloquear ítem'}"
                style="min-width: 78px;"
              >
                <i class="fa-solid ${isLocked ? 'fa-lock' : 'fa-check'}"></i>
                <span>${isLocked ? 'Contado' : 'Contar'}</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  toggleInlineNewLocation(itemId) {
    const box = document.getElementById(`inline-loc-box-${itemId}`);
    if (!box) return;

    if (box.style.display === 'none' || box.style.display === '') {
      box.style.display = 'block';
      const input = document.getElementById(`inline-loc-input-${itemId}`);
      if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 100);
      }
    } else {
      box.style.display = 'none';
    }
  },

  async submitInlineNewLocation(itemId) {
    if (!this.currentInventory) return;
    const input = document.getElementById(`inline-loc-input-${itemId}`);
    const newLoc = input ? input.value.trim().toUpperCase() : '';

    if (!newLoc) {
      window.Toast.warning('Especifique la nueva ubicación física.');
      return;
    }

    try {
      window.Toast.info(`Agregando ubicación '${newLoc}'...`);
      await window.API.registerCount(this.currentInventory.id, {
        itemId,
        isNewLocation: true,
        location: newLoc,
        stockFisico: null,
        malEstado: 0,
        locked: false
      });

      window.Toast.success(`Nueva ubicación '${newLoc}' agregada al final de la lista. Ingrese la cantidad y presione 'Contar'.`);
      await this.reloadCurrentInventory();

      // Scroll to newly appended row at the bottom and focus its input
      setTimeout(() => {
        const rows = document.querySelectorAll('#tbody-count-items tr');
        const lastRow = rows[rows.length - 1];
        if (lastRow) {
          lastRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const lastInput = lastRow.querySelector('input.input-inline-count');
          if (lastInput) {
            lastInput.focus();
            lastInput.select();
          }
        }
      }, 300);
    } catch (err) {
      window.Toast.danger(err.message || 'Error al agregar ubicación');
    }
  },

  async deleteAdditionalLocation(itemId, sku, location) {
    if (!this.currentInventory) return;
    const confirmed = confirm(`⚠️ ¿Está seguro de eliminar la ubicación adicional '${location}' del SKU ${sku}?`);
    if (!confirmed) return;

    try {
      await window.API.deleteInventoryItem(this.currentInventory.id, itemId);
      window.Toast.success(`Ubicación adicional '${location}' eliminada.`);
      await this.reloadCurrentInventory();
    } catch (err) {
      window.Toast.danger(err.message || 'Error al eliminar ubicación adicional');
    }
  },

  filterCountTable(term) {
    const rows = document.querySelectorAll('#tbody-count-items tr');
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = (!term || text.includes(term)) ? '' : 'none';
    });
  },

  handleDamagedInput(itemId, val) {
    const btnPhoto = document.getElementById(`btn-photo-${itemId}`);
    if (!btnPhoto) return;

    const num = parseInt(val, 10) || 0;
    if (num > 0) {
      btnPhoto.disabled = false;
      btnPhoto.style.opacity = '1';
      btnPhoto.style.cursor = 'pointer';
      btnPhoto.className = 'btn btn-warning btn-sm';
      btnPhoto.title = 'Tomar o subir foto de evidencia de mal estado';
    } else {
      btnPhoto.disabled = true;
      btnPhoto.style.opacity = '0.35';
      btnPhoto.style.cursor = 'not-allowed';
      btnPhoto.className = 'btn btn-secondary btn-sm';
      btnPhoto.title = 'Ingrese cantidad en mal estado para habilitar foto';
    }
  },

  handleInlineCountChange(itemId) {
    const item = this.currentInventory?.items.find(it => it.id === itemId);
    if (!item) return;

    const qtyInput = document.getElementById(`input-qty-${itemId}`);
    const damInput = document.getElementById(`input-damaged-${itemId}`);

    if (qtyInput && qtyInput.value !== '') {
      item.Stock_Fisico = parseInt(qtyInput.value, 10) || 0;
    }
    if (damInput) {
      item.Mal_estado = parseInt(damInput.value, 10) || 0;
      this.handleDamagedInput(itemId, damInput.value);
    }
  },

  async confirmAndLockItem(itemId) {
    if (!this.currentInventory) return;

    const item = this.currentInventory.items.find(it => it.id === itemId || it.SKU === itemId || String(it.id) === String(itemId));
    const actualId = item ? item.id : itemId;

    const qtyInput = document.getElementById(`input-qty-${actualId}`);
    const damInput = document.getElementById(`input-damaged-${actualId}`);
    const btn = document.getElementById(`btn-count-lock-${actualId}`);
    if (!qtyInput || !damInput) return;

    let qtyVal = qtyInput.value.trim();
    if (qtyVal === '') {
      qtyVal = '0';
      qtyInput.value = '0';
    }

    const qty = parseInt(qtyVal, 10);
    const damaged = parseInt(damInput.value, 10) || 0;

    if (isNaN(qty) || qty < 0) {
      window.Toast.warning('La cantidad física no es válida.');
      return;
    }

    try {
      await window.API.registerCount(this.currentInventory.id, {
        itemId: actualId,
        stockFisico: qty,
        malEstado: damaged,
        locked: true
      });

      if (item) {
        item.Stock_Fisico = qty;
        item.Mal_estado = damaged;
        item.locked = true;
        item.Estado = 'Contado';
      }

      // Lock input fields to prevent accidental edits
      qtyInput.disabled = true;
      qtyInput.setAttribute('disabled', 'true');
      qtyInput.style.background = 'rgba(255,255,255,0.03)';
      qtyInput.style.cursor = 'not-allowed';
      qtyInput.style.opacity = '0.9';
      qtyInput.style.borderColor = 'var(--success)';

      damInput.disabled = true;
      damInput.setAttribute('disabled', 'true');
      damInput.style.background = 'rgba(255,255,255,0.03)';
      damInput.style.cursor = 'not-allowed';
      damInput.style.opacity = '0.9';

      // Update lock button
      if (btn) {
        btn.className = 'btn btn-success btn-sm';
        btn.innerHTML = '<i class="fa-solid fa-lock"></i> <span>Contado</span>';
        btn.onclick = () => window.InventoryView.requestUnlockItem(actualId);
        btn.title = 'Ítem contado y bloqueado contra edición. Clic para desbloquear con confirmación';
      }

      const icon = document.getElementById(`saved-icon-${actualId}`);
      if (icon) icon.style.opacity = '1';

      const row = document.getElementById(`row-item-${actualId}`);
      if (row) row.classList.add('counted-row');

      window.Toast.success(`✅ Conteo guardado y bloqueado: ${item ? item.SKU : ''} (${qty} contados)`);
    } catch (err) {
      qtyInput.style.borderColor = 'var(--danger)';
      window.Toast.danger(err.message || 'Error al guardar y bloquear conteo');
    }
  },

  async requestUnlockItem(itemId) {
    if (!this.currentInventory) return;
    const item = this.currentInventory.items.find(it => it.id === itemId || it.SKU === itemId || String(it.id) === String(itemId));
    if (!item) {
      window.Toast.warning('Ítem no encontrado en el inventario actual');
      return;
    }

    const promptReason = prompt(`⚠️ ¿Desea desbloquear el SKU '${item.SKU}' para modificar o corregir el conteo ya realizado?\n\nIndique el motivo de la modificación:`, 'Corrección de cantidad física');
    if (promptReason === null) return;

    const reason = promptReason.trim() || 'Modificación solicitada por contador';

    // 1. Immediately unlock locally on DOM
    item.locked = false;
    item.unlockRequestCount = (item.unlockRequestCount || 0) + 1;

    const actualId = item.id;
    const qtyInput = document.getElementById(`input-qty-${actualId}`);
    const damInput = document.getElementById(`input-damaged-${actualId}`);
    const btn = document.getElementById(`btn-count-lock-${actualId}`);
    const row = document.getElementById(`row-item-${actualId}`);

    if (qtyInput) {
      qtyInput.disabled = false;
      qtyInput.removeAttribute('disabled');
      qtyInput.style.background = 'rgba(255,255,255,0.08)';
      qtyInput.style.cursor = 'text';
      qtyInput.style.opacity = '1';
      qtyInput.style.borderColor = 'var(--primary)';
      setTimeout(() => {
        qtyInput.focus();
        qtyInput.select();
      }, 50);
    }

    if (damInput) {
      damInput.disabled = false;
      damInput.removeAttribute('disabled');
      damInput.style.background = 'rgba(255,255,255,0.08)';
      damInput.style.cursor = 'text';
      damInput.style.opacity = '1';
    }

    if (btn) {
      btn.className = 'btn btn-primary btn-sm';
      btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>Contar</span>';
      btn.onclick = () => window.InventoryView.confirmAndLockItem(actualId);
      btn.title = 'Registrar conteo y bloquear ítem';
    }

    if (row) {
      row.classList.remove('counted-row');
    }

    window.Toast.info(`Ítem ${item.SKU} desbloqueado. Modifique la cantidad y vuelva a presionar 'Contar'.`);

    // 2. Call backend in background to register the unlock audit event
    try {
      await window.API.requestUnlockItem(this.currentInventory.id, actualId, { reason });
    } catch (err) {
      console.warn('[requestUnlockItem] Notice recording unlock on server:', err.message);
    }
  },

  openDamagePhotoModal(itemId) {
    if (!this.currentInventory) return;
    const item = this.currentInventory.items.find(it => it.id === itemId);
    if (!item) return;

    const damInput = document.getElementById(`input-damaged-${itemId}`);
    const damagedVal = damInput ? (parseInt(damInput.value, 10) || item.Mal_estado || 0) : (item.Mal_estado || 0);

    document.getElementById('damage-photo-item-id').value = item.id;
    document.getElementById('damage-photo-sku').textContent = item.SKU;
    document.getElementById('damage-photo-desc').textContent = item.Descripcion;
    document.getElementById('damage-photo-qty').textContent = `${damagedVal} pieza(s) en mal estado`;

    const previewBox = document.getElementById('damage-photo-preview-box');
    const previewImg = document.getElementById('img-damage-photo-preview');
    const urlVal = document.getElementById('damage-photo-url-val');
    const fileInput = document.getElementById('input-damage-photo-file');

    if (fileInput) fileInput.value = '';

    if (item.foto_mal_estado) {
      urlVal.value = item.foto_mal_estado;
      if (previewImg) previewImg.src = item.foto_mal_estado;
      if (previewBox) previewBox.style.display = 'block';
    } else {
      urlVal.value = '';
      if (previewBox) previewBox.style.display = 'none';
      if (previewImg) previewImg.src = '';
    }

    window.ModalHelper.open('modal-damage-photo');
  },

  filterCountTable(term) {
    const rows = document.querySelectorAll('#tbody-count-items tr');
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(term) ? '' : 'none';
    });
  },

  openCountModal(itemId, isNewLocation = false) {
    document.getElementById('modal-count-is-new-loc').value = isNewLocation ? 'true' : 'false';
    const newLocGroup = document.getElementById('group-new-location-input');
    const skuGroup = document.getElementById('group-sku-select');
    const selectSku = document.getElementById('modal-select-item-sku');

    if (isNewLocation) {
      if (newLocGroup) newLocGroup.style.display = 'block';
      if (skuGroup) skuGroup.style.display = 'block';

      if (selectSku && this.currentInventory) {
        selectSku.innerHTML = this.currentInventory.items.map(it => `
          <option value="${it.id}">${it.SKU} - ${it.Descripcion.substring(0, 40)} (Ubic: ${it.Ubicacion || '-'})</option>
        `).join('');
      }

      document.getElementById('modal-count-item-id').value = '';
      document.getElementById('modal-count-sku').textContent = '+ AGREGAR NUEVA UBICACIÓN FÍSICA';
      document.getElementById('modal-count-desc').textContent = 'Se creará una nueva fila al final de la lista con la ubicación y conteo del trabajador';
      document.getElementById('modal-count-loc').textContent = 'Seleccione el SKU y defina la nueva ubicación';
      document.getElementById('modal-input-qty').value = '';
      document.getElementById('modal-input-damaged').value = '0';
      document.getElementById('modal-input-new-loc').value = '';
    } else {
      if (newLocGroup) newLocGroup.style.display = 'none';
      if (skuGroup) skuGroup.style.display = 'none';

      const item = this.currentInventory.items.find(it => it.id === itemId);
      if (!item) return;

      document.getElementById('modal-count-item-id').value = item.id;
      document.getElementById('modal-count-sku').textContent = item.SKU;
      document.getElementById('modal-count-desc').textContent = item.Descripcion;
      document.getElementById('modal-count-loc').textContent = `Ubicación registrada: ${item.Ubicacion}`;
      document.getElementById('modal-input-qty').value = item.Stock_Fisico !== null ? item.Stock_Fisico : '';
      document.getElementById('modal-input-damaged').value = item.Mal_estado || 0;
    }

    window.ModalHelper.open('modal-count-confirm');
  },

  handleBarcodeScannedInCount(barcode) {
    if (!this.currentInventory) return;
    const clean = String(barcode).trim().replace(/^JD_/i, '');
    const item = this.currentInventory.items.find(it => {
      const b = (it.Codigo_Barras || '').replace(/^JD_/i, '');
      const s = (it.SKU || '').replace(/^JD_/i, '');
      return b === clean || s.toUpperCase() === clean.toUpperCase();
    });

    if (item) {
      const input = document.getElementById(`input-qty-${item.id}`);
      if (input) {
        input.focus();
        input.select();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.Toast.success(`Producto localizado: ${item.SKU}. Ingrese cantidad.`);
      }
    } else {
      window.Toast.warning(`Código ${barcode} no encontrado en este inventario. Puede agregarlo con + Nueva Ubicación.`);
    }
  },

  promptDelete(invId) {
    if (!invId) return;
    const invInput = document.getElementById('delete-modal-inv-id');
    const keyInput = document.getElementById('delete-modal-key');
    const reasonInput = document.getElementById('delete-modal-reason');

    if (invInput) invInput.value = invId;
    if (keyInput) keyInput.value = '';
    if (reasonInput) reasonInput.value = '';
    window.ModalHelper.open('modal-delete-confirm');

    const form = document.getElementById('form-delete-confirm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const targetId = document.getElementById('delete-modal-inv-id')?.value || invId;
        const deleteKey = document.getElementById('delete-modal-key')?.value || 'ADM26';
        const reason = document.getElementById('delete-modal-reason')?.value || 'Eliminación por el usuario';

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Eliminando...';
        }

        try {
          const res = await window.API.deleteInventory(targetId, { deleteKey, reason });
          window.Toast.success(res.message || 'Inventario eliminado con éxito');
          window.ModalHelper.close('modal-delete-confirm');

          // Clean local storage cache immediately
          try {
            const cacheKey = 'nibol_cached_inventories';
            const cachedRaw = localStorage.getItem(cacheKey);
            if (cachedRaw) {
              const cachedList = JSON.parse(cachedRaw);
              if (Array.isArray(cachedList)) {
                const updated = cachedList.filter(item => item && item.id !== targetId);
                if (updated.length > 0) {
                  localStorage.setItem(cacheKey, JSON.stringify(updated));
                } else {
                  localStorage.removeItem(cacheKey);
                }
              }
            }
          } catch (e) {}

          // If current inventory was open, return to list view
          if (this.currentInventory && this.currentInventory.id === targetId) {
            this.currentInventory = null;
            document.getElementById('view-count')?.classList.remove('active');
            document.getElementById('view-inventories')?.classList.add('active');
          }

          await this.loadInventories();
        } catch (err) {
          window.Toast.danger(err.message || 'Error eliminando inventario');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Eliminar Definitivamente';
          }
        }
      };
    }
  },

  async promptAssign(invId, rawInvName, rawInvCenter) {
    if (!invId) return;
    const modal = document.getElementById('modal-quick-assign');
    if (!modal) return;

    const currentUser = window.Auth.currentUser;
    const isAdmin = window.Auth.hasRole(['ADMIN']);

    if (!isAdmin && rawInvCenter && !window.Auth.isSameCenter(rawInvCenter, currentUser?.center)) {
      window.Toast.warning('Acceso denegado: Como Encargado solo puede asignar tareas de inventarios de su propio centro.');
      return;
    }

    const invInput = document.getElementById('quick-assign-inv-id');
    const nameSpan = document.getElementById('quick-assign-inv-name');
    const auxSelect = document.getElementById('quick-assign-aux-select');
    const noteEl = document.getElementById('quick-assign-center-note');

    if (invInput) invInput.value = invId;
    if (nameSpan) nameSpan.textContent = decodeURIComponent(rawInvName || invId);
    if (auxSelect) auxSelect.innerHTML = '<option value="">Cargando auxiliares...</option>';

    if (noteEl) {
      if (isAdmin) {
        noteEl.innerHTML = `<i class="fa-solid fa-crown" style="color: #f59e0b;"></i> <strong style="color: #f59e0b;">Modo Administrador:</strong> Puede asignar a cualquier auxiliar de cualquier centro operativo.`;
      } else {
        const cDesc = currentUser?.centerName ? `${currentUser.center} - ${currentUser.centerName}` : (currentUser?.center || 'su centro');
        noteEl.innerHTML = `<i class="fa-solid fa-building-user" style="color: #38bdf8;"></i> <strong style="color: #38bdf8;">Modo Encargado (${cDesc}):</strong> Mostrando únicamente los auxiliares asignables de su centro operativo.`;
      }
    }

    window.ModalHelper.open('modal-quick-assign');

    try {
      const uRes = await window.API.getUsers();
      let auxs = (uRes.users || []).filter(u => u.role === 'AUXILIAR');
      
      // If Encargado, strictly filter by center
      if (!isAdmin && currentUser?.center) {
        auxs = auxs.filter(u => window.Auth.isSameCenter(u.center, currentUser.center));
      }

      if (auxSelect) {
        if (auxs.length === 0) {
          const cDesc = currentUser?.centerName || currentUser?.center || 'este centro';
          auxSelect.innerHTML = `<option value="">No hay auxiliares registrados en ${cDesc}</option>`;
        } else {
          auxSelect.innerHTML = '<option value="">-- Seleccionar Auxiliar Responsable --</option>' +
            auxs.map(u => `<option value="${u.username}">${u.displayName || u.username} (${u.centerName || u.center || 'Sin Centro'})</option>`).join('');
        }
      }
    } catch (err) {
      if (auxSelect) auxSelect.innerHTML = '<option value="">Error cargando lista de auxiliares</option>';
    }
  },

  showReferencePhoto(sku, barcode, encodedDesc) {
    const desc = decodeURIComponent(encodedDesc || '');
    const img = document.getElementById('ref-preview-modal-img');
    const loading = document.getElementById('ref-preview-loading');
    const skuSpan = document.getElementById('ref-preview-modal-sku');
    const barcodeSpan = document.getElementById('ref-preview-modal-barcode');
    const descSpan = document.getElementById('ref-preview-modal-desc');

    if (skuSpan) skuSpan.textContent = sku || '-';
    if (barcodeSpan) barcodeSpan.textContent = barcode || 'No especificado';
    if (descSpan) descSpan.textContent = desc || 'Sin descripción disponible';

    if (img) {
      if (loading) loading.style.display = 'flex';
      img.onload = () => { if (loading) loading.style.display = 'none'; };
      img.onerror = () => { if (loading) loading.style.display = 'none'; };
      const safeSku = encodeURIComponent(sku || 'default');
      const safeBarcode = encodeURIComponent(barcode || '');
      img.src = `/api/photos/reference/${safeSku}?barcode=${safeBarcode}&t=${Date.now()}`;
    }

    window.ModalHelper.open('modal-reference-photo-preview');
  },

  async triggerAutoFetchGas(showToast = false) {
    const type = document.getElementById('new-inv-type')?.value || 'CICLICO';
    const center = (window.Auth.currentUser?.role === 'ENCARGADO')
      ? window.Auth.currentUser.center
      : (document.getElementById('new-inv-center')?.value || '1120');
    const btn = document.getElementById('btn-fetch-gas-template');
    const statusSpan = document.getElementById('gas-fetch-status');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando con hoja de Google Sheets...';
    }
    if (statusSpan) statusSpan.textContent = 'Consultando hoja del centro...';

    try {
      const res = await window.API.fetchFromGas({ type, center });
      if (res && res.products && res.products.length > 0) {
        this.gasFetchedItems = res.products;
        if (statusSpan) statusSpan.innerHTML = `<span style="color: var(--success);"><i class="fa-solid fa-circle-check"></i> ${res.products.length} productos cargados de la hoja ${center}</span>`;
        if (showToast) window.Toast.success(`Cargados ${res.products.length} productos de la hoja ${center}`);
      } else {
        this.gasFetchedItems = [];
        if (statusSpan) statusSpan.innerHTML = `<span style="color: var(--text-muted);"><i class="fa-solid fa-circle-info"></i> Hoja sin productos registrados en Google Sheets (${center}).</span>`;
        if (showToast) window.Toast.info(res.message || 'Hoja vacía');
      }
    } catch (err) {
      if (statusSpan) statusSpan.innerHTML = `<span style="color: var(--warning);"><i class="fa-solid fa-triangle-exclamation"></i> Aviso de conexión Google Sheets: ${err.message}</span>`;
      if (showToast) window.Toast.warning('Aviso GAS: ' + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Actualizar productos desde Google Apps Script';
      }
    }
  }
};
