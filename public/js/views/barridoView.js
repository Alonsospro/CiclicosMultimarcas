// View: Dedicated Barrido Screen
window.BarridoView = {
  currentScannedProduct: null,
  isCameraActive: false,
  uploadedPhotoUrl: null,

  init() {
    this.setupListeners();
    this.initCenters();
  },

  initCenters() {
    const select = document.getElementById('barrido-select-center');
    if (!select) return;

    const centers = window.AppConfig?.centersList || [
      { code: '1120', displayName: '1120 - Volvo - Km 14' },
      { code: '1160', displayName: '1160 - Av. Banzer 3er anillo' },
      { code: '1180', displayName: '1180 - Foton - Km 10' },
      { code: '1300', displayName: '1300 - John Deere - Km 10' },
      { code: '1310', displayName: '1310 - Sucursal Montero' },
      { code: '1340', displayName: '1340 - Sucursal Cuatro Cañadas' },
      { code: '1700', displayName: '1700 - Av. Grigota 3er anillo' },
      { code: '1800', displayName: '1800 - Express San Julián' },
      { code: '1820', displayName: '1820 - Express San Pedro' },
      { code: '2100', displayName: '2100 - Sucursal El Alto, La Paz' },
      { code: '2150', displayName: '2150 - Centro Foton El Alto, La Paz' },
      { code: '3100', displayName: '3100 - Sucursal Cochabamba' },
      { code: '3200', displayName: '3200 - Centro Foton Blanco Galindo' },
      { code: '5100', displayName: '5100 - Sucursal Tarija' }
    ];

    select.innerHTML = centers.map(c => `<option value="${c.code}">${c.displayName || c.name || c.code}</option>`).join('');

    const user = window.Auth?.currentUser;
    if (user) {
      if (user.role === 'ADMIN' || user.isSuperadmin) {
        select.disabled = false;
        if (user.center && user.center !== 'GLOBAL') {
          select.value = user.center;
        } else {
          select.value = '1120';
        }
      } else {
        select.value = user.center || '1120';
        select.disabled = true;
      }
    }
  },

  getSelectedCenter() {
    const select = document.getElementById('barrido-select-center');
    if (select && select.value) return select.value;
    const user = window.Auth?.currentUser;
    if (user && user.center && user.center !== 'GLOBAL') return user.center;
    return '1120';
  },

  setupListeners() {
    // Back to inventories button
    document.getElementById('btn-back-from-barrido')?.addEventListener('click', () => {
      if (this.isCameraActive) {
        this.toggleCamera();
      }
      window.Router.navigate('inventories');
    });

    // Center selector change
    document.getElementById('barrido-select-center')?.addEventListener('change', () => {
      this.resetBarridoForm();
      const center = this.getSelectedCenter();
      window.Toast.info(`Centro seleccionado para Barrido: ${center}`);
    });

    // Toggle Camera in Barrido
    document.getElementById('btn-toggle-barrido-cam')?.addEventListener('click', () => {
      this.toggleCamera();
    });

    // Manual Barcode / SKU search
    document.getElementById('btn-search-barrido-manual')?.addEventListener('click', () => {
      this.searchManual();
    });

    document.getElementById('input-barrido-manual')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.searchManual();
      }
    });

    // Usar ubicación original button
    document.getElementById('btn-barrido-use-orig-loc')?.addEventListener('click', () => {
      if (!this.currentScannedProduct) return;
      const origLoc = this.currentScannedProduct.item?.UbicacionOriginal || this.currentScannedProduct.item?.Ubicacion || '';
      const locInput = document.getElementById('barrido-input-loc');
      if (locInput && origLoc) {
        locInput.value = origLoc;
        this.checkLocationDifference();
        window.Toast.info(`Ubicación original '${origLoc}' copiada al conteo.`);
      }
    });

    // Toggle + Ubicación distinta / adicional button
    document.getElementById('btn-barrido-toggle-alt-loc')?.addEventListener('click', () => {
      const locInput = document.getElementById('barrido-input-loc');
      const isNewLocInput = document.getElementById('barrido-is-new-location');
      if (locInput) {
        locInput.value = '';
        locInput.placeholder = 'Escriba o escanee la nueva ubicación física...';
        locInput.focus();
        if (isNewLocInput) isNewLocInput.value = 'true';
        const alertBox = document.getElementById('barrido-loc-diff-alert');
        if (alertBox) alertBox.style.display = 'block';
        window.Toast.warning('Modo ubicación adicional activo. Ingrese el nuevo rack/pasillo.');
      }
    });

    // Real-time detection of location difference
    document.getElementById('barrido-input-loc')?.addEventListener('input', () => {
      this.checkLocationDifference();
    });

    // Mal estado input change -> toggle photo upload box
    document.getElementById('barrido-input-damaged')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) || 0;
      const photoBox = document.getElementById('barrido-photo-box');
      if (photoBox) {
        photoBox.style.display = val > 0 ? 'block' : 'none';
      }
    });

    // Photo file selection & upload
    const photoZone = document.getElementById('zone-barrido-photo');
    const photoInput = document.getElementById('input-barrido-photo-file');
    const previewImg = document.getElementById('img-barrido-preview');

    photoZone?.addEventListener('click', () => photoInput?.click());

    photoInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const center = document.getElementById('barrido-select-center')?.value || window.Auth.currentUser?.center || '1120';
      const sku = this.currentScannedProduct?.SKU || '';
      const dateStr = new Date().toISOString().split('T')[0];

      try {
        window.Toast.info('Subiendo evidencia a Google Drive...');
        const res = await window.API.uploadPhoto(file, {
          category: 'malestado',
          photoType: 'malestado',
          sku,
          center,
          date: dateStr
        });
        if (res.photo && res.photo.url) {
          this.uploadedPhotoUrl = res.photo.url;
          if (previewImg) {
            previewImg.src = res.photo.url;
            previewImg.style.display = 'block';
          }
          window.Toast.success('Foto de avería lista para guardar en Google Drive');
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al subir foto.');
      }
    });

    // Form submit: Register Barrido Count
    document.getElementById('form-barrido-count')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.currentScannedProduct) return;

      const loc = document.getElementById('barrido-input-loc').value.trim();
      const qtyVal = document.getElementById('barrido-input-qty').value;
      const damagedVal = document.getElementById('barrido-input-damaged').value;

      const qty = qtyVal !== '' ? parseInt(qtyVal, 10) : 0;
      const damaged = damagedVal !== '' ? parseInt(damagedVal, 10) : 0;

      if (!loc) {
        window.Toast.warning('Debe ingresar la ubicación física.');
        return;
      }

      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
      }

      try {
        const item = this.currentScannedProduct.item;
        const origLoc = item.UbicacionOriginal || item.Ubicacion || '';
        const isNewLocFlag = document.getElementById('barrido-is-new-location')?.value === 'true';
        const isDifferentLoc = (origLoc && origLoc.toUpperCase() !== loc.toUpperCase());
        const isNewLoc = isNewLocFlag || isDifferentLoc;
        const center = this.getSelectedCenter();
        const comment = document.getElementById('barrido-input-comment')?.value.trim() || '';

        await window.API.registerBarridoCount({
          inventoryId: this.currentScannedProduct.inventoryId || null,
          itemId: item.id || null,
          sku: item.SKU,
          stockFisico: qty,
          malEstado: damaged,
          location: loc,
          isNewLocation: isNewLoc,
          center,
          photoUrl: this.uploadedPhotoUrl,
          comentario: comment,
          reason: isNewLoc ? `Barrido: Ubicación adicional en ${loc}` : 'Barrido físico confirmado'
        });

        window.Toast.success(
          isNewLoc
            ? `✅ Registrado ${qty} unid. de ${item.SKU} como ubicación adicional en '${loc}'`
            : `✅ Registrado ${qty} unid. de ${item.SKU} en '${loc}'`
        );
        this.resetBarridoForm();
      } catch (err) {
        window.Toast.danger(err.message || 'Error registrando conteo en barrido');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Registrar en Barrido';
        }
      }
    });

    // Finalizar y Sincronizar Barrido con Google Sheets
    document.getElementById('btn-finish-barrido')?.addEventListener('click', async () => {
      const center = this.getSelectedCenter();
      if (!confirm(`¿Desea dar por concluido el barrido del centro ${center} y sincronizarlo con Google Sheets / Drive?`)) {
        return;
      }

      const btn = document.getElementById('btn-finish-barrido');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sincronizando con Google Sheets...';
      }

      try {
        const res = await window.API.finishBarrido({ center });
        window.Toast.success(res.message || 'Barrido finalizado y sincronizado con éxito');
        if (res.gasResult && res.gasResult.fileName) {
          window.Toast.info(`Hoja generada en Drive: ${res.gasResult.fileName}`);
        }
        window.Router.navigate('inventories');
      } catch (err) {
        window.Toast.danger(err.message || 'Error al finalizar barrido');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Finalizar y Sincronizar Barrido';
        }
      }
    });
  },

  checkLocationDifference() {
    if (!this.currentScannedProduct) return;
    const origLoc = (this.currentScannedProduct.item?.UbicacionOriginal || this.currentScannedProduct.item?.Ubicacion || '').trim().toUpperCase();
    const currentLoc = (document.getElementById('barrido-input-loc')?.value || '').trim().toUpperCase();
    const alertBox = document.getElementById('barrido-loc-diff-alert');
    const isNewLocInput = document.getElementById('barrido-is-new-location');

    if (currentLoc && origLoc && currentLoc !== origLoc) {
      if (alertBox) alertBox.style.display = 'block';
      if (isNewLocInput) isNewLocInput.value = 'true';
    } else {
      if (alertBox) alertBox.style.display = 'none';
      if (isNewLocInput) isNewLocInput.value = 'false';
    }
  },

  async toggleCamera() {
    const btn = document.getElementById('btn-toggle-barrido-cam');
    if (this.isCameraActive) {
      await window.ScannerComponent.stop();
      this.isCameraActive = false;
      if (btn) btn.innerHTML = '<i class="fa-solid fa-video"></i> Activar Cámara';
    } else {
      if (btn) btn.innerHTML = '<i class="fa-solid fa-video-slash"></i> Detener Cámara';
      this.isCameraActive = true;
      await window.ScannerComponent.start('barrido-reader', (barcode) => {
        this.handleBarcodeRead(barcode);
      });
    }
  },

  async searchManual() {
    const input = document.getElementById('input-barrido-manual');
    const term = input.value.trim();
    if (!term) {
      window.Toast.warning('Ingrese un código de barras o SKU para buscar.');
      return;
    }

    const btn = document.getElementById('btn-search-barrido-manual');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    try {
      await this.handleBarcodeRead(term);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
      }
    }
  },

  async handleBarcodeRead(barcode) {
    const center = this.getSelectedCenter();
    try {
      const res = await window.API.searchBarrido(barcode, center);
      this.displayScannedItem(res);
      if (res.source === 'GOOGLE_SHEETS') {
        window.Toast.success(`✅ Encontrado en Google Sheets (Centro ${center}): ${res.item.SKU}`);
      } else if (res.source === 'EXISTING_INVENTORY') {
        window.Toast.success(`✅ Encontrado en inventario activo: ${res.item.SKU}`);
      } else {
        window.Toast.info(`ℹ️ SKU no registrado previamente: ${barcode}`);
      }
    } catch (err) {
      window.Toast.danger(err.message || 'Error al buscar producto');
    }
  },

  displayScannedItem(data) {
    this.currentScannedProduct = data;
    const item = data.item;

    document.getElementById('barrido-empty-state').style.display = 'none';
    const form = document.getElementById('form-barrido-count');
    form.style.display = 'block';

    // 1. Cargar Foto Referencial Superior
    const refImg = document.getElementById('barrido-product-ref-img');
    if (refImg) {
      const safeSku = encodeURIComponent(item.SKU || 'default');
      const safeBarcode = encodeURIComponent(item.Codigo_Barras || '');
      refImg.src = `/api/photos/reference/${safeSku}?barcode=${safeBarcode}&t=${Date.now()}`;
      refImg.alt = `Foto Referencial ${item.SKU}`;
    }

    // 2. Source Badge
    const sourceBadge = document.getElementById('barrido-source-badge');
    if (sourceBadge) {
      sourceBadge.style.display = 'inline-flex';
      if (data.source === 'GOOGLE_SHEETS') {
        sourceBadge.className = 'badge badge-info';
        sourceBadge.innerHTML = `<i class="fa-solid fa-table"></i> Google Sheets (${data.center || ''})`;
      } else if (data.source === 'EXISTING_INVENTORY') {
        sourceBadge.className = 'badge badge-success';
        sourceBadge.innerHTML = `<i class="fa-solid fa-box-archive"></i> Inventario Local`;
      } else {
        sourceBadge.className = 'badge badge-warning';
        sourceBadge.innerHTML = `<i class="fa-solid fa-plus-circle"></i> Nuevo en Pasillo`;
      }
    }

    // 3. SKU, Código de Barras y ABC
    document.getElementById('barrido-item-sku').textContent = item.SKU || '-';
    const barcodeSpan = document.getElementById('barrido-item-barcode');
    if (barcodeSpan) {
      barcodeSpan.textContent = item.Codigo_Barras ? `(Cód: ${item.Codigo_Barras})` : '';
    }
    document.getElementById('barrido-item-abc').textContent = `ABC: ${item.Clasificacion_ABC || 'C'}`;

    // 4. Descripción del Producto
    document.getElementById('barrido-item-desc').textContent = item.Descripcion || 'Sin descripción disponible';

    // 5. Ubicación Original
    const origLoc = item.UbicacionOriginal || item.Ubicacion || 'No asignada';
    document.getElementById('barrido-item-orig-loc').textContent = origLoc;

    // 6. Campos del Formulario
    document.getElementById('barrido-input-loc').value = item.Ubicacion || (origLoc !== 'No asignada' ? origLoc : '');
    document.getElementById('barrido-is-new-location').value = 'false';
    document.getElementById('barrido-loc-diff-alert').style.display = 'none';

    document.getElementById('barrido-input-qty').value = (item.Stock_Fisico !== null && item.Stock_Fisico !== undefined) ? item.Stock_Fisico : 1;
    document.getElementById('barrido-input-damaged').value = item.Mal_estado || 0;
    const commentInput = document.getElementById('barrido-input-comment');
    if (commentInput) commentInput.value = item.Comentario || '';

    const photoBox = document.getElementById('barrido-photo-box');
    photoBox.style.display = (item.Mal_estado > 0) ? 'block' : 'none';
    this.uploadedPhotoUrl = null;
    const previewImg = document.getElementById('img-barrido-preview');
    if (previewImg) previewImg.style.display = 'none';

    const qtyInput = document.getElementById('barrido-input-qty');
    if (qtyInput) {
      qtyInput.focus();
      qtyInput.select();
    }
  },

  resetBarridoForm() {
    this.currentScannedProduct = null;
    this.uploadedPhotoUrl = null;
    const form = document.getElementById('form-barrido-count');
    if (form) {
      form.reset();
      form.style.display = 'none';
    }
    const emptyState = document.getElementById('barrido-empty-state');
    if (emptyState) emptyState.style.display = 'block';

    const sourceBadge = document.getElementById('barrido-source-badge');
    if (sourceBadge) sourceBadge.style.display = 'none';

    const manualInput = document.getElementById('input-barrido-manual');
    if (manualInput) manualInput.value = '';

    const commentInput = document.getElementById('barrido-input-comment');
    if (commentInput) commentInput.value = '';

    const previewImg = document.getElementById('img-barrido-preview');
    if (previewImg) previewImg.style.display = 'none';

    const photoBox = document.getElementById('barrido-photo-box');
    if (photoBox) photoBox.style.display = 'none';
  }
};
