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
        signal: options.signal || AbortSignal.timeout(60000),
        headers
      });

      let data;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          data = await response.json();
        } catch (jsonErr) {
          const text = await response.text().catch(() => '');
          data = { success: false, message: text || `Error del servidor (${response.status})` };
        }
      } else {
        const text = await response.text().catch(() => '');
        data = { success: false, message: text || `Error del servidor (${response.status})` };
      }

      if (response.status === 401) {
        const isLoginEndpoint = endpoint === '/auth/login' || endpoint.endsWith('/auth/login');
        if (isLoginEndpoint) {
          throw new Error(data && data.message ? data.message : 'Usuario o contraseña incorrectos.');
        } else {
          if (window.Auth && typeof window.Auth.logout === 'function') {
            window.Auth.logout(false);
          }
          throw new Error((data && data.message) || 'Sesión expirada. Por favor ingrese nuevamente.');
        }
      }

      if (!response.ok || data?.success === false) {
        const error = new Error(data.message || data.error || `Error del servidor: ${response.status}`);
        error.status = response.status;
        error.code = data.code;
        throw error;
      }

      const sync = data.inventory || data.justification || data;
      if (typeof sync.syncPending === 'boolean' && window.CountQueue) {
        const id = sync.inventoryId || sync.id || endpoint.match(/^\/inventories\/([^/?]+)/)?.[1];
        window.CountQueue.noteSync(id, sync.syncPending);
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

  getInventory(id) {
    return this.getInventoryById(id);
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
    return window.CountQueue.send(inventoryId, payload);
  },

  requestUnlockItem(inventoryId, itemId, payload = {}) {
    return this.request(`/inventories/${inventoryId}/items/${encodeURIComponent(itemId)}/request-unlock`, {
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
    if (window.CountQueue.hasPending(inventoryId)) return Promise.reject(new Error('Hay conteos pendientes de envío. Sincronícelos antes de finalizar.'));
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

  updateCountItem(inventoryId, payload = {}) {
    return this.request(`/inventories/${inventoryId}/update-count-item`, {
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

  getTrashInventories() {
    return this.request('/inventories/trash');
  },

  restoreInventory(inventoryId) {
    return this.request(`/inventories/${inventoryId}/restore`, {
      method: 'POST'
    });
  },

  purgeAllInventories() {
    return this.request('/inventories/purge-all', {
      method: 'POST'
    });
  },

  deleteItem(inventoryId, itemId, extraData = {}) {
    const params = new URLSearchParams();
    if (extraData.sku) params.set('sku', extraData.sku);
    if (extraData.location) params.set('location', extraData.location);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/inventories/${inventoryId}/items/${encodeURIComponent(itemId)}${qs}`, {
      method: 'DELETE',
      body: JSON.stringify(extraData)
    });
  },

  deleteInventoryItem(inventoryId, itemId, extraData = {}) {
    return this.deleteItem(inventoryId, itemId, extraData);
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

  syncAllFromSheets() {
    return this.request('/inventories/sync-all-sheets', {
      method: 'POST'
    });
  },

  syncInventoryFromSheet(inventoryId) {
    return this.request(`/inventories/${inventoryId}/sync-sheet`, {
      method: 'POST'
    });
  },

  saveJustification(payload) {
    return this.request('/justifications', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  corroborateItem(inventoryId, payload) {
    return this.request(`/justifications/${inventoryId}/corroborate`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  },

  enableRecount(inventoryId, payload = {}) {
    return this.request(`/justifications/${inventoryId}/enable-recount`, {
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

  deleteSnapshot(fileId, data = {}) {
    return this.request(`/history/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      body: JSON.stringify(data)
    });
  },

  // Dashboard & Metrics endpoints
  getDashboardMetrics(params = {}) {
    return this.request(`/dashboard/metrics${this.buildQueryString(params)}`);
  },

  recalculateDashboardMetrics(params = {}) {
    return this.request('/dashboard/recalculate', {
      method: 'POST',
      body: JSON.stringify(params)
    });
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
    if (metadata.type) formData.append('type', metadata.type);
    if (metadata.prefix) formData.append('prefix', metadata.prefix);
    if (metadata.isJustification2 !== undefined) formData.append('isJustification2', metadata.isJustification2);
    if (metadata.round !== undefined) formData.append('round', metadata.round);

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
