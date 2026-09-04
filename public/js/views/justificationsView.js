// View: Justifications & Final Review Closure (Admin Only)
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
          window.Toast.success('Foto de justificación lista para guardar en Google Drive');
        }
      } catch (err) {
        window.Toast.danger(err.message || 'Error al subir foto de respaldo');
      }
    });

    // Form submit: Save Justification
    document.getElementById('form-submit-justification')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const inventoryId = document.getElementById('just-modal-inv-id').value;
      const sku = document.getElementById('just-modal-sku-input').value;
      const reasonType = document.getElementById('just-select-reason').value;
      const justification = document.getElementById('just-input-text').value.trim();
      const photoUrl = document.getElementById('just-photo-url').value || null;

      try {
        await window.API.saveJustification({
          inventoryId,
          sku,
          reasonType,
          justification,
          photoUrl
        });

        window.Toast.success(`Justificación registrada para SKU ${sku}`);
        window.ModalHelper.close('modal-justification');
        this.loadJustifications();
      } catch (err) {
        window.Toast.danger(err.message || 'Error al guardar justificación');
      }
    });
  },

  async loadJustifications() {
    const container = document.getElementById('justifications-container');
    if (!container) return;

    container.innerHTML = '<div style="text-align:center; padding: 3rem;"><i class="fa-solid fa-spinner fa-spin"></i> Cargando tareas de justificación pendientes...</div>';

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
            <h3>No hay inventarios con justificaciones pendientes</h3>
            <p style="font-size: 0.9rem; margin-top: 0.5rem;">Todos los inventarios están conciliados o revisados.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = this.tasks.map(task => {
        const isReadyToFinish = task.pendingJustificationsCount === 0;

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
                  ${task.pendingJustificationsCount > 0 ? `${task.pendingJustificationsCount} Pendientes de justificar` : 'Todas justificadas'}
                </span>

                <button class="btn btn-primary" onclick="window.JustificationsView.finishReview('${task.inventoryId}')">
                  <i class="fa-solid fa-cloud-arrow-up"></i> Terminar Revisión y Crear en Drive
                </button>
              </div>
            </div>

            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Descripción</th>
                    <th>Ubicación</th>
                    <th>Stock Sist.</th>
                    <th>Stock Fís.</th>
                    <th>Diferencia</th>
                    <th>Impacto $</th>
                    <th>Mal Estado</th>
                    <th>Estado Justificación</th>
                    <th>Razón (Col. R)</th>
                    <th>Comentarios (Col. S)</th>
                    <th>Evidencia</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  ${task.items.map(item => {
                    const diff = item.Diferencia || 0;
                    const isJustified = !!item.isJustified;
                    const just = item.justificationDetails;
                    const razonVal = item.Razon || (just ? just.reasonType : '') || '-';
                    const comentarioVal = item.Comentario_Justificacion || (just ? just.justification : '') || '-';

                    return `
                      <tr class="${!isJustified ? 'discrepancy-row' : ''}">
                        <td><strong style="color: var(--primary);">${item.SKU}</strong></td>
                        <td>${item.Descripcion}</td>
                        <td><span class="badge badge-info">${item.Ubicacion}</span></td>
                        <td>${item.Stock_Sistema}</td>
                        <td><strong style="font-family: var(--font-mono);">${item.Stock_Fisico}</strong></td>
                        <td><span class="badge ${diff < 0 ? 'badge-danger' : 'badge-warning'}">${diff > 0 ? '+' : ''}${diff}</span></td>
                        <td><strong style="color: var(--danger);">$${(item.Costo_Diferencia || 0).toFixed(2)}</strong></td>
                        <td>${item.Mal_estado > 0 ? `<span class="badge badge-danger">${item.Mal_estado}</span>` : '0'}</td>
                        <td>
                          <span class="badge ${isJustified ? 'badge-success' : 'badge-warning'}">
                            ${isJustified ? 'Justificado' : 'Pendiente'}
                          </span>
                        </td>
                        <td>
                          <span style="font-size: 0.85rem; font-weight: 600; color: ${isJustified ? 'var(--text-main)' : 'var(--text-dim)'};">
                            ${razonVal}
                          </span>
                        </td>
                        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${comentarioVal}">
                          <span style="font-size: 0.82rem; color: ${isJustified ? 'var(--text-main)' : 'var(--text-dim)'};">
                            ${comentarioVal}
                          </span>
                        </td>
                        <td>
                          ${(just && just.photoUrl) ? `
                            <a href="${just.photoUrl}" target="_blank" class="btn btn-secondary btn-sm" title="Ver foto binaria real">
                              <i class="fa-solid fa-image"></i> Ver Foto
                            </a>
                          ` : '<span style="color: var(--text-dim);">-</span>'}
                        </td>
                        <td>
                          <button class="btn btn-secondary btn-sm" onclick="window.JustificationsView.openJustifyModal('${task.inventoryId}', '${item.SKU}')">
                            <i class="fa-solid fa-pen-to-square"></i> ${isJustified ? 'Editar' : 'Justificar'}
                          </button>
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

  openJustifyModal(inventoryId, sku) {
    const task = this.tasks.find(t => t.inventoryId === inventoryId);
    if (!task) return;

    const item = task.items.find(i => i.SKU === sku);
    if (!item) return;

    document.getElementById('just-modal-inv-id').value = inventoryId;
    document.getElementById('just-modal-sku-input').value = sku;
    document.getElementById('just-modal-sku').textContent = item.SKU;
    document.getElementById('just-modal-desc').textContent = item.Descripcion;
    document.getElementById('just-modal-diff').textContent = `Diferencia: ${item.Diferencia > 0 ? '+' : ''}${item.Diferencia}`;
    document.getElementById('just-modal-cost').textContent = `Impacto Costo: $${(item.Costo_Diferencia || 0).toFixed(2)}`;

    const justDetails = item.justificationDetails;
    if (justDetails) {
      document.getElementById('just-select-reason').value = justDetails.reasonType || 'AJUSTE_OPERATIVO';
      document.getElementById('just-input-text').value = justDetails.justification || '';
      document.getElementById('just-photo-url').value = justDetails.photoUrl || '';
      if (justDetails.photoUrl) {
        const preview = document.getElementById('img-just-preview');
        preview.src = justDetails.photoUrl;
        preview.style.display = 'block';
      }
    } else {
      document.getElementById('form-submit-justification').reset();
      document.getElementById('just-photo-url').value = '';
      document.getElementById('img-just-preview').style.display = 'none';
    }

    window.ModalHelper.open('modal-justification');
  },

  async finishReview(inventoryId) {
    if (!confirm('¿Está seguro de terminar la revisión? Esto cerrará el inventario, creará el archivo final en Google Drive y generará el reporte oficial.')) {
      return;
    }

    try {
      window.Toast.info('Creando archivo final en Google Drive y archivando inventario...');
      const res = await window.API.finishReview(inventoryId, {
        reviewNotes: 'Aprobado y justificado por Administrador'
      });

      window.Toast.success(`Revisión finalizada. Archivo Drive: ${res.drive?.fileName || 'creado'}`);
      this.loadJustifications();
      window.Router.navigate('history');
    } catch (err) {
      window.Toast.danger(err.message || 'Error al terminar revisión');
    }
  }
};
