// Tiny key-value store on IndexedDB, falling back to localStorage.
const DB_NAME = 'mba-tracker';
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'mba-tracker-state';

let dbPromise;
function openDB() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('no indexedDB'));
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req && req.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export async function loadState() {
  try {
    const v = await tx('readonly', (s) => s.get(KEY));
    if (v) return v;
  } catch (e) {
    console.warn('IndexedDB read failed, using localStorage', e);
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export async function saveState(state) {
  // Store a plain clone so proxies/DOM refs never sneak in.
  const data = JSON.parse(JSON.stringify(state));
  try {
    await tx('readwrite', (s) => s.put(data, KEY));
    return;
  } catch (e) {
    console.warn('IndexedDB write failed, using localStorage', e);
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Could not save data', e);
  }
}

// Ask the browser not to evict our data (helps on iOS when installed).
export async function requestPersist() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}
