import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { apiRouter } from './routes.js';

const ADMIN = 'admin@tbd.edu.vn';
const OWNER = 'owner@tbd.edu.vn';
const OTHER = 'other@tbd.edu.vn';
const GUEST = 'guest@tbd.edu.vn';

const FUTURE = new Date(Date.now() + 3600e3).toISOString();
const END = new Date(Date.now() + 7200e3).toISOString();

const seed = () => ({
  'config/roles': { entries: [{ email: ADMIN, role: 'admin' }, { email: OWNER, role: 'manager' }, { email: OTHER, role: 'manager' }] },
  'events/mine': { title: 'Mine', start: FUTURE, end: END, createdBy: OWNER },
  'events/theirs': { title: 'Theirs', start: FUTURE, end: END, createdBy: OTHER },
  'roster/mine': { emails: ['a@x.vn'], map: {} },
  'roster/theirs': { emails: ['b@x.vn'], map: {} },
  'att/k0': { uid: 'k0', email: 'z@x.vn', records: { theirs: { at: 't' } } },
  'att/ka': { uid: 'ka', email: 'a@x.vn', records: { mine: { at: 't' }, theirs: { at: 't' } } },
  'att/kb': { uid: 'kb', email: 'b@x.vn', records: { theirs: { at: 't' } } },
  'att/kc': { uid: 'kc', email: 'c@x.vn', records: { mine: { at: 't' } } },
});

function fakeStore() {
  const docs = new Map(Object.entries(seed()));
  const cascaded = [];
  return {
    docs, cascaded,
    getDoc: async (path) => ({ id: path.split('/').pop(), exists: docs.has(path), data: docs.get(path) ?? null }),
    setDoc: async (path, data) => { docs.set(path, data); },
    updateDoc: async (path, patch) => {
      if (!docs.has(path)) throw Object.assign(new Error('missing'), { code: 'invalid_argument' });
      docs.set(path, { ...docs.get(path), ...patch });
    },
    deleteDoc: async (path) => { docs.delete(path); },
    deleteEventCascade: async (id) => { cascaded.push(id); docs.delete(`events/${id}`); docs.delete(`roster/${id}`); },
    listCollection: async (prefix, limit = 500) => [...docs.entries()]
      .filter(([k]) => k.startsWith(`${prefix}/`) && !k.slice(prefix.length + 1).includes('/'))
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, limit)
      .map(([k, data]) => ({ id: k.split('/').pop(), exists: true, data })),
  };
}

// Stands in for sessionMiddleware: the caller's email travels in a header.
async function withApi(fn) {
  const store = fakeStore();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const email = req.headers['x-test-email'];
    req.session = email ? { email, name: '' } : null;
    next();
  });
  app.use('/api', apiRouter({ bootstrapAdminEmail: 'boot@tbd.edu.vn', store }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = (email, method, path, body) => fetch(`${base}/${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(email ? { 'x-test-email': email } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000), // a hung request fails the test instead of hanging the run
  });
  try {
    await fn({ call, store });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test('GET att: a manager sees only records of events they created, an admin sees all', async () => {
  await withApi(async ({ call }) => {
    const mgr = await (await call(OWNER, 'GET', 'collection/att')).json();
    assert.deepEqual(mgr.docs.map((d) => d.id), ['ka', 'kc']);
    assert.deepEqual(Object.keys(mgr.docs[0].data.records), ['mine']);

    const adm = await (await call(ADMIN, 'GET', 'collection/att')).json();
    assert.deepEqual(adm.docs.map((d) => d.id).sort(), ['k0', 'ka', 'kb', 'kc']);
    assert.deepEqual(Object.keys(adm.docs.find((d) => d.id === 'ka').data.records).sort(), ['mine', 'theirs']);

    assert.equal((await call(GUEST, 'GET', 'collection/att')).status, 403);

    // The listing is cut to `limit` after filtering, not before: k0 sorts first but holds nothing of OWNER's.
    const cut = await (await call(OWNER, 'GET', 'collection/att?limit=1')).json();
    assert.deepEqual(cut.docs.map((d) => d.id), ['ka']);

    // Only the attendance list is narrowed.
    const evs = await (await call(OWNER, 'GET', 'collection/events')).json();
    assert.equal(evs.docs.length, 2);
  });
});

test('DELETE event: the creator deletes it and the cascade runs once', async () => {
  await withApi(async ({ call, store }) => {
    const r = await call(OWNER, 'DELETE', 'doc/events/mine');
    assert.equal(r.status, 200);
    assert.deepEqual(store.cascaded, ['mine']);
    assert.equal(store.docs.has('events/mine'), false);
    assert.equal(store.docs.has('roster/mine'), false);
  });
});

test('DELETE event: another manager is refused and nothing is touched', async () => {
  await withApi(async ({ call, store }) => {
    const r = await call(OWNER, 'DELETE', 'doc/events/theirs');
    assert.equal(r.status, 403);
    assert.deepEqual(store.cascaded, []);
    assert.equal(store.docs.has('events/theirs'), true);
  });
});

test('DELETE event: an admin may delete any event', async () => {
  await withApi(async ({ call, store }) => {
    assert.equal((await call(ADMIN, 'DELETE', 'doc/events/theirs')).status, 200);
    assert.deepEqual(store.cascaded, ['theirs']);
  });
});

test('DELETE event: a nested path under an event never cascades to the event itself', async () => {
  await withApi(async ({ call, store }) => {
    assert.equal((await call(ADMIN, 'DELETE', 'doc/events/mine/nested')).status, 200);
    assert.deepEqual(store.cascaded, []);
    assert.equal(store.docs.has('events/mine'), true);
  });
});

test('PUT event: overwriting someone else\'s event is refused, creating your own works', async () => {
  await withApi(async ({ call, store }) => {
    // Keeps the victim's createdBy on purpose, so only the ownership check can refuse it.
    const bad = await call(OWNER, 'PUT', 'doc/events/theirs', { title: 'hijack', createdBy: OTHER });
    assert.equal(bad.status, 403);
    assert.equal(store.docs.get('events/theirs').title, 'Theirs');

    const ok = await call(OWNER, 'PUT', 'doc/events/fresh', { title: 'New', start: FUTURE, end: END, createdBy: OWNER });
    assert.equal(ok.status, 200);
    assert.equal(store.docs.get('events/fresh').title, 'New');
  });
});

test('roster and att of other people are closed to a manager', async () => {
  await withApi(async ({ call }) => {
    assert.equal((await call(OWNER, 'GET', 'doc/roster/theirs')).status, 403);
    assert.equal((await call(OWNER, 'GET', 'doc/roster/mine')).status, 200);
    assert.equal((await call(OWNER, 'GET', 'doc/att/ka')).status, 403);
    assert.equal((await call(ADMIN, 'GET', 'doc/att/ka')).status, 200);
  });
});
