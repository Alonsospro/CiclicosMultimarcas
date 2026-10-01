// View: Dedicated Barrido Screen
window.BarridoView = {
  currentScannedProduct: null,
  isCameraActive: false,
  uploadedPhotoUrl: null,
  uploadedJustPhotoUrl: null,

  init() {
    this.setupListeners();
    this.updateCenterAccess();
  },

  initCenters() {
    this.updateCenterAccess();
  },

  updateCenterAccess() {
    const adminWrapper = document.getElementById('barrido-admin-center-wrapper');
    const userWrapper = document.getElementById('barrido-user-center-wrapper');
    const select = document.getElementById('barrido-select-center');
    const userCenterLabel = document.getElementById('barrido-user-center-label');

    const user = window.Auth?.currentUser;
    const isAdmin = !!(user && (user.role === 'ADMIN' || user.isSuperadmin));

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

    if (isAdmin) {
      // Administrator: can view, inspect, and select any center
      if (adminWrapper) adminWrapper.style.display = 'flex';
      if (userWrapper) userWrapper.style.display = 'none';
      if (select) {
        select.disabled = false;
        select.innerHTML = centers.map(c => `<option value="${c.code}">${c.displayName || c.name || c.code}</option>`).join('');
        if (user && user.center && user.center !== 'GLOBAL') {
          select.value = user.center;
        } else if (!select.value) {
          select.value = '1120';
        }
      }
    } else {
      // Auxiliares & Encargados: NO capability to select other warehouses
      // Automatically and strictly locked to the warehouse they belong to
      const userCenterCode = user?.center || '1120';
      const matchedCenter = centers.find(c => c.code === userCenterCode);
      const displayCenterName = matchedCenter?.displayName || (user?.centerName ? `${userCenterCode} - ${user.centerName}` : userCenterCode);

      if (adminWrapper) adminWrapper.style.display = 'none';
      if (userWrapper) userWrapper.style.display = 'inline-flex';
      if (userCenterLabel) userCenterLabel.textContent = displayCenterName;

      if (select) {
        // Single option locked to their assigned center
        select.innerHTML = `<option value="${userCenterCode}" selected>${displayCenterName}</option>`;
        select.value = userCenterCode;
        select.disabled = true;
      }
    }
  },

  getSelectedCenter() {
    const user = window.Auth?.currentUser;
    const isAdmin = !!(user && (user.role === 'ADMIN' || user.isSuperadmin));

    // Auxiliares and Encargados are strictly locked to their assigned warehouse
    if (!isAdmin) {
      return (user && user.center && user.center !== 'GLOBAL') ? user.center : '1120';
    }

    // Admins can select from dropdown
    const select = document.getElementById('barrido-select-center');
    if (select && select.value) return select.value;
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

    // Checkbox for manual additional location toggle
    document.getElementById('barrido-chk-is-new-loc')?.addEventListener('change', (e) => {
      const isNewLocInput = document.getElementById('barrido-is-new-location');
      if (isNewLocInput) {
        isNewLocInput.value = e.target.checked ? 'true' : 'false';
      }
      if (e.target.checked) {
        window.Toast.info('Modo multi-ubicación activado: se creará una nueva fila adicional.');
      } else {
        window.Toast.info('Modo actualización: se guardará esta ubicación en el ítem actual sin duplicar.');
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

      // Leer localmente como DataURL Base64 de inmediato para previsualizar y asegurar el payload
      const reader = new FileReader();
      reader.onload = (event) => {
        this.uploadedPhotoBase64 = event.target.result;
        if (previewImg) {
          previewImg.src = this.uploadedPhotoBase64;
          previewImg.style.display = 'block';
        }
      };
      reader.readAsDataURL(file);

      const center = this.getSelectedCenter();
      const sku = this.currentScannedProduct?.item?.SKU || this.currentScannedProduct?.SKU || document.getElementById('barrido-input-code')?.value || '';
      const dateStr = new Date().toISOString().split('T')[0];

      try {
        window.Toast.info('Subiendo evidencia a Google Drive...');
        const res = await window.API.uploadPhoto(file, {
          category: 'malestado',
          photoType: 'malestado',
          sku,
          center,
          date: dateStr,
          type: 'BARRIDO'
        });
        if (res.photo && res.photo.url) {
          this.uploadedPhotoUrl = res.photo.url;
          window.Toast.success('Foto de avería lista para guardar en Google Drive');
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al subir foto.');
      }
    });

    // Justification photo toggle and file selection
    const btnToggleJustPhoto = document.getElementById('btn-toggle-barrido-just-photo');
    const justPhotoBox = document.getElementById('barrido-just-photo-box');
    const lblToggleJustPhoto = document.getElementById('lbl-toggle-just-photo');
    const justPhotoZone = document.getElementById('zone-barrido-just-photo');
    const justPhotoInput = document.getElementById('input-barrido-just-photo-file');
    const justPreviewImg = document.getElementById('img-barrido-just-preview');

    btnToggleJustPhoto?.addEventListener('click', () => {
      if (!justPhotoBox) return;
      const isHidden = justPhotoBox.style.display === 'none' || !justPhotoBox.style.display;
      justPhotoBox.style.display = isHidden ? 'block' : 'none';
      if (lblToggleJustPhoto) {
        lblToggleJustPhoto.textContent = isHidden ? 'Ocultar' : 'Adjuntar Foto';
      }
    });

    justPhotoZone?.addEventListener('click', () => justPhotoInput?.click());

    justPhotoInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        this.uploadedJustPhotoBase64 = event.target.result;
        if (justPreviewImg) {
          justPreviewImg.src = this.uploadedJustPhotoBase64;
          justPreviewImg.style.display = 'block';
        }
      };
      reader.readAsDataURL(file);

      const center = this.getSelectedCenter();
      const sku = this.currentScannedProduct?.item?.SKU || this.currentScannedProduct?.SKU || document.getElementById('barrido-input-code')?.value || '';
      const dateStr = new Date().toISOString().split('T')[0];

      try {
        window.Toast.info('Subiendo foto de justificación a Google Drive...');
        const res = await window.API.uploadPhoto(file, {
          category: 'justificaciones',
          photoType: 'justificaciones',
          sku,
          center,
          date: dateStr,
          type: 'BARRIDO'
        });
        if (res.photo && res.photo.url) {
          this.uploadedJustPhotoUrl = res.photo.url;
          window.Toast.success('Foto de justificación vinculada con éxito');
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al subir foto de justificación.');
      }
    });

    // Form submit: Register Barrido Count
    document.getElementById('form-barrido-count')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!this.currentScannedProduct) return;

      const descInput = document.getElementById('barrido-input-desc');
      const itemDesc = descInput ? descInput.value.trim() : '';
      const loc = document.getElementById('barrido-input-loc').value.trim();
      const qtyVal = document.getElementById('barrido-input-qty').value;
      const damagedVal = document.getElementById('barrido-input-damaged').value;

      const qty = qtyVal !== '' ? parseInt(qtyVal, 10) : 0;
      const damaged = damagedVal !== '' ? parseInt(damagedVal, 10) : 0;

      if (!itemDesc) {
        window.Toast.warning('Debe ingresar el nombre o descripción del ítem.');
        descInput?.focus();
        return;
      }

      if (!loc) {
        window.Toast.warning('Debe ingresar la ubicación física.');
        document.getElementById('barrido-input-loc')?.focus();
        return;
      }

      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';
      }

      try {
        const item = this.currentScannedProduct.item;
        const isNewDiscovery = !this.currentScannedProduct.found || this.currentScannedProduct.source === 'NEW_DISCOVERY';
        const origLoc = item.UbicacionOriginal || item.Ubicacion || '';

        // Si es un ítem nuevo no registrado en sistema, la ubicación ingresada es la PRINCIPAL (isNewLocation = false)
        let isNewLoc = false;
        if (!isNewDiscovery) {
          // Solo si el contador lo activa explícitamente en la casilla de verificación
          const chk = document.getElementById('barrido-chk-is-new-loc');
          isNewLoc = !!(chk && chk.checked);
        }

        const center = this.getSelectedCenter();
        const comment = document.getElementById('barrido-input-comment')?.value.trim() || '';

        await window.API.registerBarridoCount({
          inventoryId: this.currentScannedProduct.inventoryId || null,
          itemId: item.id || null,
          sku: item.SKU,
          barcode: item.Codigo_Barras || '',
          descripcion: itemDesc,
          description: itemDesc,
          stockFisico: qty,
          malEstado: damaged,
          location: loc,
          isNewLocation: isNewLoc,
          center,
          photoUrl: this.uploadedPhotoUrl,
          photoBase64: this.uploadedPhotoBase64 || '',
          justificationPhotoUrl: this.uploadedJustPhotoUrl,
          justificationPhoto: this.uploadedJustPhotoBase64 || '',
          comentario: comment,
          categoria: 'repuesto',
          reason: isNewDiscovery 
            ? `Nuevo ítem detectado: Ubicación Principal asignada en ${loc}` 
            : (isNewLoc ? `Barrido: Ubicación adicional en ${loc}` : 'Barrido físico confirmado')
        });

        window.Toast.success(
          isNewDiscovery
            ? `✅ Registrado nuevo ítem '${itemDesc}' con ubicación principal '${loc}'`
            : (isNewLoc
                ? `✅ Registrado ${qty} unid. de ${item.SKU} como ubicación adicional en '${loc}'`
                : `✅ Registrado ${qty} unid. de ${item.SKU} en '${loc}'`)
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
      s === 'NO ASIGNADA' ||
      s === 'NUEVA_UBICACION'
    );
  },

  checkLocationDifference() {
    if (!this.currentScannedProduct) return;
    const origLoc = (this.currentScannedProduct.item?.UbicacionOriginal || this.currentScannedProduct.item?.Ubicacion || '').trim().toUpperCase();
    const currentLoc = (document.getElementById('barrido-input-loc')?.value || '').trim().toUpperCase();
    const alertBox = document.getElementById('barrido-loc-diff-alert');
    const noLocAlert = document.getElementById('barrido-no-loc-alert');
    const chkNewLoc = document.getElementById('barrido-chk-is-new-loc');
    const isNewLocInput = document.getElementById('barrido-is-new-location');

    const hasMissingOrigLoc = this.isInvalidOrMissingLocation(origLoc);

    if (hasMissingOrigLoc) {
      if (noLocAlert) noLocAlert.style.display = 'block';
      if (alertBox) alertBox.style.display = 'none';
      if (isNewLocInput) isNewLocInput.value = 'false';
      if (chkNewLoc) chkNewLoc.checked = false;
      return;
    } else {
      if (noLocAlert) noLocAlert.style.display = 'none';
    }

    if (currentLoc && origLoc && currentLoc !== origLoc) {
      if (alertBox) alertBox.style.display = 'block';
      // ONLY set isNewLocation if manual checkbox is checked! Do NOT auto-set to true!
      if (isNewLocInput) isNewLocInput.value = (chkNewLoc && chkNewLoc.checked) ? 'true' : 'false';
    } else {
      if (alertBox) alertBox.style.display = 'none';
      if (isNewLocInput) isNewLocInput.value = 'false';
      if (chkNewLoc) chkNewLoc.checked = false;
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
    const isNewDiscovery = !data.found || data.source === 'NEW_DISCOVERY';

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
        sourceBadge.innerHTML = `<i class="fa-solid fa-sparkles"></i> Nuevo / Descubierto en Pasillo`;
      }
    }

    // 3. SKU, Código de Barras y ABC
    document.getElementById('barrido-item-sku').textContent = item.SKU || '-';
    const barcodeSpan = document.getElementById('barrido-item-barcode');
    if (barcodeSpan) {
      barcodeSpan.textContent = item.Codigo_Barras ? `(Cód: ${item.Codigo_Barras})` : '';
    }
    document.getElementById('barrido-item-abc').textContent = `ABC: ${item.Clasificacion_ABC || 'C'}`;

    // 4. Descripción del Producto / Nombre
    const descInput = document.getElementById('barrido-input-desc');
    if (descInput) {
      if (isNewDiscovery) {
        descInput.value = (item.Descripcion && !item.Descripcion.includes('Ítem Descubierto')) ? item.Descripcion : '';
        descInput.placeholder = 'Escriba el nombre o descripción del repuesto...';
      } else {
        descInput.value = item.Descripcion || '';
        descInput.placeholder = 'Nombre o descripción del repuesto...';
      }
    }

    // 5. Configuración de Ubicación Principal vs Existente
    const origLocContainer = document.getElementById('barrido-orig-loc-container');
    const newItemNotice = document.getElementById('barrido-new-item-notice');
    const locLabel = document.getElementById('barrido-loc-label');
    const primaryLocAlert = document.getElementById('barrido-primary-loc-alert');
    const locDiffAlert = document.getElementById('barrido-loc-diff-alert');
    const locInput = document.getElementById('barrido-input-loc');
    const isNewLocInput = document.getElementById('barrido-is-new-location');

    if (isNewDiscovery) {
      if (origLocContainer) origLocContainer.style.display = 'none';
      if (newItemNotice) newItemNotice.style.display = 'block';
      if (locLabel) locLabel.innerHTML = '<i class="fa-solid fa-star" style="color: #38bdf8;"></i> Ubicación Física Principal:';
      if (primaryLocAlert) primaryLocAlert.style.display = 'block';
      if (locDiffAlert) locDiffAlert.style.display = 'none';
      if (isNewLocInput) isNewLocInput.value = 'false';
      if (locInput) {
        locInput.value = item.Ubicacion || '';
        locInput.placeholder = 'Ej: RACK-A1-02 (Asignar como Ubicación Principal)...';
      }
      if (descInput && !descInput.value) {
        descInput.focus();
      } else if (locInput) {
        locInput.focus();
      }
    } else {
      if (origLocContainer) origLocContainer.style.display = 'flex';
      if (newItemNotice) newItemNotice.style.display = 'none';
      if (locLabel) locLabel.innerHTML = '<i class="fa-solid fa-location-dot"></i> Ubicación Física Contada:';
      if (primaryLocAlert) primaryLocAlert.style.display = 'none';
      const origLoc = item.UbicacionOriginal || item.Ubicacion || 'No asignada';
      const hasMissingLoc = this.isInvalidOrMissingLocation(origLoc);
      const origLocSpan = document.getElementById('barrido-item-orig-loc');
      if (origLocSpan) {
        if (hasMissingLoc) {
          origLocSpan.innerHTML = '<span style="color: #ef4444; font-weight: 800; background: rgba(239, 68, 68, 0.2); padding: 2px 8px; border-radius: 4px; border: 1.5px solid #ef4444;"><i class="fa-solid fa-triangle-exclamation"></i> SIN UBICACIÓN</span>';
        } else {
          origLocSpan.textContent = origLoc;
        }
      }
      if (locInput) {
        locInput.value = item.Ubicacion || (origLoc !== 'No asignada' && !hasMissingLoc ? origLoc : '');
        locInput.placeholder = 'Ej: RACK-A1-02...';
      }
      if (isNewLocInput) isNewLocInput.value = 'false';
      const chkNewLoc = document.getElementById('barrido-chk-is-new-loc');
      if (chkNewLoc) chkNewLoc.checked = false;
      this.checkLocationDifference();
      const qtyInput = document.getElementById('barrido-input-qty');
      if (qtyInput) {
        qtyInput.focus();
        qtyInput.select();
      }
    }

    // 6. Cantidades, comentarios y fotos
    document.getElementById('barrido-input-qty').value = (item.Stock_Fisico !== null && item.Stock_Fisico !== undefined) ? item.Stock_Fisico : 1;
    document.getElementById('barrido-input-damaged').value = item.Mal_estado || 0;
    const commentInput = document.getElementById('barrido-input-comment');
    if (commentInput) commentInput.value = item.Comentario || '';

    const photoBox = document.getElementById('barrido-photo-box');
    photoBox.style.display = (item.Mal_estado > 0) ? 'block' : 'none';
    this.uploadedPhotoUrl = null;
    this.uploadedPhotoBase64 = null;
    const previewImg = document.getElementById('img-barrido-preview');
    if (previewImg) previewImg.style.display = 'none';

    this.uploadedJustPhotoUrl = null;
    this.uploadedJustPhotoBase64 = null;
    const justPhotoBox = document.getElementById('barrido-just-photo-box');
    if (justPhotoBox) justPhotoBox.style.display = 'none';
    const justPreviewImg = document.getElementById('img-barrido-just-preview');
    if (justPreviewImg) justPreviewImg.style.display = 'none';
    const lblToggleJustPhoto = document.getElementById('lbl-toggle-just-photo');
    if (lblToggleJustPhoto) lblToggleJustPhoto.textContent = 'Adjuntar Foto';
  },

  resetBarridoForm() {
    this.currentScannedProduct = null;
    this.uploadedPhotoUrl = null;
    this.uploadedPhotoBase64 = null;
    this.uploadedJustPhotoUrl = null;
    this.uploadedJustPhotoBase64 = null;
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

    const descInput = document.getElementById('barrido-input-desc');
    if (descInput) descInput.value = '';

    const commentInput = document.getElementById('barrido-input-comment');
    if (commentInput) commentInput.value = '';

    const previewImg = document.getElementById('img-barrido-preview');
    if (previewImg) previewImg.style.display = 'none';

    const photoBox = document.getElementById('barrido-photo-box');
    if (photoBox) photoBox.style.display = 'none';

    const justPhotoBox = document.getElementById('barrido-just-photo-box');
    if (justPhotoBox) justPhotoBox.style.display = 'none';
    const justPreviewImg = document.getElementById('img-barrido-just-preview');
    if (justPreviewImg) justPreviewImg.style.display = 'none';
    const lblToggleJustPhoto = document.getElementById('lbl-toggle-just-photo');
    if (lblToggleJustPhoto) lblToggleJustPhoto.textContent = 'Adjuntar Foto';

    const primaryLocAlert = document.getElementById('barrido-primary-loc-alert');
    if (primaryLocAlert) primaryLocAlert.style.display = 'none';
    const locDiffAlert = document.getElementById('barrido-loc-diff-alert');
    if (locDiffAlert) locDiffAlert.style.display = 'none';
    const noLocAlert = document.getElementById('barrido-no-loc-alert');
    if (noLocAlert) noLocAlert.style.display = 'none';
    const chkNewLoc = document.getElementById('barrido-chk-is-new-loc');
    if (chkNewLoc) chkNewLoc.checked = false;
    const isNewLocInput = document.getElementById('barrido-is-new-location');
    if (isNewLocInput) isNewLocInput.value = 'false';
    const newItemNotice = document.getElementById('barrido-new-item-notice');
    if (newItemNotice) newItemNotice.style.display = 'none';
  }
};
