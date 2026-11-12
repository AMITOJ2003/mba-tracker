// Optional laptop <-> phone sync through a file in a PRIVATE GitHub repo you own.
// No server of our own: each device talks to the GitHub API directly with a
// fine-grained token that can only read/write that one repo.
//
// Conflict handling is per record: every item carries `u` (last-changed time),
// deletions leave a tombstone in `deleted`, and two copies merge item by item,
// newest wins. So edits made offline on both devices are kept.

const API = 'https://api.github.com';
const PATH = 'mba-tracker-data.json';
export const COLLECTIONS = ['phases', 'dates', 'sessions', 'scores', 'goals', 'checkpoints', 'scoreCheckpoints'];
const UI_ONLY = ['open', 'u'];

/* ---------- change tracking ---------- */
const recordKey = (item) => JSON.stringify(item, (k, v) => (UI_ONLY.includes(k) ? undefined : v));

export function snapshot(state) {
  const snap = { settings: JSON.stringify(state.settings) };
  for (const c of COLLECTIONS) {
    snap[c] = {};
    for (const item of state[c] || []) snap[c][item.id] = recordKey(item);
    snap[`${c}#order`] = (state[c] || []).map((i) => i.id).join(',');
  }
  return snap;
}

// Compare state with the previous snapshot; stamp changed records, tombstone removed ones.
export function stamp(prev, state, now = Date.now()) {
  state.deleted ||= {};
  let changed = false;
  for (const c of COLLECTIONS) {
    const before = prev?.[c] || {};
    const ids = new Set();
    for (const item of state[c] || []) {
      ids.add(item.id);
      if (before[item.id] !== recordKey(item)) { item.u = now; changed = true; }
      delete state.deleted[item.id];
    }
    for (const id of Object.keys(before)) if (!ids.has(id)) { state.deleted[id] = now; changed = true; }
    if (prev && prev[`${c}#order`] !== (state[c] || []).map((i) => i.id).join(',')) changed = true;
  }
  if (prev && prev.settings !== JSON.stringify(state.settings)) { state.settingsU = now; changed = true; }
  if (changed) state.updatedAt = now;
  return changed;
}

/* ---------- merge ---------- */
export function merge(local, remote) {
  if (!remote) return local;
  const deleted = { ...(remote.deleted || {}) };
  for (const [id, ts] of Object.entries(local.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);
  // Prune tombstones older than ~1 year to keep the file small.
  const cutoff = Date.now() - 400 * 864e5;
  for (const id of Object.keys(deleted)) if (deleted[id] < cutoff) delete deleted[id];

  const localNewer = (local.updatedAt || 0) >= (remote.updatedAt || 0);
  const out = { ...(localNewer ? remote : local), ...(localNewer ? local : remote), deleted };

  for (const c of COLLECTIONS) {
    const L = local[c] || [], R = remote[c] || [];
    const byId = new Map();
    for (const item of R) byId.set(item.id, item);
    for (const item of L) {
      const r = byId.get(item.id);
      if (!r || (item.u || 0) >= (r.u || 0)) byId.set(item.id, item);
      else if ('open' in item) byId.set(item.id, { ...r, open: item.open }); // keep this device's expand state
    }
    // Order: follow the newer copy, then append anything only the other copy has.
    const primary = localNewer ? L : R, secondary = localNewer ? R : L;
    const ids = [...primary.map((i) => i.id), ...secondary.map((i) => i.id).filter((id) => !primary.some((p) => p.id === id))];
    out[c] = ids.map((id) => byId.get(id)).filter((item) => item && !(deleted[item.id] >= (item.u || 0) && deleted[item.id]));
  }
  out.settings = (local.settingsU || 0) >= (remote.settingsU || 0) ? local.settings : remote.settings;
  out.settingsU = Math.max(local.settingsU || 0, remote.settingsU || 0);
  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  out.lastBackup = [local.lastBackup, remote.lastBackup].filter(Boolean).sort().at(-1) || null;
  return out;
}

// Content equality ignoring per-device UI state.
export const sameData = (a, b) => !!a && !!b && JSON.stringify(a, (k, v) => (k === 'open' ? undefined : v)) === JSON.stringify(b, (k, v) => (k === 'open' ? undefined : v));

/* ---------- GitHub transport ---------- */
export class SyncError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const b64encode = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

async function gh(cfg, path, opts = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      ...opts,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new SyncError('Offline — will sync when you are back online', 0);
  }
  if (res.status === 401) throw new SyncError('Token rejected (expired or wrong). Paste a new one.', 401);
  if (res.status === 403) throw new SyncError('Token lacks access. It needs Contents: read and write on this repo.', 403);
  return res;
}

const normRepo = (repo) => String(repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');

export async function checkRepo(cfg) {
  const repo = normRepo(cfg.repo);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new SyncError('Repository should look like username/mba-tracker-data', 400);
  const res = await gh({ ...cfg, repo }, `/repos/${repo}`);
  if (res.status === 404) throw new SyncError('Repository not found, or the token is not allowed to see it.', 404);
  if (!res.ok) throw new SyncError(`GitHub error ${res.status}`, res.status);
  const info = await res.json();
  if (!info.private) throw new SyncError('That repository is public. Use a private repo so your data stays private.', 400);
  return repo;
}

export async function pull(cfg) {
  const res = await gh(cfg, `/repos/${cfg.repo}/contents/${PATH}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new SyncError(`GitHub error ${res.status}`, res.status);
  const file = await res.json();
  let text;
  if (file.content) text = b64decode(file.content);
  else {
    const raw = await gh(cfg, `/repos/${cfg.repo}/contents/${PATH}`, { headers: { Accept: 'application/vnd.github.raw' } });
    text = await raw.text();
  }
  return { sha: file.sha, data: JSON.parse(text) };
}

export async function push(cfg, data, sha) {
  const res = await gh(cfg, `/repos/${cfg.repo}/contents/${PATH}`, {
    method: 'PUT',
    body: JSON.stringify({ message: `sync ${new Date().toISOString()}`, content: b64encode(JSON.stringify(data)), ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 || res.status === 422) throw new SyncError('conflict', 409);
  if (!res.ok) throw new SyncError(`GitHub error ${res.status}`, res.status);
  return (await res.json()).content.sha;
}

// Pull → merge → push (retrying if the other device pushed in between).
export async function syncOnce(cfg, local) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const remote = await pull(cfg);
    const merged = merge(local, remote?.data);
    if (remote && sameData(merged, remote.data)) return { state: merged, pushed: false };
    try {
      await push(cfg, merged, remote?.sha);
      return { state: merged, pushed: true };
    } catch (e) {
      if (e.status !== 409) throw e;
    }
  }
  throw new SyncError('Could not sync after 3 tries — try again', 409);
}
