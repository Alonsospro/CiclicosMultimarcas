// Frontend Configuration
window.AppConfig = {
  apiBaseUrl: window.location.origin + '/api',
  storageTokenKey: 'nibol_inv_token',
  storageUserKey: 'nibol_inv_user',
  storageThemeKey: 'nibol_inv_theme',
  scanDelayMs: 1000, // 1s cooldown between consecutive barcode scans
  currencySymbol: 'Bs.', // Configuración centralizada de moneda visual (Bs.)
  formatCurrency: function(amount) {
    const num = Number(amount || 0);
    return `${this.currencySymbol} ${num.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
};
