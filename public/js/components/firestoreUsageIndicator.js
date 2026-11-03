// Estimated daily Firestore consumption for the superadministrator. It loads on demand, never on a timer.
window.FirestoreUsageIndicator = {
  loading: false,

  format(value) {
    return Number(value || 0).toLocaleString('es-BO');
  },

  describe(usage) {
    const over = usage.readPercent >= 100 || usage.writePercent >= 100;
    return [
      'Consumo estimado de Firestore hoy',
      `Lecturas: ${this.format(usage.reads)} de ${this.format(usage.readQuota)}`,
      `Escrituras: ${this.format(usage.writes)} de ${this.format(usage.writeQuota)}`,
      over ? 'Cuota gratuita superada: la app sigue funcionando y el excedente se cobra en Google Cloud.' : 'La app sigue funcionando aunque se supere la cuota gratuita.',
      'Se reinicia a medianoche, hora del Pacífico. Clic para actualizar.'
    ].join('\n');
  },

  render(usage) {
    const button = document.getElementById('btn-firestore-usage');
    const text = document.getElementById('firestore-usage-text');
    if (!button || !text) return;
    button.classList.toggle('is-warning', usage?.level === 'warning');
    button.classList.toggle('is-critical', usage?.level === 'critical');
    if (!usage) {
      text.textContent = 'Firestore: sin datos';
      button.title = 'No se pudo consultar el consumo. Clic para reintentar.';
      return;
    }
    text.textContent = `Lect. ${Math.round(usage.readPercent)}% · Escr. ${Math.round(usage.writePercent)}%`;
    button.title = this.describe(usage);
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
