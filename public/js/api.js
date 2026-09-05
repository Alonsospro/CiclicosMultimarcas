// API Client for NIBOL Inventarios
window.API = {
  getToken() {
    return localStorage.getItem(window.AppConfig.storageTokenKey);
  },

  async request(endpoint, options = {}) {
    const url = `${window.AppConfig.apiBaseUrl}${endpoint}`;
    const headers = {
      ...(options.headers || {})
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (response.status === 401) {
        window.Auth.logout(true);
        throw new Error('Sesión expirada. Por favor ingrese nuevamente.');
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || `Error del servidor: ${response.status}`);
      }

      return data;
    } catch (err) {
      console.error(`[API Error] ${endpoint}:`, err);
      throw err;
    }
  },

  buildQueryString(params = {}) {
    const cleanParams = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '' && value !== 'undefined' && value !== 'null') {
        cleanParams[key] = value;
      }
    }
    const qs = new URLSearchParams(cleanParams).toString();
    return qs ? `?${qs}` : '';
  },

  // Auth endpoints
  login(username, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },

  getMe() {
    return this.request('/auth/me');
  },

  getCenters() {
    return this.request('/auth/centers');
  },

  getUsers() {
    return this.request('/auth/users');
  },

  createUser(userData) {
    return this.request('/auth/users', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
  },

  updateUser(id, userData) {
    return this.request(`/auth/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(userData)
    });
  },

  deleteUser(id) {
    return this.request(`/auth/users/${id}`, {
      method: 'DELETE'
    });
  },

  // Inventories endpoints
  getInventories(params = {}) {
    return this.request(`/inventories${this.buildQueryString(params)}`);
  },

  getInventoryById(id) {
    return this.request(`/inventories/${id}`);
  },

  syncInventories(inventories) {
    return this.request('/inventories/sync', {
      method: 'POST',
      body: JSON.stringify({ inventories })
    });
  },

  createInventory(payload) {
    return this.request('/inventories', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  fetchFromGas(payload) {
    return this.request('/inventories/fetch-from-gas', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  checkGasHealth() {
    return this.request('/inventories/gas-health');
  },

  registerCount(inventoryId, payload) {
    return this.request(`/inventories/${inventoryId}/count`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  requestUnlockItem(inventoryId, itemId, payload = {}) {
    return this.request(`/inventories/${inventoryId}/items/${itemId}/request-unlock`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  reassignTasks(inventoryId, payload) {
    return this.request(`/inventories/${inventoryId}/reassign`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  submitInventory(inventoryId, payload = {}) {
    return this.request(`/inventories/${inventoryId}/submit`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  reopenInventory(inventoryId, payload = {}) {
    return this.request(`/inventories/${inventoryId}/reopen`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  deleteInventory(inventoryId, payload = {}) {
    return this.request(`/inventories/${inventoryId}`, {
      method: 'DELETE',
      body: JSON.stringify(payload)
    });
  },

  deleteItem(inventoryId, itemId) {
    return this.request(`/inventories/${inventoryId}/items/${itemId}`, {
      method: 'DELETE'
    });
  },

  // Barrido endpoints
  searchBarrido(q, center) {
    const params = new URLSearchParams({ q });
    if (center) params.set('center', center);
    return this.request(`/barrido/search?${params.toString()}`);
  },

  registerBarridoCount(payload) {
    return this.request('/barrido/count', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  finishBarrido(payload) {
    return this.request('/barrido/finish', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // Justifications endpoints
  getJustifications(center) {
    const query = center ? `?center=${encodeURIComponent(center)}` : '';
    return this.request(`/justifications${query}`);
  },

  saveJustification(payload) {
    return this.request('/justifications', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  finishReview(inventoryId, payload = {}) {
    return this.request(`/justifications/${inventoryId}/finish-review`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  // History & Reports endpoints
  getHistory() {
    return this.request('/history');
  },

  getHistoryDetail(fileId) {
    return this.request(`/history/${fileId}`);
  },

  // Dashboard & Metrics endpoints
  getDashboardMetrics(params = {}) {
    return this.request(`/dashboard/metrics${this.buildQueryString(params)}`);
  },

  getAuditLogs(params = {}) {
    return this.request(`/dashboard/audit${this.buildQueryString(params)}`);
  },

  // Photo upload
  async uploadPhoto(file, metadata = {}) {
    const formData = new FormData();
    formData.append('photo', file);
    if (metadata.category) formData.append('category', metadata.category);
    if (metadata.photoType) formData.append('photoType', metadata.photoType);
    if (metadata.sku) formData.append('sku', metadata.sku);
    if (metadata.center) formData.append('center', metadata.center);
    if (metadata.date) formData.append('date', metadata.date);
    if (metadata.inventoryId) formData.append('inventoryId', metadata.inventoryId);
    if (metadata.itemId) formData.append('itemId', metadata.itemId);

    return this.request('/photos/upload', {
      method: 'POST',
      body: formData
    });
  },

  // Google Apps Script Connectivity & Diagnostics
  getGasHealth() {
    return this.request('/inventories/gas-health');
  },

  getGasDiagnostics() {
    return this.request('/inventories/gas-diagnostics');
  }
};
