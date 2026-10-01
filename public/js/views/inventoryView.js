// View: Inventories & Operative Count (Blind Count Mode)
window.InventoryView = {
  currentInventory: null,
  gasFetchedItems: [],

  init() {
    this.setupListeners();
  },

  setupListeners() {
    // Filter changes - status filter (Activos, Revision, Cerrados, Todos)
    document.getElementById('filter-inv-status')?.addEventListener('change', () => {
      this.filterInventoryTable(document.getElementById('search-inventory-list')?.value || '');
    });

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

    // Search input in inventories list view
    const searchInvInput = document.getElementById('search-inventory-list');
    const clearInvBtn = document.getElementById('btn-clear-search-inv');
    searchInvInput?.addEventListener('input', (e) => {
      const term = e.target.value;
      if (clearInvBtn) clearInvBtn.style.display = term ? 'block' : 'none';
      this.filterInventoryTable(term);
    });
    clearInvBtn?.addEventListener('click', () => {
      if (searchInvInput) {
        searchInvInput.value = '';
        searchInvInput.focus();
      }
      clearInvBtn.style.display = 'none';
      this.filterInventoryTable('');
    });

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

    // Purge all inventories button (Admin)
    document.getElementById('btn-purge-all-invs')?.addEventListener('click', () => {
      this.promptPurgeAll();
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
    const searchCountInput = document.getElementById('search-count-items');
    const clearCountBtn = document.getElementById('btn-clear-search-count');

    searchCountInput?.addEventListener('input', (e) => {
      const term = e.target.value;
      if (clearCountBtn) clearCountBtn.style.display = term ? 'block' : 'none';
      this.filterCountTable(term);
    });

    searchCountInput?.addEventListener('keyup', (e) => {
      if (e.key === 'Escape') {
        searchCountInput.value = '';
        if (clearCountBtn) clearCountBtn.style.display = 'none';
        this.filterCountTable('');
      }
    });

    clearCountBtn?.addEventListener('click', () => {
      if (searchCountInput) {
        searchCountInput.value = '';
        searchCountInput.focus();
      }
      clearCountBtn.style.display = 'none';
      this.filterCountTable('');
    });

    // + Nueva Ubicación (Multiple Locations) button
    document.getElementById('btn-add-multiple-location')?.addEventListener('click', () => {
      if (!this.currentInventory) return;
      this.openCountModal(null, true);
    });

    // Modal Count Confirm (Nueva Ubicación / Conteo): Handlers de foto de mal estado
    const modalCountPhotoZone = document.getElementById('modal-count-photo-zone');
    const modalCountPhotoInput = document.getElementById('modal-count-photo-file-input');
    const modalCountPhotoPreviewBox = document.getElementById('modal-count-photo-preview-box');
    const modalCountPhotoPreviewImg = document.getElementById('modal-count-photo-preview-img');
    const modalCountPhotoUrlVal = document.getElementById('modal-count-photo-url-val');
    const modalCountDamagedInput = document.getElementById('modal-input-damaged');
    const modalCountPhotoBadge = document.getElementById('modal-count-photo-badge');

    modalCountDamagedInput?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      if (val > 0) {
        if (modalCountPhotoBadge) {
          modalCountPhotoBadge.textContent = 'Recomendado';
          modalCountPhotoBadge.className = 'badge badge-danger';
        }
        if (modalCountPhotoZone && !modalCountPhotoUrlVal?.value) {
          modalCountPhotoZone.style.borderColor = '#ef4444';
          modalCountPhotoZone.style.background = 'rgba(239, 68, 68, 0.08)';
        }
      } else {
        if (modalCountPhotoBadge) {
          modalCountPhotoBadge.textContent = 'Opcional';
          modalCountPhotoBadge.className = 'badge badge-secondary';
        }
        if (modalCountPhotoZone) {
          modalCountPhotoZone.style.borderColor = '#475569';
          modalCountPhotoZone.style.background = 'rgba(239, 68, 68, 0.04)';
        }
      }
    });

    modalCountPhotoZone?.addEventListener('click', () => modalCountPhotoInput?.click());
    document.getElementById('modal-count-btn-change-photo')?.addEventListener('click', () => modalCountPhotoInput?.click());
    document.getElementById('modal-count-btn-remove-photo')?.addEventListener('click', () => {
      if (modalCountPhotoUrlVal) modalCountPhotoUrlVal.value = '';
      if (modalCountPhotoInput) modalCountPhotoInput.value = '';
      if (modalCountPhotoPreviewBox) modalCountPhotoPreviewBox.style.display = 'none';
      if (modalCountPhotoPreviewImg) modalCountPhotoPreviewImg.src = '';
      if (modalCountPhotoZone) modalCountPhotoZone.style.display = 'block';
    });

    modalCountPhotoInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const uploadInventoryId = this.currentInventory?.id;
      const uploadContextId = document.getElementById('modal-count-item-id')?.value;
      const uploadToken = Symbol('photo');
      this._photoTokens ||= {};
      this._photoTokens['modalCountPhotoInput'] = uploadToken;
      this._photoUploading ||= {};
      this._photoUploading['modalCountPhotoInput'] = uploadToken;

      let itemId = document.getElementById('modal-count-item-id')?.value;
      if (!itemId) {
        const select = document.getElementById('modal-select-item-sku');
        if (select) itemId = select.value;
      }
      const item = this.currentInventory?.items?.find(it => it.id === itemId);
      const sku = item ? item.SKU : (document.getElementById('modal-count-sku')?.textContent || '');
      const invDate = this.currentInventory?.createdAt ? this.currentInventory.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];

      const reader = new FileReader();
      reader.onload = (ev) => {
        if (modalCountPhotoPreviewImg) modalCountPhotoPreviewImg.src = ev.target.result;
        if (modalCountPhotoPreviewBox) modalCountPhotoPreviewBox.style.display = 'block';
        if (modalCountPhotoZone) modalCountPhotoZone.style.display = 'none';
      };
      reader.readAsDataURL(file);

      try {
        window.Toast.info('Subiendo foto de evidencia de mal estado...');
        const res = await window.API.uploadPhoto(file, {
          category: 'malestado',
          photoType: 'malestado',
          sku: sku,
          center: this.currentInventory ? this.currentInventory.center : (window.Auth.currentUser?.center || ''),
          date: invDate,
          type: this.currentInventory ? (this.currentInventory.type || 'CICLICO') : 'CICLICO',
          inventoryId: this.currentInventory ? this.currentInventory.id : '',
          itemId: itemId || ''
        });

        if (this.currentInventory?.id !== uploadInventoryId || document.getElementById('modal-count-item-id')?.value !== uploadContextId || this._photoTokens['modalCountPhotoInput'] !== uploadToken) return;
        if (!res.photo?.driveFileId) throw new Error('Drive no confirmó la foto.');
        if (res.photo && res.photo.url) {
          if (modalCountPhotoUrlVal) modalCountPhotoUrlVal.value = res.photo.url;
          window.Toast.success('Foto de mal estado adjuntada con éxito.');
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al subir foto de evidencia');
      } finally {
        if (this._photoUploading['modalCountPhotoInput'] === uploadToken) delete this._photoUploading['modalCountPhotoInput'];
      }
    });

    // Form submit: Confirm Count (Modal for additional location)
    document.getElementById('form-confirm-count')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this._photoUploading?.modalCountPhotoInput) return window.Toast.warning('Espere a que termine de subir la foto.');
      const inventoryId = this.currentInventory?.id;
      if (!inventoryId) return;
      let itemId = document.getElementById('modal-count-item-id').value;
      const isNewLoc = document.getElementById('modal-count-is-new-loc').value === 'true';
      const newLoc = document.getElementById('modal-input-new-loc').value.trim();
      const qtyVal = document.getElementById('modal-input-qty').value;
      const damagedVal = document.getElementById('modal-input-damaged').value;
      const photoUrl = document.getElementById('modal-count-photo-url-val')?.value || null;

      if (isNewLoc && !itemId) {
        const select = document.getElementById('modal-select-item-sku');
        if (select) itemId = select.value;
      }

      if (isNewLoc && !newLoc) {
        window.Toast.warning('Debe especificar la nueva ubicación física.');
        return;
      }

      const qty = qtyVal !== '' ? Number(qtyVal) : 0;
      const damaged = damagedVal !== '' ? Number(damagedVal) : 0;

      const targetModalItem = itemId && this.currentInventory?.items ? this.currentInventory.items.find(it => it.id === itemId) : null;
      try {
        await window.API.registerCount(inventoryId, {
          itemId: itemId || null,
          sku: targetModalItem?.SKU || undefined,
          stockFisico: qty,
          malEstado: damaged,
          photoUrl: photoUrl || (targetModalItem ? targetModalItem.foto_mal_estado : undefined),
          location: isNewLoc ? newLoc : (targetModalItem ? targetModalItem.Ubicacion : null),
          almacen: targetModalItem?.Almacen || targetModalItem?.almacen || targetModalItem?.warehouse || undefined,
          isNewLocation: isNewLoc
        });

        if (this.currentInventory?.id !== inventoryId) return;
        window.Toast.success(isNewLoc ? `Nueva ubicación '${newLoc}' registrada para este ítem` : 'Conteo registrado correctamente');
        window.ModalHelper.close('modal-count-confirm');
        await this.reloadCurrentInventory();

        if (isNewLoc && itemId) {
          setTimeout(() => {
            const row = document.getElementById(`row-item-${itemId}`) ||
                        document.querySelector(`tr[data-item-id="${itemId}"]`);
            if (row) {
              row.scrollIntoView({ behavior: 'smooth', block: 'center' });
              row.classList.add('new-row-highlight');
              setTimeout(() => row.classList.remove('new-row-highlight'), 3000);
            }
          }, 250);
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al guardar conteo');
      }
    });

    // Damage Photo Upload listeners (modal individual de foto de daño)
    const photoZone = document.getElementById('zone-damage-photo');
    const photoInput = document.getElementById('input-damage-photo-file');
    const previewBox = document.getElementById('damage-photo-preview-box');
    const previewImg = document.getElementById('img-damage-photo-preview');

    photoZone?.addEventListener('click', () => photoInput?.click());

    photoInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const uploadInventoryId = this.currentInventory?.id;
      const uploadContextId = document.getElementById('damage-photo-item-id')?.value;
      const uploadToken = Symbol('photo');
      this._photoTokens ||= {};
      this._photoTokens['photoInput'] = uploadToken;
      this._photoUploading ||= {};
      this._photoUploading['photoInput'] = uploadToken;

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
          type: this.currentInventory ? (this.currentInventory.type || 'CICLICO') : 'CICLICO',
          inventoryId: this.currentInventory ? this.currentInventory.id : '',
          itemId: itemId || ''
        });

        if (this.currentInventory?.id !== uploadInventoryId || document.getElementById('damage-photo-item-id')?.value !== uploadContextId || this._photoTokens['photoInput'] !== uploadToken) return;
        if (!res.photo?.driveFileId) throw new Error('Drive no confirmó la foto.');
        if (res.photo && res.photo.url) {
          document.getElementById('damage-photo-url-val').value = res.photo.url;
          if (previewImg) previewImg.src = res.photo.url;
          if (previewBox) previewBox.style.display = 'block';
          window.Toast.success('Foto lista para guardar en Google Drive');
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al subir foto de evidencia');
      } finally {
        if (this._photoUploading['photoInput'] === uploadToken) delete this._photoUploading['photoInput'];
      }
    });

    document.getElementById('btn-save-damage-photo')?.addEventListener('click', async () => {
      if (this._photoUploading?.photoInput) return window.Toast.warning('Espere a que termine de subir la foto.');
      const inventoryId = this.currentInventory?.id;
      const itemId = document.getElementById('damage-photo-item-id').value;
      const photoUrl = document.getElementById('damage-photo-url-val').value;
      if (!itemId || !this.currentInventory) return;
      if (!photoUrl) return window.Toast.warning('Suba la foto antes de guardar la evidencia.');

      const item = this.currentInventory.items.find(it => it.id === itemId);
      const isReconteoInv = !!(this.currentInventory.isReconteo || this.currentInventory.phase === 'RECONTEO' || String(this.currentInventory.id || '').startsWith('REC-'));
      const qtyInput = document.getElementById(`input-qty-${itemId}`);
      const damagedInput = document.getElementById(`input-damaged-${itemId}`);

      const qty = qtyInput && qtyInput.value !== '' ? Number(qtyInput.value) : (isReconteoInv ? (item?.Reconteo_Fisico ?? item?.Stock_Fisico ?? 0) : (item?.Stock_Fisico ?? 0));
      const damaged = damagedInput && damagedInput.value !== '' ? Number(damagedInput.value) : (isReconteoInv ? (item?.Reconteo_Mal_Estado ?? item?.Mal_estado ?? 0) : (item?.Mal_estado ?? 0));

      try {
        const saved = await window.API.registerCount(inventoryId, {
          itemId,
          sku: item?.SKU,
          location: item?.Ubicacion,
          almacen: item?.Almacen || item?.almacen || item?.warehouse || undefined,
          stockFisico: qty,
          malEstado: damaged,
          photoUrl
        });
        if (this.currentInventory?.id !== inventoryId) return;
        if (item && saved.item) Object.assign(item, saved.item);

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

    // Modal: Agregar Ubicación Adicional - Handlers de Foto de Evidencia
    const addLocPhotoZone = document.getElementById('add-loc-photo-zone');
    const addLocPhotoInput = document.getElementById('add-loc-photo-file-input');
    const addLocPhotoPreviewBox = document.getElementById('add-loc-photo-preview-box');
    const addLocPhotoPreviewImg = document.getElementById('add-loc-photo-preview-img');
    const addLocPhotoUrlVal = document.getElementById('add-loc-photo-url-val');
    const addLocDamagedInput = document.getElementById('add-loc-input-damaged');
    const addLocPhotoBadge = document.getElementById('add-loc-photo-badge');

    addLocDamagedInput?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      if (val > 0) {
        if (addLocPhotoBadge) {
          addLocPhotoBadge.textContent = 'Recomendado';
          addLocPhotoBadge.className = 'badge badge-danger';
        }
        if (addLocPhotoZone && !addLocPhotoUrlVal?.value) {
          addLocPhotoZone.style.borderColor = '#ef4444';
          addLocPhotoZone.style.background = 'rgba(239, 68, 68, 0.08)';
        }
      } else {
        if (addLocPhotoBadge) {
          addLocPhotoBadge.textContent = 'Opcional';
          addLocPhotoBadge.className = 'badge badge-secondary';
        }
        if (addLocPhotoZone) {
          addLocPhotoZone.style.borderColor = '#475569';
          addLocPhotoZone.style.background = 'rgba(239, 68, 68, 0.04)';
        }
      }
    });

    addLocPhotoZone?.addEventListener('click', () => addLocPhotoInput?.click());
    document.getElementById('add-loc-btn-change-photo')?.addEventListener('click', () => addLocPhotoInput?.click());

    document.getElementById('add-loc-btn-remove-photo')?.addEventListener('click', () => {
      if (addLocPhotoUrlVal) addLocPhotoUrlVal.value = '';
      if (addLocPhotoInput) addLocPhotoInput.value = '';
      if (addLocPhotoPreviewBox) addLocPhotoPreviewBox.style.display = 'none';
      if (addLocPhotoPreviewImg) addLocPhotoPreviewImg.src = '';
      if (addLocPhotoZone) addLocPhotoZone.style.display = 'block';
    });

    addLocPhotoInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const uploadInventoryId = this.currentInventory?.id;
      const uploadContextId = document.getElementById('add-loc-item-id')?.value;
      const uploadToken = Symbol('photo');
      this._photoTokens ||= {};
      this._photoTokens['addLocPhotoInput'] = uploadToken;
      this._photoUploading ||= {};
      this._photoUploading['addLocPhotoInput'] = uploadToken;

      const itemId = document.getElementById('add-loc-item-id')?.value;
      const currentItem = (this.currentInventory?.items || []).find(it => it.id === itemId);
      const sku = currentItem ? currentItem.SKU : '';
      const invDate = this.currentInventory?.createdAt ? this.currentInventory.createdAt.split('T')[0] : new Date().toISOString().split('T')[0];

      // Vista previa local inmediata
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (addLocPhotoPreviewImg) addLocPhotoPreviewImg.src = ev.target.result;
        if (addLocPhotoPreviewBox) addLocPhotoPreviewBox.style.display = 'block';
        if (addLocPhotoZone) addLocPhotoZone.style.display = 'none';
      };
      reader.readAsDataURL(file);

      try {
        window.Toast.info('Subiendo foto de evidencia de mal estado a Google Drive...');
        const res = await window.API.uploadPhoto(file, {
          category: 'malestado',
          photoType: 'malestado',
          sku: sku,
          center: this.currentInventory ? this.currentInventory.center : (window.Auth.currentUser?.center || ''),
          date: invDate,
          type: this.currentInventory ? (this.currentInventory.type || 'CICLICO') : 'CICLICO',
          inventoryId: this.currentInventory ? this.currentInventory.id : '',
          itemId: itemId || ''
        });

        if (this.currentInventory?.id !== uploadInventoryId || document.getElementById('add-loc-item-id')?.value !== uploadContextId || this._photoTokens['addLocPhotoInput'] !== uploadToken) return;
        if (!res.photo?.driveFileId) throw new Error('Drive no confirmó la foto.');
        if (res.photo && res.photo.url) {
          if (addLocPhotoUrlVal) addLocPhotoUrlVal.value = res.photo.url;
          window.Toast.success('Foto de mal estado adjuntada con éxito.');
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al subir foto de evidencia');
      } finally {
        if (this._photoUploading['addLocPhotoInput'] === uploadToken) delete this._photoUploading['addLocPhotoInput'];
      }
    });

    // Form: Agregar Ubicación Adicional Manual
    document.getElementById('form-add-location')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.currentInventory) return;

      const itemId = document.getElementById('add-loc-item-id')?.value;
      const locInput = document.getElementById('add-loc-input-location');
      const newLoc = locInput ? locInput.value.trim().toUpperCase() : '';

      if (!newLoc) {
        window.Toast.warning('Debe especificar la nueva ubicación física adicional.');
        if (locInput) locInput.focus();
        return;
      }

      const currentItem = (this.currentInventory.items || []).find(it => it.id === itemId);
      const sku = currentItem ? currentItem.SKU : '';

      const submitBtn = document.getElementById('btn-submit-add-location');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
      }

      try {
        await window.API.registerCount(this.currentInventory.id, {
          itemId,
          sku,
          location: newLoc,
          almacen: currentItem?.Almacen || currentItem?.almacen || currentItem?.warehouse || undefined,
          isNewLocation: true
        });

        window.Toast.success(`✅ Ubicación adicional '${newLoc}' agregada para ${sku}.`);
        if (window.ModalHelper) {
          window.ModalHelper.close('modal-add-location');
        }

        await this.reloadCurrentInventory();

        setTimeout(() => {
          const targetRow = document.getElementById(`row-item-${itemId}`) || document.querySelector(`tr[data-sku="${sku}"]`);
          if (targetRow) {
            targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            targetRow.classList.add('new-row-highlight');
            setTimeout(() => targetRow.classList.remove('new-row-highlight'), 3000);
          }
        }, 250);
      } catch (err) {
        window.Toast.danger(err.message || 'Error al agregar ubicación adicional');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Guardar Ubicación Adicional';
        }
      }
    });

    // Submit Inventory for Review & Signature (Firmar y Terminar Conteo)
    document.getElementById('btn-submit-inv-review')?.addEventListener('click', async () => {
      if (!this.currentInventory) return;

      const isClosedOrSigned = this.currentInventory.status !== 'EN_PROGRESO' ||
        this.currentInventory.isHistory ||
        this.currentInventory.status === 'FIRMADO' ||
        this.currentInventory.status === 'PENDIENTE_JUSTIFICACION' ||
        this.currentInventory.status === 'REVISADO' ||
        this.currentInventory.status === 'CERRADO';

      if (isClosedOrSigned) {
        window.Toast.info('Este inventario ya ha sido firmado y finalizado.');
        return;
      }

      const isReconteo = !!(this.currentInventory.isReconteo || this.currentInventory.phase === 'RECONTEO' || String(this.currentInventory.id || '').startsWith('REC-'));
      const uncounted = (this.currentInventory.items || []).filter(it => {
        if (isReconteo) {
          const hasRec = it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined;
          const hasPhys = it.Stock_Fisico !== null && it.Stock_Fisico !== undefined;
          return !hasRec && !hasPhys;
        }
        return it.Stock_Fisico === null || it.Stock_Fisico === undefined;
      });
      if (uncounted.length > 0) {
        window.Toast.warning(`Aún quedan ${uncounted.length} ítems pendientes de ${isReconteo ? 'reconteo' : 'conteo'}. Complete todos los ítems al 100% antes de finalizar.`);
        alert(`⚠️ Inventario Incompleto\n\nAún quedan ${uncounted.length} ítems pendientes de ${isReconteo ? 'reconteo' : 'conteo'}.\n\nPor regla de auditoría y control, el inventario debe completarse al 100% antes de poder ser firmado y finalizado.`);
        return;
      }

      const userRole = window.Auth.currentUser?.role || 'AUXILIAR';
      const roleLabel = userRole === 'ENCARGADO' ? 'como Encargado' : (userRole === 'ADMIN' ? 'como Administrador' : '');
      if (!confirm(`¿Está seguro de firmar y finalizar este ${isReconteo ? 'reconteo' : 'inventario'}${roleLabel ? ' ' + roleLabel : ''}?\n\nAl confirmar, el ${isReconteo ? 'reconteo' : 'inventario'} quedará cerrado y pasará a revisión final.`)) {
        return;
      }

      const btn = document.getElementById('btn-submit-inv-review');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finalizando y firmando...';
      }

      try {
        const signerName = window.Auth.currentUser?.displayName || window.Auth.currentUser?.username || 'Usuario';
        const rolePrefix = userRole === 'ENCARGADO' ? 'Encargado: ' : (userRole === 'ADMIN' ? 'Administrador: ' : 'Auxiliar: ');
        const submittedId = this.currentInventory.id;
        await window.API.submitInventory(submittedId, {
          signature: `Firmado digitalmente por ${rolePrefix}${signerName} (${new Date().toLocaleString()})`
        });

        if (this.currentInventory?.id !== submittedId) return;
        this.currentInventory.status = isReconteo ? 'RECONTEO_COMPLETADO' : 'PENDIENTE_JUSTIFICACION';
        this.updateSubmitButtonState();

        window.Toast.success(isReconteo ? '¡Reconteo finalizado y firmado con éxito!' : '¡Inventario finalizado y firmado con éxito!');
        alert(isReconteo ? '✅ Reconteo Finalizado y Firmado\n\nEl reconteo ha sido completado y habilitado para justificación final.' : '✅ Conteo Finalizado y Firmado\n\nEl inventario ha sido completado al 100%, firmado y enviado a revisión de justificaciones.');

        try {
          localStorage.removeItem('nibol_active_inv_id');
          localStorage.removeItem(`nibol_inv_detail_${submittedId}`);
        } catch (e) {}

        this.currentInventory = null;
        document.getElementById('view-count')?.classList.remove('active');
        document.getElementById('view-inventories')?.classList.add('active');
        await this.loadInventories();
      } catch (err) {
        window.Toast.danger(err.message || 'Error al enviar inventario');
        this.updateSubmitButtonState();
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
    const type = (window.Auth.currentUser?.role === 'AUXILIAR') ? 'TODOS' : (document.getElementById('filter-inv-type')?.value || 'TODOS');
    const center = document.getElementById('filter-inv-center')?.value || 'TODOS';

    const tbody = document.getElementById('tbody-inventories');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando inventarios...</td></tr>';

    try {
      const res = await window.API.getInventories({ type, center });
      let list = res.inventories || [];

      const cacheKey = 'nibol_cached_inventories';
      if (list.length > 0) {
        // Filter out any obsolete test stubs that might linger
        list = list.filter(inv => {
          const idU = String(inv.id || '').toUpperCase();
          return !idU.includes('WARNES') && !idU.includes('MTOG');
        });
        try { localStorage.setItem(cacheKey, JSON.stringify(list)); } catch (e) {}
      } else {
        // If server returned empty, clear the client cache completely so deleted items stay deleted
        try { localStorage.removeItem(cacheKey); } catch (e) {}
      }

      // If user is AUXILIAR, verify assignment and strictly exclude inventories already completed/sent to justification
      if (window.Auth.currentUser?.role === 'AUXILIAR') {
        const u = String(window.Auth.currentUser.username || '').toLowerCase().trim();
        const c = String(window.Auth.currentUser.clave || '').toLowerCase().trim();
        const d = String(window.Auth.currentUser.displayName || '').toLowerCase().trim();

        list = list.filter(inv => {
          // Si el conteo terminó y fue enviado a justificación o cerrado, ya no lo puede ver el auxiliar
          if (inv.status !== 'EN_PROGRESO') {
            return false;
          }

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
          <tr data-inv-id="${inv.id}" data-inv-status="${inv.status || ''}" data-inv-type="${inv.type || ''}" data-inv-center="${inv.center || ''}">
            <td><strong style="color: var(--primary); font-family: var(--font-mono);">${inv.id}</strong></td>
            <td><strong>${inv.name}</strong></td>
            <td class="role-encargado-admin col-inv-type"><span class="badge badge-neutral">${inv.type}</span></td>
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
                  ${inv.status === 'EN_PROGRESO' ? `
                    <button class="btn ${percent >= 100 ? 'btn-success' : 'btn-secondary'} btn-sm" onclick="window.InventoryView.promptFinalizeByEncargado('${inv.id}', ${inv.countedItems}, ${inv.totalItems})" title="${percent >= 100 ? 'Finalizar conteo y firmar como Encargado' : `Conteo al ${percent}%. Se requiere 100% para poder finalizar.`}">
                      <i class="fa-solid fa-signature"></i> Finalizar
                    </button>
                  ` : ''}
                  <button class="btn btn-secondary btn-sm" onclick="window.InventoryView.syncInventoryFromSheetRow('${inv.id}', this)" title="Sincronizar conteos desde Google Sheets" style="color: #38bdf8; border-color: rgba(56, 189, 248, 0.4);">
                    <i class="fa-solid fa-rotate"></i>
                  </button>
                  <button class="btn btn-secondary btn-sm" onclick="window.InventoryView.promptAssign('${inv.id}', '${safeName}', '${inv.center}')" title="Asignar tareas a Auxiliar de este centro">
                    <i class="fa-solid fa-user-tag"></i> Asignar
                  </button>
                  <button class="btn btn-danger btn-sm" onclick="window.InventoryView.promptDelete('${inv.id}', ${inv.countedItems || 0})" title="Eliminar inventario/tarea">
                    <i class="fa-solid fa-trash"></i>
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');
      window.Auth?.updateUI();
      this.filterInventoryTable(document.getElementById('search-inventory-list')?.value || '');
    } catch (err) {
      console.warn('[InventoryView] Error loading inventories:', err);
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Error al cargar inventarios: ${err.message}</td></tr>`;
    }
  },

  async promptFinalizeByEncargado(invId, countedItems, totalItems) {
    if (!invId) return;

    if (!totalItems || totalItems === 0 || countedItems < totalItems) {
      const remaining = Math.max(0, (totalItems || 0) - (countedItems || 0));
      window.Toast.warning(`Aún quedan ${remaining} ítems pendientes de conteo (${countedItems || 0}/${totalItems || 0} contados). El inventario debe completarse al 100% para poder finalizar.`);
      alert(`⚠️ Inventario Incompleto (${countedItems || 0}/${totalItems || 0})\n\nAún quedan ${remaining} ítems sin contar.\n\nPor regla de control y auditoría, el inventario debe estar completado al 100% para poder ser firmado y finalizado.`);
      return;
    }

    const roleName = window.Auth.currentUser?.role === 'ENCARGADO' ? 'Encargado' : (window.Auth.currentUser?.role === 'ADMIN' ? 'Administrador' : 'Usuario');
    const signerName = window.Auth.currentUser?.displayName || window.Auth.currentUser?.username || roleName;

    if (!confirm(`¿Está seguro de firmar y finalizar este inventario como ${roleName}?\n\nConteo completado al 100% (${countedItems}/${totalItems} ítems contados).\nAl confirmar, el inventario quedará cerrado y pasará a revisión de justificaciones.`)) {
      return;
    }

    try {
      window.Toast.info('Finalizando y firmando inventario...');
      const signature = `Firmado digitalmente por ${roleName}: ${signerName} (${new Date().toLocaleString()})`;
      await window.API.submitInventory(invId, { signature });

      window.Toast.success('¡Inventario finalizado y firmado con éxito por el Encargado!');
      alert(`✅ Conteo Finalizado y Firmado\n\nEl inventario fue verificado al 100%, firmado por ${roleName} (${signerName}) y enviado a la bandeja de Justificaciones.`);

      await this.loadInventories();
    } catch (err) {
      window.Toast.danger(err.message || 'Error al finalizar inventario');
    }
  },

  async openInventory(id) {
    const opening = this._opening = Symbol(id);
    try {
      try {
        localStorage.setItem('nibol_active_inv_id', id);
        localStorage.setItem('nibol_active_view', 'count');
      } catch (e) {}

      let inv = null;
      try {
        const res = await window.API.getInventoryById(id);
        inv = res.inventory;
        try { localStorage.setItem(window.CountQueue.cacheKey(id), JSON.stringify(inv)); } catch (e) {}
      } catch (netErr) {
        if (netErr.status && netErr.status < 500) throw netErr;
        const cachedRaw = localStorage.getItem(window.CountQueue.cacheKey(id));
        if (cachedRaw) {
          inv = JSON.parse(cachedRaw);
          window.Toast.warning('Sin conexión: copia local del último avance confirmado. Los envíos pendientes se muestran por separado.');
        } else {
          throw netErr;
        }
      }

      if (this._opening !== opening) return;
      this.currentInventory = inv;

      // Un auxiliar no puede abrir un inventario que ya fue enviado a justificación
      if (window.Auth.currentUser?.role === 'AUXILIAR' && inv && inv.status !== 'EN_PROGRESO') {
        window.Toast.warning('Este inventario ya ha sido completado y enviado a justificación. Ya no está disponible en su bandeja.');
        return;
      }

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

      const recountBanner = document.getElementById('count-recount-banner');
      if (recountBanner) {
        const isReconteo = !!(this.currentInventory.isReconteo || this.currentInventory.phase === 'RECONTEO' || String(this.currentInventory.id).startsWith('REC-'));
        recountBanner.style.display = isReconteo ? 'inline-flex' : 'none';
      }

      this.renderCountTable();
      this.updateSubmitButtonState();
    } catch (err) {
      window.Toast.danger(err.message || 'No se pudo abrir el inventario');
    }
  },

  async reloadCurrentInventory() {
    if (!this.currentInventory) return;
    const id = this.currentInventory.id;
    try {
      const res = await window.API.getInventoryById(id);
      if (this.currentInventory?.id !== id) return;
      this.currentInventory = res.inventory;
      try { localStorage.setItem(window.CountQueue.cacheKey(id), JSON.stringify(res.inventory)); } catch (e) {}
    } catch (e) {
      // Keep memory copy
    }
    this.renderCountTable();
    this.updateSubmitButtonState();
  },

  updateSubmitButtonState() {
    const btn = document.getElementById('btn-submit-inv-review');
    if (!btn || !this.currentInventory) return;

    const isReconteo = !!(this.currentInventory.isReconteo || this.currentInventory.phase === 'RECONTEO' || String(this.currentInventory.id || '').startsWith('REC-'));
    const isClosedOrSigned = this.currentInventory.status !== 'EN_PROGRESO' ||
      this.currentInventory.isHistory ||
      this.currentInventory.status === 'FIRMADO' ||
      this.currentInventory.status === 'PENDIENTE_JUSTIFICACION' ||
      this.currentInventory.status === 'RECONTEO_COMPLETADO' ||
      this.currentInventory.status === 'REVISADO' ||
      this.currentInventory.status === 'CERRADO';

    if (isClosedOrSigned) {
      btn.className = 'btn btn-finalized';
      btn.innerHTML = `<i class="fa-solid fa-lock"></i> ${isReconteo ? 'Reconteo Finalizado y Firmado' : 'Conteo Finalizado y Firmado'}`;
      btn.title = isReconteo ? 'Este reconteo ya ha sido finalizado y firmado' : 'Este inventario ya ha sido finalizado y firmado';
    } else {
      btn.className = 'btn btn-success';
      btn.innerHTML = `<i class="fa-solid fa-signature"></i> ${isReconteo ? 'Finalizar Reconteo y Firmar' : 'Finalizar Conteo y Firmar'}`;
      btn.title = isReconteo ? 'Finalizar reconteo y firmar digitalmente' : 'Finalizar conteo y firmar digitalmente';
    }
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

    // Mobile-First count cards with high-contrast warehouse layout
    thead.innerHTML = '';

    if (!this.currentInventory.items || this.currentInventory.items.length === 0) {
      tbody.innerHTML = `
        <tr class="mobile-count-card">
          <td class="mobile-count-td" style="text-align: center; padding: 3rem 1.5rem; color: #94a3b8;">
            <div style="font-size: 2.5rem; margin-bottom: 0.75rem; color: #f59e0b;"><i class="fa-solid fa-clipboard-question"></i></div>
            <h4 style="color: #ffffff; margin-bottom: 0.5rem; font-size: 1.15rem;">No hay ítems asignados para este conteo</h4>
            <p style="font-size: 0.9rem; max-width: 480px; margin: 0 auto 1.25rem auto; line-height: 1.5; color: #cbd5e1;">
              Si el encargado acaba de asignar este inventario, presione actualizar para sincronizar los ítems asignados a su usuario.
            </p>
            <button type="button" class="btn btn-primary btn-sm" onclick="window.InventoryView.reloadCurrentInventory()" style="display: inline-flex; align-items: center; gap: 0.5rem; height: 42px; font-weight: 700; border-radius: 6px;">
              <i class="fa-solid fa-arrows-rotate"></i> Actualizar ítems
            </button>
          </td>
        </tr>
      `;
      this.updateCountSummaryBar();
      return;
    }

    // Ensure items of the same SKU stay strictly together in the same block
    const organizedItems = this.getOrganizedItems(this.currentInventory.items);
    this.currentInventory.items = organizedItems;

    const isReconteoInv = !!(this.currentInventory.isReconteo || this.currentInventory.phase === 'RECONTEO' || String(this.currentInventory.id || '').startsWith('REC-'));

    tbody.innerHTML = organizedItems.map(item => {
      const isCounted = isReconteoInv
        ? ((item.Reconteo_Fisico !== null && item.Reconteo_Fisico !== undefined) || (item.Stock_Fisico !== null && item.Stock_Fisico !== undefined))
        : (item.Stock_Fisico !== null && item.Stock_Fisico !== undefined);
      const isLocked = item.locked === true || (item.locked !== false && isCounted);
      const rowClass = isCounted ? 'counted-row' : '';
      const countedQty = isReconteoInv && item.Reconteo_Fisico !== null && item.Reconteo_Fisico !== undefined
        ? item.Reconteo_Fisico
        : (item.Stock_Buen_Estado !== null && item.Stock_Buen_Estado !== undefined ? item.Stock_Buen_Estado : (item.Stock_Fisico !== null && item.Stock_Fisico !== undefined ? item.Stock_Fisico : 0));
      const damagedQty = isReconteoInv && item.Reconteo_Mal_Estado !== null && item.Reconteo_Mal_Estado !== undefined
        ? item.Reconteo_Mal_Estado
        : (item.Mal_estado || 0);
      const totalCount = (parseInt(isCounted ? countedQty : 0, 10) || 0) + (parseInt(damagedQty || 0, 10) || 0);
      const hasDamaged = damagedQty > 0;
      const hasPhoto = !!item.foto_mal_estado;
      const isAdditional = (item.isAdditionalLocation === true) || String(item.id).startsWith('ITEM-NEW-LOC');
      const hasNoLocation = this.isInvalidOrMissingLocation(item.Ubicacion);
      const isDuplicateSku = (this.currentInventory.items || []).filter(it => it.SKU && it.SKU === item.SKU).length > 1;
      const canDelete = isAdditional || isDuplicateSku;

      const mainRowHtml = `
        <tr class="mobile-count-card ${rowClass} ${isAdditional ? 'additional-location-row' : ''} ${hasNoLocation ? 'no-location-alert-row' : ''}" data-item-id="${item.id}" data-sku="${item.SKU}" data-is-additional="${isAdditional}" data-status="${isCounted ? 'counted' : 'pending'}" id="row-item-${item.id}">
          <td class="mobile-count-td">
            <div class="warehouse-count-card" style="padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;">
              <!-- ROW 1: PHYSICAL LOCATION & ABC CLASSIFICATION -->
              <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div style="display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                  <!-- UBICACIÓN PRINCIPAL (COLUMNA D) -->
                  ${hasNoLocation ? `
                    <span style="display: inline-flex; align-items: center; gap: 7px; background: #dc2626; color: #ffffff; padding: 6px 14px; border-radius: 6px; font-weight: 900; font-size: 1.02rem; letter-spacing: 0.5px; border: 2px solid #f87171; box-shadow: 0 0 14px rgba(220, 38, 38, 0.7);">
                      <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.15rem; color: #fecaca; animation: pulse 1.5s infinite;"></i>
                      <span>${item.Ubicacion && item.Ubicacion.trim() ? `UBIC. INCORRECTA: ${item.Ubicacion}` : '⚠️ SIN UBICACIÓN'}</span>
                    </span>
                  ` : `
                    <span style="display: inline-flex; align-items: center; gap: 6px; background: #0284c7; color: #ffffff; padding: 6px 14px; border-radius: 6px; font-weight: 800; font-size: 1.05rem; letter-spacing: 0.5px; border: 1.5px solid #38bdf8; box-shadow: 0 2px 8px rgba(2, 132, 199, 0.4);">
                      <i class="fa-solid fa-location-dot" style="font-size: 1.15rem; color: #bae6fd;"></i>
                      <span>${item.Ubicacion}</span>
                    </span>
                  `}

                  <!-- UBICACIÓN ADICIONAL 1 (COLUMNA E) -->
                  ${item.Ubicacion_1 ? `
                    <span style="display: inline-flex; align-items: center; gap: 5px; background: #0f172a; color: #38bdf8; padding: 5px 10px; border-radius: 6px; font-weight: 800; font-size: 0.88rem; border: 1.5px solid #0284c7; box-shadow: 0 1px 4px rgba(0,0,0,0.3);">
                      <i class="fa-solid fa-layer-group" style="font-size: 0.8rem; color: #38bdf8;"></i>
                      <span>Ubic. 1: <strong>${item.Ubicacion_1}</strong></span>
                      <button
                        type="button"
                        class="btn-delete-extra-loc"
                        onclick="window.InventoryView.deleteAdditionalLocation('${item.id}', '${item.SKU}', '${item.Ubicacion_1}')"
                        title="Eliminar Ubicación 1"
                        style="background: none; border: none; color: #f87171; cursor: pointer; padding: 0 2px; margin-left: 3px; font-size: 0.85rem;"
                      >
                        <i class="fa-solid fa-xmark"></i>
                      </button>
                    </span>
                  ` : ''}

                  <!-- UBICACIÓN ADICIONAL 2 (COLUMNA F) -->
                  ${item.Ubicacion_2 ? `
                    <span style="display: inline-flex; align-items: center; gap: 5px; background: #0f172a; color: #a78bfa; padding: 5px 10px; border-radius: 6px; font-weight: 800; font-size: 0.88rem; border: 1.5px solid #8b5cf6; box-shadow: 0 1px 4px rgba(0,0,0,0.3);">
                      <i class="fa-solid fa-layer-group" style="font-size: 0.8rem; color: #a78bfa;"></i>
                      <span>Ubic. 2: <strong>${item.Ubicacion_2}</strong></span>
                      <button
                        type="button"
                        class="btn-delete-extra-loc"
                        onclick="window.InventoryView.deleteAdditionalLocation('${item.id}', '${item.SKU}', '${item.Ubicacion_2}')"
                        title="Eliminar Ubicación 2"
                        style="background: none; border: none; color: #f87171; cursor: pointer; padding: 0 2px; margin-left: 3px; font-size: 0.85rem;"
                      >
                        <i class="fa-solid fa-xmark"></i>
                      </button>
                    </span>
                  ` : ''}

                  <!-- BOTÓN + PARA AGREGAR UBICACIÓN ADICIONAL (HASTA 2) -->
                  ${(!item.Ubicacion_1 || !item.Ubicacion_2) ? `
                    <button
                      type="button"
                      class="btn btn-secondary btn-xs btn-add-loc-plus"
                      onclick="window.InventoryView.openAddLocationModal('${item.id}')"
                      title="Agregar ubicación adicional a este SKU (máx. 2)"
                      style="width: 32px; height: 32px; min-width: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; background: #1e293b; color: #38bdf8; border: 1.5px solid #0284c7; font-size: 0.95rem; font-weight: 900; cursor: pointer;"
                    >
                      <i class="fa-solid fa-plus"></i>
                    </button>
                  ` : `
                    <span class="badge badge-neutral" style="font-size: 0.72rem; padding: 3px 6px; color: #94a3b8; border: 1px solid #334155;" title="Límite máximo de 2 ubicaciones adicionales alcanzado">
                      2/2 Ubic. Extra
                    </span>
                  `}
                </div>

                <div style="display: inline-flex; align-items: center; gap: 6px;">
                  <span style="background: #1e293b; color: #f8fafc; font-size: 0.8rem; font-weight: 800; padding: 5px 10px; border-radius: 6px; border: 1.5px solid #475569; font-family: var(--font-mono); display: inline-flex; align-items: center; gap: 4px;">
                    ABC: <strong style="color: ${item.Clasificacion_ABC === 'A' ? '#38bdf8' : (item.Clasificacion_ABC === 'B' ? '#fbbf24' : '#94a3b8')};">${item.Clasificacion_ABC || 'C'}</strong>
                  </span>
                  ${(item.Almacen || item.Almacén) ? `
                    <span style="background: #1e293b; color: #f8fafc; font-size: 0.8rem; font-weight: 800; padding: 5px 10px; border-radius: 6px; border: 1.5px solid #475569; font-family: var(--font-mono); display: inline-flex; align-items: center;">
                      ${item.Almacen || item.Almacén}
                    </span>
                  ` : ''}

                  ${canDelete ? `
                    <button
                      type="button"
                      class="btn btn-danger btn-xs btn-delete-location"
                      data-item-id="${item.id}"
                      data-sku="${item.SKU}"
                      data-location="${item.Ubicacion || ''}"
                      onclick="window.InventoryView.promptDeleteAdditionalLocation(this)"
                      title="Eliminar esta fila o ubicación"
                      style="padding: 6px 11px; font-size: 0.78rem; font-weight: 800; border-radius: 6px; background: rgba(239, 68, 68, 0.25); border: 1.5px solid #ef4444; color: #fecaca; cursor: pointer; min-height: 34px; display: inline-flex; align-items: center; gap: 5px;"
                    >
                      <i class="fa-solid fa-trash-can"></i> <span>Eliminar</span>
                    </button>
                  ` : ''}
                </div>
              </div>

              <!-- ROW 2: SKU & BARCODE (HIGH CONTRAST MONOSPACE) -->
              <div style="display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;">
                <div style="font-size: 1.25rem; font-weight: 900; font-family: var(--font-mono); color: #38bdf8; letter-spacing: 0.5px;">
                  ${item.SKU}
                </div>
                ${item.Codigo_Barras ? `
                  <div style="font-size: 0.85rem; font-weight: 600; font-family: var(--font-mono); color: #e2e8f0; background: rgba(255,255,255,0.06); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); display: inline-flex; align-items: center; gap: 5px;">
                    <i class="fa-solid fa-barcode"></i> ${item.Codigo_Barras}
                  </div>
                ` : ''}
              </div>

              <!-- ROW 3: FULL PRODUCT DESCRIPTION (CRISP WHITE, NO HORIZONTAL SQUEEZING) -->
              <div style="font-size: 0.98rem; font-weight: 600; color: #ffffff; line-height: 1.45; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">
                ${item.Descripcion || 'Sin descripción'}
              </div>

              <!-- ROW 4: OPERATIVE TOUCH COUNTING STATION -->
              <div style="background: rgba(15, 23, 42, 0.75); border: 1.5px solid #334155; border-radius: 8px; padding: 10px 12px; margin-top: 2px;">
                <div style="display: grid; grid-template-columns: 1.1fr 1fr; gap: 12px; align-items: end;">
                  <!-- BUEN ESTADO MANUAL -->
                  <div>
                    <label style="display: block; font-size: 0.75rem; font-weight: 800; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">
                      <i class="fa-solid fa-circle-check" style="color: #10b981;"></i> Buen Estado *
                    </label>
                    <input
                      type="number"
                      min="0"
                      id="input-qty-${item.id}"
                      class="form-input input-inline-count"
                      style="height: 46px; font-size: 1.35rem; font-weight: 900; text-align: center; font-family: var(--font-mono); color: #ffffff; background: #090e1a; border: 2px solid ${isCounted ? '#10b981' : '#475569'}; border-radius: 6px; width: 100%; ${isLocked ? 'background: rgba(16,185,129,0.08); cursor: pointer; opacity: 0.95;' : ''}"
                      placeholder="0"
                      value="${!isLocked && window.CountQueue.draft(this.currentInventory.id, item.id) ? Number(window.CountQueue.draft(this.currentInventory.id, item.id).stockFisico) : (isCounted ? countedQty : '')}"
                      ${isLocked ? 'disabled' : ''}
                      oninput="window.InventoryView.handleInlineCountChange('${item.id}')"
                      onchange="window.InventoryView.handleInlineCountChange('${item.id}'); window.InventoryView.updateItemTotalBadge('${item.id}');"
                      onkeydown="if(event.key==='Enter'){event.preventDefault(); window.InventoryView.confirmAndLockItem('${item.id}');}"
                    />
                  </div>

                  <!-- MAL ESTADO (Avería) MANUAL + BOTÓN FOTO -->
                  <div>
                    <label style="display: block; font-size: 0.75rem; font-weight: 800; color: #fca5a5; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">
                      <i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i> Mal Estado
                    </label>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <input
                        type="number"
                        min="0"
                        id="input-damaged-${item.id}"
                        class="form-input input-inline-damaged"
                        style="height: 46px; width: 100%; min-width: 50px; font-size: 1.25rem; font-weight: 800; text-align: center; font-family: var(--font-mono); color: #f87171; background: #090e1a; border: 2px solid ${hasDamaged ? '#ef4444' : '#475569'}; border-radius: 6px; ${isLocked ? 'cursor: not-allowed; opacity: 0.85;' : ''}"
                        placeholder="0"
                        value="${!isLocked && window.CountQueue.draft(this.currentInventory.id, item.id) ? Number(window.CountQueue.draft(this.currentInventory.id, item.id).malEstado) : damagedQty}"
                        ${isLocked ? 'disabled' : ''}
                        oninput="window.InventoryView.handleDamagedInput('${item.id}', this.value); window.InventoryView.updateItemTotalBadge('${item.id}');"
                        onchange="window.InventoryView.handleInlineCountChange('${item.id}'); window.InventoryView.updateItemTotalBadge('${item.id}');"
                        onkeydown="if(event.key==='Enter'){event.preventDefault(); window.InventoryView.confirmAndLockItem('${item.id}');}"
                      />
                      <button
                        type="button"
                        id="btn-photo-${item.id}"
                        class="btn ${hasDamaged ? (hasPhoto ? 'btn-success' : 'btn-warning') : 'btn-secondary'} btn-sm"
                        onclick="window.InventoryView.openDamagePhotoModal('${item.id}')"
                        title="${hasPhoto ? 'Ver foto de evidencia' : 'Tomar / subir foto de daño'}"
                        style="height: 46px; min-width: 48px; padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; border-radius: 6px; cursor: pointer; white-space: nowrap; ${hasDamaged ? '' : 'opacity: 0.85;'}"
                      >
                        <i class="fa-solid ${hasPhoto ? 'fa-image' : 'fa-camera'}"></i>
                        <span style="font-size: 0.75rem; font-weight: 700;">Foto</span>
                      </button>
                    </div>
                  </div>
                </div>

                <!-- VISUALIZACIÓN COMPACTA TOTAL (No ocupa mucho espacio) -->
                <div style="margin-top: 8px; padding: 4px 10px; background: rgba(2, 6, 23, 0.85); border: 1px solid #334155; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; font-size: 0.78rem;">
                  <span style="color: #94a3b8; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-calculator" style="color: #38bdf8;"></i> Total Conteo:
                  </span>
                  <span id="badge-total-${item.id}" style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 900; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.35); padding: 1px 8px; border-radius: 4px;">
                    ${totalCount}
                  </span>
                </div>
              </div>

              <!-- ROW 5: PRIMARY ACTION BUTTONS (HIGH CONTRAST, FULL WIDTH TOUCH TARGETS) -->
              <div style="margin-top: 4px;">
                ${isLocked ? `
                  <div style="display: flex; gap: 8px; align-items: center; width: 100%;">
                    <button
                      type="button"
                      id="btn-count-lock-${item.id}"
                      class="btn btn-success"
                      onclick="window.InventoryView.promptUnlockItem('${item.id}')"
                      title="Ítem contado y bloqueado. Clic para habilitar reconteo"
                      style="flex: 1; height: 48px; font-size: 1rem; font-weight: 800; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; background: #059669; border: 1.5px solid #34d399; color: #ffffff; cursor: pointer; box-shadow: 0 2px 10px rgba(5, 150, 105, 0.35);"
                    >
                      <i class="fa-solid fa-circle-check" style="font-size: 1.15rem;"></i>
                      <span>${isReconteoInv ? 'RECONTADO' : 'CONTADO'} (${countedQty})</span>
                    </button>
                    <button
                      type="button"
                      id="btn-recount-${item.id}"
                      class="btn btn-warning"
                      onclick="window.InventoryView.promptUnlockItem('${item.id}')"
                      title="Habilitar reconteo para este ítem"
                      style="height: 48px; min-width: 110px; font-size: 0.92rem; font-weight: 800; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 6px; background: #d97706; border: 1.5px solid #fbbf24; color: #ffffff; cursor: pointer; box-shadow: 0 2px 10px rgba(217, 119, 6, 0.35);"
                    >
                      <i class="fa-solid fa-rotate-right"></i>
                      <span>Reconteo</span>
                    </button>
                  </div>
                ` : `
                  <button
                    type="button"
                    id="btn-count-lock-${item.id}"
                    class="btn btn-primary btn-block"
                    onclick="window.InventoryView.confirmAndLockItem('${item.id}')"
                    title="Registrar conteo y bloquear ítem"
                    style="width: 100%; height: 48px; font-size: 1.05rem; font-weight: 800; letter-spacing: 0.5px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; background: #0284c7; border: 1.5px solid #38bdf8; color: #ffffff; cursor: pointer; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);"
                  >
                    <i class="fa-solid fa-check" style="font-size: 1.15rem;"></i>
                    <span>${isReconteoInv ? 'CONFIRMAR RECONTEO' : 'CONFIRMAR CONTEO'}</span>
                  </button>
                `}

                ${(item.modificationCount > 0 || item.unlockRequestCount > 0) ? `
                  <div style="margin-top: 6px; text-align: center;">
                    <span class="badge badge-warning" style="font-size: 0.75rem; font-weight: 800; padding: 4px 12px; border-radius: 4px; font-family: var(--font-mono); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24;" onclick="window.InventoryView.promptUnlockItem('${item.id}')" title="Ítem con ${item.modificationCount || item.unlockRequestCount} reconteo(s)">
                      <i class="fa-solid fa-rotate-right"></i> Reconteo #${item.modificationCount || item.unlockRequestCount} registrado
                    </span>
                  </div>
                ` : ''}
              </div>
            </div>
          </td>
        </tr>
      `;

      return mainRowHtml;
    }).join('');

    this.updateCountSummaryBar();
    this.filterCountTable(document.getElementById('search-count-items')?.value || '');
  },

  openAddLocationModal(itemId) {
    this._photoTokens ||= {};
    this._photoTokens['addLocPhotoInput'] = null;
    if (this._photoUploading) delete this._photoUploading['addLocPhotoInput'];
    if (!this.currentInventory) return;
    const item = (this.currentInventory.items || []).find(it => it.id === itemId);
    if (!item) return;

    if (item.Ubicacion_1 && item.Ubicacion_2) {
      window.Toast.warning('Este producto ya cuenta con el máximo permitido de 2 ubicaciones adicionales (Columnas E y F).');
      return;
    }

    const idInput = document.getElementById('add-loc-item-id');
    const skuDisplay = document.getElementById('add-loc-sku-display');
    const descDisplay = document.getElementById('add-loc-desc-display');
    const locInput = document.getElementById('add-loc-input-location');

    if (idInput) idInput.value = item.id;
    const existingExtras = [
      item.Ubicacion_1 ? `Ubic. 1: ${item.Ubicacion_1}` : null,
      item.Ubicacion_2 ? `Ubic. 2: ${item.Ubicacion_2}` : null
    ].filter(Boolean).join(' | ');

    if (skuDisplay) {
      skuDisplay.textContent = `${item.SKU} (Ubic. Principal: ${item.Ubicacion || 'S/U'}${existingExtras ? ' | ' + existingExtras : ''})`;
    }
    if (descDisplay) descDisplay.textContent = item.Descripcion || '';
    if (locInput) locInput.value = '';

    if (window.ModalHelper) {
      window.ModalHelper.open('modal-add-location');
    }
    setTimeout(() => {
      if (locInput) locInput.focus();
    }, 150);
  },

  isInvalidOrMissingLocation(loc) {
    if (!loc) return true;
    const s = String(loc).trim().toUpperCase();
    return (
      s === '' ||
      s === 'S/U' ||
      s === 'S.U.' ||
      s === 'SIN UBICACION' ||
      s === 'SIN UBICACIÓN' ||
      s === 'SIN UBIC' ||
      s === 'N/A' ||
      s === 'NA' ||
      s === 'PENDIENTE' ||
      s === '0' ||
      s === '-' ||
      s === '--' ||
      s === 'NO TIENE' ||
      s === 'DESCONOCIDO' ||
      s === 'NUEVA_UBICACION' ||
      s === 'NULL' ||
      s === 'UNDEFINED'
    );
  },

  getOrganizedItems(items = []) {
    if (!Array.isArray(items)) return [];
    return [...items];
  },

  pendingDeleteLocData: null,

  promptDeleteAdditionalLocation(btnEl) {
    if (!btnEl) return;
    const itemId = btnEl.getAttribute('data-item-id') || '';
    const sku = btnEl.getAttribute('data-sku') || '';
    const location = btnEl.getAttribute('data-location') || 'S/U';

    this.pendingDeleteLocData = { itemId, sku, location };

    const skuEl = document.getElementById('delete-loc-sku');
    const nameEl = document.getElementById('delete-loc-name');
    const idEl = document.getElementById('delete-loc-item-id');

    if (skuEl) skuEl.textContent = sku;
    if (nameEl) nameEl.textContent = location;
    if (idEl) idEl.value = itemId;

    if (window.ModalHelper) {
      window.ModalHelper.open('modal-delete-location-confirm');
    }
  },

  async executeDeleteAdditionalLocation() {
    if (!this.pendingDeleteLocData || !this.currentInventory) return;
    const { itemId, sku, location } = this.pendingDeleteLocData;

    const btnConfirm = document.getElementById('btn-confirm-delete-location');
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Eliminando...';
    }

    try {
      if (window.ModalHelper) {
        window.ModalHelper.close('modal-delete-location-confirm');
      }
      window.Toast.info(`Eliminando ubicación adicional '${location}'...`);

      if (window.API.deleteInventoryItem) {
        await window.API.deleteInventoryItem(this.currentInventory.id, itemId, { sku, location });
      } else {
        await window.API.deleteItem(this.currentInventory.id, itemId, { sku, location });
      }

      window.Toast.success(`✅ Ubicación adicional '${location}' eliminada correctamente.`);

      const row = document.getElementById(`row-item-${itemId}`);
      const prevRow = row ? row.previousElementSibling : null;
      const prevId = prevRow ? prevRow.getAttribute('data-item-id') : null;

      await this.reloadCurrentInventory();

      if (prevId) {
        setTimeout(() => {
          const target = document.getElementById(`row-item-${prevId}`);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 250);
      }
    } catch (err) {
      window.Toast.danger(err.message || 'Error al eliminar ubicación adicional');
    } finally {
      if (btnConfirm) {
        btnConfirm.disabled = false;
        btnConfirm.innerHTML = '<i class="fa-solid fa-trash-can"></i> Sí, Eliminar Ubicación';
      }
      this.pendingDeleteLocData = null;
    }
  },

  async deleteAdditionalLocation(itemId, sku, location) {
    this.promptDeleteAdditionalLocation({
      getAttribute: (attr) => {
        if (attr === 'data-item-id') return itemId;
        if (attr === 'data-sku') return sku;
        if (attr === 'data-location') return location;
        return '';
      }
    });
  },

  currentCountFilter: 'all',

  setCountFilter(filter, btn) {
    this.currentCountFilter = filter;
    document.querySelectorAll('.count-filter-btn').forEach(b => {
      b.classList.remove('active');
      b.style.borderColor = 'rgba(255,255,255,0.15)';
      b.style.background = 'rgba(255,255,255,0.04)';
      b.style.color = '#94a3b8';
    });
    if (btn) {
      btn.classList.add('active');
      btn.style.borderColor = '#38bdf8';
      btn.style.background = 'rgba(56, 189, 248, 0.15)';
      btn.style.color = '#ffffff';
    }
    const term = document.getElementById('search-count-items')?.value || '';
    this.filterCountTable(term);
  },

  updateCountSummaryBar() {
    const isReconteoInv = !!(this.currentInventory?.isReconteo || this.currentInventory?.phase === 'RECONTEO' || String(this.currentInventory?.id || '').startsWith('REC-'));
    const items = this.currentInventory?.items || [];
    const total = items.length;
    const counted = items.filter(it => {
      if (isReconteoInv) {
        return (it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined) || (it.Stock_Fisico !== null && it.Stock_Fisico !== undefined);
      }
      return it.Stock_Fisico !== null && it.Stock_Fisico !== undefined;
    }).length;
    const pending = total - counted;
    const percent = total > 0 ? Math.round((counted / total) * 100) : 0;

    const bar = document.getElementById('count-progress-bar');
    const text = document.getElementById('count-progress-text');
    const totalEl = document.getElementById('count-total-num');
    const pendingEl = document.getElementById('count-pending-num');
    const countedEl = document.getElementById('count-counted-num');

    if (bar) bar.style.width = `${percent}%`;
    if (text) text.textContent = `${counted} / ${total} (${percent}%)`;
    if (totalEl) totalEl.textContent = total;
    if (pendingEl) pendingEl.textContent = pending;
    if (countedEl) countedEl.textContent = counted;
  },

  adjustCountQty(itemId, delta) {
    const input = document.getElementById(`input-qty-${itemId}`);
    if (!input || input.disabled) return;
    let val = parseInt(input.value, 10);
    if (isNaN(val)) val = 0;
    val += delta;
    if (val < 0) val = 0;
    input.value = val;
    this.handleInlineCountChange(itemId);
  },

  filterInventoryTable(term) {
    const filter = (term !== undefined ? term : (document.getElementById('search-inventory-list')?.value || '')).toLowerCase().trim();
    const statusSelect = document.getElementById('filter-inv-status');
    const selectedStatusGroup = statusSelect ? statusSelect.value : 'ACTIVOS';

    const rows = document.querySelectorAll('#tbody-inventories tr');
    let visibleCount = 0;

    rows.forEach(row => {
      if (row.cells.length <= 1) return;
      const text = row.textContent.toLowerCase();
      const matchesSearch = !filter || text.includes(filter);

      const rowStatus = (row.getAttribute('data-inv-status') || '').trim();
      let matchesStatus = true;

      if (selectedStatusGroup === 'ACTIVOS') {
        // Excluye inventarios que ya fueron revisados/archivados a historial
        // y muestra los que están en proceso de conteo o recién creados
        matchesStatus = (rowStatus !== 'REVISADO' && rowStatus !== 'CERRADO');
      } else if (selectedStatusGroup === 'REVISION') {
        // En justificación / reconteo
        matchesStatus = (rowStatus === 'PENDIENTE_JUSTIFICACION' || rowStatus === 'EN_RECONTEO' || rowStatus === 'RECONTEO_COMPLETADO');
      } else if (selectedStatusGroup === 'CERRADOS') {
        // Historial / Finalizados
        matchesStatus = (rowStatus === 'REVISADO' || rowStatus === 'CERRADO' || rowStatus === 'FINALIZADO');
      } else if (selectedStatusGroup === 'TODOS') {
        matchesStatus = true;
      }

      const visible = matchesSearch && matchesStatus;
      row.style.display = visible ? '' : 'none';
      if (visible) visibleCount++;
    });

    let noResults = document.getElementById('row-no-inv-results');
    if (visibleCount === 0 && rows.length > 0 && rows[0].cells.length > 1) {
      if (!noResults) {
        const tbody = document.getElementById('tbody-inventories');
        if (tbody) {
          noResults = document.createElement('tr');
          noResults.id = 'row-no-inv-results';
          tbody.appendChild(noResults);
        }
      }
      if (noResults) {
        noResults.innerHTML = `<td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-dim);"><i class="fa-solid fa-magnifying-glass" style="margin-right: 6px;"></i> No se encontraron inventarios que coincidan con el filtro o búsqueda.</td>`;
        noResults.style.display = '';
      }
    } else if (noResults) {
      noResults.style.display = 'none';
    }
  },

  filterCountTable(term) {
    const filter = (term || '').toLowerCase().trim();
    const statusFilter = this.currentCountFilter || 'all';
    const rows = document.querySelectorAll('#tbody-count-items tr.mobile-count-card');

    let visibleCount = 0;
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      const sku = (row.getAttribute('data-sku') || '').toLowerCase();
      const itemId = (row.getAttribute('data-item-id') || '').toLowerCase();
      const matchesSearch = !filter || text.includes(filter) || sku.includes(filter) || itemId.includes(filter);

      const status = row.getAttribute('data-status') || 'pending';
      let matchesStatus = true;
      if (statusFilter === 'pending') {
        matchesStatus = status !== 'counted';
      } else if (statusFilter === 'counted') {
        matchesStatus = status === 'counted';
      }

      const visible = matchesSearch && matchesStatus;
      if (visible) visibleCount++;

      row.classList.toggle('is-hidden', !visible);
      row.style.setProperty('display', visible ? 'block' : 'none', 'important');

      const inlineTr = document.getElementById(`inline-loc-tr-${itemId}`);
      if (inlineTr) {
        inlineTr.classList.toggle('is-hidden', !visible);
        if (!visible) {
          inlineTr.style.setProperty('display', 'none', 'important');
        }
      }
    });

    let noResultsRow = document.getElementById('row-no-count-results');
    if (visibleCount === 0 && rows.length > 0) {
      if (!noResultsRow) {
        const tbody = document.getElementById('tbody-count-items');
        if (tbody) {
          noResultsRow = document.createElement('tr');
          noResultsRow.id = 'row-no-count-results';
          tbody.appendChild(noResultsRow);
        }
      }
      if (noResultsRow) {
        noResultsRow.style.cssText = 'display: block; width: 100%; text-align: center; padding: 2.5rem 1rem; color: #94a3b8; background: #0b1329; border: 1.5px dashed #334155; border-radius: 10px; margin-top: 0.75rem;';
        noResultsRow.innerHTML = `
          <td style="display: block; width: 100%; border: none; padding: 0;">
            <i class="fa-solid fa-magnifying-glass" style="font-size: 2rem; color: #64748b; margin-bottom: 0.75rem; display: block;"></i>
            <div style="font-size: 1.05rem; font-weight: 700; color: #f8fafc; margin-bottom: 0.35rem;">No se encontraron ítems</div>
            <div style="font-size: 0.85rem; color: #94a3b8;">No hay ítems que coincidan con "${filter}" con el filtro activo.</div>
          </td>
        `;
        noResultsRow.style.setProperty('display', 'block', 'important');
      }
    } else if (noResultsRow) {
      noResultsRow.style.setProperty('display', 'none', 'important');
    }

    const clearBtn = document.getElementById('btn-clear-search-count');
    if (clearBtn) {
      clearBtn.style.display = filter ? 'block' : 'none';
    }
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

  updateItemTotalBadge(itemId) {
    const qtyInput = document.getElementById(`input-qty-${itemId}`);
    const damInput = document.getElementById(`input-damaged-${itemId}`);
    const badge = document.getElementById(`badge-total-${itemId}`);
    if (!badge) return;
    const q = (qtyInput && qtyInput.value !== '') ? (parseInt(qtyInput.value, 10) || 0) : 0;
    const d = (damInput && damInput.value !== '') ? (parseInt(damInput.value, 10) || 0) : 0;
    badge.textContent = q + d;
  },

  handleInlineCountChange(itemId) {
    const inventoryId = this.currentInventory?.id;
    const item = this.currentInventory?.items.find(it => it.id === itemId);
    if (!item || item.locked || this._confirmingItems?.has(`${inventoryId}:${itemId}`)) return;
    const qty = document.getElementById(`input-qty-${itemId}`)?.value;
    const damaged = document.getElementById(`input-damaged-${itemId}`)?.value;
    this.updateItemTotalBadge(itemId);
    this.handleDamagedInput(itemId, damaged);
    try {
      window.CountQueue.saveDraft(inventoryId, itemId, { stockFisico: qty, malEstado: damaged, expectedItemVersion: item._version || 0 });
    } catch (_) { window.Toast.warning('El navegador no pudo conservar el borrador. Confirme el conteo antes de salir.'); }
  },

  async confirmAndLockItem(itemId) {
    if (!this.currentInventory) return;

    const item = this.currentInventory.items.find(it => it.id === itemId || it.SKU === itemId || String(it.id) === String(itemId));
    const actualId = item ? item.id : itemId;
    const inventory = this.currentInventory;
    const inventoryId = inventory.id;
    const sendKey = `${inventoryId}:${actualId}`;
    this._confirmingItems ||= new Set();
    if (this._confirmingItems.has(sendKey)) return;

    const qtyInput = document.getElementById(`input-qty-${actualId}`);
    const damInput = document.getElementById(`input-damaged-${actualId}`);
    const btn = document.getElementById(`btn-count-lock-${actualId}`);
    const recountBtn = document.getElementById(`btn-recount-${actualId}`);
    if (!qtyInput || !damInput) return;

    let qtyVal = qtyInput.value.trim();
    if (qtyVal === '') {
      qtyVal = '0';
      qtyInput.value = '0';
    }

    const qty = Number(qtyVal);
    const damaged = Number(damInput.value || 0);

    if (!Number.isSafeInteger(qty) || qty < 0 || !Number.isSafeInteger(damaged) || damaged < 0) {
      window.Toast.warning('Las cantidades deben ser enteros mayores o iguales a cero.');
      return;
    }

    const previousCount = (item && item.Stock_Fisico !== null && item.Stock_Fisico !== undefined) ? item.Stock_Fisico : null;
    const isReCount = previousCount !== null;
    const recountReason = (item && item.pendingReEditReason) ? item.pendingReEditReason : (isReCount ? 'Reconteo físico confirmado' : null);

    this._confirmingItems.add(sendKey);
    if (btn) btn.disabled = true;
    qtyInput.disabled = true;
    damInput.disabled = true;
    let confirmed = false;
    try {
      const saved = await window.API.registerCount(inventoryId, {
        itemId: actualId,
        sku: item?.SKU,
        location: item?.Ubicacion,
        almacen: item?.Almacen || item?.almacen || item?.warehouse || undefined,
        stockFisico: qty,
        malEstado: damaged,
        photoUrl: item?.foto_mal_estado || undefined,
        locked: true,
        reason: recountReason
      });

      confirmed = true;
      if (saved.item && item) Object.assign(item, saved.item);
      window.CountQueue.cache(inventory);
      if (this.currentInventory?.id !== inventoryId) return;
      const isReconteoInv = !!(this.currentInventory?.isReconteo || this.currentInventory?.phase === 'RECONTEO' || String(this.currentInventory?.id || '').startsWith('REC-'));

      if (item) {

        item.Stock_Fisico = qty;
        item.Mal_estado = damaged;
        if (isReconteoInv) {
          item.Reconteo_Fisico = qty;
          item.Reconteo_Mal_Estado = damaged;
        }
        item.locked = true;
        item.Estado = isReconteoInv ? 'Recontado' : 'Contado';
        delete item.pendingReEditReason;
      }

      // Lock input fields to prevent accidental edits
      qtyInput.disabled = true;
      qtyInput.setAttribute('disabled', 'true');
      qtyInput.style.background = 'rgba(255,255,255,0.03)';
      qtyInput.style.cursor = 'pointer';
      qtyInput.style.opacity = '0.9';
      qtyInput.style.borderColor = 'var(--success)';

      damInput.disabled = true;
      damInput.setAttribute('disabled', 'true');
      damInput.style.background = 'rgba(255,255,255,0.03)';
      damInput.style.cursor = 'not-allowed';
      damInput.style.opacity = '0.9';

      // Update lock button and show recount button
      if (btn) {
        btn.className = 'btn btn-success';
        btn.innerHTML = `<i class="fa-solid fa-circle-check"></i> <span>${isReconteoInv ? 'RECONTADO' : 'CONTADO'} (${qty})</span>`;
        btn.onclick = () => window.InventoryView.promptUnlockItem(actualId);
        btn.title = isReconteoInv ? 'Ítem recontado y bloqueado contra edición. Clic para editar reconteo' : 'Ítem contado y bloqueado contra edición. Clic para habilitar reconteo';
        btn.style.cursor = 'pointer';
        btn.style.boxShadow = '0 2px 10px rgba(5, 150, 105, 0.35)';
      }

      if (recountBtn) {
        recountBtn.style.display = 'inline-flex';
      }

      const icon = document.getElementById(`saved-icon-${actualId}`);
      if (icon) icon.style.opacity = '1';

      const row = document.getElementById(`row-item-${actualId}`);
      if (row) {
        row.classList.add('counted-row');
        row.setAttribute('data-status', 'counted');
        row.style.outline = 'none';
        row.querySelectorAll('.touch-step-btn').forEach(b => {
          b.disabled = true;
          b.style.opacity = '0.4';
          b.style.cursor = 'not-allowed';
        });
      }

      this.updateCountSummaryBar();

      if (isReCount) {
        window.Toast.success(`✅ Reconteo guardado y registrado: ${item ? item.SKU : ''} (${qty} contados, edición #${item ? item.modificationCount : 1})`);
      } else {
        window.Toast.success(`✅ Conteo guardado y bloqueado: ${item ? item.SKU : ''} (${qty} contados)`);
      }
    } catch (err) {
      qtyInput.style.borderColor = 'var(--danger)';
      window.Toast.danger(err.message || 'Error al guardar y bloquear conteo');
    } finally {
      this._confirmingItems.delete(sendKey);
      if (btn) btn.disabled = false;
      if (!confirmed) { qtyInput.disabled = false; damInput.disabled = false; }
    }
  },

  promptUnlockItem(itemId) {
    if (!this.currentInventory) return;
    const item = this.currentInventory.items.find(it => it.id === itemId || it.SKU === itemId || String(it.id) === String(itemId));
    if (!item) {
      window.Toast.warning('Ítem no encontrado en el inventario actual');
      return;
    }

    const skuEl = document.getElementById('unlock-sku');
    const locEl = document.getElementById('unlock-location');
    const descEl = document.getElementById('unlock-desc');
    const curQtyEl = document.getElementById('unlock-current-qty');
    const curDamEl = document.getElementById('unlock-current-damaged');
    const prevRecEl = document.getElementById('unlock-previous-recounts');
    const idEl = document.getElementById('unlock-item-id');
    const selectEl = document.getElementById('unlock-reason-select');
    const customEl = document.getElementById('unlock-reason-custom');

    if (skuEl) skuEl.textContent = item.SKU || '-';
    if (locEl) locEl.textContent = item.Ubicacion || 'S/U';
    if (descEl) descEl.textContent = item.Descripcion || '';
    if (curQtyEl) curQtyEl.textContent = (item.Stock_Fisico !== null && item.Stock_Fisico !== undefined) ? item.Stock_Fisico : '-';
    if (curDamEl) curDamEl.textContent = item.Mal_estado || 0;
    const recounts = (item.modificationCount || 0) + (item.unlockRequestCount || 0);
    if (prevRecEl) prevRecEl.textContent = recounts;
    if (idEl) idEl.value = item.id;

    if (selectEl) selectEl.value = 'Corrección de cantidad física';
    if (customEl) {
      customEl.value = '';
      customEl.style.display = 'none';
    }

    if (window.ModalHelper) {
      window.ModalHelper.open('modal-unlock-count-confirm');
    }
  },

  handleUnlockReasonChange(val) {
    const customEl = document.getElementById('unlock-reason-custom');
    if (customEl) {
      if (val === 'OTRO') {
        customEl.style.display = 'block';
        customEl.focus();
      } else {
        customEl.style.display = 'none';
      }
    }
  },

  async executeUnlockItem() {
    if (!this.currentInventory) return;
    const idEl = document.getElementById('unlock-item-id');
    const itemId = idEl ? idEl.value : null;
    if (!itemId) return;

    const item = this.currentInventory.items.find(it => it.id === itemId || String(it.id) === String(itemId));
    if (!item) return;

    const selectEl = document.getElementById('unlock-reason-select');
    const customEl = document.getElementById('unlock-reason-custom');
    let reason = 'Corrección de cantidad física';
    if (selectEl) {
      if (selectEl.value === 'OTRO' && customEl && customEl.value.trim()) {
        reason = customEl.value.trim();
      } else if (selectEl.value !== 'OTRO') {
        reason = selectEl.value;
      }
    }

    const actualId = item.id;
    const btnConfirm = document.getElementById('btn-confirm-unlock');
    if (btnConfirm) {
      btnConfirm.disabled = true;
      btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Habilitando...';
    }

    try {
      if (window.ModalHelper) {
        window.ModalHelper.close('modal-unlock-count-confirm');
      }

      // 1. Immediately unlock locally on DOM and item state
      item.locked = false;
      item.unlockRequestCount = (item.unlockRequestCount || 0) + 1;
      item.pendingReEditReason = reason;

      const qtyInput = document.getElementById(`input-qty-${actualId}`);
      const damInput = document.getElementById(`input-damaged-${actualId}`);
      const btn = document.getElementById(`btn-count-lock-${actualId}`);
      const recountBtn = document.getElementById(`btn-recount-${actualId}`);
      const row = document.getElementById(`row-item-${actualId}`);

      if (qtyInput) {
        qtyInput.disabled = false;
        qtyInput.removeAttribute('disabled');
        qtyInput.style.background = 'rgba(245, 158, 11, 0.1)';
        qtyInput.style.cursor = 'text';
        qtyInput.style.opacity = '1';
        qtyInput.style.borderColor = '#f59e0b';
        setTimeout(() => {
          qtyInput.focus();
          qtyInput.select();
        }, 60);
      }

      if (damInput) {
        damInput.disabled = false;
        damInput.removeAttribute('disabled');
        damInput.style.background = 'rgba(255,255,255,0.08)';
        damInput.style.cursor = 'text';
        damInput.style.opacity = '1';
      }

      if (btn) {
        btn.className = 'btn btn-warning';
        btn.innerHTML = '<i class="fa-solid fa-check"></i> <span>CONFIRMAR RECONTEO</span>';
        btn.onclick = () => window.InventoryView.confirmAndLockItem(actualId);
        btn.title = 'Guardar nuevo conteo físico verificado';
        btn.style.boxShadow = '0 2px 10px rgba(217, 119, 6, 0.35)';
      }

      if (recountBtn) {
        recountBtn.style.display = 'none';
      }

      if (row) {
        row.classList.remove('counted-row');
        row.setAttribute('data-status', 'pending');
        row.style.outline = '2px solid rgba(245, 158, 11, 0.6)';
        row.querySelectorAll('.touch-step-btn').forEach(b => {
          b.disabled = false;
          b.style.opacity = '1';
          b.style.cursor = 'pointer';
        });
      }

      this.updateCountSummaryBar();

      window.Toast.info(`Reconteo habilitado para ${item.SKU}. Ingrese el nuevo valor y presione 'CONFIRMAR RECONTEO'.`);

      // 2. Call backend in background to register the unlock request in audit
      await window.API.requestUnlockItem(this.currentInventory.id, actualId, {
        reason,
        center: this.currentInventory.center
      });
    } catch (err) {
      console.warn('[executeUnlockItem] Notice recording unlock on server:', err.message);
    } finally {
      if (btnConfirm) {
        btnConfirm.disabled = false;
        btnConfirm.innerHTML = '<i class="fa-solid fa-unlock"></i> Habilitar Reconteo';
      }
    }
  },

  // Alias for backward compatibility
  requestUnlockItem(itemId) {
    this.promptUnlockItem(itemId);
  },

  openDamagePhotoModal(itemId) {
    this._photoTokens ||= {};
    this._photoTokens['photoInput'] = null;
    if (this._photoUploading) delete this._photoUploading['photoInput'];
    if (!this.currentInventory) return;
    const item = this.currentInventory.items.find(it => it.id === itemId);
    if (!item) return;

    const isReconteo = !!(this.currentInventory.isReconteo || this.currentInventory.phase === 'RECONTEO' || String(this.currentInventory.id || '').startsWith('REC-'));
    const damInput = document.getElementById(`input-damaged-${itemId}`);
    const defaultDamaged = isReconteo ? (item.Reconteo_Mal_Estado ?? item.Malestado_Reconteo ?? item.Mal_estado ?? 0) : (item.Mal_estado || 0);
    const damagedVal = damInput && damInput.value !== '' ? Number(damInput.value) : defaultDamaged;

    document.getElementById('damage-photo-item-id').value = item.id;
    document.getElementById('damage-photo-sku').textContent = item.SKU;
    document.getElementById('damage-photo-desc').textContent = item.Descripcion;
    document.getElementById('damage-photo-qty').textContent = `${damagedVal} pieza(s) en mal estado ${isReconteo ? '(Reconteo)' : ''}`;

    const previewBox = document.getElementById('damage-photo-preview-box');
    const previewImg = document.getElementById('img-damage-photo-preview');
    const urlVal = document.getElementById('damage-photo-url-val');
    const fileInput = document.getElementById('input-damage-photo-file');

    if (fileInput) fileInput.value = '';

    const existingPhoto = isReconteo ? (item.foto_mal_estado_reconteo || item.foto_mal_estado) : item.foto_mal_estado;
    if (existingPhoto) {
      urlVal.value = existingPhoto;
      if (previewImg) previewImg.src = existingPhoto;
      if (previewBox) previewBox.style.display = 'block';
    } else {
      urlVal.value = '';
      if (previewBox) previewBox.style.display = 'none';
      if (previewImg) previewImg.src = '';
    }

    window.ModalHelper.open('modal-damage-photo');
  },

  openCountModal(itemId, isNewLocation = false) {
    this._photoTokens ||= {};
    this._photoTokens['modalCountPhotoInput'] = null;
    if (this._photoUploading) delete this._photoUploading['modalCountPhotoInput'];
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

    // Resetear o cargar foto en modal-count-confirm
    const mcPhotoUrlVal = document.getElementById('modal-count-photo-url-val');
    const mcPhotoFileInput = document.getElementById('modal-count-photo-file-input');
    const mcPhotoPreviewBox = document.getElementById('modal-count-photo-preview-box');
    const mcPhotoPreviewImg = document.getElementById('modal-count-photo-preview-img');
    const mcPhotoZone = document.getElementById('modal-count-photo-zone');
    const mcPhotoBadge = document.getElementById('modal-count-photo-badge');

    const itemTarget = !isNewLocation && itemId ? this.currentInventory.items.find(it => it.id === itemId) : null;

    if (itemTarget && itemTarget.foto_mal_estado) {
      if (mcPhotoUrlVal) mcPhotoUrlVal.value = itemTarget.foto_mal_estado;
      if (mcPhotoPreviewImg) mcPhotoPreviewImg.src = itemTarget.foto_mal_estado;
      if (mcPhotoPreviewBox) mcPhotoPreviewBox.style.display = 'block';
      if (mcPhotoZone) mcPhotoZone.style.display = 'none';
      if (mcPhotoBadge) {
        mcPhotoBadge.textContent = 'Foto lista';
        mcPhotoBadge.className = 'badge badge-success';
      }
    } else {
      if (mcPhotoUrlVal) mcPhotoUrlVal.value = '';
      if (mcPhotoFileInput) mcPhotoFileInput.value = '';
      if (mcPhotoPreviewBox) mcPhotoPreviewBox.style.display = 'none';
      if (mcPhotoPreviewImg) mcPhotoPreviewImg.src = '';
      if (mcPhotoZone) {
        mcPhotoZone.style.display = 'block';
        mcPhotoZone.style.borderColor = '#475569';
        mcPhotoZone.style.background = 'rgba(239, 68, 68, 0.04)';
      }
      if (mcPhotoBadge) {
        mcPhotoBadge.textContent = 'Opcional';
        mcPhotoBadge.className = 'badge badge-secondary';
      }
    }

    this.updateModalCountTotal();
    window.ModalHelper.open('modal-count-confirm');
  },

  updateModalCountTotal() {
    const qtyInput = document.getElementById('modal-input-qty');
    const damInput = document.getElementById('modal-input-damaged');
    const badge = document.getElementById('modal-count-total-badge');
    if (!badge) return;
    const q = (qtyInput && qtyInput.value !== '') ? (parseInt(qtyInput.value, 10) || 0) : 0;
    const d = (damInput && damInput.value !== '') ? (parseInt(damInput.value, 10) || 0) : 0;
    badge.textContent = q + d;
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

  async syncCurrentInventoryFromSheet() {
    if (!this.currentInventory) return;
    const invId = this.currentInventory.id;
    const btn = document.getElementById('btn-sync-inv-gas');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando...';
    }
    try {
      window.Toast.info('Sincronizando conteos desde Google Sheets...');
      const res = await window.API.syncInventoryFromSheet(invId);
      const updated = res.itemsUpdated || res.updatedCount || 0;
      window.Toast.success(`Sincronización completa: ${updated} ítems actualizados desde Sheets`);
      await this.openInventory(invId);
    } catch (err) {
      window.Toast.danger(err.message || 'Error al sincronizar con Google Sheets');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Sincronizar Google Sheets';
      }
    }
  },

  async syncInventoryFromSheetRow(invId, btnElement) {
    if (!invId) return;
    let origHtml = '';
    if (btnElement) {
      origHtml = btnElement.innerHTML;
      btnElement.disabled = true;
      btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }
    try {
      window.Toast.info(`Sincronizando ${invId} desde Google Sheets...`);
      const res = await window.API.syncInventoryFromSheet(invId);
      const updated = res.itemsUpdated || res.updatedCount || 0;
      window.Toast.success(`Sincronizado ${invId}: ${updated} conteos actualizados`);
      await this.loadInventories();
    } catch (err) {
      window.Toast.danger(err.message || 'Error al sincronizar inventario con Google Sheets');
    } finally {
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.innerHTML = origHtml;
      }
    }
  },

  async syncAllFromSheets(btnElement) {
    let origHtml = '';
    if (btnElement) {
      origHtml = btnElement.innerHTML;
      btnElement.disabled = true;
      btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando...';
    }
    try {
      window.Toast.info('Sincronizando conteos de todos los centros desde Google Sheets...');
      const res = await window.API.syncAllFromSheets();
      let totalUpdated = 0;
      if (res && Array.isArray(res.results)) {
        res.results.forEach(r => {
          totalUpdated += (r.updated || 0);
        });
      }
      window.Toast.success(`✅ Sincronización exitosa: ${totalUpdated} conteos recuperados desde Google Sheets.`);
      await this.loadInventories();
    } catch (err) {
      window.Toast.danger(err.message || 'Error al sincronizar con Google Sheets');
    } finally {
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.innerHTML = origHtml;
      }
    }
  },

  promptDelete(invId, countedItems = 0) {
    if (!invId) return;
    const invInput = document.getElementById('delete-modal-inv-id');
    const keyInput = document.getElementById('delete-modal-key');
    const reasonInput = document.getElementById('delete-modal-reason');
    const warningDiv = document.getElementById('delete-modal-warning');

    if (invInput) invInput.value = invId;
    if (keyInput) keyInput.value = '';
    if (reasonInput) reasonInput.value = '';

    if (warningDiv) {
      if (countedItems > 0) {
        warningDiv.style.display = 'block';
        warningDiv.innerHTML = `
          <div style="background: rgba(239, 68, 68, 0.15); border: 1.5px solid #ef4444; border-radius: 8px; padding: 0.85rem 1rem; color: #fca5a5; font-size: 0.88rem; line-height: 1.4;">
            <div style="font-weight: 800; color: #ef4444; margin-bottom: 0.35rem; display: flex; align-items: center; gap: 0.5rem;">
              <i class="fa-solid fa-triangle-exclamation" style="font-size: 1.1rem;"></i> ¡ADVERTENCIA: INVENTARIO CON AVANCE!
            </div>
            Este inventario ya tiene <strong>${countedItems} ítems contados</strong> por el personal operativo. Si lo elimina, los conteos saldrán de la vista de los auxiliares y se archivarán en la papelera de seguridad.
          </div>
        `;
      } else {
        warningDiv.style.display = 'none';
        warningDiv.innerHTML = '';
      }
    }
    window.ModalHelper.open('modal-delete-confirm');

    const form = document.getElementById('form-delete-confirm');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const targetId = document.getElementById('delete-modal-inv-id')?.value || invId;
        const deleteKey = document.getElementById('delete-modal-key')?.value?.trim();
        if (!deleteKey) {
          window.Toast.error('Debe ingresar la clave de confirmación (ADM26) para eliminar este inventario');
          return;
        }
        const reason = document.getElementById('delete-modal-reason')?.value?.trim() || 'Eliminación por el usuario';

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Eliminando...';
        }

        try {
          const res = await window.API.deleteInventory(targetId, { deleteKey, reason });
          window.Toast.success(res.message || 'Inventario eliminado con éxito');
        } catch (err) {
          // If the error indicates not found or permission issue, notify user but still purge from local UI/cache
          window.Toast.info(`Inventario removido de la vista local (${err.message})`);
        } finally {
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
            localStorage.removeItem(`nibol_inv_detail_${targetId}`);
          } catch (e) {}

          // If current inventory was open, return to list view
          if (this.currentInventory && this.currentInventory.id === targetId) {
            this.currentInventory = null;
            document.getElementById('view-count')?.classList.remove('active');
            document.getElementById('view-inventories')?.classList.add('active');
          }

          await this.loadInventories();

          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Eliminar Definitivamente';
          }
        }
      };
    }
  },

  async promptPurgeAll() {
    const isConfirmed = confirm('¿Está seguro de limpiar TODO el historial y las pruebas a 0?\\n\\nEsta acción eliminará todos los inventarios en progreso, auditorías y pruebas residuales tanto del servidor como de la memoria local.');
    if (!isConfirmed) return;

    try {
      window.Toast.info('Limpiando todos los inventarios y pruebas a 0...');
      const res = await window.API.purgeAllInventories();
      window.Toast.success(res.message || 'Sistema restablecido a 0 con éxito');

      // Clear all local storage inventory/history items
      try {
        localStorage.removeItem('nibol_cached_inventories');
        localStorage.removeItem('nibol_cached_history');
        localStorage.removeItem('nibol_active_inv_id');
        // Clean all keys starting with nibol_inv_
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith('nibol_inv_')) {
            localStorage.removeItem(k);
          }
        });
      } catch (e) {}

      this.currentInventory = null;
      document.getElementById('view-count')?.classList.remove('active');
      document.getElementById('view-inventories')?.classList.add('active');

      await this.loadInventories();
      if (window.HistoryView && typeof window.HistoryView.loadHistory === 'function') {
        window.HistoryView.loadHistory().catch(() => {});
      }
    } catch (err) {
      window.Toast.danger(err.message || 'Error limpiando el sistema a 0');
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
