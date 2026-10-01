const { FirebaseSyncService } = require('../../src/services/firestorePersistence');
class FakeFirestore {
  constructor() { this.docs = new Map(); this.tick = 0; this.failCommit = null; this.afterCommit = null; this.gasCalls = []; this.gasFailure = false; this.gasReplies = new Map(); }
  time() { return `2026-10-01T00:00:00.${String(++this.tick).padStart(9, '0')}Z`; }
  seed(rel, data) {
    const api = new FirebaseSyncService();
    const name = `${api.root}/app_files/${api._getSafeId(rel)}`;
    const record = { name, updateTime: this.time(), fields: { path: { stringValue: rel }, dir: { stringValue: rel.split('/').slice(0,-1).join('/') || '.' },
      fileName: { stringValue: rel.split('/').pop() }, content: { stringValue: JSON.stringify(data) }, secret: { stringValue: 'NIBOL_BACKEND_SECRET_987654321' }, updatedAt: { integerValue: String(this.tick) } } };
    this.docs.set(name, record);
    return record;
  }
  value(rel) { const record = [...this.docs.values()].find(r => r.fields.path.stringValue === rel); return record ? JSON.parse(record.fields.content.stringValue) : null; }
  reply(body, status=200) { return { ok: status < 400, status, json: async () => structuredClone(body), text: async () => JSON.stringify(body) }; }
  fetch = async (url, options = {}) => {
    if (String(url).startsWith('https://script.google.com/')) {
      const body = JSON.parse(options.body);
      if (this.gasFailure) return this.reply({ success:false, error:'Servidor ocupado' });
      if (this.gasReplies.has(body.operationId)) return this.reply(this.gasReplies.get(body.operationId));
      this.gasCalls.push(body);
      const result = body.action === 'createFinalFile' ? { success:true,fileId:'real-drive-id',spreadsheetUrl:'https://docs.google.com/spreadsheets/d/real-drive-id/edit' } : { success:true,updated:true };
      if (body.operationId) this.gasReplies.set(body.operationId,result);
      return this.reply(result);
    }
    if (!String(url).startsWith('https://firestore.googleapis.com/')) throw new Error('Test blocked unmocked network: '+url);
    const body = JSON.parse(options.body);
    if (url.includes(':runQuery')) {
      const field = body.structuredQuery.where.compositeFilter?.filters.find(f => f.fieldFilter.field.fieldPath === 'path');
      const paths = field?.fieldFilter.value.arrayValue.values.map(v=>v.stringValue);
      const docs = [...this.docs.values()].filter(d=>!paths || paths.includes(d.fields.path.stringValue));
      return this.reply(docs.map(document=>({document})));
    }
    if (url.includes(':commit')) {
      if (this.failCommit) return this.reply({error:{status:this.failCommit}}, this.failCommit === 'RESOURCE_EXHAUSTED' ? 429 : 409);
      for (const write of body.writes) {
        const old = this.docs.get(write.update?.name || write.delete);
        if ((write.currentDocument?.exists === false && old) || (write.currentDocument?.updateTime && write.currentDocument.updateTime !== old?.updateTime)) return this.reply({error:{status:'FAILED_PRECONDITION'}},409);
      }
      const writeResults = [];
      for (const write of body.writes) {
        const updateTime=this.time();
        if (write.delete) this.docs.delete(write.delete);
        else this.docs.set(write.update.name,{...structuredClone(write.update),updateTime});
        writeResults.push({updateTime});
      }
      if (this.afterCommit) { const fn=this.afterCommit;this.afterCommit=null;await fn(); }
      return this.reply({writeResults});
    }
    throw new Error('Unsupported Firestore action');
  };
}
module.exports = FakeFirestore;
