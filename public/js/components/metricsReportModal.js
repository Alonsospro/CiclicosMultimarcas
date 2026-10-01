// ==========================================================================
// INFORME ADMINISTRATIVO • CONTROL DE INVENTARIO CÍCLICO
// Generador y Exportador de Reportes Oficiales NIBOL Multimarcas en PDF
// ==========================================================================

window.MetricsReportModal = {
  currentInventory: null,
  currentMetrics: null,
  reportCharts: [],
  isGenerating: false,
  initialized: false,

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.setupListeners();
  },

  setupListeners() {
    // Botón principal del Dashboard
    const btnDashPrint = document.getElementById('btn-dash-print-report');
    if (btnDashPrint) {
      btnDashPrint.onclick = (e) => {
        e.preventDefault();
        this.handlePrintReportClick();
      };
    }

    // Botón en banner del Dashboard
    const btnBannerPrint = document.getElementById('btn-dash-banner-print-report');
    if (btnBannerPrint) {
      btnBannerPrint.onclick = (e) => {
        e.preventDefault();
        this.handlePrintReportClick();
      };
    }

    // Botón de Descargar PDF en modal
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

    // Renderizar el informe en el contenedor de impresión
    this.buildReportDOM(inventoryObj, metricsData);

    // Abrir modal de vista previa
    window.ModalHelper?.open('modal-metrics-report');

    // Inicializar y renderizar los gráficos de alta definición
    setTimeout(() => {
      this.renderReportCharts(metricsData.summary || {}, metricsData.discrepanciesList || []);
    }, 120);

    window.Toast?.success('Informe administrativo generado correctamente');
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
    this.reportCharts.forEach(chart => { try { chart.destroy(); } catch (_) {} });
    this.reportCharts = [];
    const summary = metrics.summary || {};
    const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const money = value => Number(value ?? 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const percent = value => Number(value ?? 0).toFixed(2) + '%';
    const discrepancies = metrics.discrepanciesList || [];
    const shortages = discrepancies.filter(row => (row.diferenciaFinal ?? row.diferencia ?? 0) < 0);
    const eris = [
      ['ERI existencias', summary.eriItemInicial, summary.eriItemFinal],
      ['ERI SKU', summary.eriSkuInicial, summary.eriSkuFinal],
      ['ERI monetario', summary.eriMonetarioInicial, summary.eriMonetarioFinal]
    ];
    this.chartData = {
      donutLabels: ['Registros exactos finales', 'Registros con diferencia final'],
      donutValues: [summary.itemsCuadradosFinal ?? 0, summary.discrepanciasFinal ?? 0],
      donutColors: ['#059669', '#dc2626'],
      barLabels: shortages.map(row => row.sku),
      barValues: shortages.map(row => Math.abs(row.costoDiferenciaFinal ?? row.costoDiferencia ?? 0)),
      eriComparison: { labels: eris.map(row => row[0]), initial: eris.map(row => row[1] ?? 0), final: eris.map(row => row[2] ?? 0) }
    };
    container.innerHTML = `
      <div class="rep-exec-banner"><img src="/logos/nibol.svg" alt="NIBOL" style="height:24px" />
        <div><h1 class="rep-exec-banner-title">INFORME DE MÉTRICAS DE INVENTARIO</h1>
          <p class="rep-exec-banner-sub">${escape(inv.name || inv.id)} · Centro ${escape(inv.center || metrics.filters?.center)}</p></div></div>
      <div class="rep-exec-summary-box">
        ${summary.totalInventories ?? 0} inventario(s), ${summary.totalSkusAudited ?? 0} SKU auditados,
        ${summary.totalItemsAudited ?? 0} registros y ${summary.totalAuditedSystemUnits ?? 0} existencias de sistema.
        Emisión: ${new Date().toLocaleString('es-BO')}. Los totales consolidados suman las evaluaciones de cada inventario.
      </div>
      <table class="rep-exec-table"><thead><tr><th>Indicador</th><th>Primer conteo</th><th>Final</th><th>Meta ≥95%</th></tr></thead>
        <tbody>${eris.map(row => `<tr><td>${row[0]}</td><td>${percent(row[1])}</td><td>${percent(row[2])}</td><td>${Number(row[2]) >= 95 ? 'Cumple' : 'Por debajo de la meta'}</td></tr>`).join('')}</tbody></table>
      <p>Valor de sistema: Bs. ${money(summary.totalAuditedSystemValue)} · Diferencia absoluta final: Bs. ${money(summary.impactoFinancieroFinal)}.</p>
      <h3>Fuentes utilizadas</h3>
      <table class="rep-exec-table"><thead><tr><th>Inventario / centro</th><th>Pestaña</th><th>Filas / SKU únicos</th><th>Lectura</th></tr></thead>
        <tbody>${(metrics.sourceDiagnostics || []).map(source => `<tr><td>${escape(source.name || source.id)} / ${escape(source.center)}</td>
          <td>${escape(source.sheetName || 'Inventario activo')}</td><td>${source.actualRows ?? 0} / ${source.actualSkus ?? 0}</td><td>${escape(source.readAt || '')}</td></tr>`).join('')}</tbody></table>
      ${(metrics.sourceDiagnostics || []).flatMap(source => (source.warnings || []).map(warning => `<p>${escape(source.name || source.id)}: ${escape(warning)}</p>`)).join('')}
      <h3>Diferencias observadas</h3>
      <table class="rep-exec-table"><thead><tr><th>SKU</th><th>Almacén / ubicación</th><th>Diferencia inicial</th><th>Diferencia final</th><th>Costo final (Bs.)</th></tr></thead>
        <tbody>${discrepancies.map(row => `<tr><td>${escape(row.sku)}</td><td>${escape(row.almacen)} / ${escape(row.ubicacion)}</td>
          <td>${row.diferencia1erConteo ?? row.diferencia ?? 0}</td><td>${row.diferenciaFinal ?? 0}</td><td>${money(row.costoDiferenciaFinal)}</td></tr>`).join('') || '<tr><td colspan="5">Sin diferencias registradas.</td></tr>'}</tbody></table>
      <div class="rep-charts-grid-3">${['rep-chart-result-donut', 'rep-chart-sku-bars', 'rep-chart-eri-comparison'].map(id => `<div class="rep-chart-card"><div class="rep-chart-canvas-wrapper"><canvas id="${id}"></canvas></div></div>`).join('')}</div>
    `;
  },

  renderReportCharts(summary, discrepancies) {
    if (typeof Chart === 'undefined') {
      console.warn('[MetricsReport] Chart.js no disponible.');
      return;
    }

    const data = this.chartData || {
      donutLabels: ['Conforme Inicial', 'Doble Ubicación', 'Balanceos', 'Mal Estado', 'Faltante Definitivo'],
      donutValues: [],
      donutColors: ['#059669', '#2563eb', '#d97706', '#8b5cf6', '#dc2626'],
      barLabels: [],
      barValues: [],
      eriComparison: {
        labels: ['ERI Ítems (Principal)', 'ERI de SKU (Códigos)', 'ERI Monetario (Valor)'],
        initial: [0, 0, 0],
        final: [0, 0, 0]
      }
    };

    // 1. Gráfico Donut: Distribución del Resultado del Inventario
    try {
      const cvs1 = document.getElementById('rep-chart-result-donut');
      if (cvs1) {
        const existing = Chart.getChart(cvs1);
        if (existing) existing.destroy();

        const chart1 = new Chart(cvs1.getContext('2d'), {
          type: 'doughnut',
          data: {
            labels: data.donutLabels,
            datasets: [{
              data: data.donutValues,
              backgroundColor: data.donutColors,
              borderColor: '#ffffff',
              borderWidth: 2,
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            cutout: '56%',
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: '#1e293b',
                  boxWidth: 9,
                  padding: 5,
                  font: { size: 8.5, family: 'Inter', weight: '600' }
                }
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const val = ctx.raw || 0;
                    const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                    const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                    return ` ${ctx.label}: ${val} (${pct}%)`;
                  }
                }
              }
            }
          }
        });
        this.reportCharts.push(chart1);
      }
    } catch (e1) {
      console.warn('[Report] Error Donut Chart:', e1);
    }

    // 2. Gráfico Barras: Monto Faltante por Código SKU
    try {
      const cvs2 = document.getElementById('rep-chart-sku-bars');
      if (cvs2) {
        const existing = Chart.getChart(cvs2);
        if (existing) existing.destroy();

        const chart2 = new Chart(cvs2.getContext('2d'), {
          type: 'bar',
          data: {
            labels: data.barLabels,
            datasets: [{
              label: 'Impacto Faltante ($)',
              data: data.barValues,
              backgroundColor: '#dc2626',
              borderRadius: 4,
              barPercentage: 0.45
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
              y: {
                beginAtZero: true,
                grid: { color: '#e2e8f0' },
                ticks: {
                  color: '#475569',
                  font: { size: 8.5, family: 'Inter' },
                  callback: (v) => `$${Number(v).toLocaleString('es-BO')}`
                }
              },
              x: {
                grid: { display: false },
                ticks: {
                  color: '#0f172a',
                  font: { size: 9, family: 'Inter', weight: '700' }
                }
              }
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => ` Faltante: -$${Number(ctx.raw).toLocaleString('es-BO', { minimumFractionDigits: 2 })}`
                }
              }
            }
          }
        });
        this.reportCharts.push(chart2);
      }
    } catch (e2) {
      console.warn('[Report] Error Bar Chart:', e2);
    }

    // 3. Gráfico Barras Comparativas: Evolución de los 3 ERIs (1er Conteo vs Final)
    try {
      const cvs3 = document.getElementById('rep-chart-eri-comparison');
      if (cvs3) {
        const existing = Chart.getChart(cvs3);
        if (existing) existing.destroy();

        const eriComp = data.eriComparison || {
          labels: ['ERI Ítems', 'ERI SKU', 'ERI Monetario'],
          initial: [0, 0, 0],
          final: [0, 0, 0]
        };

        const chart3 = new Chart(cvs3.getContext('2d'), {
          type: 'bar',
          data: {
            labels: eriComp.labels,
            datasets: [
              {
                label: '1er Conteo (Inicial)',
                data: eriComp.initial,
                backgroundColor: '#94a3b8',
                borderRadius: 4,
                barPercentage: 0.7,
                categoryPercentage: 0.8
              },
              {
                label: 'Conteo Final (Cierre)',
                data: eriComp.final,
                backgroundColor: '#059669',
                borderRadius: 4,
                barPercentage: 0.7,
                categoryPercentage: 0.8
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
              y: {
                beginAtZero: true,
                max: 105,
                grid: { color: '#e2e8f0' },
                ticks: {
                  color: '#475569',
                  font: { size: 8.5, family: 'Inter' },
                  callback: (v) => `${v}%`
                }
              },
              x: {
                grid: { display: false },
                ticks: {
                  color: '#0f172a',
                  font: { size: 8.5, family: 'Inter', weight: '700' }
                }
              }
            },
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: '#1e293b',
                  boxWidth: 9,
                  padding: 5,
                  font: { size: 8.5, family: 'Inter', weight: '600' }
                }
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toFixed(2)}%`
                }
              }
            }
          }
        });
        this.reportCharts.push(chart3);
      }
    } catch (e3) {
      console.warn('[Report] Error Comparison Chart:', e3);
    }
  },

  async downloadPDF() {
    const element = document.getElementById('report-printable-area');
    if (!element) {
      window.Toast?.danger('No se encontró el contenido del reporte para generar el PDF.');
      return;
    }

    const btn = document.getElementById('btn-report-download-pdf');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando PDF...';
      btn.disabled = true;
    }

    window.Toast?.info('Compilando documento PDF en alta calidad...');

    const inv = this.currentInventory || {};
    const center = String(inv.center || '1300').replace(/[^a-zA-Z0-9_-]/g, '_');
    const invId = String(inv.id || 'INV').replace(/[^a-zA-Z0-9_-]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `Informe_Administrativo_Inventario_${center}_${invId}_${dateStr}.pdf`;

    // Scroll viewport to top to prevent canvas offset clippings
    const viewport = document.getElementById('report-preview-viewport');
    const prevScrollTop = viewport ? viewport.scrollTop : 0;
    if (viewport) viewport.scrollTop = 0;

    // Para evitar lienzos en blanco o cortados en html2canvas, reemplazamos temporalmente cada canvas por su imagen PNG en alta resolución
    const canvases = element.querySelectorAll('canvas');
    const replacements = [];
    canvases.forEach(cvs => {
      try {
        const dataUrl = cvs.toDataURL('image/png', 1.0);
        if (dataUrl && dataUrl.length > 50) {
          const img = document.createElement('img');
          img.src = dataUrl;
          img.style.width = '100%';
          const h = cvs.offsetHeight || (cvs.parentElement ? cvs.parentElement.offsetHeight : 180);
          img.style.height = `${h}px`;
          img.style.objectFit = 'contain';
          img.style.display = 'block';
          img.className = 'temp-pdf-chart-img';
          cvs.parentNode.insertBefore(img, cvs);
          cvs.style.display = 'none';
          replacements.push({ cvs, img });
        }
      } catch (e) {
        console.warn('Canvas a imagen omitido:', e);
      }
    });

    let downloaded = false;
    let blobUrl = null;

    if (typeof html2pdf !== 'undefined') {
      const opt = {
        margin: [6, 6, 6, 6],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          logging: false,
          scrollY: 0,
          scrollX: 0,
          backgroundColor: '#ffffff'
        },
        jsPDF: {
          unit: 'mm',
          format: 'a4',
          orientation: 'portrait'
        },
        pagebreak: {
          mode: ['avoid-all', 'css', 'legacy']
        }
      };

      try {
        const worker = html2pdf().set(opt).from(element);
        const pdfBlob = await worker.outputPdf('blob');
        if (pdfBlob && pdfBlob.size > 0) {
          blobUrl = URL.createObjectURL(pdfBlob);
          const link = document.createElement('a');
          link.href = blobUrl;
          link.download = filename;
          link.rel = 'noopener';
          link.target = '_blank';
          document.body.appendChild(link);
          link.click();
          setTimeout(() => {
            if (link.parentNode) link.parentNode.removeChild(link);
          }, 1500);

          downloaded = true;
          this.showDirectDownloadButton(blobUrl, filename);
          window.Toast?.success(`PDF "${filename}" compilado y descargado con éxito.`);
        }
      } catch (errBlob) {
        console.warn('[html2pdf outputPdf blob error, attempting direct save]:', errBlob);
        try {
          await html2pdf().set(opt).from(element).save();
          downloaded = true;
          window.Toast?.success(`PDF "${filename}" descargado con éxito.`);
        } catch (errSave) {
          console.error('[html2pdf save error]:', errSave);
        }
      }
    }

    if (!downloaded) {
      // Intento de fallback secundario con renderizado asistido
      try {
        const fallbackSuccess = await this.generateJsPdfFallback(element, filename);
        if (fallbackSuccess) {
          downloaded = true;
          window.Toast?.success(`PDF "${filename}" generado y descargado con éxito.`);
        }
      } catch (fbErr) {
        console.error('[PDF Fallback Error]:', fbErr);
      }
    }

    // Restaurar lienzos de canvas originales y scroll
    replacements.forEach(({ cvs, img }) => {
      cvs.style.display = '';
      if (img.parentNode) img.parentNode.removeChild(img);
    });
    if (viewport) viewport.scrollTop = prevScrollTop;

    if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }

    if (!downloaded) {
      window.Toast?.danger('No se pudo completar la descarga directa. Abriendo diálogo de impresión...');
      try {
        window.print();
      } catch (pErr) {
        console.warn('window.print en iframe no disponible:', pErr);
      }
    }
  },

  async generateJsPdfFallback(element, filename) {
    if (typeof html2canvas !== 'function') return false;
    const JsPDFClass = window.jspdf?.jsPDF || window.jsPDF;
    if (!JsPDFClass) return false;

    const canvas = await html2canvas(element, {
      scale: 1.5,
      useCORS: true,
      allowTaint: true,
      scrollY: 0,
      scrollX: 0,
      backgroundColor: '#ffffff'
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    const pdf = new JsPDFClass('p', 'mm', 'a4');
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pdfWidth - 10;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 5;

    pdf.addImage(imgData, 'JPEG', 5, position, imgWidth, imgHeight);
    heightLeft -= (pdfHeight - 10);

    while (heightLeft > 0) {
      position = heightLeft - imgHeight + 5;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 5, position, imgWidth, imgHeight);
      heightLeft -= (pdfHeight - 10);
    }

    const blob = pdf.output('blob');
    if (!blob) return false;

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
    }, 1500);

    this.showDirectDownloadButton(blobUrl, filename);
    return true;
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
      window.Toast?.info('El entorno web enmarcado restringe el comando de impresión. Iniciando exportación directa a PDF...');
      this.downloadPDF();
    }
  },

  printNative() {
    this.triggerNativePrint();
  }
};
