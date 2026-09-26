// Thin, typed access to the claude.ai artifact runtime (db, user, google sign-in,
// downloads), with an in-memory fallback so the page still works in a local preview.

export type Snap = { id: string; exists: boolean; data(): any };
export type QSnap = { docs: Snap[] };
export type Unsub = () => void;

export interface DocRef {
  id: string;
  get(): Promise<Snap>;
  set(d: Record<string, unknown>): Promise<void>;
  update(d: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  onSnapshot(next: (s: Snap) => void, err?: (e: any) => void): Unsub;
}
export interface ColRef {
  limit(n: number): ColRef;
  onSnapshot(next: (s: QSnap) => void, err?: (e: any) => void): Unsub;
}
export interface Store {
  doc(path: string): DocRef;
  collection(path: string): ColRef;
}
export interface Viewer {
  id: string | null;
  name: string;
  email: string | null;
  avatarUrl: string;
  canEdit: boolean;
  isOwner: boolean;
}

export interface GoogleUser {
  email: string;
  name: string;
  picture?: string;
}

/**
 * Google sign-in as a small observable session. The signed-in address is what
 * every authorization decision in the app is based on, so it has to be readable
 * synchronously and to notify on change.
 */
export interface GoogleSession {
  available: boolean;
  current(): GoogleUser | null;
  /** Pick up a session established on an earlier visit, if the runtime exposes one. */
  restore(): Promise<GoogleUser | null>;
  /** `emailHint` is only honoured in the local preview, where there is no real IdP. */
  signIn(emailHint?: string): Promise<GoogleUser>;
  signOut(): Promise<void>;
  subscribe(cb: (u: GoogleUser | null) => void): Unsub;
  /**
   * Self-hosted backend only: mounts Google's own "Sign in with Google" button into `el`.
   * A click on it drives `signIn()` to resolve/reject; callers that don't implement this
   * (claude.ai, local preview) fall back to a plain button that calls `signIn()` directly.
   */
  renderButton?(el: HTMLElement): void;
}

export interface Platform {
  demo: boolean;
  db: Store;
  me: Viewer;
  google: GoogleSession;
  profiles(ids: string[]): Promise<Record<string, { name: string }>>;
  /** Directory lookup (managers only). Returns candidate account ids for a query. */
  search(q: string): Promise<{ id: string; name: string }[]>;
  save: ((filename: string, data: string | Blob) => Promise<void>) | null;
  /** Null where Drive export isn't wired up (self-hosted backend, local preview). */
  uploadToDrive: ((filename: string, csvContent: string) => Promise<void>) | null;
}

declare global {
  interface Window {
    claude?: { use(name: string): Promise<any> };
    google?: {
      accounts: {
        id: {
          initialize(opts: { client_id: string; callback: (resp: { credential: string }) => void }): void;
          renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
          prompt(): void;
        };
      };
    };
  }
}

/** Plain browser download — works anywhere, no server or capability involved. */
async function browserSave(filename: string, data: string | Blob): Promise<void> {
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// ---------- in-memory store (preview only) ----------
const DEMO_STORAGE_KEY = 'vpu.preview.memoryStore';
const DEMO_SEED_KEY = 'vpu.preview.seeded';

export function shouldSeedDemo(): boolean {
  try {
    return sessionStorage.getItem(DEMO_SEED_KEY) !== '1';
  } catch {
    return true;
  }
}

export function markDemoSeeded() {
  try {
    sessionStorage.setItem(DEMO_SEED_KEY, '1');
  } catch {
    // Ignore storage failures in restrictive browser modes.
  }
}

export function clearDemoPreviewState() {
  try {
    sessionStorage.removeItem(DEMO_STORAGE_KEY);
    sessionStorage.removeItem(DEMO_SEED_KEY);
  } catch {
    // Ignore storage failures in restrictive browser modes.
  }
}

function loadPersistedDocs(): Map<string, any> {
  try {
    const raw = sessionStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, any>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function savePersistedDocs(docs: Map<string, any>) {
  try {
    sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(Object.fromEntries(docs.entries())));
  } catch {
    // Ignore storage failures in restrictive browser modes.
  }
}

function memoryStore(): Store {
  const docs = loadPersistedDocs();
  const listeners = new Set<() => void>();
  const emit = () => {
    savePersistedDocs(docs);
    setTimeout(() => listeners.forEach((l) => l()), 0);
  };
  const snap = (path: string): Snap => {
    const id = path.split('/').pop()!;
    const v = docs.get(path);
    return { id, exists: v !== undefined, data: () => v };
  };
  const merge = (a: any, b: any): any => {
    const out = { ...a };
    for (const k of Object.keys(b)) {
      const bv = b[k];
      out[k] = bv && typeof bv === 'object' && !Array.isArray(bv) && a?.[k] && typeof a[k] === 'object' ? merge(a[k], bv) : bv;
    }
    return out;
  };
  const doc = (path: string): DocRef => ({
    id: path.split('/').pop()!,
    get: async () => snap(path),
    set: async (d) => { docs.set(path, structuredClone(d)); emit(); },
    update: async (d) => {
      if (!docs.has(path)) throw { code: 'invalid_argument', message: 'missing' };
      docs.set(path, merge(docs.get(path), structuredClone(d))); emit();
    },
    delete: async () => { docs.delete(path); emit(); },
    onSnapshot: (next) => {
      const l = () => next(snap(path));
      listeners.add(l); l();
      return () => listeners.delete(l);
    },
  });
  const collection = (path: string): ColRef => {
    const depth = path.split('/').length + 1;
    const ref: ColRef = {
      limit: () => ref,
      onSnapshot: (next) => {
        const l = () => next({
          docs: [...docs.keys()]
            .filter((k) => k.startsWith(path + '/') && k.split('/').length === depth)
            .sort()
            .map(snap),
        });
        listeners.add(l); l();
        return () => listeners.delete(l);
      },
    };
    return ref;
  };
  return { doc, collection };
}

// ---------- google session ----------
const SESSION_KEY = 'vpu.google.session';

function readStoredSession(): GoogleUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    return u?.email ? { email: String(u.email).toLowerCase(), name: u.name || '', picture: u.picture } : null;
  } catch {
    return null;
  }
}

function writeStoredSession(u: GoogleUser | null) {
  try {
    if (u) sessionStorage.setItem(SESSION_KEY, JSON.stringify(u));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* private mode: the session simply does not survive a reload */ }
}

function normalizeGoogleUser(raw: any): GoogleUser | null {
  const email = raw?.email ?? raw?.user?.email ?? raw?.profile?.email;
  if (!email) return null;
  return {
    email: String(email).toLowerCase(),
    name: raw?.name ?? raw?.user?.name ?? raw?.profile?.name ?? '',
    picture: raw?.picture ?? raw?.avatarUrl ?? raw?.user?.picture,
  };
}

function observable(initial: GoogleUser | null) {
  let current = initial;
  const subs = new Set<(u: GoogleUser | null) => void>();
  return {
    get: () => current,
    set: (u: GoogleUser | null) => {
      current = u;
      writeStoredSession(u);
      subs.forEach((cb) => cb(u));
    },
    subscribe: (cb: (u: GoogleUser | null) => void): Unsub => {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
  };
}

function googleSession(api: any): GoogleSession {
  const state = observable(readStoredSession());

  return {
    available: !!api,
    current: state.get,
    subscribe: state.subscribe,

    restore: async () => {
      if (!api) return state.get();
      // The runtime may expose an already-established session under any of these names.
      for (const fn of ['getUser', 'currentUser', 'getCurrentUser', 'me'] as const) {
        if (typeof api[fn] !== 'function') continue;
        try {
          const u = normalizeGoogleUser(await api[fn]());
          if (u) { state.set(u); return u; }
        } catch { /* not signed in, or the method does not behave as expected */ }
      }
      return state.get();
    },

    signIn: async () => {
      if (!api) throw new Error('Trang này chưa bật đăng nhập Google.');
      let u: GoogleUser | null;
      try {
        u = normalizeGoogleUser(await api.signIn());
      } catch (e: any) {
        throw new Error(e?.message ? `Không đăng nhập được: ${e.message}` : 'Không đăng nhập được Google.');
      }
      if (!u) throw new Error('Đăng nhập xong nhưng không đọc được địa chỉ email của tài khoản.');
      state.set(u);
      return u;
    },

    signOut: async () => {
      try { await api?.signOut?.(); } finally { state.set(null); }
    },
  };
}

// ---------- self-hosted backend (server/) ----------

const API = '/api';

async function apiHealthy(): Promise<boolean> {
  try {
    const r = await fetch('/health', { cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}

// The server answers 403 for every refusal (expired sign-in, wrong role, not the creator, event already started).
const FORBIDDEN_MSG = 'Bạn không có quyền thực hiện thao tác này. Hãy đăng nhập lại; nếu đang sửa sự kiện, có thể sự kiện đã bắt đầu hoặc không do bạn tạo.';

// A 403 carries the code 'forbidden' so a caller can explain the refusal in its own words.
const refused = (r: Response, fallback: string) =>
  Object.assign(new Error(r.status === 403 ? FORBIDDEN_MSG : `${fallback} (mã ${r.status}).`), { code: r.status === 403 ? 'forbidden' : 'unknown' });

function backendDoc(path: string): DocRef {
  const url = `${API}/doc/${path}`;
  return {
    id: path.split('/').pop()!,
    get: async () => {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`Không đọc được dữ liệu (mã ${r.status}).`);
      return r.json();
    },
    set: async (d) => {
      const r = await fetch(url, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      if (!r.ok) throw refused(r, 'Không lưu được dữ liệu');
    },
    update: async (d) => {
      const r = await fetch(url, { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) });
      if (!r.ok) throw { code: r.status === 404 ? 'invalid_argument' : r.status === 403 ? 'forbidden' : 'unknown', message: r.status === 403 ? FORBIDDEN_MSG : `Không cập nhật được dữ liệu (mã ${r.status}).` };
    },
    delete: async () => {
      const r = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
      if (!r.ok) throw refused(r, 'Không xoá được dữ liệu');
    },
    onSnapshot: (next, err) => {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const poll = async () => {
        if (stopped) return;
        try {
          const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
          if (!r.ok) throw new Error(String(r.status));
          const snap = await r.json();
          if (!stopped) next({ id: snap.id, exists: snap.exists, data: () => snap.data });
        } catch (e: any) {
          if (!stopped) err?.(e);
        } finally {
          if (!stopped) timer = setTimeout(poll, 3000);
        }
      };
      poll();
      return () => { stopped = true; if (timer) clearTimeout(timer); };
    },
  };
}

function backendCollection(path: string): ColRef {
  let lim = 500;
  const ref: ColRef = {
    limit: (n) => { lim = n; return ref; },
    onSnapshot: (next, err) => {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const poll = async () => {
        if (stopped) return;
        try {
          const r = await fetch(`${API}/collection/${path}?limit=${lim}`, { credentials: 'same-origin', cache: 'no-store' });
          if (!r.ok) throw new Error(String(r.status));
          const { docs } = await r.json();
          if (!stopped) next({ docs: docs.map((d: Snap) => ({ id: d.id, exists: d.exists, data: () => d.data })) });
        } catch (e: any) {
          if (!stopped) err?.(e);
        } finally {
          if (!stopped) timer = setTimeout(poll, 3000);
        }
      };
      poll();
      return () => { stopped = true; if (timer) clearTimeout(timer); };
    },
  };
  return ref;
}

function backendStore(): Store {
  return { doc: backendDoc, collection: backendCollection };
}

let gisLoad: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  gisLoad ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoad = null; reject(new Error('Không tải được Google Identity Services.')); };
    document.head.appendChild(s);
  });
  return gisLoad;
}

/** Real Google Sign-In against our own server, which verifies the ID token. */
function backendGoogleSession(clientId: string | null): GoogleSession {
  const state = observable(readStoredSession());
  let pending: { resolve: (u: GoogleUser) => void; reject: (e: any) => void } | null = null;
  let initialized: Promise<void> | null = null;

  const ensureInit = () => {
    if (!clientId) return Promise.reject(new Error('Trang này chưa cấu hình GOOGLE_CLIENT_ID.'));
    initialized ??= loadGis().then(() => {
      window.google!.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp) => {
          const p = pending;
          pending = null;
          try {
            const r = await fetch(`${API}/auth/google`, {
              method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credential: resp.credential }),
            });
            const body = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(body?.error || 'Đăng nhập thất bại.');
            const u: GoogleUser = { email: body.email, name: body.name || '', picture: body.picture };
            state.set(u);
            p?.resolve(u);
          } catch (e) {
            p?.reject(e);
          }
        },
      });
    });
    return initialized;
  };

  return {
    available: !!clientId,
    current: state.get,
    subscribe: state.subscribe,

    restore: async () => {
      try {
        const r = await fetch(`${API}/auth/me`, { credentials: 'same-origin' });
        const body = r.ok ? await r.json() : null;
        const u: GoogleUser | null = body?.email ? { email: body.email, name: body.name || '', picture: body.picture } : null;
        state.set(u);
        return u;
      } catch {
        return state.get();
      }
    },

    signIn: async () => {
      await ensureInit();
      return new Promise<GoogleUser>((resolve, reject) => {
        pending = { resolve, reject };
        window.google!.accounts.id.prompt();
      });
    },

    signOut: async () => {
      try { await fetch(`${API}/auth/signout`, { method: 'POST', credentials: 'same-origin' }); }
      finally { state.set(null); }
    },

    renderButton: (el) => {
      ensureInit().then(() => {
        window.google!.accounts.id.renderButton(el, { theme: 'outline', size: 'large', width: 320, text: 'signin_with' });
      }).catch(() => { /* surfaced via the "chưa bật đăng nhập Google" notice instead */ });
    },
  };
}

/** Preview-only sign-in: the caller supplies the address it wants to act as. */
function demoGoogleSession(): GoogleSession {
  const state = observable(readStoredSession());
  return {
    available: true,
    current: state.get,
    subscribe: state.subscribe,
    restore: async () => state.get(),
    signIn: async (hint) => {
      const email = String(hint ?? '').trim().toLowerCase();
      if (!email) throw new Error('Chế độ xem thử: nhập email bạn muốn đăng nhập thử.');
      const u: GoogleUser = { email, name: email.split('@')[0] };
      state.set(u);
      return u;
    },
    signOut: async () => state.set(null),
  };
}

const DEMO_VIEWER: Viewer = {
  id: 'u_demo', name: 'Phan Thanh Sơn (xem thử)', email: null,
  avatarUrl: '', canEdit: true, isOwner: true,
};

/** Any syntactically valid email resolves to itself — there is no org directory to check outside claude.ai. */
function emailOnlySearch(q: string): { id: string; name: string }[] {
  const norm = q.trim().toLowerCase();
  return EMAIL_RE.test(norm) ? [{ id: norm, name: norm.split('@')[0] }] : [];
}
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export async function connect(): Promise<Platform> {
  // Named `capability`, not `use`: a bare `use(...)` reads as a React hook to the linter.
  const capability = (n: string) => (window.claude?.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
  const [db, user, downloads, googleAuth, googleDrive] = await Promise.all([
    capability('db'), capability('user'), capability('downloads'), capability('googleAuth'), capability('googleDrive'),
  ]);

  // ---- running as a claude.ai Artifact: the real capabilities above ----
  if (db) {
    const save = downloads
      ? async (filename: string, data: string | Blob) => { await downloads.save({ filename, data }); }
      : null;
    const google = googleSession(googleAuth);
    await google.restore();
    const uploadToDrive = googleDrive
      ? async (filename: string, csvContent: string) => {
        if (!google.current()) throw new Error('Chưa đăng nhập Google.');
        try {
          await googleDrive.uploadFile({
            name: filename,
            mimeType: 'text/csv',
            fileContent: new Blob([csvContent], { type: 'text/csv;charset=utf-8' }),
            parents: ['root'],
          });
        } catch (e: any) {
          throw new Error(`Không upload được lên Google Drive: ${e?.message ?? 'lỗi không xác định'}`);
        }
      }
      : null;

    const m = user ? await user.me() : null;
    const me: Viewer = {
      id: m?.id ?? null,
      name: m?.name || '',
      email: m?.email ? String(m.email).toLowerCase() : null,
      avatarUrl: m?.avatarUrl || '',
      canEdit: !!m?.canEdit,
      isOwner: !!m?.isOwner,
    };

    return {
      demo: false,
      db,
      me,
      google,
      profiles: async (ids) => {
        if (!user || !ids.length) return {};
        const ps = await user.profiles(ids);
        const out: Record<string, { name: string }> = {};
        for (const id of ids) out[id] = { name: ps[id]?.name || '' };
        return out;
      },
      search: async (q) => {
        if (!user) return [];
        const hits = await user.search(q);
        return (hits || []).map((h: any) => ({ id: h.id, name: h.name || '' }));
      },
      save,
      uploadToDrive,
    };
  }

  // ---- self-hosted: talk to our own server (server/) instead of window.claude ----
  if (await apiHealthy()) {
    const cfg = await fetch(`${API}/config`, { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({ googleClientId: null }));
    const google = backendGoogleSession(cfg.googleClientId ?? null);
    await google.restore();
    const gu = google.current();

    return {
      demo: false,
      db: backendStore(),
      me: {
        id: gu?.email ?? null,
        name: gu?.name ?? '',
        email: gu?.email ?? null,
        avatarUrl: gu?.picture ?? '',
        canEdit: !!gu,
        isOwner: false,
      },
      google,
      profiles: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: i.includes('@') ? i.split('@')[0] : i }])),
      search: async (q) => emailOnlySearch(q),
      save: browserSave,
      uploadToDrive: null,
    };
  }

  // ---- local dev preview only (no claude.ai, no backend reachable): in-memory demo ----
  const google = demoGoogleSession();
  await google.restore();
  return {
    demo: true,
    db: memoryStore(),
    me: DEMO_VIEWER,
    google,
    profiles: async (ids) => Object.fromEntries(ids.map((i) => [i, { name: i === 'u_demo' ? DEMO_VIEWER.name : i.startsWith('u_') ? i.slice(2) : '' }])),
    search: async (q) => {
      await new Promise((r) => setTimeout(r, 40));
      if (q === 'son.pt@tbd.edu.vn') return [{ id: 'u_demo', name: DEMO_VIEWER.name }];
      return emailOnlySearch(q);
    },
    save: browserSave,
    uploadToDrive: null,
  };
}
