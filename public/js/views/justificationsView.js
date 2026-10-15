// View: Justifications & Final Review Closure (Admin Only)
window.JustificationsView = {
  tasks: [],
  expandedTaskIds: new Set(),
  uploadedPhotoUrl: null,
  viewMode: 'list', // 'list' | 'popup'
  currentInventoryId: null,
  currentItemIndex: 0,

  init() {
    this.setupListeners();
  },

  setViewMode(mode) {
    this.viewMode = mode;
    document.querySelectorAll('.just-view-mode-btn').forEach(btn => {
      if (btn.dataset.mode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (mode === 'popup') {
      // Find first task with pending items to open modal immediately
      const targetTask = this.tasks.find(t => (t.items || []).some(it => !it.isJustified && it.corroborationStatus !== 'CUADRA')) || this.tasks[0];
      if (targetTask && targetTask.items && targetTask.items.length > 0) {
        const pendingIndex = targetTask.items.findIndex(it => !it.isJustified && it.corroborationStatus !== 'CUADRA');
        const firstIndex = pendingIndex >= 0 ? pendingIndex : 0;
        this.openJustifyModalAtIndex(targetTask.inventoryId, firstIndex);
      } else {
        window.Toast.info('No hay ítems discrepantes para mostrar en vista pop-up.');
      }
    }
  },

  setupListeners() {
    // Center & Status filters for justifications
    document.getElementById('filter-just-center')?.addEventListener('change', () => this.loadJustifications());
    document.getElementById('filter-just-status')?.addEventListener('change', () => this.loadJustifications());

    // Justification photo upload with immediate Google Drive sync
    const photoZone = document.getElementById('zone-just-photo');
    const photoInput = document.getElementById('input-just-photo-file');
    const previewImg = document.getElementById('img-just-preview');
    const statusDiv = document.getElementById('just-photo-status');

    photoZone?.addEventListener('click', () => photoInput.click());

    photoInput?.addEventListener('change', async (e) => {
      const rawFile = e.target.files[0];
      if (!rawFile) return;

      const inventoryId = document.getElementById('just-modal-inv-id')?.value;
      const sku = document.getElementById('just-modal-sku-input')?.value;
      const itemId = document.getElementById('just-modal-item-id')?.value || '';
      const almacen = document.getElementById('just-modal-almacen-input')?.value || '';
      const task = this.tasks?.find(t => t.inventoryId === inventoryId);

      const center = task ? task.center : (window.Auth.currentUser?.center || '1120');
      const dateStr = new Date().toISOString().split('T')[0];

      try {
        if (statusDiv) {
          statusDiv.style.display = 'block';
          statusDiv.innerHTML = '<span style="color: var(--primary); display: flex; align-items: center; gap: 6px;"><i class="fa-solid fa-spinner fa-spin"></i> Optimizando y subiendo inmediatamente a Google Drive...</span>';
        }
        window.Toast.info('Subiendo imagen de justificación a Google Drive...');

        // Client-side quick compression to ensure instant upload without exceeding quotas
        const file = await this.compressImage(rawFile);

        const isSecondJust = !!(this.currentIsSecondJustification || document.getElementById('just-modal-is-second-just')?.value === 'true');

        const res = await window.API.uploadPhoto(file, {
          category: 'justificaciones',
          photoType: 'justificaciones',
          sku: sku || '',
          almacen,
          center: center,
          date: dateStr,
          inventoryId: inventoryId || '',
          itemId,
          type: task?.type || 'CICLICO',
          prefix: isSecondJust ? 'JS2' : '',
          isJustification2: isSecondJust,
          round: isSecondJust ? 2 : 1
        });

        if (res.photo && (res.photo.driveUrl || res.photo.url)) {
          const driveUrl = res.photo.driveUrl || res.photo.url;
          const driveFileId = res.photo.driveFileId || '';
          const previewSrc = res.photo.thumbnailUrl || res.photo.url;
          const uploadedFileName = res.photo.name || (isSecondJust ? `JS2_${sku}.jpg` : `${sku}.jpg`);

          this.uploadedPhotoUrl = driveUrl;
          this.uploadedDriveUrl = driveUrl;
          this.uploadedDriveFileId = driveFileId;

          document.getElementById('just-photo-url').value = driveUrl;
          const driveUrlInput = document.getElementById('just-drive-url');
          if (driveUrlInput) driveUrlInput.value = driveUrl;
          const driveFileIdInput = document.getElementById('just-drive-file-id');
          if (driveFileIdInput) driveFileIdInput.value = driveFileId;

          previewImg.src = previewSrc;
          previewImg.style.display = 'block';

          if (statusDiv) {
            const folderPath = res.photo?.driveFolderPath || 'nibol/ciclicos/fotos/justificaciones';
            statusDiv.style.display = 'block';
            statusDiv.innerHTML = `
              <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.4); padding: 8px 12px; border-radius: 6px; color: #22c55e;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <span><i class="fa-brands fa-google-drive"></i> ${isSecondJust ? 'Foto 2da Justificación (' + uploadedFileName + ')' : 'Subida exitosa a Google Drive'}</span>
                  ${driveUrl ? `<a href="${driveUrl}" target="_blank" class="btn btn-xs btn-secondary" style="font-size: 0.75rem; text-decoration: none;"><i class="fa-solid fa-external-link"></i> Abrir en Drive</a>` : ''}
                </div>
                <div style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">
                  <i class="fa-solid fa-folder-tree"></i> Archivo: <strong style="color: #38bdf8;">${uploadedFileName}</strong> | Ruta: <strong style="color: #e2e8f0;">${folderPath}</strong>
                </div>
              </div>
            `;
          }
          window.Toast.success(isSecondJust ? `Foto de 2da justificación (${uploadedFileName}) subida a Google Drive` : 'Foto subida y guardada inmediatamente en Google Drive');
        }
      } catch (err) {
        if (statusDiv) {
          statusDiv.style.display = 'block';
          statusDiv.innerHTML = `<span style="color: var(--danger);"><i class="fa-solid fa-circle-exclamation"></i> Error: ${err.message}</span>`;
        }
        window.Toast.danger(err.message || 'Error al subir foto de respaldo a Google Drive');
      }
    });

    // Form submit: Save Justification
    document.getElementById('form-submit-justification')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.saveCurrentModalJustification(false);
    });

    // Form submit: Reabrir Inventario (1er Conteo / Reconteo 1 / Reconteo 2 y Sincronización)
    document.getElementById('form-reopen-inventory')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inventoryId = document.getElementById('reopen-modal-inv-id')?.value;
      if (!inventoryId) return;

      const selectedRadio = document.querySelector('input[name="reopen-target-phase"]:checked');
      const targetPhase = selectedRadio ? selectedRadio.value : '1ER_CONTEO';
      const syncFromGAS = document.getElementById('reopen-chk-sync-gas')?.checked ?? true;
      const reason = document.getElementById('reopen-modal-reason')?.value || 'Reapertura para actualización de cantidades';

      const submitBtn = document.getElementById('btn-submit-reopen');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reabriendo y Sincronizando...';
      }

      try {
        window.Toast.info('Reabriendo inventario y sincronizando cantidades con Google Sheets...');
        const res = await window.API.reopenInventory(inventoryId, {
          targetPhase,
          syncFromGAS,
          reason
        });

        window.ModalHelper.close('modal-reopen-inventory');
        window.Toast.success(res.message || `Inventario reabierto con éxito en fase ${targetPhase}`);
        
        if (this.expandedTaskIds) {
          this.expandedTaskIds.add(inventoryId);
        }
        await this.loadJustifications();
      } catch (err) {
        window.Toast.danger(err.message || 'Error al reabrir inventario');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fa-solid fa-lock-open"></i> Confirmar y Reabrir';
        }
      }
    });

    // Form submit: Actualizar Cantidad de Conteo
    document.getElementById('form-edit-count-justification')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inventoryId = document.getElementById('edit-count-inv-id')?.value;
      const sku = document.getElementById('edit-count-sku')?.value;
      const itemId = document.getElementById('edit-count-item-id')?.value;
      const location = document.getElementById('edit-count-location')?.value;
      const almacen = document.getElementById('edit-count-almacen')?.value;
      const selectedPhase = document.querySelector('input[name="edit-count-phase"]:checked')?.value || '1ER_CONTEO';
      const stockFisico = Number(document.getElementById('edit-count-stock-fisico')?.value || 0);
      const malEstado = Number(document.getElementById('edit-count-mal-estado')?.value || 0);
      const reason = document.getElementById('edit-count-reason')?.value || '';

      const submitBtn = document.getElementById('btn-save-edit-count');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando y Sincronizando...';
      }

      try {
        window.Toast.info('Actualizando cantidad en inventario y sincronizando con Google Sheets...');
        const res = await window.API.updateCountItem(inventoryId, {
          sku,
          itemId,
          location,
          almacen,
          countPhase: selectedPhase,
          stockFisico,
          malEstado,
          reason
        });

        window.ModalHelper.close('modal-edit-count-justification');
        window.Toast.success(res.message || 'Cantidad actualizada y sincronizada exitosamente');

        if (this.expandedTaskIds) {
          this.expandedTaskIds.add(inventoryId);
        }
        await this.loadJustifications();
      } catch (err) {
        window.Toast.danger(err.message || 'Error al actualizar cantidad');
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<i class="fa-solid fa-save"></i> Guardar y Sincronizar';
        }
      }
    });

    // Cambios dinámicos de fase e inputs en modal de edición de cantidades
    document.querySelectorAll('input[name="edit-count-phase"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.updateEditCountFieldsFromPhase(e.target.value);
      });
    });

    document.getElementById('edit-count-stock-fisico')?.addEventListener('input', () => this.recalculateEditCountPreview());
    document.getElementById('edit-count-mal-estado')?.addEventListener('input', () => this.recalculateEditCountPreview());

    // Keyboard shortcuts for modal navigation (Left arrow, Right arrow, Ctrl+Enter)
    window.addEventListener('keydown', (e) => {
      const modal = document.getElementById('modal-justification');
      if (!modal || !modal.classList.contains('active')) return;

      // Ignore when user is actively typing inside the justification textarea or an input
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      const isTyping = activeTag === 'textarea' || activeTag === 'input';

      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        this.saveCurrentModalJustification(false);
        return;
      }

      if (!isTyping) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          this.navigatePopup(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          this.navigatePopup(1);
        }
      }
    });
  },

  async compressImage(file, maxDimension = 1600, quality = 0.85) {
    return new Promise((resolve) => {
      if (!file.type || !file.type.startsWith('image/') || file.type.includes('svg')) {
        return resolve(file);
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (blob && blob.size < file.size) {
                const compressedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                });
                resolve(compressedFile);
              } else {
                resolve(file);
              }
            },
            'image/jpeg',
            quality
          );
        };
        img.onerror = () => resolve(file);
        img.src = e.target.result;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  },

  toggleTaskDetails(inventoryId) {
    if (this.expandedTaskIds.has(inventoryId)) {
      this.expandedTaskIds.delete(inventoryId);
    } else {
      this.expandedTaskIds.add(inventoryId);
    }
    this.renderTasks();
  },

  reviewAction(task) {
    if (task.isFinalized || task.status === 'REVISADO') return '<span class="badge badge-success">Finalizado en Drive · Solo lectura</span>';
    if (task.status === 'EN_RECONTEO') return '<span class="badge badge-info">Reconteo en curso · Justificación bloqueada</span>';
    if (task.canEnableRecount) return `<button type="button" class="btn btn-warning" onclick="window.JustificationsView.enableRecount('${task.inventoryId}')">Habilitar Reconteo</button>`;
    if (task.canClose) return `<button type="button" id="btn-finish-just-${task.inventoryId}" class="btn btn-success" onclick="window.JustificationsView.finishReview('${task.inventoryId}')">Finalizar Inventario y Crear Copia en Drive</button>`;
    return '<span class="badge badge-warning">Complete las justificaciones pendientes para continuar</span>';
  },

  reviewHistory(item) {
    const escape = value => String(value || '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
    return (item.justificationHistory || []).map(entry => `<div style="margin-bottom:6px; white-space:normal; overflow-wrap:anywhere;"><strong>${entry.round}ª justificación · ${escape(entry.corroboracion)}</strong><br>${escape(entry.justification)}${window.InventoryContract?.isWeekly(item) && window.InventoryContract.has(entry.justifiedQuantity) ? `<br>Compensación: ${Number(entry.justifiedQuantity) > 0 ? '+' : ''}${escape(entry.justifiedQuantity)}` : ''}<br><small>${escape(entry.reviewedBy)} · ${escape(entry.reviewedAt)}</small></div>`).join('') || '-';
  },

  async loadJustifications() {
    const container = document.getElementById('justifications-container');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center; padding: 3rem;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando inventarios para justificación...</div>';

    try {
      const centerSelect = document.getElementById('filter-just-center');
      if (centerSelect && window.Auth.currentUser?.role === 'ENCARGADO') {
        centerSelect.value = window.Auth.currentUser.center;
        centerSelect.disabled = true;
      }

      const selectedCenter = centerSelect ? centerSelect.value : 'TODOS';
      const center = (selectedCenter && selectedCenter !== 'TODOS') ? selectedCenter : undefined;
      const statusSelect = document.getElementById('filter-just-status');
      const selectedStatus = statusSelect ? statusSelect.value : 'ALL';

      const res = await window.API.getJustifications(center, {
        status: selectedStatus,
        includeFinalized: selectedStatus === 'ALL' || selectedStatus === 'REVISADO'
      });
      this.tasks = (res.tasks || []).filter(task => task.isFinalized || ['PENDIENTE_JUSTIFICACION', 'EN_RECONTEO', 'RECONTEO_COMPLETADO'].includes(task.status));

      this.renderTasks();
    } catch (err) {
      container.innerHTML = `<div style="padding: 2rem; color: var(--danger); text-align: center;">Error al cargar justificaciones: ${err.message}</div>`;
    }
  },

  renderTasks() {
    const container = document.getElementById('justifications-container');
    if (!container) return;

    if (this.tasks.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 3.5rem 1.5rem; color: var(--text-dim); background: var(--bg-card); border-radius: 12px; border: 1px dashed var(--border-glass);">
          <i class="fa-solid fa-circle-check" style="font-size: 3rem; color: var(--success); margin-bottom: 1rem; display: block;"></i>
          <h3 style="color: var(--text-main); font-weight: 700; margin-bottom: 0.5rem;">No hay inventarios pendientes de justificar</h3>
          <p style="font-size: 0.9rem; max-width: 480px; margin: 0 auto;">Todos los inventarios están conciliados o revisados sin diferencias pendientes.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.tasks.map(task => {
      const isExpanded = this.expandedTaskIds.has(task.inventoryId);
      const isFinalized = task.status === 'REVISADO' || task.isFinalized === true;
      const isReconteoTask = !!(task.isReconteo || task.phase === 'RECONTEO' || task.hasRecount || String(task.inventoryId).startsWith('REC-') || task.status === 'RECONTEO_COMPLETADO');

      const hasItemDiscrepancy = (it) => {
        const corr = String(it.corroborationStatus || it.corroboracion || it.Estado || '').toUpperCase().trim();
        if (corr === 'CUADRA' || it.isCuadra === true) return false;

        const sys = Number(it.Stock_Sistema ?? it.stockSistema ?? 0);
        const damaged = Number(it.Mal_estado ?? it.malEstado ?? 0);

        const hasRec2 = (it.Stock_Total_Reconteo_2 !== null && it.Stock_Total_Reconteo_2 !== undefined && String(it.Stock_Total_Reconteo_2).trim() !== '') ||
                        (it.Diferencia_Final_2 !== null && it.Diferencia_Final_2 !== undefined && String(it.Diferencia_Final_2).trim() !== '') ||
                        (it.Reconteo_2 !== null && it.Reconteo_2 !== undefined && String(it.Reconteo_2).trim() !== '');

        const hasRec1 = (it.Stock_Total_Reconteo !== null && it.Stock_Total_Reconteo !== undefined && String(it.Stock_Total_Reconteo).trim() !== '') ||
                        (it.Diferencia_Final !== null && it.Diferencia_Final !== undefined && String(it.Diferencia_Final).trim() !== '') ||
                        (it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined && String(it.Reconteo_Fisico).trim() !== '') ||
                        (it.Reconteo !== null && it.Reconteo !== undefined && String(it.Reconteo).trim() !== '');

        // 1. Reconteo 2
        if (hasRec2) {
          const recDam2 = (it.Malestado_Reconteo_2 !== null && it.Malestado_Reconteo_2 !== undefined && String(it.Malestado_Reconteo_2).trim() !== '') ? Number(it.Malestado_Reconteo_2) : 0;
          const recPhys2 = (it.Reconteo_2 !== null && it.Reconteo_2 !== undefined && String(it.Reconteo_2).trim() !== '') ? Number(it.Reconteo_2) : 0;
          if (sys < 0 && recPhys2 === 0 && recDam2 === 0) return false;
          const recTot2 = (it.Stock_Total_Reconteo_2 !== null && it.Stock_Total_Reconteo_2 !== undefined && String(it.Stock_Total_Reconteo_2).trim() !== '') ? Number(it.Stock_Total_Reconteo_2) : (recPhys2 + recDam2);
          const finalDiff2 = (it.Diferencia_Final_2 !== null && it.Diferencia_Final_2 !== undefined && String(it.Diferencia_Final_2).trim() !== '') ? Number(it.Diferencia_Final_2) : (recTot2 - sys);
          return (finalDiff2 !== 0 || recDam2 > 0);
        }

        // 2. Reconteo 1
        if (hasRec1) {
          const recDam1 = (it.Reconteo_Mal_Estado !== null && it.Reconteo_Mal_Estado !== undefined && String(it.Reconteo_Mal_Estado).trim() !== '') ? Number(it.Reconteo_Mal_Estado) : ((it.Malestado_Reconteo !== null && it.Malestado_Reconteo !== undefined && String(it.Malestado_Reconteo).trim() !== '') ? Number(it.Malestado_Reconteo) : damaged);
          const recPhys1 = (it.Reconteo !== null && it.Reconteo !== undefined && String(it.Reconteo).trim() !== '') ? Number(it.Reconteo) : ((it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined && String(it.Reconteo_Fisico).trim() !== '') ? Number(it.Reconteo_Fisico) : 0);
          if (sys < 0 && recPhys1 === 0 && recDam1 === 0) return false;
          const recTot1 = (it.Stock_Total_Reconteo !== null && it.Stock_Total_Reconteo !== undefined && String(it.Stock_Total_Reconteo).trim() !== '') ? Number(it.Stock_Total_Reconteo) : (recPhys1 + recDam1);
          const finalDiff1 = (it.Diferencia_Final !== null && it.Diferencia_Final !== undefined && String(it.Diferencia_Final).trim() !== '') ? Number(it.Diferencia_Final) : (recTot1 - sys);
          return (finalDiff1 !== 0 || recDam1 > 0);
        }

        // 3. Primer conteo
        const phys = Number(it.Stock_Buen_Estado ?? it.Stock_Fisico ?? 0);
        if (sys < 0 && damaged === 0 && phys === 0) return false;

        const diff = (it.Diferencia !== null && it.Diferencia !== undefined && String(it.Diferencia).trim() !== '') ? Number(it.Diferencia) : (phys + damaged - sys);
        const costDiff = Number(it.Costo_Diferencia ?? it.costoDiferencia ?? 0);
        return (diff !== 0 || damaged > 0 || Math.abs(costDiff) > 0.001);
      };

      const itemsWithDiff = (task.items || []).filter(hasItemDiscrepancy);
      const isRecountInProgress = !isFinalized && task.status === 'EN_RECONTEO';

      const hasRecountData = isReconteoTask || (task.items || []).some(it => it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined && it.Reconteo_Fisico !== '');
      const hasRec2Data = (task.items || []).some(it => (it.Reconteo_2 !== undefined && it.Reconteo_2 !== null && String(it.Reconteo_2).trim() !== '') || (it.Stock_Total_Reconteo_2 !== undefined && it.Stock_Total_Reconteo_2 !== null && String(it.Stock_Total_Reconteo_2).trim() !== ''));

      // 1er Conteo metrics
      let initialDiffCostTotal = 0;
      let initialFaltantesCost = 0;
      let initialSobrantesCost = 0;

      // Post-Reconteo metrics
      let finalDiffCostTotal = 0;
      let finalFaltantesCost = 0;
      let finalSobrantesCost = 0;
      let finalDamagedCount = 0;
      let finalDamagedCost = 0;
      let reconciledItemsCount = 0;

      (task.items || []).forEach(it => {
        const sys = Number(it.Stock_Sistema || 0);
        const cost = Number(it.Costo_Unitario || 0);
        const phys1 = (it.Stock_Buen_Estado !== null && it.Stock_Buen_Estado !== undefined && String(it.Stock_Buen_Estado).trim() !== '')
          ? Number(it.Stock_Buen_Estado)
          : ((it.Stock_Fisico !== null && it.Stock_Fisico !== undefined) ? Number(it.Stock_Fisico) : 0);
        const dam1 = Number(it.Mal_estado || 0);
        const isNeg1Match = false; // Physical totals never inherit negative system stock.

        const diff1 = isNeg1Match ? 0 : ((it.Diferencia !== null && it.Diferencia !== undefined && String(it.Diferencia).trim() !== '')
          ? Number(it.Diferencia)
          : (phys1 - sys));
        const costDiff1 = isNeg1Match ? 0 : ((it.Costo_Diferencia !== null && it.Costo_Diferencia !== undefined && String(it.Costo_Diferencia).trim() !== '')
          ? Number(it.Costo_Diferencia)
          : (diff1 * cost));

        initialDiffCostTotal += Math.abs(costDiff1);
        if (costDiff1 < 0) initialFaltantesCost += Math.abs(costDiff1);
        if (costDiff1 > 0) initialSobrantesCost += costDiff1;

        const hasRec2 = (it.Stock_Total_Reconteo_2 !== undefined && it.Stock_Total_Reconteo_2 !== null && String(it.Stock_Total_Reconteo_2).trim() !== '') ||
                        (it.Diferencia_Final_2 !== undefined && it.Diferencia_Final_2 !== null && String(it.Diferencia_Final_2).trim() !== '') ||
                        (it.Reconteo_2 !== undefined && it.Reconteo_2 !== null && String(it.Reconteo_2).trim() !== '');

        const hasRec1 = (it.Stock_Total_Reconteo !== undefined && it.Stock_Total_Reconteo !== null && String(it.Stock_Total_Reconteo).trim() !== '') ||
                        (it.Diferencia_Final !== undefined && it.Diferencia_Final !== null && String(it.Diferencia_Final).trim() !== '') ||
                        (it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined && String(it.Reconteo_Fisico).trim() !== '') ||
                        (it.Reconteo !== null && it.Reconteo !== undefined && String(it.Reconteo).trim() !== '');

        let physFinal = phys1;
        let damFinal = dam1;
        let diffFinal = diff1;
        let costDiffFinal = costDiff1;
        let hasAnyRec = false;

        if (hasRec2) {
          hasAnyRec = true;
          damFinal = (it.Malestado_Reconteo_2 !== null && it.Malestado_Reconteo_2 !== undefined && String(it.Malestado_Reconteo_2).trim() !== '')
            ? Number(it.Malestado_Reconteo_2)
            : 0;
          const recPhys2 = (it.Reconteo_2 !== null && it.Reconteo_2 !== undefined && String(it.Reconteo_2).trim() !== '')
            ? Number(it.Reconteo_2)
            : 0;
          // Toma Columna AJ para el stock total de reconteo 2
          physFinal = (it.Stock_Total_Reconteo_2 !== null && it.Stock_Total_Reconteo_2 !== undefined && String(it.Stock_Total_Reconteo_2).trim() !== '')
            ? Number(it.Stock_Total_Reconteo_2)
            : (recPhys2 + damFinal);

          const isNegFinal2 = (sys < 0 && recPhys2 === 0 && damFinal === 0);
          // Mantiene Columna AM para la diferencia total final del reconteo 2
          diffFinal = isNegFinal2 ? 0 : ((it.Diferencia_Final_2 !== null && it.Diferencia_Final_2 !== undefined && String(it.Diferencia_Final_2).trim() !== '')
            ? Number(it.Diferencia_Final_2)
            : (physFinal - sys));
          costDiffFinal = isNegFinal2 ? 0 : ((it.Costo_Diferencia_Final_2 !== null && it.Costo_Diferencia_Final_2 !== undefined && String(it.Costo_Diferencia_Final_2).trim() !== '')
            ? Number(it.Costo_Diferencia_Final_2)
            : (diffFinal * cost));
        } else if (hasRec1) {
          hasAnyRec = true;
          damFinal = (it.Reconteo_Mal_Estado !== null && it.Reconteo_Mal_Estado !== undefined && String(it.Reconteo_Mal_Estado).trim() !== '')
            ? Number(it.Reconteo_Mal_Estado)
            : ((it.Malestado_Reconteo !== null && it.Malestado_Reconteo !== undefined && String(it.Malestado_Reconteo).trim() !== '')
                ? Number(it.Malestado_Reconteo)
                : dam1);
          const recPhys1 = (it.Reconteo !== null && it.Reconteo !== undefined && String(it.Reconteo).trim() !== '')
            ? Number(it.Reconteo)
            : ((it.Reconteo_Fisico !== null && it.Reconteo_Fisico !== undefined && String(it.Reconteo_Fisico).trim() !== '') ? Number(it.Reconteo_Fisico) : 0);
          // Toma Columna Y para el stock total de reconteo 1
          physFinal = (it.Stock_Total_Reconteo !== null && it.Stock_Total_Reconteo !== undefined && String(it.Stock_Total_Reconteo).trim() !== '')
            ? Number(it.Stock_Total_Reconteo)
            : (recPhys1 + damFinal);

          const isNegFinal1 = (sys < 0 && recPhys1 === 0 && damFinal === 0);
          // Mantiene Columna AB para la diferencia total final del reconteo 1
          diffFinal = isNegFinal1 ? 0 : ((it.Diferencia_Final !== null && it.Diferencia_Final !== undefined && String(it.Diferencia_Final).trim() !== '')
            ? Number(it.Diferencia_Final)
            : (physFinal - sys));
          costDiffFinal = isNegFinal1 ? 0 : ((it.Costo_Diferencia_Final !== null && it.Costo_Diferencia_Final !== undefined && String(it.Costo_Diferencia_Final).trim() !== '')
            ? Number(it.Costo_Diferencia_Final)
            : (diffFinal * cost));
        }

        if (window.InventoryContract?.isWeekly(it)) {
          physFinal = window.InventoryContract.finalQuantity(it);
          diffFinal = physFinal - sys;
          costDiffFinal = diffFinal * cost;
        }
        finalDiffCostTotal += Math.abs(costDiffFinal);
        if (costDiffFinal < 0) finalFaltantesCost += Math.abs(costDiffFinal);
        if (costDiffFinal > 0) finalSobrantesCost += costDiffFinal;

        finalDamagedCount += damFinal;
        finalDamagedCost += (damFinal * cost);

        if (hasAnyRec && diffFinal === 0 && damFinal === 0 && (diff1 !== 0 || Number(it.Mal_estado || 0) > 0)) {
          reconciledItemsCount++;
        }
      });

      const clarifiedCost = Math.max(0, initialDiffCostTotal - finalDiffCostTotal);
      const totalCost = hasRecountData || task.items?.some(it => window.InventoryContract?.isWeekly(it)) ? finalDiffCostTotal : initialDiffCostTotal;
      const totalDamaged = hasRecountData ? finalDamagedCount : (task.items || []).reduce((acc, it) => acc + (it.Mal_estado || 0), 0);

      const totalDiffItems = (task.items || []).length;
      const justifiedCount = (task.items || []).filter(it => it.reviewComplete).length;
      const progressPercent = totalDiffItems > 0 ? Math.round((justifiedCount / totalDiffItems) * 100) : 100;

      return `
        <div class="just-card" id="just-card-${task.inventoryId}">
          <!-- Card Header Summary (Bloque del Inventario) -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 1rem;">
            <div style="flex: 1; min-width: 250px;">
              <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.35rem;">
                <span class="badge badge-neutral"><i class="fa-solid fa-warehouse"></i> Centro ${task.center}</span>
                <span class="badge badge-info">${task.type}</span>
                ${isReconteoTask 
                  ? '<span class="badge badge-warning" style="font-weight: 700;"><i class="fa-solid fa-rotate-right"></i> Justificación de Reconteo</span>' 
                  : '<span class="badge badge-primary" style="font-weight: 600;"><i class="fa-solid fa-clipboard-list"></i> 1ª Justificación</span>'}
                ${isFinalized 
                  ? `<span class="badge badge-success" id="card-status-badge-${task.inventoryId}"><i class="fa-solid fa-check-double"></i> Finalizado en Drive</span>` 
                  : (isRecountInProgress 
                      ? `<span class="badge badge-info" id="card-status-badge-${task.inventoryId}"><i class="fa-solid fa-rotate fa-spin"></i> Reconteo en Curso</span>`
                      : (task.pendingJustificationsCount > 0 
                          ? `<span class="badge badge-warning" id="card-status-badge-${task.inventoryId}"><i class="fa-solid fa-clock"></i> ${task.pendingJustificationsCount} Pendiente${task.pendingJustificationsCount > 1 ? 's' : ''}</span>`
                          : `<span class="badge badge-success" id="card-status-badge-${task.inventoryId}"><i class="fa-solid fa-check"></i> Revisión documentada</span>`))}
                ${totalDiffItems > 0 ? `
                  <span id="card-progress-badge-${task.inventoryId}" class="badge" style="background: rgba(99, 102, 241, 0.12); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.25); font-weight: 600;">
                    <i class="fa-solid fa-chart-pie mr-1"></i> ${justifiedCount}/${totalDiffItems} (${progressPercent}%)
                  </span>
                ` : ''}
              </div>
              <h3 style="font-size: 1.2rem; font-weight: 700; color: var(--text-main); margin: 0.25rem 0;">
                ${task.inventoryName}
              </h3>
              <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
                <p style="font-size: 0.82rem; color: var(--text-muted); margin: 0; font-family: var(--font-mono);">
                  ID: <strong style="color: var(--primary);">${task.inventoryId}</strong>
                </p>
                ${totalDiffItems > 0 ? `
                  <div style="display: flex; align-items: center; gap: 6px; width: 140px; height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 4px; overflow: hidden;" title="Progreso de justificación: ${progressPercent}%">
                    <div id="card-progress-bar-${task.inventoryId}" style="height: 100%; width: ${progressPercent}%; background: ${progressPercent === 100 ? '#10b981' : '#f59e0b'}; transition: width 0.3s ease;"></div>
                  </div>
                ` : ''}
              </div>
            </div>

            <!-- Card Actions: Abrir / Ocultar & Acciones según flujo solicitado -->
            <div style="display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap;">
              <button 
                type="button" 
                class="btn ${isExpanded ? 'btn-secondary' : 'btn-primary'}" 
                onclick="window.JustificationsView.toggleTaskDetails('${task.inventoryId}')"
                style="display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600;"
              >
                <i class="fa-solid ${isExpanded ? 'fa-chevron-up' : 'fa-folder-open'}"></i>
                <span>${isExpanded ? 'Ocultar Ítems' : `Abrir y Revisar Ítems (${(task.items || []).length})`}</span>
              </button>

              <div id="card-main-action-${task.inventoryId}" style="display: inline-flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                <button 
                  type="button" 
                  id="btn-sync-sheet-${task.inventoryId}"
                  class="btn btn-secondary" 
                  onclick="window.JustificationsView.syncTaskFromSheets('${task.inventoryId}')"
                  title="Volver a actualizar los montos e ítems de este inventario directamente desde Google Sheets"
                  style="display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600;"
                >
                  <i class="fa-solid fa-arrows-rotate"></i> Actualizar desde Sheets
                </button>
                <button 
                  type="button" 
                  class="btn btn-warning" 
                  onclick="window.JustificationsView.openReopenModal('${task.inventoryId}')"
                  title="Reabrir inventario para actualizar cantidades (1er Conteo, Reconteo 1 o Reconteo 2) o sincronizar con Google Sheets"
                  style="display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 700;"
                >
                  <i class="fa-solid fa-lock-open"></i> Reabrir Inventario
                </button>
              ${this.reviewAction(task)}
              </div>
            </div>
          </div>

          <!-- KPI Summary Row (Visible sin abrir los ítems) -->
          <div class="just-card-stats">
            <div class="just-stat-box">
              <div class="just-stat-val" style="color: var(--primary);">${task.totalItems || (task.items || []).length}</div>
              <div class="just-stat-lbl">Ítems Totales</div>
            </div>
            <div class="just-stat-box">
              <div class="just-stat-val" style="color: ${(task.items || []).length > 0 ? 'var(--warning)' : 'var(--success)'};">
                ${(task.items || []).length}
              </div>
              <div class="just-stat-lbl">Con Diferencias</div>
            </div>
            ${hasRecountData ? `
              <div class="just-stat-box">
                <div class="just-stat-val" style="color: var(--danger); text-decoration: ${clarifiedCost > 0 ? 'line-through' : 'none'};">
                  ${window.AppConfig ? window.AppConfig.formatCurrency(initialDiffCostTotal) : `Bs. ${initialDiffCostTotal.toFixed(2)}`}
                </div>
                <div class="just-stat-lbl">1er Conteo</div>
              </div>
              <div class="just-stat-box">
                <div class="just-stat-val" style="color: ${finalDiffCostTotal > 0 ? 'var(--warning)' : 'var(--success)'}; font-weight: 800;">
                  ${window.AppConfig ? window.AppConfig.formatCurrency(finalDiffCostTotal) : `Bs. ${finalDiffCostTotal.toFixed(2)}`}
                </div>
                <div class="just-stat-lbl">Impacto Real Final</div>
              </div>
              <div class="just-stat-box">
                <div class="just-stat-val" style="color: var(--success); font-weight: 800;">
                  +${window.AppConfig ? window.AppConfig.formatCurrency(clarifiedCost) : `Bs. ${clarifiedCost.toFixed(2)}`}
                </div>
                <div class="just-stat-lbl">Subsanado / Aclarado</div>
              </div>
            ` : `
              <div class="just-stat-box">
                <div class="just-stat-val" style="color: ${task.pendingJustificationsCount > 0 ? 'var(--danger)' : 'var(--success)'};">
                  ${task.pendingJustificationsCount || 0}
                </div>
                <div class="just-stat-lbl">Por Justificar</div>
              </div>
              <div class="just-stat-box">
                <div class="just-stat-val" style="color: ${totalCost > 0 ? 'var(--danger)' : 'var(--text-main)'};">
                  ${window.AppConfig ? window.AppConfig.formatCurrency(totalCost) : `Bs. ${totalCost.toFixed(2)}`}
                </div>
                <div class="just-stat-lbl">Impacto Costo</div>
              </div>
            `}
            <div class="just-stat-box">
              <div class="just-stat-val" style="color: ${totalDamaged > 0 ? 'var(--danger)' : 'var(--text-dim)'};">
                ${totalDamaged}
              </div>
              <div class="just-stat-lbl">Mal Estado</div>
            </div>
          </div>

          ${hasRecountData ? `
            <!-- Banner de Impacto Real Post-Reconteo -->
            <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px; padding: 0.85rem 1.1rem; margin-top: 0.85rem; display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem;">
              <div>
                <div style="font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; color: #10b981; margin-bottom: 0.2rem; display: flex; align-items: center; gap: 6px;">
                  <i class="fa-solid fa-scale-balanced"></i> Impacto Financiero Real Post-Reconteo (Google Sheets Cols. W y X)
                </div>
                <div style="font-size: 0.88rem; color: var(--text-main);">
                  Impacto Inicial: <strong style="color: var(--danger); font-family: var(--font-mono);">${window.AppConfig ? window.AppConfig.formatCurrency(initialDiffCostTotal) : `Bs. ${initialDiffCostTotal.toFixed(2)}`}</strong>
                  &nbsp;➔&nbsp;
                  Impacto Final: <strong style="color: ${finalDiffCostTotal > 0 ? 'var(--warning)' : 'var(--success)'}; font-family: var(--font-mono); font-size: 1.02rem;">${window.AppConfig ? window.AppConfig.formatCurrency(finalDiffCostTotal) : `Bs. ${finalDiffCostTotal.toFixed(2)}`}</strong>
                  ${clarifiedCost > 0 ? `
                    <span class="badge badge-success" style="margin-left: 0.5rem; font-weight: 700;">
                      <i class="fa-solid fa-arrow-trend-down"></i> Subsanado: +${window.AppConfig ? window.AppConfig.formatCurrency(clarifiedCost) : `Bs. ${clarifiedCost.toFixed(2)}`} (${reconciledItemsCount} ítem${reconciledItemsCount === 1 ? '' : 's'} cuadrados)
                    </span>
                  ` : ''}
                </div>
              </div>
              <div style="display: flex; gap: 1rem; font-size: 0.82rem; color: var(--text-dim); flex-wrap: wrap;">
                <span><i class="fa-solid fa-circle-minus" style="color: #ef4444;"></i> Faltante Final: <strong style="color: var(--text-main); font-family: var(--font-mono);">${window.AppConfig ? window.AppConfig.formatCurrency(finalFaltantesCost) : `Bs. ${finalFaltantesCost.toFixed(2)}`}</strong></span>
                <span><i class="fa-solid fa-circle-plus" style="color: #38bdf8;"></i> Sobrante Final: <strong style="color: var(--text-main); font-family: var(--font-mono);">${window.AppConfig ? window.AppConfig.formatCurrency(finalSobrantesCost) : `Bs. ${finalSobrantesCost.toFixed(2)}`}</strong></span>
                <span><i class="fa-solid fa-triangle-exclamation" style="color: var(--danger);"></i> Averías: <strong style="color: var(--text-main); font-family: var(--font-mono);">${window.AppConfig ? window.AppConfig.formatCurrency(finalDamagedCost) : `Bs. ${finalDamagedCost.toFixed(2)}`}</strong></span>
              </div>
            </div>
          ` : ''}

          <!-- Expandable Details Section (Solo visible al pulsar "Abrir y Revisar") -->
          <div id="task-details-${task.inventoryId}" style="display: ${isExpanded ? 'block' : 'none'}; margin-top: 1.25rem; border-top: 1px solid var(--border-glass); padding-top: 1.25rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.85rem; flex-wrap: wrap; gap: 0.5rem;">
              <span style="font-size: 0.88rem; font-weight: 600; color: var(--text-dim);">
                <i class="fa-solid fa-list-check"></i> Listado de ítems con diferencias para este inventario (${(task.items || []).length}):
              </span>
              <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                <button 
                  type="button" 
                  class="btn btn-primary btn-xs" 
                  onclick="window.JustificationsView.openJustifyModalAtIndex('${task.inventoryId}', 0)"
                  style="padding: 0.25rem 0.65rem; font-size: 0.75rem;"
                  title="Abrir ventana emergente centrada para revisar y justificar ítem por ítem con navegación"
                >
                  <i class="fa-solid fa-window-maximize"></i> Vista Pop-up
                </button>
                <button 
                  type="button" 
                  id="btn-toggle-height-${task.inventoryId}"
                  class="btn btn-secondary btn-xs" 
                  onclick="window.JustificationsView.toggleMaxHeight('${task.inventoryId}')"
                  style="padding: 0.25rem 0.55rem; font-size: 0.75rem;"
                  title="Alternar entre altura completa y ventana compacta con scroll vertical"
                >
                  <i class="fa-solid fa-arrows-down-to-line"></i> Vista Compacta
                </button>
                <button 
                  type="button" 
                  class="btn btn-secondary btn-xs" 
                  onclick="window.JustificationsView.toggleTaskDetails('${task.inventoryId}')"
                  style="padding: 0.25rem 0.55rem; font-size: 0.75rem;"
                >
                  <i class="fa-solid fa-chevron-up"></i> Ocultar tabla de ítems
                </button>
              </div>
            </div>

            <!-- Contenedor con Doble Barra de Desplazamiento Sincronizada (Superior e Inferior) -->
            <div class="just-table-container" id="just-table-container-${task.inventoryId}" data-inventory-id="${task.inventoryId}">
              
              <!-- Barra de desplazamiento SUPERIOR (Siempre visible y sticky al bajar en la tabla) -->
              <div class="just-sticky-scroll-wrapper just-sticky-scroll-top" id="just-scroll-top-wrap-${task.inventoryId}">
                <div class="just-scroll-bar-header">
                  <div class="just-scroll-title">
                    <i class="fa-solid fa-arrows-left-right"></i>
                    <span>Desplazamiento horizontal</span>
                  </div>
                  <div class="just-scroll-quick-jumps">
                    <button type="button" class="just-jump-btn" onclick="window.JustificationsView.scrollToPosition('${task.inventoryId}', 'start')" title="Ir al inicio (SKU)">
                      <i class="fa-solid fa-backward-step"></i> SKU
                    </button>
                    <button type="button" class="just-jump-btn" onclick="window.JustificationsView.scrollToPosition('${task.inventoryId}', 'middle')" title="Ir a Stock y Diferencias">
                      <i class="fa-solid fa-scale-balanced"></i> Diferencias
                    </button>
                    <button type="button" class="just-jump-btn" onclick="window.JustificationsView.scrollToPosition('${task.inventoryId}', 'end')" title="Ir al final (Justificar y Acciones)">
                      <i class="fa-solid fa-pen-to-square"></i> Acciones
                    </button>
                  </div>
                  <div class="just-scroll-nav-btns">
                    <button type="button" class="just-nav-btn" onclick="window.JustificationsView.scrollTable('${task.inventoryId}', -250)" title="Desplazar a la izquierda">
                      <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <button type="button" class="just-nav-btn" onclick="window.JustificationsView.scrollTable('${task.inventoryId}', 250)" title="Desplazar a la derecha">
                      <i class="fa-solid fa-chevron-right"></i>
                    </button>
                  </div>
                </div>
                <div class="just-scroll-track" id="just-scroll-track-top-${task.inventoryId}" title="Arrastra para deslizar horizontalmente">
                  <div class="just-scroll-dummy" id="just-scroll-dummy-top-${task.inventoryId}"></div>
                </div>
              </div>

              <!-- Tabla principal con scroll horizontal y vertical -->
              <div class="table-responsive just-table-responsive" id="just-table-responsive-${task.inventoryId}">
                <table class="data-table" id="just-data-table-${task.inventoryId}">
                  <thead>
                    ${(isReconteoTask || (task.items || []).some(it => it.Reconteo_Fisico !== undefined && it.Reconteo_Fisico !== null) || hasRec2Data) ? `
                      <tr class="table-group-header" style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em;">
                        <th colspan="3" style="background: rgba(255, 255, 255, 0.03); text-align: left; padding: 4px 10px; border-bottom: 1px solid var(--border-color);">Identificación</th>
                        <th colspan="4" style="background: rgba(245, 158, 11, 0.08); color: #f59e0b; text-align: center; padding: 4px 10px; border-bottom: 2px solid #f59e0b;">
                          <i class="fa-solid fa-list-ol mr-1"></i> 1er Conteo Físico
                        </th>
                        <th colspan="4" style="background: rgba(56, 189, 248, 0.08); color: #38bdf8; text-align: center; padding: 4px 10px; border-bottom: 2px solid #38bdf8;">
                          <i class="fa-solid fa-rotate mr-1"></i> Reconteo 1
                        </th>
                        ${hasRec2Data ? `
                          <th colspan="4" style="background: rgba(168, 85, 247, 0.08); color: #a855f7; text-align: center; padding: 4px 10px; border-bottom: 2px solid #a855f7;">
                            <i class="fa-solid fa-rotate mr-1"></i> Reconteo 2
                          </th>
                        ` : ''}
                        <th colspan="6" style="background: rgba(255, 255, 255, 0.03); text-align: left; padding: 4px 10px; border-bottom: 1px solid var(--border-color);">Justificación & Evidencia</th>
                      </tr>
                    ` : ''}
                    <tr>
                      <th>SKU</th>
                      <th>Descripción</th>
                      <th>Ubicación</th>
                      <th>Stock Sist. (Col I)</th>
                      <th>Stock Fís. (Col J)</th>
                      <th>Dif. 1er (Col K)</th>
                      <th>Impacto 1er (Col L)</th>
                      ${(isReconteoTask || (task.items || []).some(it => it.Reconteo_Fisico !== undefined && it.Reconteo_Fisico !== null) || (task.items || []).some(it => it.Stock_Total_Reconteo !== undefined && it.Stock_Total_Reconteo !== null)) ? `
                        <th style="background: rgba(56, 189, 248, 0.1); color: #38bdf8;">Stock Total Rec. 1 (Col. Y)</th>
                        <th style="background: rgba(56, 189, 248, 0.1); color: #38bdf8;">Rec. 1 Daño (Col. AA)</th>
                        <th style="background: rgba(16, 185, 129, 0.1); color: #10b981;">Dif. Final 1 (Col. AB)</th>
                        <th style="background: rgba(16, 185, 129, 0.1); color: #10b981;">Impacto Final 1 (Col. AC)</th>
                      ` : ''}
                      ${hasRec2Data ? `
                        <th style="background: rgba(168, 85, 247, 0.1); color: #a855f7;">Stock Total Rec. 2 (Col. AJ)</th>
                        <th style="background: rgba(168, 85, 247, 0.1); color: #a855f7;">Rec. 2 Daño (Col. AL)</th>
                        <th style="background: rgba(168, 85, 247, 0.1); color: #a855f7;">Dif. Final 2 (Col. AM)</th>
                        <th style="background: rgba(168, 85, 247, 0.1); color: #a855f7;">Impacto Final 2 (Col. AN)</th>
                      ` : ''}
                      <th>Mal Estado</th>
                      <th>1ª Justificación (Variante)</th>
                      <th>Razón (Col. R)</th>
                      <th>Comentarios (Col. S)</th>
                      <th>Evidencia</th>
                      <th style="text-align: center;">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${(() => {
                      const itemsToDisplay = task.items || [];
                      if (itemsToDisplay.length === 0) {
                        return `
                          <tr>
                            <td colspan="18" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
                              <i class="fa-solid fa-circle-check" style="color: #10b981; font-size: 2rem; margin-bottom: 0.5rem; display: block;"></i>
                              <strong style="color: var(--text-main);">Sin diferencias registradas</strong>
                              <p style="margin: 0.25rem 0 0; font-size: 0.85rem;">Todos los ítems de este inventario cuadran con el sistema.</p>
                            </td>
                          </tr>
                        `;
                      }
                      return itemsToDisplay.map((item, itemIdx) => {
                      const diff = item.Diferencia || 0;
                      const isJustified = !!item.isJustified;
                      const just = item.justificationDetails;
                      const razonVal = (just ? just.reasonType : '') || '-';
                      const comentarioVal = (just ? just.justification : '') || '-';
                      const showRecountCols = isReconteoTask || (task.items || []).some(it => (it.Reconteo_Fisico !== undefined && it.Reconteo_Fisico !== null) || (it.Stock_Total_Reconteo !== undefined && it.Stock_Total_Reconteo !== null));
                      const itemSys = Number(item.Stock_Sistema || 0);

                      const hasItemRec2 = (item.Reconteo_2 !== undefined && item.Reconteo_2 !== null && String(item.Reconteo_2).trim() !== '' && String(item.Reconteo_2).trim() !== '-') ||
                                          (item.Fecha_Reconteo_2 && String(item.Fecha_Reconteo_2).trim() !== '');

                      const hasItemRec1 = (item.Stock_Total_Reconteo !== undefined && item.Stock_Total_Reconteo !== null && String(item.Stock_Total_Reconteo).trim() !== '' && String(item.Stock_Total_Reconteo).trim() !== '-') ||
                                          (item.Diferencia_Final !== undefined && item.Diferencia_Final !== null && String(item.Diferencia_Final).trim() !== '' && String(item.Diferencia_Final).trim() !== '-') ||
                                          (item.Reconteo_Fisico !== undefined && item.Reconteo_Fisico !== null && String(item.Reconteo_Fisico).trim() !== '' && String(item.Reconteo_Fisico).trim() !== '-') ||
                                          (item.Reconteo !== undefined && item.Reconteo !== null && String(item.Reconteo).trim() !== '' && String(item.Reconteo).trim() !== '-') ||
                                          (item.Fecha_Reconteo && String(item.Fecha_Reconteo).trim() !== '');

                      // Reconteo 1: Stock Total Columna Y, Diferencia Final Columna AB
                      const rec1StockTotal = (item.Stock_Total_Reconteo !== undefined && item.Stock_Total_Reconteo !== null && String(item.Stock_Total_Reconteo).trim() !== '')
                        ? Number(item.Stock_Total_Reconteo)
                        : ((item.Reconteo_Fisico !== undefined && item.Reconteo_Fisico !== null && String(item.Reconteo_Fisico).trim() !== '') ? Number(item.Reconteo_Fisico) : (item.Stock_Fisico ?? 0));
                      const rec1Dam = (item.Reconteo_Mal_Estado !== undefined && item.Reconteo_Mal_Estado !== null && String(item.Reconteo_Mal_Estado).trim() !== '')
                        ? Number(item.Reconteo_Mal_Estado)
                        : ((item.Malestado_Reconteo !== null && item.Malestado_Reconteo !== undefined && String(item.Malestado_Reconteo).trim() !== '') ? Number(item.Malestado_Reconteo) : 0);
                      const isNegRec1Match = false; // Physical totals never inherit negative system stock.
                      const finalDiffQty1 = isNegRec1Match ? 0 : ((item.Diferencia_Final !== undefined && item.Diferencia_Final !== null && String(item.Diferencia_Final).trim() !== '')
                        ? Number(item.Diferencia_Final)
                        : (rec1StockTotal - itemSys));
                      const finalDiffCost1 = isNegRec1Match ? 0 : ((item.Costo_Diferencia_Final !== undefined && item.Costo_Diferencia_Final !== null && String(item.Costo_Diferencia_Final).trim() !== '')
                        ? Number(item.Costo_Diferencia_Final)
                        : (finalDiffQty1 * Number(item.Costo_Unitario || 0)));

                      // Reconteo 2: Stock Total Columna AJ, Total/Diferencia Final Columna AM
                      const rec2StockTotal = (item.Stock_Total_Reconteo_2 !== undefined && item.Stock_Total_Reconteo_2 !== null && String(item.Stock_Total_Reconteo_2).trim() !== '')
                        ? Number(item.Stock_Total_Reconteo_2)
                        : ((item.Reconteo_2 !== undefined && item.Reconteo_2 !== null && String(item.Reconteo_2).trim() !== '') ? Number(item.Reconteo_2) : null);
                      const rec2Dam = (item.Malestado_Reconteo_2 !== undefined && item.Malestado_Reconteo_2 !== null && String(item.Malestado_Reconteo_2).trim() !== '')
                        ? Number(item.Malestado_Reconteo_2)
                        : 0;
                      const isNegRec2Match = false; // Physical totals never inherit negative system stock.
                      const finalDiffQty2 = isNegRec2Match ? 0 : ((item.Diferencia_Final_2 !== undefined && item.Diferencia_Final_2 !== null && String(item.Diferencia_Final_2).trim() !== '')
                        ? Number(item.Diferencia_Final_2)
                        : (rec2StockTotal !== null ? (rec2StockTotal - itemSys) : null));
                      const finalDiffCost2 = isNegRec2Match ? 0 : ((item.Costo_Diferencia_Final_2 !== undefined && item.Costo_Diferencia_Final_2 !== null && String(item.Costo_Diferencia_Final_2).trim() !== '')
                        ? Number(item.Costo_Diferencia_Final_2)
                        : (finalDiffQty2 !== null ? (finalDiffQty2 * Number(item.Costo_Unitario || 0)) : null));

                      const itemCorr = item.reviewStatus || '';
                      const isCuadra = item.reviewComplete && itemCorr === 'CUADRA';
                      const isNoCuadra = item.reviewComplete && itemCorr === 'NO CUADRA';

                      const itemWar = item.Almacen || item.almacen || item.warehouse || '';
                      const itemLoc = item.Ubicacion || '';
                      const cleanSkuId = String(item.SKU).replace(/[^a-zA-Z0-9_-]/g, '_');
                      const cleanWarId = String(itemWar).replace(/[^a-zA-Z0-9_-]/g, '_');
                      const cleanLocId = String(itemLoc).replace(/[^a-zA-Z0-9_-]/g, '_');
                      const itemKey = `${cleanSkuId}_${cleanWarId || 'war'}_${cleanLocId || 'loc'}_${itemIdx}`;
                      const rowId = `just-row-${task.inventoryId}-${itemKey}`;

                      // Multi-location gathering across Col D (Ubicación), Col E (Ubicación 1), Col F (Ubicación 2)
                      const itemLocs = [];
                      if (item.Ubicacion && String(item.Ubicacion).trim()) itemLocs.push(String(item.Ubicacion).trim());
                      if (item.Ubicacion_1 && String(item.Ubicacion_1).trim()) itemLocs.push(String(item.Ubicacion_1).trim());
                      if (item.Ubicacion_2 && String(item.Ubicacion_2).trim()) itemLocs.push(String(item.Ubicacion_2).trim());
                      if (Array.isArray(item.additionalLocations)) {
                        item.additionalLocations.forEach(al => {
                          const str = (typeof al === 'string' ? al : (al && al.location ? al.location : '')).trim();
                          if (str && !itemLocs.includes(str)) itemLocs.push(str);
                        });
                      }
                      const locsHtml = itemLocs.length > 0
                        ? itemLocs.map((l, idx) => `<span class="badge ${idx === 0 ? 'badge-info' : 'badge-neutral'}" style="font-size: 0.75rem; margin: 1px;"><i class="fa-solid fa-location-dot" style="font-size: 0.65rem; margin-right: 2px;"></i>${l}</span>`).join('')
                        : '<span class="badge badge-neutral">-</span>';

                      return `
                        <tr id="${rowId}" data-inventory-id="${task.inventoryId}" data-sku="${item.SKU}" data-almacen="${itemWar}" data-location="${itemLoc}" data-item-id="${item.id || ''}" data-item-key="${itemKey}" data-item-idx="${itemIdx}" class="${!isJustified && !isCuadra ? 'discrepancy-row' : ''}">
                          <td>
                            <div style="display: flex; flex-direction: column; gap: 3px;">
                              <strong style="color: var(--primary); font-family: var(--font-mono);">${item.SKU}</strong>
                              ${itemWar ? `<span class="badge badge-info" style="font-size: 0.68rem; padding: 1px 6px; width: fit-content; line-height: 1.2;"><i class="fa-solid fa-warehouse"></i> ${itemWar}</span>` : ''}
                            </div>
                          </td>
                          <td style="font-size: 0.88rem;">${item.Descripcion}</td>
                          <td><div style="display: flex; flex-direction: column; gap: 2px;">${locsHtml}</div></td>
                          <td class="cell-stock-sistema" style="font-family: var(--font-mono);">${item.Stock_Sistema ?? 0}</td>
                          <td class="cell-stock-fisico"><strong style="font-family: var(--font-mono);">${item.Stock_Fisico ?? 0}</strong></td>
                          <td class="cell-diferencia"><span class="badge ${diff < 0 ? 'badge-danger' : (diff > 0 ? 'badge-warning' : 'badge-neutral')}">${diff > 0 ? '+' : ''}${diff}</span></td>
                          <td class="cell-costo-diferencia"><strong style="color: var(--danger); font-family: var(--font-mono);">${window.AppConfig ? window.AppConfig.formatCurrency(item.Costo_Diferencia || 0) : `Bs. ${(item.Costo_Diferencia || 0).toFixed(2)}`}</strong></td>
                          ${showRecountCols ? `
                            <td style="font-family: var(--font-mono); font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.05);">${hasItemRec1 ? rec1StockTotal : '-'}</td>
                            <td style="font-family: var(--font-mono); background: rgba(56, 189, 248, 0.05);">${hasItemRec1 ? rec1Dam : '-'}</td>
                            <td style="font-family: var(--font-mono); background: rgba(16, 185, 129, 0.05);">
                              ${hasItemRec1 ? `
                                <span class="badge ${finalDiffQty1 === 0 ? 'badge-success' : (finalDiffQty1 < 0 ? 'badge-danger' : 'badge-warning')}" style="font-weight: 700;">
                                  ${finalDiffQty1 === 0 ? '<i class="fa-solid fa-check"></i> 0 (Cuadrado)' : (finalDiffQty1 > 0 ? `+${finalDiffQty1}` : finalDiffQty1)}
                                </span>
                              ` : '-'}
                            </td>
                            <td style="font-family: var(--font-mono); font-weight: 700; background: rgba(16, 185, 129, 0.05); color: ${finalDiffQty1 === 0 ? 'var(--success)' : 'var(--danger)'};">
                              ${hasItemRec1 ? (window.AppConfig ? window.AppConfig.formatCurrency(finalDiffCost1) : `Bs. ${finalDiffCost1.toFixed(2)}`) : '-'}
                            </td>
                          ` : ''}
                          ${hasRec2Data ? `
                            <td style="font-family: var(--font-mono); font-weight: 700; color: #a855f7; background: rgba(168, 85, 247, 0.05);">${hasItemRec2 ? rec2StockTotal : '-'}</td>
                            <td style="font-family: var(--font-mono); background: rgba(168, 85, 247, 0.05);">${hasItemRec2 ? rec2Dam : '-'}</td>
                            <td style="font-family: var(--font-mono); background: rgba(168, 85, 247, 0.05);">
                              ${hasItemRec2 ? `
                                <span class="badge ${finalDiffQty2 === 0 ? 'badge-success' : (finalDiffQty2 < 0 ? 'badge-danger' : 'badge-warning')}" style="font-weight: 700;">
                                  ${finalDiffQty2 === 0 ? '<i class="fa-solid fa-check"></i> 0 (Cuadrado)' : (finalDiffQty2 > 0 ? `+${finalDiffQty2}` : finalDiffQty2)}
                                </span>
                              ` : '-'}
                            </td>
                            <td style="font-family: var(--font-mono); font-weight: 700; background: rgba(168, 85, 247, 0.05); color: ${finalDiffQty2 === 0 ? 'var(--success)' : 'var(--danger)'};">
                              ${hasItemRec2 ? (window.AppConfig ? window.AppConfig.formatCurrency(finalDiffCost2) : `Bs. ${Number(finalDiffCost2 || 0).toFixed(2)}`) : '-'}
                            </td>
                          ` : ''}
                          <td>${item.Mal_estado > 0 ? `<span class="badge badge-danger">${item.Mal_estado}</span>` : '0'}</td>
                          <td class="cell-status">
                            ${window.InventoryContract?.isWeekly(item) ? `<div style="white-space:normal; margin-bottom:6px;"><strong>Final conciliado: ${window.InventoryContract.finalQuantity(item) ?? '-'}</strong><br><small>Físico: ${window.InventoryContract.latestPhysical(window.InventoryContract.normalize(item)) ?? '-'}</small></div>` : ''}
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                              ${isCuadra ? `
                                <span class="badge badge-success" style="font-weight: 800; font-size: 0.76rem;">
                                  <i class="fa-solid fa-check"></i> Cuadra (Aprobado)
                                </span>
                              ` : (isNoCuadra ? `
                                <span class="badge badge-danger" style="font-weight: 800; font-size: 0.76rem;">
                                  <i class="fa-solid fa-rotate-right"></i> No Cuadra (${item.justificationRound === 2 ? 'Resultado final' : 'A reconteo'})
                                </span>
                              ` : (isJustified ? `
                                <span class="badge badge-success" style="font-weight: 800; font-size: 0.76rem;">
                                  <i class="fa-solid fa-check"></i> Justificado
                                </span>
                              ` : `
                                <span class="badge badge-warning" style="font-weight: 800; font-size: 0.76rem;">
                                  <i class="fa-solid fa-clock"></i> Pendiente
                                </span>
                              `))}
                              ${item.canJustify ? `
                                <div style="display: inline-flex; gap: 4px; margin-top: 2px;">
                                  <button type="button" class="btn btn-xs ${isCuadra ? 'btn-success' : 'btn-secondary'}" onclick="window.JustificationsView.markCorroboration('${task.inventoryId}', '${item.SKU}', 'CUADRA', '${itemKey}', ${itemIdx})" title="Marcar Cuadra (Justificado)" style="padding: 2px 7px; font-size: 0.72rem;">
                                    <i class="fa-solid fa-check"></i> Cuadra
                                  </button>
                                  <button type="button" class="btn btn-xs ${isNoCuadra ? 'btn-danger' : 'btn-secondary'}" onclick="window.JustificationsView.markCorroboration('${task.inventoryId}', '${item.SKU}', 'NO_CUADRA', '${itemKey}', ${itemIdx})" title="Marcar No Cuadra (A Reconteo)" style="padding: 2px 7px; font-size: 0.72rem;">
                                    <i class="fa-solid fa-rotate-right"></i> No cuadra
                                  </button>
                                </div>
                              ` : ''}
                            </div>
                          </td>
                          <td class="cell-razon">
                            <span style="font-size: 0.82rem; font-weight: 600; color: ${isJustified || isCuadra ? 'var(--text-main)' : 'var(--text-dim)'};">
                              ${razonVal}
                            </span>
                          </td>
                          <td class="cell-comentario" style="min-width:180px; max-width:280px; white-space:normal;">${this.reviewHistory(item)}</td>
                          <td class="cell-evidencia">
                            ${(just && (just.driveUrl || just.photoUrl)) ? `
                              <a href="${just.driveUrl || just.photoUrl}" target="_blank" class="btn btn-secondary btn-xs" title="Ver foto de justificación en Google Drive" style="display: inline-flex; align-items: center; gap: 4px; text-decoration: none;">
                                <i class="fa-brands fa-google-drive" style="color: #34a853;"></i> Ver en Drive
                              </a>
                            ` : '<span style="color: var(--text-dim);">-</span>'}
                          </td>
                          <td class="cell-accion" style="text-align: center;">
                            <div style="display: flex; flex-direction: column; gap: 4px; align-items: center;">
                              <button ${item.canJustify ? '' : 'disabled'} class="btn btn-secondary btn-xs" onclick="window.JustificationsView.openJustifyModal('${task.inventoryId}', '${item.SKU}', '${itemKey}', ${itemIdx})" style="width: 100%;">
                                <i class="fa-solid fa-pen-to-square"></i> ${!item.canJustify ? 'Solo lectura' : (item.reviewComplete ? 'Editar explicación' : 'Justificar')}
                              </button>
                              <button type="button" class="btn btn-outline-info btn-xs" onclick="window.JustificationsView.openReopenModal('${task.inventoryId}')" title="Reabra la etapa para modificar cantidades y volver a justificar el resultado." style="width: 100%; padding: 2px 4px; font-size: 0.72rem; display: inline-flex; align-items: center; justify-content: center; gap: 3px;">
                                <i class="fa-solid fa-calculator"></i> Reabrir cantidades
                              </button>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('');
                  })()}
                  </tbody>
                </table>
              </div>

              <!-- Barra de desplazamiento INFERIOR (Siempre visible y sticky al estar en la tabla) -->
              <div class="just-sticky-scroll-wrapper just-sticky-scroll-bottom" id="just-scroll-bottom-wrap-${task.inventoryId}">
                <div class="just-scroll-track" id="just-scroll-track-bottom-${task.inventoryId}" title="Arrastra para deslizar horizontalmente">
                  <div class="just-scroll-dummy" id="just-scroll-dummy-bottom-${task.inventoryId}"></div>
                </div>
                <div class="just-scroll-bar-footer">
                  <div class="just-scroll-title">
                    <i class="fa-solid fa-arrows-left-right"></i>
                    <span>Barra de desplazamiento inferior sincronizada</span>
                  </div>
                  <div class="just-scroll-quick-jumps">
                    <button type="button" class="just-jump-btn" onclick="window.JustificationsView.scrollToPosition('${task.inventoryId}', 'start')" title="Ir a SKU">
                      <i class="fa-solid fa-backward-step"></i> SKU
                    </button>
                    <button type="button" class="just-jump-btn" onclick="window.JustificationsView.scrollToPosition('${task.inventoryId}', 'middle')" title="Ir a Diferencias">
                      <i class="fa-solid fa-scale-balanced"></i> Diferencias
                    </button>
                    <button type="button" class="just-jump-btn" onclick="window.JustificationsView.scrollToPosition('${task.inventoryId}', 'end')" title="Ir a Acciones">
                      <i class="fa-solid fa-pen-to-square"></i> Acciones
                    </button>
                  </div>
                  <div class="just-scroll-nav-btns">
                    <button type="button" class="just-nav-btn" onclick="window.JustificationsView.scrollTable('${task.inventoryId}', -250)" title="Desplazar a la izquierda">
                      <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <button type="button" class="just-nav-btn" onclick="window.JustificationsView.scrollTable('${task.inventoryId}', 250)" title="Desplazar a la derecha">
                      <i class="fa-solid fa-chevron-right"></i>
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      `;
    }).join('');

    this.initDualScrollbars();
    setTimeout(() => this.initDualScrollbars(), 60);
    setTimeout(() => this.initDualScrollbars(), 250);
  },

  initDualScrollbars() {
    const containers = document.querySelectorAll('.just-table-container');
    containers.forEach(container => {
      const invId = container.dataset.inventoryId;
      if (!invId) return;

      const topTrack = document.getElementById(`just-scroll-track-top-${invId}`);
      const bottomTrack = document.getElementById(`just-scroll-track-bottom-${invId}`);
      const topDummy = document.getElementById(`just-scroll-dummy-top-${invId}`);
      const bottomDummy = document.getElementById(`just-scroll-dummy-bottom-${invId}`);
      const tableResp = document.getElementById(`just-table-responsive-${invId}`);
      const table = document.getElementById(`just-data-table-${invId}`);

      if (!topTrack || !bottomTrack || !tableResp || !table) return;

      const updateWidths = () => {
        const scrollWidth = Math.max(table.scrollWidth || 0, tableResp.scrollWidth || 0);
        if (scrollWidth > 0) {
          if (topDummy) topDummy.style.width = `${scrollWidth}px`;
          if (bottomDummy) bottomDummy.style.width = `${scrollWidth}px`;
        }
      };

      updateWidths();

      if (window.ResizeObserver && !container._roAttached) {
        container._roAttached = true;
        const ro = new ResizeObserver(() => updateWidths());
        ro.observe(table);
        ro.observe(tableResp);
      }

      if (!container._listenersAttached) {
        container._listenersAttached = true;
        let activeDriver = null;
        let releaseDriverTimer = null;

        const handleScroll = (source, targets) => {
          // If another scroll element is already driving the scroll, discard to avoid feedback loop
          if (activeDriver && activeDriver !== source) return;

          activeDriver = source;
          if (releaseDriverTimer) clearTimeout(releaseDriverTimer);
          releaseDriverTimer = setTimeout(() => {
            activeDriver = null;
          }, 60);

          const left = source.scrollLeft;
          targets.forEach(t => {
            if (t && t !== source && Math.abs(t.scrollLeft - left) >= 1) {
              t.scrollLeft = left;
            }
          });
        };

        topTrack.addEventListener('scroll', () => handleScroll(topTrack, [tableResp, bottomTrack]), { passive: true });
        bottomTrack.addEventListener('scroll', () => handleScroll(bottomTrack, [tableResp, topTrack]), { passive: true });
        tableResp.addEventListener('scroll', () => handleScroll(tableResp, [topTrack, bottomTrack]), { passive: true });
      }
    });
  },

  scrollTable(inventoryId, delta) {
    const tableResp = document.getElementById(`just-table-responsive-${inventoryId}`);
    if (tableResp) {
      tableResp.scrollBy({ left: delta, behavior: 'smooth' });
    }
  },

  scrollToPosition(inventoryId, position) {
    const tableResp = document.getElementById(`just-table-responsive-${inventoryId}`);
    if (!tableResp) return;
    if (position === 'start') {
      tableResp.scrollTo({ left: 0, behavior: 'smooth' });
    } else if (position === 'middle') {
      const mid = Math.max(0, (tableResp.scrollWidth - tableResp.clientWidth) / 2);
      tableResp.scrollTo({ left: mid, behavior: 'smooth' });
    } else if (position === 'end') {
      tableResp.scrollTo({ left: tableResp.scrollWidth, behavior: 'smooth' });
    }
  },

  toggleMaxHeight(inventoryId) {
    const tableResp = document.getElementById(`just-table-responsive-${inventoryId}`);
    const btn = document.getElementById(`btn-toggle-height-${inventoryId}`);
    if (!tableResp) return;
    tableResp.classList.toggle('compact-scroll');
    const isCompact = tableResp.classList.contains('compact-scroll');
    if (btn) {
      btn.innerHTML = isCompact 
        ? '<i class="fa-solid fa-arrows-up-down"></i> Altura Completa' 
        : '<i class="fa-solid fa-arrows-down-to-line"></i> Vista Compacta';
    }
    this.initDualScrollbars();
  },

  openJustifyModal(inventoryId, sku, itemKey, index) {
    const task = this.tasks.find(t => t.inventoryId === inventoryId);
    if (!task || !task.items) return;
    let itemIndex = -1;
    if (typeof index === 'number' && index >= 0 && index < task.items.length) {
      itemIndex = index;
    } else if (itemKey) {
      itemIndex = task.items.findIndex((it, idx) => {
        const cleanSkuId = String(it.SKU).replace(/[^a-zA-Z0-9_-]/g, '_');
        const cleanWarId = String(it.Almacen || it.almacen || it.warehouse || '').replace(/[^a-zA-Z0-9_-]/g, '_');
        const cleanLocId = String(it.Ubicacion || '').replace(/[^a-zA-Z0-9_-]/g, '_');
        return `${cleanSkuId}_${cleanWarId || 'war'}_${cleanLocId || 'loc'}_${idx}` === itemKey;
      });
    }
    if (itemIndex === -1) {
      itemIndex = task.items.findIndex(i => i.SKU === sku);
    }
    this.openJustifyModalAtIndex(inventoryId, itemIndex >= 0 ? itemIndex : 0);
  },

  openJustifyModalAtIndex(inventoryId, index) {
    const task = this.tasks.find(t => t.inventoryId === inventoryId);
    if (!task || !task.items || task.items.length === 0) return;

    // Constrain index within valid bounds
    const totalItems = task.items.length;
    let clampedIndex = Math.max(0, Math.min(index, totalItems - 1));

    this.currentInventoryId = inventoryId;
    this.currentItemIndex = clampedIndex;

    const item = task.items[clampedIndex];
    if (!item) return;
    if (!item.canJustify) {
      window.Toast.warning('Esta etapa está bloqueada. Finalice y firme el conteo o reconteo correspondiente.');
      return;
    }

    const isReconteoTask = !!(task && (task.hasRecount || task.status === 'EN_RECONTEO' || task.isReconteo || String(task.inventoryId).startsWith('REC-')));

    // Modal title & counter
    const titleElem = document.getElementById('just-modal-title');
    if (titleElem) {
      titleElem.textContent = isReconteoTask ? 'Revisión y Justificación de Reconteo' : 'Justificar Diferencia / Mal Estado';
    }

    const counterElem = document.getElementById('just-modal-item-counter');
    if (counterElem) {
      counterElem.textContent = `Ítem ${clampedIndex + 1} de ${totalItems}`;
    }

    // Navigation buttons state
    const btnPrev = document.getElementById('btn-just-prev-item');
    const btnNext = document.getElementById('btn-just-next-item');
    if (btnPrev) btnPrev.disabled = (clampedIndex <= 0);
    if (btnNext) btnNext.disabled = (clampedIndex >= totalItems - 1);

    const itemWar = item.Almacen || item.almacen || item.warehouse || '';
    const itemLoc = item.Ubicacion || '';
    const cleanSkuId = String(item.SKU).replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanWarId = String(itemWar).replace(/[^a-zA-Z0-9_-]/g, '_');
    const cleanLocId = String(itemLoc).replace(/[^a-zA-Z0-9_-]/g, '_');
    const itemKey = `${cleanSkuId}_${cleanWarId || 'war'}_${cleanLocId || 'loc'}_${clampedIndex}`;

    // Form inputs & Item Details
    document.getElementById('just-modal-inv-id').value = inventoryId;
    document.getElementById('just-modal-sku-input').value = item.SKU;
    const elWar = document.getElementById('just-modal-almacen-input');
    if (elWar) elWar.value = itemWar;
    const elLoc = document.getElementById('just-modal-location-input');
    if (elLoc) elLoc.value = itemLoc;
    const elKey = document.getElementById('just-modal-item-key');
    if (elKey) elKey.value = itemKey;
    const elIdx = document.getElementById('just-modal-item-idx');
    if (elIdx) elIdx.value = clampedIndex;
    const elId = document.getElementById('just-modal-item-id');
    if (elId) elId.value = item.id || '';

    document.getElementById('just-modal-sku').textContent = item.SKU;
    document.getElementById('just-modal-desc').textContent = item.Descripcion || 'Sin descripción';

    const alBadge = document.getElementById('just-modal-almacen');
    const alVal = document.getElementById('just-modal-almacen-val');
    if (alBadge && alVal) {
      if (itemWar) {
        alVal.textContent = itemWar;
        alBadge.style.display = 'inline-flex';
      } else {
        alBadge.style.display = 'none';
      }
    }

    const alCell = document.getElementById('just-modal-cell-almacen');
    const alCellVal = document.getElementById('just-modal-almacen-cell');
    if (alCell && alCellVal) {
      if (itemWar) {
        alCellVal.textContent = itemWar;
        alCell.style.display = 'flex';
      } else {
        alCell.style.display = 'none';
      }
    }
    
    // Determinar el último reconteo realizado para este ítem:
    const sys = Number(item.Stock_Sistema ?? item.stockSistema ?? 0);
    const damaged1 = Number(item.Mal_estado ?? item.malEstado ?? 0);

    const hasItemRec2 = (item.Reconteo_2 !== null && item.Reconteo_2 !== undefined && String(item.Reconteo_2).trim() !== '' && String(item.Reconteo_2).trim() !== '-') ||
                        (item.Fecha_Reconteo_2 && String(item.Fecha_Reconteo_2).trim() !== '');

    const hasItemRec1 = (item.Stock_Total_Reconteo !== null && item.Stock_Total_Reconteo !== undefined && String(item.Stock_Total_Reconteo).trim() !== '' && String(item.Stock_Total_Reconteo).trim() !== '-') ||
                        (item.Diferencia_Final !== null && item.Diferencia_Final !== undefined && String(item.Diferencia_Final).trim() !== '' && String(item.Diferencia_Final).trim() !== '-') ||
                        (item.Reconteo_Fisico !== null && item.Reconteo_Fisico !== undefined && String(item.Reconteo_Fisico).trim() !== '' && String(item.Reconteo_Fisico).trim() !== '-') ||
                        (item.Reconteo !== null && item.Reconteo !== undefined && String(item.Reconteo).trim() !== '' && String(item.Reconteo).trim() !== '-') ||
                        (item.Fecha_Reconteo && String(item.Fecha_Reconteo).trim() !== '');

    let hasLastRec = false;
    let recLabel = '';
    let recStockTotal = null;
    let recDamaged = 0;
    let recFinalDiff = 0;
    let recCostDiff = 0;

    if (hasItemRec2) {
      hasLastRec = true;
      recLabel = '2do Reconteo';
      recDamaged = (item.Malestado_Reconteo_2 !== null && item.Malestado_Reconteo_2 !== undefined && String(item.Malestado_Reconteo_2).trim() !== '') ? Number(item.Malestado_Reconteo_2) : 0;
      const recPhys2 = (item.Reconteo_2 !== null && item.Reconteo_2 !== undefined && String(item.Reconteo_2).trim() !== '') ? Number(item.Reconteo_2) : 0;
      const isNeg2 = (sys < 0 && recPhys2 === 0 && recDamaged === 0);
      recStockTotal = (item.Stock_Total_Reconteo_2 !== null && item.Stock_Total_Reconteo_2 !== undefined && String(item.Stock_Total_Reconteo_2).trim() !== '')
        ? Number(item.Stock_Total_Reconteo_2)
        : (recPhys2 + recDamaged);
      recFinalDiff = isNeg2 ? 0 : ((item.Diferencia_Final_2 !== null && item.Diferencia_Final_2 !== undefined && String(item.Diferencia_Final_2).trim() !== '')
        ? Number(item.Diferencia_Final_2)
        : (recStockTotal - sys));
      recCostDiff = isNeg2 ? 0 : ((item.Costo_Diferencia_Final_2 !== null && item.Costo_Diferencia_Final_2 !== undefined && String(item.Costo_Diferencia_Final_2).trim() !== '')
        ? Number(item.Costo_Diferencia_Final_2)
        : (recFinalDiff * (Number(item.Costo_Unitario) || 0)));
    } else if (hasItemRec1) {
      hasLastRec = true;
      recLabel = '1er Reconteo';
      recDamaged = (item.Reconteo_Mal_Estado !== null && item.Reconteo_Mal_Estado !== undefined && String(item.Reconteo_Mal_Estado).trim() !== '')
        ? Number(item.Reconteo_Mal_Estado)
        : ((item.Malestado_Reconteo !== null && item.Malestado_Reconteo !== undefined && String(item.Malestado_Reconteo).trim() !== '') ? Number(item.Malestado_Reconteo) : 0);
      const recPhys1 = (item.Reconteo !== null && item.Reconteo !== undefined && String(item.Reconteo).trim() !== '')
        ? Number(item.Reconteo)
        : ((item.Reconteo_Fisico !== null && item.Reconteo_Fisico !== undefined && String(item.Reconteo_Fisico).trim() !== '') ? Number(item.Reconteo_Fisico) : 0);
      const isNeg1 = (sys < 0 && recPhys1 === 0 && recDamaged === 0);
      recStockTotal = (item.Stock_Total_Reconteo !== null && item.Stock_Total_Reconteo !== undefined && String(item.Stock_Total_Reconteo).trim() !== '')
        ? Number(item.Stock_Total_Reconteo)
        : (recPhys1 + recDamaged);
      recFinalDiff = isNeg1 ? 0 : ((item.Diferencia_Final !== null && item.Diferencia_Final !== undefined && String(item.Diferencia_Final).trim() !== '')
        ? Number(item.Diferencia_Final)
        : (recStockTotal - sys));
      recCostDiff = isNeg1 ? 0 : ((item.Costo_Diferencia_Final !== null && item.Costo_Diferencia_Final !== undefined && String(item.Costo_Diferencia_Final).trim() !== '')
        ? Number(item.Costo_Diferencia_Final)
        : (recFinalDiff * (Number(item.Costo_Unitario) || 0)));
    }

    const effectiveDiff = hasLastRec ? recFinalDiff : Number(item.Diferencia || 0);
    const effectiveDamaged = hasLastRec ? recDamaged : damaged1;
    const effectiveCost = hasLastRec ? recCostDiff : Number(item.Costo_Diferencia || 0);

    const isCuadrado = (effectiveDiff === 0 && effectiveDamaged === 0) || 
                       (hasLastRec && recFinalDiff === 0 && recDamaged === 0) ||
                       (String(item.corroborationStatus || item.corroboracion || '').toUpperCase().trim() === 'CUADRA');

    // La ronda viene del flujo confirmado por el servidor, no de textos o fotos previos.
    const isSecondJust = item.justificationRound === 2;
    this.currentIsSecondJustification = isSecondJust;

    const elSecondInput = document.getElementById('just-modal-is-second-just');
    if (elSecondInput) elSecondInput.value = isSecondJust ? 'true' : 'false';

    // Bordes verdosos si cuadró, o indicación de no cuadra
    const itemCard = document.getElementById('just-modal-item-card');
    if (itemCard) {
      if (isCuadrado) {
        itemCard.style.border = '2px solid #10b981';
        itemCard.style.background = 'rgba(16, 185, 129, 0.08)';
        itemCard.style.boxShadow = '0 0 16px rgba(16, 185, 129, 0.25)';
      } else {
        itemCard.style.border = '1.5px solid rgba(239, 68, 68, 0.45)';
        itemCard.style.background = 'var(--bg-card)';
        itemCard.style.boxShadow = 'none';
      }
    }

    // Banner de alerta si cuadró
    const cuadroAlert = document.getElementById('just-modal-cuadro-alert');
    const cuadroText = document.getElementById('just-modal-cuadro-text');
    if (cuadroAlert) {
      if (isCuadrado) {
        cuadroAlert.style.display = 'flex';
        if (cuadroText) {
          cuadroText.innerHTML = `¡El ítem ha <strong>cuadrado</strong> ${hasLastRec ? `en el ${recLabel}` : 'correctamente'}! (Diferencia = 0, sin daños).`;
        }
      } else {
        cuadroAlert.style.display = 'none';
      }
    }
    
    const diffBadge = document.getElementById('just-modal-diff');
    if (diffBadge) {
      if (isCuadrado) {
        diffBadge.textContent = 'Dif: 0 (Cuadra)';
        diffBadge.className = 'badge badge-success';
        diffBadge.style.cssText = 'background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid #10b981; font-weight: 700;';
      } else {
        diffBadge.textContent = `Dif: ${effectiveDiff > 0 ? '+' : ''}${effectiveDiff}`;
        diffBadge.className = effectiveDiff < 0 ? 'badge badge-danger' : 'badge badge-warning';
        diffBadge.style.cssText = '';
      }
    }

    const abcBadge = document.getElementById('just-modal-abc');
    if (abcBadge) {
      abcBadge.textContent = `ABC: ${item.ABC || '-'}`;
    }

    const statusBadge = document.getElementById('just-modal-status-badge');
    if (statusBadge) {
      if (isCuadrado) {
        statusBadge.textContent = hasLastRec ? `✅ Cuadró (${recLabel})` : '✅ Cuadra';
        statusBadge.className = 'badge badge-success';
        statusBadge.style.cssText = 'background: #10b981; color: #ffffff; font-weight: 700;';
      } else {
        statusBadge.textContent = hasLastRec ? `🔄 No Cuadra (${recLabel})` : '🔄 No Cuadra';
        statusBadge.className = 'badge badge-danger';
        statusBadge.style.cssText = '';
      }
    }

    // Details Grid Cells
    const locElem = document.getElementById('just-modal-loc');
    if (locElem) {
      const modalLocs = [];
      if (item.Ubicacion && String(item.Ubicacion).trim()) modalLocs.push(String(item.Ubicacion).trim());
      if (item.Ubicacion_1 && String(item.Ubicacion_1).trim()) modalLocs.push(String(item.Ubicacion_1).trim());
      if (item.Ubicacion_2 && String(item.Ubicacion_2).trim()) modalLocs.push(String(item.Ubicacion_2).trim());
      if (Array.isArray(item.additionalLocations)) {
        item.additionalLocations.forEach(al => {
          const str = (typeof al === 'string' ? al : (al && al.location ? al.location : '')).trim();
          if (str && !modalLocs.includes(str)) modalLocs.push(str);
        });
      }
      locElem.textContent = modalLocs.length > 0 ? modalLocs.join(' | ') : (item.Ubicacion || '-');
    }

    const sysElem = document.getElementById('just-modal-sys-stock');
    if (sysElem) sysElem.textContent = item.Stock_Sistema ?? '-';

    const physElem = document.getElementById('just-modal-phys-stock');
    if (physElem) physElem.textContent = item.Primer_Conteo_Fisico ?? item.Conteo_Fisico ?? '-';

    const lblRecount = document.getElementById('just-modal-lbl-recount');
    const recountCell = document.getElementById('just-modal-cell-recount');
    const recountVal = document.getElementById('just-modal-recount-stock');
    if (recountCell && recountVal) {
      if (hasLastRec) {
        recountCell.style.display = 'flex';
        if (lblRecount) {
          lblRecount.innerHTML = `<i class="fa-solid fa-rotate-right"></i> ${recLabel}`;
        }
        recountVal.textContent = recStockTotal;
        recountVal.style.color = isCuadrado ? '#10b981' : '#38bdf8';
      } else {
        recountCell.style.display = 'none';
      }
    }

    const damagedElem = document.getElementById('just-modal-damaged');
    if (damagedElem) {
      damagedElem.textContent = effectiveDamaged;
      damagedElem.style.color = effectiveDamaged > 0 ? '#ef4444' : '#10b981';
    }

    const costElem = document.getElementById('just-modal-cost');
    if (costElem) {
      costElem.textContent = window.AppConfig ? window.AppConfig.formatCurrency(effectiveCost) : `Bs. ${Number(effectiveCost).toFixed(2)}`;
      costElem.style.color = isCuadrado ? '#10b981' : '#ef4444';
    }

    const corrSelect = document.getElementById('just-select-corroboration');
    if (corrSelect) {
      if (item.reviewStatus) {
        corrSelect.value = item.reviewStatus.replace(/ /g, '_');
      } else if (isCuadrado) {
        corrSelect.value = 'CUADRA';
      } else {
        corrSelect.value = (item.reviewStatus || 'NO_CUADRA').replace(/ /g, '_');
      }
    }

    const btnSave = document.getElementById('btn-save-justification');
    if (btnSave) {
      if (isCuadrado) {
        btnSave.innerHTML = '<i class="fa-solid fa-circle-check"></i> Indicar que Cuadró';
        btnSave.className = 'btn btn-success btn-sm';
      } else {
        btnSave.innerHTML = '<i class="fa-solid fa-save"></i> Guardar';
        btnSave.className = 'btn btn-primary btn-sm';
      }
    }

    this.uploadedPhotoUrl = null;
    this.uploadedDriveUrl = null;
    this.uploadedDriveFileId = null;

    const statusDiv = document.getElementById('just-photo-status');
    const driveUrlInput = document.getElementById('just-drive-url');
    const driveFileIdInput = document.getElementById('just-drive-file-id');

    const justDetails = item.justificationDetails;
    if (justDetails) {
      const reasonSelect = document.getElementById('just-select-reason');
      const targetReason = justDetails.reasonType || '';
      if (reasonSelect) {
        if (targetReason) {
          const exists = Array.from(reasonSelect.options).some(opt => opt.value.toLowerCase() === targetReason.toLowerCase());
          if (!exists) {
            const opt = document.createElement('option');
            opt.value = targetReason;
            opt.textContent = targetReason;
            reasonSelect.appendChild(opt);
          }
          reasonSelect.value = targetReason;
        } else {
          reasonSelect.value = (item.Diferencia < 0) ? 'faltante en inventario anual' : ((item.Diferencia > 0) ? 'Sobrante del inventario anual' : 'balanceo');
        }
      }
      document.getElementById('just-input-text').value = justDetails.justification || '';
      const photoUrl = justDetails.driveUrl || justDetails.photoUrl || '';
      document.getElementById('just-photo-url').value = photoUrl;
      if (driveUrlInput) driveUrlInput.value = justDetails.driveUrl || (String(photoUrl).includes('drive.google.com') ? photoUrl : '');
      if (driveFileIdInput) driveFileIdInput.value = justDetails.driveFileId || '';

      if (photoUrl) {
        const preview = document.getElementById('img-just-preview');
        const previewSrc = justDetails.thumbnailUrl || (justDetails.driveFileId ? `https://lh3.googleusercontent.com/d/${justDetails.driveFileId}=s1600` : photoUrl);
        preview.src = previewSrc;
        preview.style.display = 'block';

        if (statusDiv) {
          statusDiv.style.display = 'block';
          statusDiv.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 4px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); padding: 8px 12px; border-radius: 6px; color: #38bdf8;">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span><i class="fa-brands fa-google-drive"></i> Foto respaldada en Google Drive</span>
                <a href="${photoUrl}" target="_blank" class="btn btn-xs btn-secondary" style="font-size: 0.75rem; text-decoration: none;"><i class="fa-solid fa-external-link"></i> Ver en Drive</a>
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">
                <i class="fa-solid fa-folder-tree"></i> Carpeta: <strong style="color: #38bdf8;">nibol/ciclicos/fotos/justificaciones</strong>
              </div>
            </div>
          `;
        }
      } else {
        document.getElementById('img-just-preview').style.display = 'none';
        if (statusDiv) {
          statusDiv.style.display = 'none';
          statusDiv.innerHTML = '';
        }
      }
    } else {
      document.getElementById('form-submit-justification').reset();
      if (corrSelect) corrSelect.value = isCuadrado ? 'CUADRA' : 'NO_CUADRA';
      const reasonSelect = document.getElementById('just-select-reason');
      if (isCuadrado) {
        if (reasonSelect) reasonSelect.value = 'balanceo';
        document.getElementById('just-input-text').value = '';
      } else {
        if (reasonSelect) {
          reasonSelect.value = (item.Diferencia < 0) ? 'faltante en inventario anual' : ((item.Diferencia > 0) ? 'Sobrante del inventario anual' : 'balanceo');
        }
      }
      document.getElementById('just-photo-url').value = '';
      if (driveUrlInput) driveUrlInput.value = '';
      if (driveFileIdInput) driveFileIdInput.value = '';
      document.getElementById('img-just-preview').style.display = 'none';
      if (statusDiv) {
        statusDiv.style.display = 'none';
        statusDiv.innerHTML = '';
      }
    }

    if (isCuadrado && !item.reviewStatus && corrSelect) {
      corrSelect.value = 'CUADRA';
    }

    const amountInput = document.getElementById('just-compensation-quantity');
    if (amountInput) {
      const saved = item[this.currentIsSecondJustification ? 'Cantidad_Justificada_2' : 'Cantidad_Justificada_1'];
      amountInput.value = window.InventoryContract?.has(saved) ? Math.abs(Number(saved)) : '';
    }
    if (corrSelect) corrSelect.onchange = () => this.refreshCompensation(item);
    this.refreshCompensation(item);
    window.ModalHelper.open('modal-justification');
  },

  refreshCompensation(item) {
    const panel = document.getElementById('just-compensation-panel');
    const input = document.getElementById('just-compensation-quantity');
    const hint = document.getElementById('just-compensation-hint');
    if (!panel || !input || !hint) return;
    const contract = window.InventoryContract;
    const enabled = contract?.isWeekly(item) && document.getElementById('just-select-corroboration')?.value === 'CUADRA';
    panel.hidden = !enabled;
    panel.style.display = enabled ? '' : 'none';
    input.disabled = !enabled;
    input.required = !!enabled;
    if (!enabled) return;
    const round = this.currentIsSecondJustification ? 2 : 1;
    const needed = contract.compensationNeeded(item, round);
    if (needed === 0) input.value = '0';
    hint.textContent = 'Stock inicial: ' + item.Stock_Sistema + '. Último total físico: ' + contract.latestPhysical(contract.normalize(item))
      + '. ' + (needed > 0 ? 'Debe sumar ' + needed : needed < 0 ? 'Debe descontar ' + Math.abs(needed) : 'Sin diferencia: ingrese 0')
      + ' unidades. El conteo físico se conserva; la compensación queda registrada por separado.';
  },

  navigatePopup(direction) {
    if (!this.currentInventoryId) return;
    const task = this.tasks.find(t => t.inventoryId === this.currentInventoryId);
    if (!task || !task.items || task.items.length === 0) return;

    const skipJustified = document.getElementById('just-chk-skip-justified')?.checked;
    let nextIndex = this.currentItemIndex + direction;

    if (skipJustified) {
      // Find next pending item in the given direction
      while (nextIndex >= 0 && nextIndex < task.items.length) {
        const it = task.items[nextIndex];
        const isResolved = it.reviewComplete || !it.canJustify;
        if (!isResolved) break;
        nextIndex += direction;
      }
    }

    if (nextIndex < 0) {
      window.Toast.info('Ya estás en el primer ítem de la lista.');
      return;
    }

    if (nextIndex >= task.items.length) {
      window.Toast.info('Has llegado al último ítem de este inventario.');
      return;
    }

    this.openJustifyModalAtIndex(this.currentInventoryId, nextIndex);
  },

  async saveCurrentModalJustification(advanceNext = false) {
    const inventoryId = document.getElementById('just-modal-inv-id').value;
    const sku = document.getElementById('just-modal-sku-input').value;
    const almacen = document.getElementById('just-modal-almacen-input')?.value || '';
    const location = document.getElementById('just-modal-location-input')?.value || '';
    const itemKey = document.getElementById('just-modal-item-key')?.value || '';
    const itemIdxVal = document.getElementById('just-modal-item-idx')?.value;
    const itemIdx = (itemIdxVal !== undefined && itemIdxVal !== '') ? Number(itemIdxVal) : this.currentItemIndex;
    const itemId = document.getElementById('just-modal-item-id')?.value || null;

    let reasonType = document.getElementById('just-select-reason').value;
    let justification = document.getElementById('just-input-text').value.trim();
    const corroboration = document.getElementById('just-select-corroboration')?.value || 'CUADRA';
    const task = this.tasks?.find(t => t.inventoryId === inventoryId);
    const isReconteoTask = !!(task && (task.hasRecount || task.status === 'EN_RECONTEO' || task.isReconteo || String(task.inventoryId).startsWith('REC-')));

    const selectedItem = task?.items?.find(item => item.id === itemId);
    if (!selectedItem?.canJustify) {
      window.Toast.warning('La justificación no está habilitada para esta etapa. Actualice la lista.');
      return false;
    }
    if (!justification) {
      window.Toast.warning('Explique el resultado, incluso cuando el reconteo haya cuadrado.');
      document.getElementById('just-input-text')?.focus();
      return false;
    }

    const photoUrl = document.getElementById('just-photo-url').value || this.uploadedDriveUrl || null;
    const driveUrl = document.getElementById('just-drive-url')?.value || this.uploadedDriveUrl || null;
    const driveFileId = document.getElementById('just-drive-file-id')?.value || this.uploadedDriveFileId || null;

    const saveBtn = document.getElementById('btn-save-justification');
    const saveAndNextBtn = document.getElementById('btn-save-and-next');
    if (saveBtn) saveBtn.disabled = true;
    if (saveAndNextBtn) saveAndNextBtn.disabled = true;

    const isSecondJust = !!(this.currentIsSecondJustification || document.getElementById('just-modal-is-second-just')?.value === 'true');

    try {
      let justifiedQuantity;
      if (window.InventoryContract?.isWeekly(selectedItem)) {
        justifiedQuantity = document.getElementById('just-compensation-quantity')?.value;
        window.InventoryContract.update(selectedItem, {action:'saveJustification', corroboracion:corroboration,
          round:isSecondJust ? 2 : 1, justifiedQuantity});
      }
      const savedResponse=await window.API.saveJustification({
        justifiedQuantity,
        inventoryId,
        sku,
        almacen,
        warehouse: almacen,
        location,
        itemId,
        reasonType,
        justification,
        corroboration,
        corroboracion: corroboration,
        status: corroboration,
        isCuadra: corroboration === 'CUADRA',
        isJustification2: isSecondJust,
        round: isSecondJust ? 2 : 1,
        photoUrl: driveUrl || photoUrl,
        driveUrl: driveUrl || (photoUrl && String(photoUrl).includes('drive.google.com') ? photoUrl : null),
        driveFileId
      });

      const confirmed = savedResponse.justification?.reviewItem;
      if (!confirmed) throw new Error('Falta la revisión confirmada por el servidor. Actualice la lista.');
      Object.assign(selectedItem, confirmed);
      Object.assign(task, savedResponse.justification.reviewState);

      if (inventoryId) this.expandedTaskIds.add(inventoryId);

      const warLabel = almacen ? ` [${almacen}]` : '';
      window.Toast.success(`Guardado: SKU ${sku}${warLabel} (${corroboration === 'CUADRA' ? 'Cuadra' : 'No cuadra'})`);

      this.updateCardHeaderProgress(inventoryId);

      if (advanceNext) {
        const nextIndex = this.currentItemIndex + 1;
        if (task && task.items && nextIndex < task.items.length) {
          this.navigatePopup(1);
        } else {
          window.Toast.success('¡Todos los ítems de este inventario han sido revisados!');
          window.ModalHelper.close('modal-justification');
        }
      } else {
        window.ModalHelper.close('modal-justification');
      }
      return true;
    } catch (err) {
      window.Toast.danger(err.message || 'Error al guardar justificación');
      return false;
    } finally {
      if (saveBtn) saveBtn.disabled = false;
      if (saveAndNextBtn) saveAndNextBtn.disabled = false;
    }
  },

  async saveAndAdvance() {
    await this.saveCurrentModalJustification(true);
  },

  updateItemRowDOM() {
    // Resolved entries and their history remain in the table.
    this.renderTasks();
  },

  async markCorroboration(inventoryId, sku, status, itemKey, itemIdx) {
    this.openJustifyModal(inventoryId, sku, itemKey, itemIdx);
    const item = this.tasks.find(task => task.inventoryId === inventoryId)?.items?.[itemIdx];
    if (item?.canJustify) { document.getElementById('just-select-corroboration').value = status; this.refreshCompensation(item); }
  },

  updateCardHeaderProgress(inventoryId) {
    const task = this.tasks.find(task => task.inventoryId === inventoryId);
    if (!task) return;
    task.pendingJustificationsCount = task.items.filter(item => !item.reviewComplete).length;
    task.justifiedItemsCount = task.items.length - task.pendingJustificationsCount;
    const scrolls = [...document.querySelectorAll('[id^="just-table-responsive-"]')].map(el => [el.id, el.scrollLeft, el.scrollTop]);
    this.renderTasks();
    for (const [id, left, top] of scrolls) {
      const el = document.getElementById(id);
      if (el) { el.scrollLeft = left; el.scrollTop = top; }
    }
  },

  openReopenModal(inventoryId) {
    const task = this.tasks?.find(t => t.inventoryId === inventoryId);
    if (!task) return;

    const invIdInput = document.getElementById('reopen-modal-inv-id');
    if (invIdInput) invIdInput.value = inventoryId;

    const infoEl = document.getElementById('reopen-modal-inv-info');
    if (infoEl) {
      infoEl.innerHTML = `
        <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-main); margin-bottom: 2px;">
          ${task.inventoryName}
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted); font-family: var(--font-mono);">
          ID: <strong style="color: var(--primary);">${task.inventoryId}</strong> &bull; Centro ${task.center} &bull; ${task.type}
        </div>
      `;
    }

    const phase = task.hasRecount2 ? 'RECONTEO_2' : task.hasRecount ? 'RECONTEO_1' : '1ER_CONTEO';
    const firstRadio = document.querySelector('input[name="reopen-target-phase"][value="1ER_CONTEO"]');
    if (firstRadio) firstRadio.disabled = !!task.hasRecount;
    const defaultRadio = document.querySelector(`input[name="reopen-target-phase"][value="${phase}"]`);
    if (defaultRadio) defaultRadio.checked = true;

    const chkSync = document.getElementById('reopen-chk-sync-gas');
    if (chkSync) chkSync.checked = true;

    const reasonInput = document.getElementById('reopen-modal-reason');
    if (reasonInput) reasonInput.value = 'Reapertura para actualización de cantidades';

    window.ModalHelper.open('modal-reopen-inventory');
  },

  openEditCountModal(inventoryId, sku, itemKey, itemIdx) {
    const task = this.tasks?.find(t => t.inventoryId === inventoryId);
    if (!task) return;
    const item = (task.items || [])[itemIdx] || (task.items || []).find(i => String(i.SKU) === String(sku));
    if (!item) {
      window.Toast.danger('No se encontró el ítem a editar');
      return;
    }

    this.currentEditingCountItem = { inventoryId, item, itemKey, itemIdx };

    document.getElementById('edit-count-inv-id').value = inventoryId;
    document.getElementById('edit-count-sku').value = item.SKU;
    document.getElementById('edit-count-item-id').value = item.id || '';
    document.getElementById('edit-count-location').value = item.Ubicacion || '';
    document.getElementById('edit-count-almacen').value = item.Almacen || item.almacen || item.warehouse || '';

    const skuDescEl = document.getElementById('edit-count-sku-desc');
    if (skuDescEl) skuDescEl.textContent = `${item.SKU} - ${item.Descripcion || ''}`;

    const alUbEl = document.getElementById('edit-count-almacen-ub');
    if (alUbEl) alUbEl.textContent = `${item.Almacen || 'Principal'} / ${item.Ubicacion || '-'}`;

    const sisEl = document.getElementById('edit-count-stock-sis');
    if (sisEl) sisEl.textContent = String(item.Stock_Sistema ?? 0);

    // Auto-select initial phase radio based on existing data
    let targetPhase = '1ER_CONTEO';
    if (item.Reconteo_2 !== undefined && item.Reconteo_2 !== null && String(item.Reconteo_2).trim() !== '') {
      targetPhase = 'RECONTEO_2';
    } else if (item.Reconteo_Fisico !== undefined && item.Reconteo_Fisico !== null && String(item.Reconteo_Fisico).trim() !== '') {
      targetPhase = 'RECONTEO_1';
    }

    const radio = document.querySelector(`input[name="edit-count-phase"][value="${targetPhase}"]`);
    if (radio) radio.checked = true;

    this.updateEditCountFieldsFromPhase(targetPhase);

    const reasonEl = document.getElementById('edit-count-reason');
    if (reasonEl) reasonEl.value = '';

    window.ModalHelper.open('modal-edit-count-justification');
  },

  updateEditCountFieldsFromPhase(phase) {
    if (!this.currentEditingCountItem || !this.currentEditingCountItem.item) return;
    const item = this.currentEditingCountItem.item;

    let phys = 0;
    let dam = 0;

    if (phase === '1ER_CONTEO') {
      phys = item.Stock_Fisico !== null && item.Stock_Fisico !== undefined ? item.Stock_Fisico : 0;
      dam = item.Mal_estado !== null && item.Mal_estado !== undefined ? item.Mal_estado : 0;
    } else if (phase === 'RECONTEO_1') {
      phys = (item.Reconteo_Fisico !== null && item.Reconteo_Fisico !== undefined && item.Reconteo_Fisico !== '')
        ? item.Reconteo_Fisico
        : (item.Stock_Fisico !== null && item.Stock_Fisico !== undefined ? item.Stock_Fisico : 0);
      dam = (item.Reconteo_Mal_Estado !== null && item.Reconteo_Mal_Estado !== undefined && item.Reconteo_Mal_Estado !== '')
        ? item.Reconteo_Mal_Estado
        : (item.Mal_estado !== null && item.Mal_estado !== undefined ? item.Mal_estado : 0);
    } else if (phase === 'RECONTEO_2') {
      phys = (item.Reconteo_2 !== null && item.Reconteo_2 !== undefined && item.Reconteo_2 !== '')
        ? item.Reconteo_2
        : (item.Reconteo_Fisico !== null && item.Reconteo_Fisico !== undefined && item.Reconteo_Fisico !== ''
            ? item.Reconteo_Fisico
            : (item.Stock_Fisico !== null && item.Stock_Fisico !== undefined ? item.Stock_Fisico : 0));
      dam = (item.Malestado_Reconteo_2 !== null && item.Malestado_Reconteo_2 !== undefined && item.Malestado_Reconteo_2 !== '')
        ? item.Malestado_Reconteo_2
        : (item.Reconteo_Mal_Estado !== null && item.Reconteo_Mal_Estado !== undefined && item.Reconteo_Mal_Estado !== ''
            ? item.Reconteo_Mal_Estado
            : (item.Mal_estado !== null && item.Mal_estado !== undefined ? item.Mal_estado : 0));
    }

    const fisInput = document.getElementById('edit-count-stock-fisico');
    if (fisInput) fisInput.value = phys;

    const damInput = document.getElementById('edit-count-mal-estado');
    if (damInput) damInput.value = dam;

    this.recalculateEditCountPreview();
  },

  recalculateEditCountPreview() {
    const fisVal = Number(document.getElementById('edit-count-stock-fisico')?.value || 0);
    const sisVal = Number(document.getElementById('edit-count-stock-sis')?.textContent || 0);
    const diff = fisVal - sisVal;

    const diffEl = document.getElementById('edit-count-calc-diff');
    if (diffEl) {
      diffEl.innerHTML = `
        <span class="badge ${diff === 0 ? 'badge-success' : (diff < 0 ? 'badge-danger' : 'badge-warning')}" style="font-weight: 700;">
          ${diff === 0 ? '<i class="fa-solid fa-check"></i> 0 (Cuadra)' : (diff > 0 ? `+${diff}` : diff)}
        </span>
      `;
    }
  },

  async enableRecount(inventoryId) {
    const task = this.tasks.find(t => t.inventoryId === inventoryId);
    if (!task) return;

    if (!confirm(`¿Habilitar el Reconteo para este inventario?\n\nSe creará una lista con los ítems con diferencias (o marcados como "No cuadra") asignada automáticamente al auxiliar/contador responsable.`)) {
      return;
    }

    try {
      window.Toast.info('Generando lista de reconteo...');
      const res = await window.API.enableRecount(inventoryId);
      window.Toast.success(res.message || 'Reconteo habilitado exitosamente');
      alert(`✅ Reconteo Habilitado\n\n${res.message}\nID de Reconteo: ${res.recountInventoryId}\n\nEl contador asignado ya puede ver esta lista en su ventana de inventarios.`);
      if (this.expandedTaskIds) this.expandedTaskIds.add(inventoryId);
      await this.loadJustifications();
    } catch (err) {
      window.Toast.danger(err.message || 'Error al habilitar reconteo');
    }
  },

  async finishReview(inventoryId) {
    const task = this.tasks.find(t => t.inventoryId === inventoryId);
    const isAlreadyFinalized = task && (task.status === 'REVISADO' || task.isFinalized);

    if (isAlreadyFinalized) {
      window.Toast.info('Esta justificación ya ha sido finalizada y archivada.');
      return;
    }

    if (!task?.canClose) {
      window.Toast.warning('Complete la etapa y todas sus justificaciones, incluidas las de los ítems que cuadraron en reconteo.');
      return;
    }

    if (!confirm('¿Está seguro de terminar la justificación de este inventario?\n\nEsto cerrará el inventario, creará el archivo oficial en Google Drive y actualizará el botón a estado finalizado.')) {
      return;
    }

    const btn = document.getElementById(`btn-finish-just-${inventoryId}`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Finalizando y Creando Drive...';
    }

    try {
      window.Toast.info('Creando archivo final en Google Drive y archivando inventario...');
      const roleName = window.Auth.currentUser?.role === 'ENCARGADO' ? 'Encargado' : 'Administrador';
      const res = await window.API.finishReview(inventoryId, {
        reviewNotes: `Revisión documentada por ${roleName}; se conservan los resultados CUADRA y NO CUADRA.`
      });

      if (task) {
        task.status = 'REVISADO';
        task.isFinalized = true;
      }

      window.Toast.success(`¡Justificación finalizada con éxito! Archivo Drive: ${res.drive?.fileName || 'creado'}`);
      alert(`✅ Justificación Finalizada\n\nEl inventario ha sido cerrado exitosamente y el archivo Drive oficial ha sido creado:\n${res.drive?.fileName || ''}`);

      this.renderTasks();

      // Update history in background
      if (window.HistoryView && typeof window.HistoryView.loadHistory === 'function') {
        window.HistoryView.loadHistory().catch(() => {});
      }
    } catch (err) {
      window.Toast.danger(err.message || 'Error al terminar revisión');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-clipboard-check"></i> Terminar Justificación y Crear en Drive';
      }
    }
  },

  async syncTaskFromSheets(inventoryId) {
    const btn = document.getElementById(`btn-sync-sheet-${inventoryId}`);
    let originalHtml = '';
    if (btn) {
      originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Actualizando...';
    }

    window.Toast?.info?.(`Consultando Google Sheets para actualizar ítems de ${inventoryId}...`);

    try {
      const res = await window.API.syncInventoryFromSheet(inventoryId);
      if (res && res.success) {
        window.Toast?.success?.(`¡Listo! Se actualizaron ${res.itemsUpdated ?? 0} ítems y montos desde Sheets.`);
        await this.loadJustifications();
      } else {
        window.Toast?.error?.(res?.message || 'No se pudo actualizar desde Google Sheets.');
      }
    } catch (err) {
      console.error('Error sincronizando con Google Sheets:', err);
      window.Toast?.error?.(`Error al actualizar desde Sheets: ${err.message || 'Error de conexión'}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }
  },

  async refreshAllPendingFromSheets() {
    const btn = document.getElementById('btn-sync-all-just-sheets');
    let originalHtml = '';
    if (btn) {
      originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Actualizando Sheets...';
    }

    try {
      if (!this.tasks || this.tasks.length === 0) {
        await this.loadJustifications();
        window.Toast?.info?.('Lista de justificaciones actualizada.');
        return;
      }

      window.Toast?.info?.(`Actualizando montos desde Google Sheets para ${this.tasks.length} inventario(s)...`);
      let totalUpdated = 0;
      let successes = 0;

      for (const task of this.tasks) {
        try {
          const res = await window.API.syncInventoryFromSheet(task.inventoryId);
          if (res && res.success) {
            totalUpdated += (res.itemsUpdated ?? 0);
            successes++;
          }
        } catch (e) {
          console.warn(`Aviso al sincronizar ${task.inventoryId}:`, e.message);
        }
      }

      window.Toast?.success?.(`Sincronización completada: ${successes} inventario(s) revisados, ${totalUpdated} ítems actualizados con Sheets.`);
      await this.loadJustifications();
    } catch (err) {
      console.error('Error en sincronización global desde Sheets:', err);
      window.Toast?.error?.(`Error actualizando desde Sheets: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      }
    }
  }
};
