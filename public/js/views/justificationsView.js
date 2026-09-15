// View: Justifications & Reconteos Review Closure (Admin Only)
window.JustificationsView = {
  tasks: [],
  uploadedPhotoUrl: null,

  init() {
    this.setupListeners();
  },

  setupListeners() {
    // Center filter for justifications
    document.getElementById('filter-just-center')?.addEventListener('change', () => this.loadJustifications());

    // Justification photo upload
    const photoZone = document.getElementById('zone-just-photo');
    const photoInput = document.getElementById('input-just-photo-file');
    const previewImg = document.getElementById('img-just-preview');

    photoZone?.addEventListener('click', () => photoInput.click());

    photoInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const inventoryId = document.getElementById('just-modal-inv-id')?.value;
      const sku = document.getElementById('just-modal-sku-input')?.value;
      const task = this.tasks?.find(t => t.inventoryId === inventoryId);
      const center = task ? task.center : (window.Auth.currentUser?.center || '1120');
      const dateStr = new Date().toISOString().split('T')[0];

      try {
        window.Toast.info('Subiendo imagen de justificación a Google Drive...');
        const res = await window.API.uploadPhoto(file, {
          category: 'justificaciones',
          photoType: 'justificaciones',
          sku: sku || '',
          center: center,
          date: dateStr,
          inventoryId: inventoryId || ''
        });
        if (res.photo && res.photo.url) {
          this.uploadedPhotoUrl = res.photo.url;
          document.getElementById('just-photo-url').value = res.photo.url;
          previewImg.src = res.photo.url;
          previewImg.style.display = 'block';
          window.Toast.success('Foto de justificación lista');
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al subir foto de respaldo');
      }
    });

    // Form submit: Save Justification (Stage 1 or 2)
    document.getElementById('form-submit-justification')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inventoryId = document.getElementById('just-modal-inv-id').value;
      const sku = document.getElementById('just-modal-sku-input').value;
      const stage = parseInt(document.getElementById('just-modal-stage')?.value || '1', 10);
      const reasonType = document.getElementById('just-select-reason').value;
      const justification = document.getElementById('just-input-text').value.trim();
      const photoUrl = document.getElementById('just-photo-url').value || null;

      try {
        await window.API.saveJustification({
          inventoryId,
          sku,
          reasonType,
          justification,
          photoUrl,
          stage
        });

        window.Toast.success(`Justificación etapa ${stage} registrada para SKU ${sku}`);
        window.ModalHelper.close('modal-justification');
        this.loadJustifications();
      } catch (err) {
        window.Toast.danger(err.message || 'Error al guardar justificación');
      }
    });

    // Form submit: Save Reconteo (Reconteo 1 or 2)
    document.getElementById('form-submit-reconteo')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inventoryId = document.getElementById('reconteo-modal-inv-id').value;
      const sku = document.getElementById('reconteo-modal-sku-input').value;
      const itemId = document.getElementById('reconteo-modal-item-id').value;
      const reconteoNum = parseInt(document.getElementById('reconteo-modal-num').value || '1', 10);
      const qty = parseInt(document.getElementById('reconteo-modal-qty').value, 10);
      const damagedQty = parseInt(document.getElementById('reconteo-modal-damaged').value || '0', 10);

      try {
        await window.API.registerReconteo(inventoryId, {
          sku,
          itemId,
          reconteoNum,
          qty,
          damagedQty
        });

        window.Toast.success(`Reconteo ${reconteoNum} guardado para SKU ${sku}`);
        window.ModalHelper.close('modal-reconteo');
        this.loadJustifications();
      } catch (err) {
        window.Toast.danger(err.message || 'Error al guardar reconteo');
      }
    });
  },

  async loadJustifications() {
    const container = document.getElementById('justifications-container');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center; padding: 3rem;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando tareas de justificación y reconteos...</div>';

    try {
      const centerSelect = document.getElementById('filter-just-center');
      const selectedCenter = centerSelect ? centerSelect.value : 'TODOS';
      const center = (selectedCenter && selectedCenter !== 'TODOS') ? selectedCenter : undefined;
      const res = await window.API.getJustifications(center);
      this.tasks = res.tasks || [];

      if (this.tasks.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 3rem; color: var(--text-dim);">
            <i class="fa-solid fa-circle-check" style="font-size: 3rem; color: var(--success); margin-bottom: 1rem;"></i>
            <h3>No hay inventarios con discrepancias pendientes</h3>
            <p style="font-size: 0.9rem; margin-top: 0.5rem;">Todos los productos están conciliados o cuadrados.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = this.tasks.map(task => {
        return `
          <div class="card" style="margin-bottom: 1.5rem; background: var(--bg-glass); border: 1px solid var(--border-glass);">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem;">
              <div>
                <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-main);">
                  ${task.inventoryName}
                </h3>
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.2rem;">
                  ID: <code style="color: var(--primary);">${task.inventoryId}</code> • Centro: <span class="badge badge-neutral">${task.center}</span> • Tipo: <span class="badge badge-info">${task.type}</span>
                </p>
              </div>

              <div style="display: flex; gap: 0.5rem; align-items: center;">
                <span class="badge ${task.pendingJustificationsCount > 0 ? 'badge-warning' : 'badge-success'}">
                  ${task.pendingJustificationsCount > 0 ? `${task.pendingJustificationsCount} Pendientes de revisión` : 'Todos revisados'}
                </span>

                <button class="btn btn-primary" onclick="window.JustificationsView.finishReview('${task.inventoryId}')">
                  <i class="fa-solid fa-cloud-arrow-up"></i> Terminar Revisión y Exportar Drive
                </button>
              </div>
            </div>

            <div class="table-responsive" style="max-height: 520px; overflow: auto;">
              <table class="data-table" style="font-size: 0.83rem;">
                <thead>
                  <tr>
                    <th>SKU / Desc.</th>
                    <th>Ubicaciones</th>
                    <th>Stock Sist. (K)</th>
                    <th>1er Conteo (L/Q)</th>
                    <th>Dif. 1 (M)</th>
                    <th>Estado 1 (S)</th>
                    <th>Justif. 1 (T/U)</th>
                    <th>1er Reconteo (X/Y)</th>
                    <th>Dif. Final 1 (Z)</th>
                    <th>Estado 2 (AC)</th>
                    <th>Justif. 2 (AD/AE)</th>
                    <th>2do Reconteo (AH/AI)</th>
                    <th>Dif. Final 2 (AJ)</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  ${task.items.map(item => {
                    const diff1 = item.Diferencia;
                    const estado1 = item.Estado || (diff1 === 0 ? 'CUADRA' : 'NO CUADRA');
                    const hasRec1 = item.Reconteo !== null && item.Reconteo !== undefined && item.Reconteo !== '';
                    const hasRec2 = item.Reconteo_2 !== null && item.Reconteo_2 !== undefined && item.Reconteo_2 !== '';
                    const estado2 = item.Estado_Justificacion_2 || (hasRec1 ? (item.Diferencia_Final === 0 ? 'CUADRA' : 'NO CUADRA') : '-');

                    return `
                      <tr class="${estado1 === 'NO CUADRA' ? 'discrepancy-row' : ''}">
                        <td>
                          <strong style="color: var(--primary);">${item.SKU}</strong>
                          <div style="font-size: 0.75rem; color: var(--text-dim); max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.Descripcion || ''}">
                            ${item.Descripcion || '-'}
                          </div>
                        </td>
                        <td>
                          <span class="badge badge-info">${item.Ubicacion || 'S/U'}</span>
                          ${item.Ubicacion_1 ? `<br><small style="color:var(--text-dim);">U1: ${item.Ubicacion_1}</small>` : ''}
                          ${item.Ubicacion_2 ? `<br><small style="color:var(--text-dim);">U2: ${item.Ubicacion_2}</small>` : ''}
                        </td>
                        <td><strong>${item.Stock_Sistema}</strong></td>
                        <td>
                          <strong>${item.Stock_Fisico !== null ? item.Stock_Fisico : '-'}</strong>
                          ${item.Mal_estado > 0 ? `<br><span class="badge badge-danger" title="Mal Estado">Daño: ${item.Mal_estado}</span>` : ''}
                        </td>
                        <td>
                          <span class="badge ${diff1 < 0 ? 'badge-danger' : (diff1 > 0 ? 'badge-warning' : 'badge-success')}">
                            ${diff1 > 0 ? '+' : ''}${diff1 !== null ? diff1 : '-'}
                          </span>
                        </td>
                        <td>
                          <span class="badge ${estado1 === 'CUADRA' ? 'badge-success' : 'badge-danger'}">
                            ${estado1}
                          </span>
                        </td>
                        <td>
                          <div style="max-width: 130px; font-size: 0.75rem;">
                            <strong>${item.Razon || '-'}</strong>
                            ${item.Comentario_Justificacion ? `<br><span style="color: var(--text-dim);">${item.Comentario_Justificacion}</span>` : ''}
                          </div>
                        </td>
                        <td>
                          ${hasRec1 ? `<strong>${item.Reconteo}</strong>${item.Malestado_Reconteo > 0 ? `<br><span class="badge badge-danger">Daño: ${item.Malestado_Reconteo}</span>` : ''}` : '<span style="color: var(--text-dim);">Sin reconteo</span>'}
                        </td>
                        <td>
                          ${hasRec1 ? `
                            <span class="badge ${item.Diferencia_Final < 0 ? 'badge-danger' : (item.Diferencia_Final > 0 ? 'badge-warning' : 'badge-success')}">
                              ${item.Diferencia_Final > 0 ? '+' : ''}${item.Diferencia_Final}
                            </span>
                          ` : '<span style="color: var(--text-dim);">-</span>'}
                        </td>
                        <td>
                          ${hasRec1 ? `
                            <span class="badge ${estado2 === 'CUADRA' ? 'badge-success' : 'badge-danger'}">
                              ${estado2}
                            </span>
                          ` : '<span style="color: var(--text-dim);">-</span>'}
                        </td>
                        <td>
                          <div style="max-width: 130px; font-size: 0.75rem;">
                            <strong>${item.Razon_Justificacion_2 || '-'}</strong>
                            ${item.Comentario_Justificacion_2 ? `<br><span style="color: var(--text-dim);">${item.Comentario_Justificacion_2}</span>` : ''}
                          </div>
                        </td>
                        <td>
                          ${hasRec2 ? `<strong>${item.Reconteo_2}</strong>${item.Malestado_Reconteo_2 > 0 ? `<br><span class="badge badge-danger">Daño: ${item.Malestado_Reconteo_2}</span>` : ''}` : '<span style="color: var(--text-dim);">-</span>'}
                        </td>
                        <td>
                          ${hasRec2 ? `
                            <span class="badge ${item.Diferencia_Final_2 < 0 ? 'badge-danger' : (item.Diferencia_Final_2 > 0 ? 'badge-warning' : 'badge-success')}">
                              ${item.Diferencia_Final_2 > 0 ? '+' : ''}${item.Diferencia_Final_2}
                            </span>
                          ` : '<span style="color: var(--text-dim);">-</span>'}
                        </td>
                        <td>
                          <div style="display: flex; flex-direction: column; gap: 0.25rem;">
                            <button class="btn btn-secondary btn-sm" onclick="window.JustificationsView.openJustifyModal('${task.inventoryId}', '${item.SKU}', 1)" title="1ra Justificación">
                              <i class="fa-solid fa-pen-to-square"></i> Justif. 1
                            </button>
                            <button class="btn btn-warning btn-sm" onclick="window.JustificationsView.openReconteoModal('${task.inventoryId}', '${item.SKU}', '${item.id}', 1)" title="1er Reconteo">
                              <i class="fa-solid fa-calculator"></i> Reconteo 1
                            </button>
                            ${hasRec1 ? `
                              <button class="btn btn-secondary btn-sm" onclick="window.JustificationsView.openJustifyModal('${task.inventoryId}', '${item.SKU}', 2)" title="2da Justificación">
                                <i class="fa-solid fa-gavel"></i> Justif. 2
                              </button>
                              <button class="btn btn-info btn-sm" onclick="window.JustificationsView.openReconteoModal('${task.inventoryId}', '${item.SKU}', '${item.id}', 2)" title="2do Reconteo">
                                <i class="fa-solid fa-2"></i> Reconteo 2
                              </button>
                            ` : ''}
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      container.innerHTML = `<div style="padding: 2rem; color: var(--danger); text-align: center;">Error: ${err.message}</div>`;
    }
  },

  openJustifyModal(inventoryId, sku, stage = 1) {
    const task = this.tasks.find(t => t.inventoryId === inventoryId);
    if (!task) return;

    const item = task.items.find(i => i.SKU === sku);
    if (!item) return;

    document.getElementById('just-modal-inv-id').value = inventoryId;
    document.getElementById('just-modal-sku-input').value = sku;
    document.getElementById('just-modal-stage').value = stage;
    document.getElementById('just-modal-stage-badge').textContent = stage === 1 ? '1ra Justificación (Cols. R-V)' : '2da Justificación (Cols. AB-AF)';
    document.getElementById('just-modal-sku').textContent = item.SKU;
    document.getElementById('just-modal-desc').textContent = item.Descripcion;
    
    const diff = stage === 1 ? item.Diferencia : (item.Diferencia_Final !== null ? item.Diferencia_Final : item.Diferencia);
    const costDiff = stage === 1 ? item.Costo_Diferencia : (item.Costo_Diferencia_Final !== null ? item.Costo_Diferencia_Final : item.Costo_Diferencia);

    document.getElementById('just-modal-diff').textContent = `Dif: ${diff > 0 ? '+' : ''}${diff}`;
    document.getElementById('just-modal-cost').textContent = `Impacto Costo: $${(costDiff || 0).toFixed(2)}`;

    const currentReason = stage === 1 ? (item.Razon || 'AJUSTE_OPERATIVO') : (item.Razon_Justificacion_2 || 'AJUSTE_OPERATIVO');
    const currentComment = stage === 1 ? (item.Comentario_Justificacion || '') : (item.Comentario_Justificacion_2 || '');

    document.getElementById('just-select-reason').value = currentReason;
    document.getElementById('just-input-text').value = currentComment;
    document.getElementById('just-photo-url').value = '';
    document.getElementById('img-just-preview').style.display = 'none';

    window.ModalHelper.open('modal-justification');
  },

  openReconteoModal(inventoryId, sku, itemId, reconteoNum = 1) {
    const task = this.tasks.find(t => t.inventoryId === inventoryId);
    if (!task) return;

    const item = task.items.find(i => i.SKU === sku);
    if (!item) return;

    document.getElementById('reconteo-modal-inv-id').value = inventoryId;
    document.getElementById('reconteo-modal-sku-input').value = sku;
    document.getElementById('reconteo-modal-item-id').value = itemId || item.id;
    document.getElementById('reconteo-modal-num').value = reconteoNum;

    document.getElementById('reconteo-modal-title').textContent = reconteoNum === 1 ? 'Registrar 1er Reconteo' : 'Registrar 2do Reconteo';
    document.getElementById('reconteo-modal-stage-badge').textContent = reconteoNum === 1 ? '1er Reconteo (Cols. W-AA)' : '2do Reconteo (Cols. AG-AK)';
    document.getElementById('reconteo-modal-sku').textContent = item.SKU;
    document.getElementById('reconteo-modal-desc').textContent = item.Descripcion;
    document.getElementById('reconteo-modal-system').textContent = `Stock Sistema: ${item.Stock_Sistema} | 1er Conteo: ${item.Stock_Fisico}`;

    const currentQty = reconteoNum === 1 ? (item.Reconteo !== null && item.Reconteo !== undefined ? item.Reconteo : '') : (item.Reconteo_2 !== null && item.Reconteo_2 !== undefined ? item.Reconteo_2 : '');
    const currentDamaged = reconteoNum === 1 ? (item.Malestado_Reconteo || 0) : (item.Malestado_Reconteo_2 || 0);

    document.getElementById('reconteo-modal-qty').value = currentQty;
    document.getElementById('reconteo-modal-damaged').value = currentDamaged;

    window.ModalHelper.open('modal-reconteo');
  },

  async finishReview(inventoryId) {
    if (!confirm('¿Está seguro de terminar la revisión? Esto cerrará el inventario, creará el archivo oficial en Google Drive con las 37 columnas y generará el reporte final.')) {
      return;
    }

    try {
      window.Toast.info('Creando archivo final en Google Drive...');
      const res = await window.API.finishReview(inventoryId, {
        reviewNotes: 'Aprobado y justificado con matriz oficial de 37 columnas'
      });

      window.Toast.success(`Revisión finalizada. Archivo Drive: ${res.drive?.fileName || 'creado'}`);
      this.loadJustifications();
      window.Router.navigate('history');
    } catch (err) {
      window.Toast.danger(err.message || 'Error al terminar revisión');
    }
  }
};
