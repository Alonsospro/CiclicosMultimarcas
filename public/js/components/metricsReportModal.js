// ==========================================================================
// INFORME ADMINISTRATIVO • CONTROL DE INVENTARIO CÍCLICO
// Generador y Exportador de Reportes Oficiales NIBOL Multimarcas en PDF
// ==========================================================================

window.MetricsReportModal = {
  currentInventory: null,
  currentMetrics: null,
  reportCharts: [],
  isGenerating: false,
  isExporting: false,
  initialized: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.setupListeners();
  },

  setupListeners() {
    // Dashboard print buttons are owned by DashboardView.
    const btnDownloadPdf = document.getElementById('btn-report-download-pdf');
    if (btnDownloadPdf) {
      btnDownloadPdf.onclick = (e) => {
        e.preventDefault();
        this.downloadPDF();
      };
    }

    // Botón de Imprimir nativo en modal
    const btnNativePrint = document.getElementById('btn-report-native-print');
    if (btnNativePrint) {
      btnNativePrint.onclick = (e) => {
        e.preventDefault();
        this.triggerNativePrint();
      };
    }

    // Confirmación en modal selector de inventario si se utiliza
    const btnConfirmSelect = document.getElementById('btn-confirm-report-inventory');
    if (btnConfirmSelect) {
      btnConfirmSelect.onclick = () => {
        const select = document.getElementById('select-report-target-inventory');
        const invId = select?.value;
        if (invId) {
          window.ModalHelper?.close('modal-select-inventory-report');
          this.generateReportForInventory(invId);
        }
      };
    }
  },

  handlePrintReportClick() {
    if (this.isGenerating) return;

    const currentData = window.DashboardView?.currentData;
    const invSelect = document.getElementById('dash-filter-inventory');
    const selectedVal = invSelect ? invSelect.value : 'TODOS';

    // 1. Si los datos actuales del dashboard ya están cargados en memoria y coinciden con la selección
    if (currentData && currentData.summary) {
      const isMatchingSelected = selectedVal === 'TODOS' || (currentData.selectedInventory && currentData.selectedInventory.id === selectedVal);
      if (isMatchingSelected) {
        const invObj = currentData.selectedInventory || {
          id: selectedVal !== 'TODOS' ? selectedVal : 'CONSOLIDADO',
          name: selectedVal !== 'TODOS' ? selectedVal : 'Informe Consolidado Período',
          center: currentData.filters?.center || '1300',
          type: 'CICLICO',
          status: 'FINALIZADO',
          createdAt: new Date().toISOString(),
          totalItems: currentData.summary?.totalItemsAudited || 0
        };
        this.openReportWithData(invObj, currentData);
        return;
      }
    }

    // 2. Si se tiene seleccionado un inventario específico en el filtro
    if (selectedVal && selectedVal !== 'TODOS') {
      this.generateReportForInventory(selectedVal);
      return;
    }

    // 3. Si el estado del dashboard ya tiene un inventario puntual cargado
    if (currentData?.selectedInventory?.id) {
      this.generateReportForInventory(currentData.selectedInventory.id);
      return;
    }

    // 4. Revisar lista de inventarios disponibles (excluyendo reconteos auxiliares)
    const available = (currentData?.availableInventories || []).filter(inv => !String(inv.id || '').startsWith('REC-'));
    if (available.length === 1) {
      this.generateReportForInventory(available[0].id);
      return;
    }

    // 5. Generar reporte consolidado activo
    this.generateReportForInventory('TODOS');
  },

  openReportWithData(inventoryObj, metricsData) {
    if (metricsData.metricsComplete === false) {
      window.Toast?.warning('Hay archivos sin validar. Revise las fuentes antes de generar el informe.');
      return;
    }
    this.currentInventory = inventoryObj;
    this.currentMetrics = metricsData;

    // The sheets are measured to paginate, so the modal must be visible first.
    window.ModalHelper?.open('modal-metrics-report');
    this.buildReportDOM(inventoryObj, metricsData);

    window.Toast?.success('Informe generado correctamente');
  },

  async generateReportForInventory(inventoryId) {
    if (this.isGenerating) return;
    this.isGenerating = true;

    const user = window.Auth?.currentUser;
    const isAdmin = user && (user.role === 'ADMIN' || user.isSuperadmin);
    const centerFilter = isAdmin
      ? (document.getElementById('dash-filter-center')?.value || 'TODOS')
      : (user?.center || '1300');

    window.Toast?.info('Cargando métricas y generando informe administrativo...');

    try {
      let metricsData;
      let inventoryObj = null;

      if (inventoryId === 'TODOS') {
        const currentData = window.DashboardView?.currentData;
        if (currentData && currentData.summary) {
          metricsData = currentData;
        } else {
          metricsData = await window.API.getDashboardMetrics({
            inventoryId: 'TODOS',
            center: centerFilter === 'TODOS' ? '' : centerFilter,
            period: document.getElementById('dash-filter-period')?.value || 'TODO'
          });
        }
        inventoryObj = {
          id: 'CONSOLIDADO',
          name: 'Informe Consolidado Período',
          center: centerFilter === 'TODOS' ? '1300' : centerFilter,
          type: 'CICLICO',
          status: 'COMPLETO',
          createdAt: new Date().toISOString(),
          totalItems: metricsData.summary?.totalItemsAudited || 0
        };
      } else {
        metricsData = await window.API.getDashboardMetrics({
          inventoryId,
          center: '',
          period: 'TODO'
        });

        inventoryObj = metricsData.selectedInventory;
        if (!inventoryObj) {
          try {
            const invRes = await window.API.getInventoryById(inventoryId);
            if (invRes && invRes.inventory) {
              inventoryObj = invRes.inventory;
            }
          } catch (e) {
            console.warn('[Report] Fallback detalle inventario:', e);
          }
        }

        if (!inventoryObj) {
          inventoryObj = {
            id: inventoryId,
            name: inventoryId,
            center: centerFilter !== 'TODOS' ? centerFilter : '1300',
            type: 'CICLICO',
            status: 'FINALIZADO',
            createdAt: new Date().toISOString(),
            totalItems: metricsData.summary?.totalItemsAudited || 0
          };
        }
      }

      this.openReportWithData(inventoryObj, metricsData);
    } catch (err) {
      console.error('[MetricsReport] Error:', err);
      window.Toast?.danger(err.message || 'Error al generar el informe administrativo.');
    } finally {
      this.isGenerating = false;
    }
  },

  buildReportDOM(inv, metrics) {
    const container = document.getElementById('report-printable-area');
    if (!container) return;
    const report = window.ManagementReport;
    const consolidated = report.kind(metrics) === 'consolidado';
    const title = document.getElementById('report-modal-title');
    const subtitle = document.getElementById('report-modal-subtitle');
    if (title) title.textContent = consolidated ? 'Informe consolidado de centros' : 'Informe de inventario por centro';
    if (subtitle) subtitle.textContent = consolidated ? 'Comparación entre centros con el filtro actual del dashboard' : 'Resultado, cantidades, ubicación y detalle del centro';
    container.innerHTML = report.render(inv, metrics);
    report.paginate(container);
  },

  async downloadPDF() {
    if (this.isExporting) return;
    const element = document.getElementById('report-printable-area');
    const pages = Array.from(element?.querySelectorAll('.mr-sheet') || []);
    if (!pages.length) {
      window.Toast?.danger('No se encontró el contenido del informe para generar el PDF.');
      return;
    }
    if (typeof html2pdf === 'undefined') {
      window.Toast?.danger('El generador de PDF no está disponible. Abriendo diálogo de impresión...');
      this.triggerNativePrint();
      return;
    }

    this.isExporting = true;
    const controls = ['btn-report-download-pdf', 'btn-report-native-print'].map(id => document.getElementById(id)).filter(Boolean);
    controls.forEach(control => { control.disabled = true; });
    const btn = document.getElementById('btn-report-download-pdf');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando PDF...';
    window.Toast?.info('Generando el PDF...');

    const viewport = document.getElementById('report-preview-viewport');
    const previousScroll = viewport ? viewport.scrollTop : 0;
    if (viewport) viewport.scrollTop = 0;
    const consolidated = window.ManagementReport.kind(this.currentMetrics) === 'consolidado';
    const inv = this.currentInventory || {};
    const safe = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = consolidated
      ? `Informe_Consolidado_${dateStr}.pdf`
      : `Informe_Centro_${safe(inv.center)}_${safe(inv.id)}_${dateStr}.pdf`;

    try {
      // One image per sheet: a whole-document canvas fails on long annexes.
      let worker = html2pdf().set({
        margin: 0,
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: [] }
      }).from(pages[0]).toContainer().toCanvas().toPdf();
      pages.slice(1).forEach(page => {
        worker = worker.get('pdf').then(pdf => { pdf.addPage(); }).from(page).toContainer().toCanvas().toPdf();
      });
      const blob = await worker.outputPdf('blob');
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => link.remove(), 1500);
      this.showDirectDownloadButton(blobUrl, filename);
      window.Toast?.success(`PDF "${filename}" descargado.`);
    } catch (err) {
      console.error('[MetricsReport] Error de PDF:', err);
      window.Toast?.danger('No se pudo generar el PDF. Abriendo diálogo de impresión...');
      this.triggerNativePrint();
    } finally {
      if (viewport) viewport.scrollTop = previousScroll;
      if (btn) btn.innerHTML = originalText;
      controls.forEach(control => { control.disabled = false; });
      this.isExporting = false;
    }
  },

  showDirectDownloadButton(blobUrl, filename) {
    let box = document.getElementById('report-pdf-direct-download-box');
    if (!box) {
      const headerBtns = document.querySelector('#modal-metrics-report .modal-header > div:last-child');
      if (headerBtns) {
        box = document.createElement('div');
        box.id = 'report-pdf-direct-download-box';
        headerBtns.insertBefore(box, headerBtns.firstChild);
      }
    }
    if (box) {
      box.innerHTML = `
        <a href="${blobUrl}" download="${filename}" class="btn btn-success btn-sm" style="background: #059669; color: #fff; text-decoration: none; display: inline-flex; align-items: center; gap: 0.35rem; font-weight: 600; padding: 0.28rem 0.65rem; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.15);" title="Descarga directa del PDF generado">
          <i class="fa-solid fa-circle-down"></i> Descargar PDF Listo
        </a>
      `;
    }
  },

  triggerNativePrint() {
    try {
      window.print();
    } catch (err) {
      console.warn('Native print en iframe no soportado:', err);
      window.Toast?.danger('Este entorno no permite imprimir desde la página.');
    }
  },

  printNative() {
    this.triggerNativePrint();
  }
};
