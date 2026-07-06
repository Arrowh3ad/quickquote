// Minimal promise wrapper over IndexedDB. Blobs store natively (structured clone).
let dbp;

function open() {
  dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('quickquote', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('clients', { keyPath: 'id' });
      r.result.createObjectStore('quotes', { keyPath: 'id' });
      r.result.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const rq = fn(db.transaction(store, mode).objectStore(store));
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  }));
}

export const get = (s, k) => tx(s, 'readonly', o => o.get(k));
export const all = s => tx(s, 'readonly', o => o.getAll());
export const put = (s, v, k) => tx(s, 'readwrite', o => o.put(v, k));
export const del = (s, k) => tx(s, 'readwrite', o => o.delete(k));
