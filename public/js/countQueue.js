// Counts are retained before transmission, scoped to the signed-in operator.
// A server acknowledgement, never a local edit, advances the confirmed count.
window.CountQueue = {
  inFlight: new Map(),
  serverPending: new Map(),
  noteSync(id, pending) {
    if (!id || !this.account()) return;
    const key = `${this.account()}|${id}`;
    if (pending) this.serverPending.set(key, { account: this.account(), id });
    else this.serverPending.delete(key);
    this.renderStatus();
  },
  account() {
    const user = window.Auth?.currentUser;
    return user ? `${user.username}:${user.center || ''}` : null;
  },
  key(account = this.account()) { return `nibol_pending_counts_v1:${account}`; },
  read(account = this.account()) { return JSON.parse(localStorage.getItem(this.key(account)) || '[]'); },
  write(entries, account = this.account()) {
    localStorage.setItem(this.key(account), JSON.stringify(entries));
    this.renderStatus();
  },
  draftKey(inventoryId, itemId) { return `nibol_count_draft:${this.account()}:${inventoryId}:${itemId}`; },
  draft(inventoryId, itemId) { return JSON.parse(localStorage.getItem(this.draftKey(inventoryId, itemId)) || 'null'); },
  saveDraft(inventoryId, itemId, payload) {
    localStorage.setItem(this.draftKey(inventoryId, itemId), JSON.stringify(payload));
  },
  hasPending(inventoryId) { return this.read().some(entry => entry.inventoryId === inventoryId); },
  cacheKey(id, account = this.account()) { return `nibol_confirmed_inventory:${account}:${id}`; },
  cache(inventory) {
    try { localStorage.setItem(this.cacheKey(inventory.id), JSON.stringify(inventory)); } catch (_) {}
  },
  async send(inventoryId, payload) {
    const account = this.account();
    if (!account) throw new Error('Inicie sesión para guardar el conteo.');
    const snapshot = window.InventoryView?.currentInventory;
    const item = snapshot?.id === inventoryId ? snapshot.items.find(it => it.id === payload.itemId) : null;
    const body = { ...payload };
    if (body.expectedItemVersion === undefined && item) body.expectedItemVersion = item._version || 0;
    const identity = payload.itemId || [payload.sku, payload.almacen || payload.warehouse, payload.location].join(':');
    const entries = this.read(account);
    let entry = entries.find(e => e.inventoryId === inventoryId && e.identity === identity);
    if (entry && JSON.stringify(entry.payload) !== JSON.stringify(body)) {
      throw new Error('Este ítem tiene un envío pendiente. Reinténtelo antes de cambiar sus cantidades.');
    }
    if (!entry) {
      entry = { id: crypto.randomUUID(), inventoryId, identity, payload: body, createdAt: Date.now(), state: 'pending' };
      entries.push(entry);
      try { this.write(entries, account); }
      catch { throw new Error('No se pudo conservar el conteo en este navegador. Libere espacio y vuelva a confirmar.'); }
    }
    return this.transmit(entry, account);
  },
  transmit(entry, account) {
    if (this.inFlight.has(entry.id)) return this.inFlight.get(entry.id);
    const promise = (async () => {
      try {
        const result = await window.API.request(`/inventories/${encodeURIComponent(entry.inventoryId)}/count`, {
          method: 'POST', body: JSON.stringify({ ...entry.payload, operationId: entry.id })
        });
        this.write(this.read(account).filter(e => e.id !== entry.id), account);
        if (this.account() === account) {
          localStorage.removeItem(this.draftKey(entry.inventoryId, entry.payload.itemId));
          const view = window.InventoryView;
          if (view?.currentInventory?.id === entry.inventoryId && result.item) {
            const target = view.currentInventory.items.find(item => item.id === result.item.id);
            if (target) Object.assign(target, result.item);
            this.cache(view.currentInventory);
          }
          this.noteSync(entry.inventoryId, result.syncPending);
        }
        return result;
      } catch (error) {
        const entries = this.read(account);
        const pending = entries.find(e => e.id === entry.id);
        if (pending) {
          const retryConflict = ['FAILED_PRECONDITION', 'ABORTED', 'ALREADY_EXISTS'].includes(error.code);
          pending.state = !retryConflict && (error.status === 409 || (error.status >= 400 && error.status < 500 && error.status !== 429)) ? 'review' : 'pending';
          pending.message = error.message;
          this.write(entries, account);
        }
        error.message = `${error.message} El conteo permanece pendiente en este navegador.`;
        throw error;
      } finally { this.inFlight.delete(entry.id); }
    })();
    this.inFlight.set(entry.id, promise);
    return promise;
  },
  async flush() {
    const account = this.account();
    if (!account || !navigator.onLine || this.flushing) return;
    this.flushing = true;
    let updated = false;
    try {
      for (const entry of this.read(account)) {
        if (this.account() !== account) break;
        if (entry.state === 'review') continue;
        try { await this.transmit(entry, account); updated = true; } catch (_) { break; }
      }
      for (const pending of this.serverPending.values()) {
        if (pending.account !== account || this.account() !== account) continue;
        try {
          const result = await window.API.getInventoryById(pending.id);
          this.noteSync(pending.id, result.inventory?.syncPending);
        } catch (_) { break; }
      }
      if (updated && window.InventoryView?.currentInventory) await window.InventoryView.reloadCurrentInventory();
    } finally { this.flushing = false; this.renderStatus(); }
  },
  renderStatus() {
    if (!document.body) return;
    let element = document.getElementById('count-sync-status');
    if (!element) {
      element = document.createElement('div');
      element.id = 'count-sync-status';
      element.setAttribute('role', 'status');
      element.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;z-index:10050;padding:12px;background:#78350f;color:white;border-radius:8px;display:none';
      document.body.appendChild(element);
    }
    const entries = this.account() ? this.read() : [];
    const syncing = [...this.serverPending.values()].filter(entry => entry.account === this.account()).length;
    element.style.display = entries.length || syncing ? 'block' : 'none';
    element.textContent = entries.length ? `${entries.length} conteo(s) pendiente(s) de confirmar. ` : '';
    if (syncing) element.textContent += `${syncing} inventario(s) guardados localmente, pendientes de sincronizar con Sheets. `;
    const conflict = entries.find(e => e.state === 'review');
    if (conflict) element.appendChild(document.createTextNode(`Revisar ${conflict.payload.sku || conflict.identity}: ${conflict.message}. `));
    const button = document.createElement('button');
    button.textContent = 'Reintentar conexión';
    button.onclick = () => this.flush();
    element.appendChild(button);
    if (conflict) {
      const review = document.createElement('button');
      review.textContent = 'Revisar conteo';
      review.onclick = async () => {
        await window.InventoryView.openInventory(conflict.inventoryId);
        window.Toast?.warning(`Pendiente: ${conflict.payload.stockFisico} buenos, ${conflict.payload.malEstado || 0} dañados. Revise el valor actual antes de reenviar.`);
        if (!confirm('¿Conservar el valor actual del servidor y retirar este envío pendiente? La cantidad pendiente permanecerá como borrador.')) return;
        this.saveDraft(conflict.inventoryId, conflict.payload.itemId, conflict.payload);
        this.write(this.read().filter(e => e.id !== conflict.id));
      };
      element.appendChild(review);
    }
  }
};
window.addEventListener('online', () => window.CountQueue.flush());
window.addEventListener('beforeunload', event => {
  if (window.CountQueue.account() && window.CountQueue.read().length) { event.preventDefault(); event.returnValue = ''; }
});
setInterval(() => window.CountQueue.flush().catch(() => {}), 15000);
