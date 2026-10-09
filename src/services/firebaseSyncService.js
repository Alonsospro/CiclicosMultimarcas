const { initializeApp } = require('firebase/app');
const { getFirestore, getDocFromServer, getDocsFromServer, collection, doc, query, where, runTransaction, writeBatch } = require('firebase/firestore');
const config = require('../../firebase-applet-config.json');
const CloudFileStore = require('./cloudFileStore');

// Keep the database containing production data until an explicit migration.
const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
const app = initializeApp(config);
const db = getFirestore(app, databaseId);
const SECRET = 'NIBOL_BACKEND_SECRET_987654321';
const usersRef = doc(db, 'app_files', Buffer.from('users.json').toString('base64url'));
const stateOf = data => ({ generation: Number(data.syncGeneration || 0), revision: Number(data.syncRevision || 0) });
const adapter = {
  async readControl() {
    const snapshot = await getDocFromServer(usersRef);
    if (!snapshot.exists()) throw Object.assign(new Error('No se encontró el documento de usuarios de la base configurada. Verifica el proyecto y la base antes de iniciar.'), { status: 503 });
    return snapshot.data();
  },
  async readAll() {
    const snapshot = await getDocsFromServer(query(collection(db, 'app_files'), where('secret', '==', SECRET)));
    return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
  },
  async commit(expected, operations, generation) {
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(usersRef);
      if (!snapshot.exists()) throw Object.assign(new Error('Control de sincronización no disponible.'), { status: 503 });
      const current = stateOf(snapshot.data());
      if (current.generation !== expected.generation || current.revision !== expected.revision) {
        throw Object.assign(new Error('Los datos cambiaron en otra sesión. Actualiza la vista y vuelve a intentar.'), { status: 409, code: 'STALE_DATA' });
      }
      for (const operation of operations) {
        const ref = doc(db, 'app_files', operation.id);
        if (operation.type === 'delete') transaction.delete(ref);
        else transaction.set(ref, operation.data, { merge: true });
      }
      transaction.set(usersRef, { syncGeneration: generation, syncRevision: expected.revision + 1 }, { merge: true });
    });
  },
  async removeOld(ids) {
    for (let offset = 0; offset < ids.length; offset += 450) {
      const batch = writeBatch(db);
      ids.slice(offset, offset + 450).forEach(id => batch.delete(doc(db, 'app_files', id)));
      await batch.commit();
    }
  }
};
module.exports = new CloudFileStore(adapter, SECRET);
module.exports.databaseId = databaseId;
