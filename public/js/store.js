/* Elite Frame Finder — customer records in IndexedDB (photos included), so the tablet keeps them offline.
 * A copy is also posted to the Frame Finder server when it is reachable (see customer.js).
 */
(function (root) {
  'use strict';
  const DB = 'eff', STORE = 'customers', VERSION = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
          s.createIndex('phone', 'phone');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }
  root.Store = {
    put: (rec) => tx('readwrite', (s) => s.put(rec)).then(() => rec),
    get: (id) => tx('readonly', (s) => s.get(id)),
    remove: (id) => tx('readwrite', (s) => s.delete(id)),
    all: () => tx('readonly', (s) => s.getAll()).then((list) => (list || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')))
  };
})(typeof self !== 'undefined' ? self : this);
