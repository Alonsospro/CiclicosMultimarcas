// Estimated daily Firestore consumption for the superadministrator. It loads on demand, never on a timer.
window.FirestoreUsageIndicator = {
  loading: false,

  format(value) {
    return Number(value || 0).toLocaleString('es-BO');
  },

  percentText(percent) {
    if (percent > 0 && percent < 1) return '<1%';
    return `${Math.round(percent)}%`;
  },

  describe(usage) {
    const over = usage.readPercent >= 100 || usage.writePercent >= 100;
    return [
      'Consumo estimado de Firestore hoy',
      `Lecturas: ${this.format(usage.reads)} de ${this.format(usage.readQuota)} (${this.percentText(usage.readPercent)})`,
      `Escrituras: ${this.format(usage.writes)} de ${this.format(usage.writeQuota)} (${this.percentText(usage.writePercent)})`,
      over ? 'Cuota gratuita superada: la app sigue funcionando y el excedente se cobra en Google Cloud.' : 'La app sigue funcionando aunque se supere la cuota gratuita.',
      'Se reinicia a medianoche, hora del Pacífico. Clic para actualizar.'
    ].join('\n');
  },

  renderMeter(name, percent) {
    const meter = document.getElementById(`firestore-usage-${name}`);
    const fill = document.getElementById(`firestore-usage-${name}-fill`);
    const value = document.getElementById(`firestore-usage-${name}-value`);
    if (!meter || !fill || !value) return;
    const known = Number.isFinite(percent);
    meter.classList.toggle('is-warning', known && percent >= 70 && percent < 90);
    meter.classList.toggle('is-critical', known && percent >= 90);
    fill.style.width = known ? `${Math.min(percent, 100)}%` : '0';
    value.textContent = known ? this.percentText(percent) : '–';
  },

  render(usage) {
    const button = document.getElementById('btn-firestore-usage');
    if (!button) return;
    this.renderMeter('read', usage?.readPercent);
    this.renderMeter('write', usage?.writePercent);
    const description = usage ? this.describe(usage) : 'No se pudo consultar el consumo. Clic para reintentar.';
    button.title = description;
    button.setAttribute('aria-label', description);
  },

  async load() {
    if (this.loading || !window.Auth?.isSuperadminAlonso?.()) return;
    this.loading = true;
    try {
      const response = await window.API.getFirestoreUsage();
      this.render(response.usage);
    } catch (error) {
      this.render(null);
    } finally {
      this.loading = false;
    }
  }
};
