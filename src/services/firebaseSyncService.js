const { initializeApp } = require('firebase/app');
const { getFirestore, getDocFromServer, getDocsFromServer, collection, doc, query, where, runTransaction, writeBatch } = require('firebase/firestore');
const config = require('../../firebase-applet-config.json');
const CloudFileStore = require('./cloudFileStore');
const FirestoreUsage = require('./firestoreUsage');

// Keep the database containing production data until an explicit migration.
const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
const app = initializeApp(config);
const db = getFirestore(app, databaseId);
const SECRET = 'NIBOL_BACKEND_SECRET_987654321';
const usersRef = doc(db, 'app_files', Buffer.from('users.json').toString('base64url'));
const stateOf = data => ({ generation: Number(data.syncGeneration || 0), revision: Number(data.syncRevision || 0) });
const usage = new FirestoreUsage({ readQuota: process.env.FIRESTORE_DAILY_READ_QUOTA, writeQuota: process.env.FIRESTORE_DAILY_WRITE_QUOTA });
let reportingUsage = false;
function reportUsageIfDue() {
  if (reportingUsage || !usage.shouldReport()) return;
  reportingUsage = true;
  usage.noteReportAttempt();
  adapter.reportUsage()
    .catch(error => console.error('[firestoreUsage] Report pending:', error.code || error.message))
    .finally(() => { reportingUsage = false; });
}
const adapter = {
  async readControl() {
    const snapshot = await getDocFromServer(usersRef);
    usage.addReads(1);
    if (!snapshot.exists()) throw Object.assign(new Error('No se encontró el documento de usuarios de la base configurada. Verifica el proyecto y la base antes de iniciar.'), { status: 503 });
    const data = snapshot.data();
    usage.absorb(data);
    reportUsageIfDue();
    return data;
  },
  async readAll() {
    const snapshot = await getDocsFromServer(query(collection(db, 'app_files'), where('secret', '==', SECRET)));
    usage.addReads(Math.max(1, snapshot.docs.length));
    return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
  },
  // Two equality filters are served by the automatic indexes: no composite index is required.
  async readRevision(revision) {
    const snapshot = await getDocsFromServer(query(collection(db, 'app_files'), where('secret', '==', SECRET), where('syncRevision', '==', revision)));
    usage.addReads(Math.max(1, snapshot.docs.length));
    return snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
  },
  async commit(expected, operations, generation) {
    usage.addReads(1);
    usage.addWrites(operations.length + 1);
    let delta, fields;
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(usersRef);
      if (!snapshot.exists()) throw Object.assign(new Error('Control de sincronización no disponible.'), { status: 503 });
      const data = snapshot.data();
      const current = stateOf(data);
      if (current.generation !== expected.generation || current.revision !== expected.revision) {
        throw Object.assign(new Error('Los datos cambiaron en otra sesión. Actualiza la vista y vuelve a intentar.'), { status: 409, code: 'STALE_DATA' });
      }
      for (const operation of operations) {
        const ref = doc(db, 'app_files', operation.id);
        if (operation.type === 'delete') transaction.delete(ref);
        else transaction.set(ref, operation.data, { merge: true });
      }
      delta = usage.unreported();
      fields = usage.fieldsFor(data, delta);
      // The usage totals travel in this same control write, so they add no extra write.
      transaction.set(usersRef, { ...CloudFileStore.nextControlFields(data, expected, generation), ...fields }, { merge: true });
    });
    usage.markReported(delta, fields);
  },
  // Used only while nothing is being saved; it does not change the sync revision.
  async reportUsage() {
    usage.addReads(1);
    usage.addWrites(1);
    let delta, fields;
    await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(usersRef);
      if (!snapshot.exists()) return;
      delta = usage.unreported();
      fields = usage.fieldsFor(snapshot.data(), delta);
      transaction.set(usersRef, fields, { merge: true });
    });
    if (fields) usage.markReported(delta, fields);
  },
  async removeOld(ids) {
    for (let offset = 0; offset < ids.length; offset += 450) {
      const batch = writeBatch(db);
      ids.slice(offset, offset + 450).forEach(id => batch.delete(doc(db, 'app_files', id)));
      await batch.commit();
      usage.addWrites(Math.min(450, ids.length - offset));
    }
  }
};
module.exports = new CloudFileStore(adapter, SECRET, { usage });
module.exports.databaseId = databaseId;
