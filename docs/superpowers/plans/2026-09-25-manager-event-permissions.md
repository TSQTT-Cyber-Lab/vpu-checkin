# Manager Event Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers edit only the events they created (full edit before the start time), see other managers' events only as ordinary attendees, and admins keep full control over managers and events.

**Architecture:** `server/authorize.js` becomes the single enforcement point: it loads the event document to decide ownership and start time, and `routes.js` narrows the `att` listing for non-admin managers and cascades event deletion in one SQL statement. The React UI mirrors the rules with two tiny predicates in `src/lib/auth.ts`, reuses `EventForm` for editing, and adds an edit action to `ManagersView`.

**Tech Stack:** Node 22 + Express 4 + Postgres (`documents` table), React 19 + TypeScript + Vite, `node:test` for server tests (no new dependency).

**Spec:** `docs/superpowers/specs/2026-09-25-manager-event-permissions-design.md`

**Conventions for this plan**
- Project root: `G:\Research\NCKH2027\De tai VPU2027\Claude outputs\vpu-checkin`. Run every command from there (Git Bash syntax).
- The project is **not a git repository**, so there are no commit steps. Each task ends with a passing check instead.
- Do **not** read or print `.env` (it holds secrets) and do not reuse the session cookies pasted in `.claude/settings.json`.
- UI strings are Vietnamese (match the codebase); code comments are English.

**Deliberate deviations from the spec (keep, but tell the user at handoff)**
1. Spec §4.1 lists `canTweakEvent` / `canDeleteEvent`. Because the console only lists events the user owns (or all, for admins), those two would always be `true` there, so they are not added. The server still enforces both.
2. Spec §4.2 keeps the client-side cascade in demo mode. The old client loop never actually removed records (`update()` deep-merges, so a deleted key survives), so it is dropped; the server cascade replaces it and the in-memory demo simply leaves invisible leftovers.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `package.json` | modify | add `npm test` |
| `server/authorize.js` | rewrite | ownership/time rules for `events`, `roster`, `att`; helpers `eventIdsOwnedBy`, `filterAttRecords` |
| `server/authorize.test.js` | create | rule matrix tests |
| `server/db.js` | modify | `deleteEventCascade` |
| `server/routes.js` | modify | injectable store, `guard` returns role, `att` filtering, cascade delete |
| `server/routes.test.js` | create | HTTP-level tests with a fake store |
| `src/lib/auth.ts` | modify | `isEventOwner`, `canEditEvent` |
| `src/lib/platform.ts` | modify | friendly 403 message |
| `src/components/EventForm.tsx` | modify | edit mode |
| `src/components/AdminView.tsx` | modify | own-events list, edit dialog, server-side delete |
| `src/components/ManagersView.tsx` | modify | edit an existing manager |

---

### Task 1: Test harness and `events` rules

**Files:**
- Modify: `package.json`
- Create: `server/authorize.test.js`
- Modify: `server/authorize.js`

- [ ] **Step 1: Add the `test` script**

In `package.json` replace

```json
    "start": "node server/index.js"
  },
```

with

```json
    "start": "node server/index.js",
    "test": "node --test \"server/*.test.js\""
  },
```

- [ ] **Step 2: Write the failing tests**

Create `server/authorize.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from './authorize.js';

const ADMIN = 'admin@tbd.edu.vn';
const OWNER = 'owner@tbd.edu.vn';
const OTHER = 'other@tbd.edu.vn';
const GUEST = 'guest@tbd.edu.vn';

const rolesDoc = {
  entries: [
    { email: ADMIN, role: 'admin' },
    { email: OWNER, role: 'manager' },
    { email: OTHER, role: 'manager' },
  ],
};

const NOW = Date.parse('2026-09-25T10:00:00Z');
const FUTURE = '2026-09-25T12:00:00.000Z';
const PAST = '2026-09-25T08:00:00.000Z';
const END = '2026-09-25T14:00:00.000Z';

const docs = {
  'events/future': { title: 'F', start: FUTURE, end: END, createdBy: OWNER },
  'events/started': { title: 'S', start: PAST, end: END, createdBy: OWNER },
  'events/legacy': { title: 'L', start: FUTURE, end: END, createdBy: null },
};
const loadDoc = async (path) => docs[path] ?? null;

const can = (email, method, path, body) => authorize({
  method, path, body,
  session: email ? { email } : null,
  rolesDoc, bootstrapAdminEmail: 'boot@tbd.edu.vn', loadDoc, now: NOW,
});

test('config: roles are admin-only to write, app settings manager-only', async () => {
  assert.equal(await can(GUEST, 'GET', 'config/roles'), true);
  assert.equal(await can(OWNER, 'PUT', 'config/roles', {}), false);
  assert.equal(await can(ADMIN, 'PUT', 'config/roles', {}), true);
  assert.equal(await can(OWNER, 'PUT', 'config/app', {}), true);
  assert.equal(await can(GUEST, 'PUT', 'config/app', {}), false);
  assert.equal(await can(OWNER, 'GET', 'other/path'), false);
});

test('events: any signed-in user reads, anonymous cannot', async () => {
  assert.equal(await can(GUEST, 'GET', 'events/future'), true);
  assert.equal(await can(null, 'GET', 'events/future'), false);
  assert.equal(await can(GUEST, 'GET', 'events'), true);
});

test('events: a manager creates an event only as themselves', async () => {
  assert.equal(await can(OWNER, 'PUT', 'events/new', { createdBy: OWNER }), true);
  assert.equal(await can(OWNER, 'PUT', 'events/new', { createdBy: OTHER }), false);
  assert.equal(await can(OWNER, 'PUT', 'events/new', {}), false);
  assert.equal(await can(ADMIN, 'PUT', 'events/new', { createdBy: OTHER }), false);
  assert.equal(await can(ADMIN, 'PUT', 'events/new', { createdBy: ADMIN }), true);
  assert.equal(await can(GUEST, 'PUT', 'events/new', { createdBy: GUEST }), false);
});

test('events: the creator replaces the event only before it starts and cannot reassign it', async () => {
  assert.equal(await can(OWNER, 'PUT', 'events/future', { createdBy: OWNER }), true);
  assert.equal(await can(OWNER.toUpperCase(), 'PUT', 'events/future', { createdBy: OWNER }), true);
  assert.equal(await can(OWNER, 'PUT', 'events/future', { createdBy: OTHER }), false);
  assert.equal(await can(OWNER, 'PUT', 'events/started', { createdBy: OWNER }), false);
  assert.equal(await can(OTHER, 'PUT', 'events/future', { createdBy: OTHER }), false);
  assert.equal(await can(OWNER, 'PUT', 'events/legacy', { createdBy: OWNER }), false);
  assert.equal(await can(ADMIN, 'PUT', 'events/started', { createdBy: OWNER }), true);
  assert.equal(await can(ADMIN, 'PUT', 'events/legacy', { createdBy: null }), true);
});

test('events: after the start the creator may only tweak window and tolerance', async () => {
  assert.equal(await can(OWNER, 'PATCH', 'events/started', { window: 30 }), true);
  assert.equal(await can(OWNER, 'PATCH', 'events/started', { window: 30, tolerance: 65 }), true);
  assert.equal(await can(OWNER, 'PATCH', 'events/started', { title: 'x' }), false);
  assert.equal(await can(OWNER, 'PATCH', 'events/started', { window: 30, end: FUTURE }), false);
  assert.equal(await can(OWNER, 'PATCH', 'events/future', { title: 'x' }), true);
  assert.equal(await can(OWNER, 'PATCH', 'events/future', { createdBy: OTHER }), false);
  assert.equal(await can(OTHER, 'PATCH', 'events/future', { window: 30 }), false);
  assert.equal(await can(GUEST, 'PATCH', 'events/future', { window: 30 }), false);
  assert.equal(await can(ADMIN, 'PATCH', 'events/started', { title: 'x' }), true);
});

test('events: only the creator or an admin deletes', async () => {
  assert.equal(await can(OWNER, 'DELETE', 'events/future'), true);
  assert.equal(await can(OWNER, 'DELETE', 'events/started'), true);
  assert.equal(await can(OTHER, 'DELETE', 'events/future'), false);
  assert.equal(await can(GUEST, 'DELETE', 'events/future'), false);
  assert.equal(await can(OWNER, 'DELETE', 'events/legacy'), false);
  assert.equal(await can(ADMIN, 'DELETE', 'events/legacy'), true);
});

test('events: bare and nested paths accept no manager writes', async () => {
  assert.equal(await can(OWNER, 'PUT', 'events', {}), false);
  assert.equal(await can(ADMIN, 'PUT', 'events', {}), false);
  assert.equal(await can(OWNER, 'PUT', 'events/future/x', {}), false);
  assert.equal(await can(ADMIN, 'PUT', 'events/future/x', {}), true);
});

test('the bootstrap admin is an admin even without a roles entry', async () => {
  const r = await authorize({
    method: 'DELETE', path: 'events/legacy', session: { email: 'boot@tbd.edu.vn' },
    rolesDoc, bootstrapAdminEmail: 'boot@tbd.edu.vn', loadDoc, now: NOW,
  });
  assert.equal(r, true);
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. Several tests fail on their assertions (for example "a manager creates an event only as themselves" and "only the creator or an admin deletes"), because the current rule lets any manager write any event.

- [ ] **Step 4: Rewrite `server/authorize.js` with the `events` rules**

Replace the whole file with (roster and att blocks are unchanged for now and are replaced in Tasks 2 and 3):

```js
// Path-based access rules for the generic document API. Applied on every request so
// permissions hold even when called directly (curl, a modified client), not just when
// the React UI happens to hide a button.
//
// An event belongs to the manager whose email is in its `createdBy`. Admins may do anything
// to any event; the owner may replace it only before it starts, and afterwards may still
// adjust the live settings in QUICK_FIELDS. Keep this in sync with canEditEvent in src/lib/auth.ts.
import { attKeyOf, computeRole, hashEmail, normalizeEmail } from './roles.js';

const QUICK_FIELDS = new Set(['window', 'tolerance']);

function isOwner(eventDoc, email) {
  return !!eventDoc?.createdBy && !!email && normalizeEmail(eventDoc.createdBy) === normalizeEmail(email);
}

// An unparseable start compares false, i.e. counts as already started — the restrictive answer.
function notStarted(eventDoc, now) {
  return now < Date.parse(eventDoc.start);
}

export async function authorize({ method, path, session, rolesDoc, bootstrapAdminEmail, body, loadDoc, now = Date.now() }) {
  const isWrite = method !== 'GET';
  const signedIn = !!session?.email;
  const email = signedIn ? normalizeEmail(session.email) : null;
  const { isAdmin, isManager } = computeRole(rolesDoc, session?.email, bootstrapAdminEmail);
  const segs = path.split('/');

  if (path === 'config/roles') return isWrite ? isAdmin : signedIn;
  if (path === 'config/app') return isWrite ? isManager : signedIn;

  if (segs[0] === 'events') {
    if (!isWrite) return signedIn;
    if (!isManager || segs.length === 1) return false;
    if (segs.length > 2) return isAdmin;

    const existing = await loadDoc(path);
    const b = body && typeof body === 'object' ? body : {};
    if (method === 'PUT') {
      if (!existing) return normalizeEmail(b.createdBy) === email; // creating: only as yourself
      if (isAdmin) return true;
      return isOwner(existing, email) && notStarted(existing, now)
        && normalizeEmail(b.createdBy) === normalizeEmail(existing.createdBy);
    }
    if (method === 'PATCH') {
      if (!existing || isAdmin) return true; // a missing doc is answered with 404 by the route
      if (!isOwner(existing, email) || 'createdBy' in b) return false;
      return notStarted(existing, now) || Object.keys(b).every((k) => QUICK_FIELDS.has(k));
    }
    if (method === 'DELETE') return isAdmin || isOwner(existing, email);
    return false;
  }

  // Plaintext invite list — must not be world-readable (see the comment in src/lib/auth.ts).
  if (path.startsWith('roster/')) return isManager;

  if (path === 'att' || path.startsWith('att/')) {
    if (path === 'att') return isManager; // full list: managers only
    if (isManager) return true;
    if (!signedIn) return false;
    const hash = await hashEmail(session.email);
    return path === `att/${attKeyOf(hash)}`; // an attendee may only touch their own record
  }

  return false;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS — all tests in `server/authorize.test.js` pass, 0 fail.

---

### Task 2: `roster` rules

**Files:**
- Modify: `server/authorize.test.js`
- Modify: `server/authorize.js`

- [ ] **Step 1: Append the failing tests**

Append to `server/authorize.test.js`:

```js
test('roster: only the creator (before the start) or an admin reads and writes it', async () => {
  assert.equal(await can(OWNER, 'GET', 'roster/future'), true);
  assert.equal(await can(OWNER, 'GET', 'roster/started'), true);
  assert.equal(await can(OTHER, 'GET', 'roster/future'), false);
  assert.equal(await can(GUEST, 'GET', 'roster/future'), false);
  assert.equal(await can(ADMIN, 'GET', 'roster/future'), true);
  assert.equal(await can(ADMIN, 'GET', 'roster/missing'), true);
  assert.equal(await can(OWNER, 'GET', 'roster/missing'), false);
  assert.equal(await can(OWNER, 'GET', 'roster'), false);

  assert.equal(await can(OWNER, 'PUT', 'roster/future', { emails: [] }), true);
  assert.equal(await can(OWNER, 'PUT', 'roster/started', { emails: [] }), false);
  assert.equal(await can(OTHER, 'PUT', 'roster/future', { emails: [] }), false);
  assert.equal(await can(ADMIN, 'PUT', 'roster/started', { emails: [] }), true);
  assert.equal(await can(OWNER, 'DELETE', 'roster/started'), false);
  assert.equal(await can(ADMIN, 'DELETE', 'roster/started'), true);
});

test('roster: any manager may write it before the event exists (the form saves it first)', async () => {
  assert.equal(await can(OWNER, 'PUT', 'roster/brand-new', { emails: [] }), true);
  assert.equal(await can(GUEST, 'PUT', 'roster/brand-new', { emails: [] }), false);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL in the two new roster tests (today any manager reads/writes every roster).

- [ ] **Step 3: Replace the roster block**

In `server/authorize.js` replace

```js
  // Plaintext invite list — must not be world-readable (see the comment in src/lib/auth.ts).
  if (path.startsWith('roster/')) return isManager;
```

with

```js
  // Plaintext invite list — must not be world-readable (see the comment in src/lib/auth.ts).
  if (segs[0] === 'roster') {
    if (!isManager || segs.length !== 2) return false;
    if (isAdmin) return true;
    const event = await loadDoc(`events/${segs[1]}`);
    if (!isWrite) return isOwner(event, email);
    // The form writes the roster before the event exists, so an unclaimed id is open to any manager.
    return !event || (isOwner(event, email) && notStarted(event, now));
  }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 0 fail.

---

### Task 3: `att` rules and helpers

**Files:**
- Modify: `server/authorize.test.js`
- Modify: `server/authorize.js`

- [ ] **Step 1: Update the test imports and append the failing tests**

In `server/authorize.test.js` replace the import line

```js
import { authorize } from './authorize.js';
```

with

```js
import { authorize, eventIdsOwnedBy, filterAttRecords } from './authorize.js';
import { attKeyOf, hashEmail } from './roles.js';
```

Append:

```js
const attPath = async (email) => `att/${attKeyOf(await hashEmail(email))}`;

test('att: managers read the list but only touch their own document', async () => {
  assert.equal(await can(OWNER, 'GET', 'att'), true);
  assert.equal(await can(GUEST, 'GET', 'att'), false);
  assert.equal(await can(null, 'GET', 'att'), false);
  assert.equal(await can(OWNER, 'PUT', 'att', {}), false);
  assert.equal(await can(ADMIN, 'PUT', 'att', {}), false);

  const own = await attPath(OWNER);
  assert.equal(await can(OWNER, 'GET', own), true);
  assert.equal(await can(OWNER, 'PUT', own, {}), true);
  assert.equal(await can(OWNER, 'PATCH', own, {}), true);

  const theirs = await attPath(OTHER);
  assert.equal(await can(OWNER, 'GET', theirs), false);
  assert.equal(await can(OWNER, 'PATCH', theirs, {}), false);
  assert.equal(await can(OWNER, 'DELETE', theirs), false);
  assert.equal(await can(ADMIN, 'PATCH', theirs, {}), true);
  assert.equal(await can(ADMIN, 'GET', theirs), true);
});

test('att: an attendee touches only their own document', async () => {
  assert.equal(await can(GUEST, 'PUT', await attPath(GUEST), {}), true);
  assert.equal(await can(GUEST, 'GET', await attPath(OWNER)), false);
  assert.equal(await can(null, 'GET', await attPath(OWNER)), false);
  assert.equal(await can(OWNER, 'GET', `${await attPath(OWNER)}/nested`), false);
});

test('eventIdsOwnedBy lists the events created by that email, ignoring case', () => {
  const events = [
    { id: 'a', data: { createdBy: OWNER } },
    { id: 'b', data: { createdBy: OTHER } },
    { id: 'c', data: { createdBy: null } },
  ];
  assert.deepEqual(eventIdsOwnedBy(events, OWNER.toUpperCase()), ['a']);
});

test('filterAttRecords keeps only owned events and drops attendees left with none', () => {
  const list = [
    { id: 'ka', exists: true, data: { uid: 'ka', email: 'a@x.vn', records: { a: { at: 1 }, b: { at: 2 } } } },
    { id: 'kb', exists: true, data: { uid: 'kb', email: 'b@x.vn', records: { b: { at: 3 } } } },
  ];
  const out = filterAttRecords(list, ['a']);
  assert.equal(out.length, 1);
  assert.equal(out[0].data.email, 'a@x.vn');
  assert.deepEqual(Object.keys(out[0].data.records), ['a']);
  assert.deepEqual(Object.keys(list[0].data.records), ['a', 'b']); // input not mutated
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. The import of `eventIdsOwnedBy` / `filterAttRecords` finds no such export, and the att rule tests fail.

- [ ] **Step 3: Replace the att block and add the helpers**

In `server/authorize.js` replace

```js
  if (path === 'att' || path.startsWith('att/')) {
    if (path === 'att') return isManager; // full list: managers only
    if (isManager) return true;
    if (!signedIn) return false;
    const hash = await hashEmail(session.email);
    return path === `att/${attKeyOf(hash)}`; // an attendee may only touch their own record
  }

  return false;
}
```

with

```js
  if (segs[0] === 'att') {
    if (segs.length === 1) return !isWrite && isManager; // full list: managers only, narrowed per manager by the route
    if (segs.length !== 2 || !signedIn) return false;
    if (isAdmin) return true;
    // Everyone else, managers included, may only touch their own record.
    return path === `att/${attKeyOf(await hashEmail(session.email))}`;
  }

  return false;
}

/** Ids of the events created by `email`, from a listCollection('events') result. */
export function eventIdsOwnedBy(eventDocs, email) {
  return eventDocs.filter((d) => isOwner(d.data, email)).map((d) => d.id);
}

/**
 * What a non-admin manager sees of the attendance list: only the records of the given
 * events, and only the attendees who still have one — nobody else's name or email leaks out.
 */
export function filterAttRecords(docs, ownedEventIds) {
  const owned = new Set(ownedEventIds);
  return docs
    .map((d) => ({
      ...d,
      data: {
        ...d.data,
        records: Object.fromEntries(Object.entries(d.data?.records ?? {}).filter(([id]) => owned.has(id))),
      },
    }))
    .filter((d) => Object.keys(d.data.records).length > 0);
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS, 0 fail.

---

### Task 4: Cascade delete, `att` filtering and guard in the router

**Files:**
- Modify: `server/db.js`
- Modify: `server/routes.js`
- Create: `server/routes.test.js`

- [ ] **Step 1: Make the store injectable (no behavior change)**

In `server/routes.js` replace

```js
import express from 'express';
import { deleteDoc, getDoc, listCollection, setDoc, updateDoc } from './db.js';
import { authorize } from './authorize.js';

export function apiRouter({ bootstrapAdminEmail }) {
  const router = express.Router();
```

with

```js
import express from 'express';
import * as db from './db.js';
import { authorize, eventIdsOwnedBy, filterAttRecords } from './authorize.js';
import { computeRole } from './roles.js';

// `store` is injectable so the routes can be tested without Postgres.
export function apiRouter({ bootstrapAdminEmail, store = db }) {
  const { deleteDoc, deleteEventCascade, getDoc, listCollection, setDoc, updateDoc } = store;
  const router = express.Router();
```

- [ ] **Step 2: Write the failing router tests**

Create `server/routes.test.js`:

```js
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
  'att/ka': { uid: 'ka', email: 'a@x.vn', records: { mine: { at: 't' }, theirs: { at: 't' } } },
  'att/kb': { uid: 'kb', email: 'b@x.vn', records: { theirs: { at: 't' } } },
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
    listCollection: async (prefix) => [...docs.entries()]
      .filter(([k]) => k.startsWith(`${prefix}/`) && !k.slice(prefix.length + 1).includes('/'))
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
    assert.deepEqual(mgr.docs.map((d) => d.id), ['ka']);
    assert.deepEqual(Object.keys(mgr.docs[0].data.records), ['mine']);

    const adm = await (await call(ADMIN, 'GET', 'collection/att')).json();
    assert.deepEqual(adm.docs.map((d) => d.id).sort(), ['ka', 'kb']);
    assert.deepEqual(Object.keys(adm.docs.find((d) => d.id === 'ka').data.records).sort(), ['mine', 'theirs']);

    assert.equal((await call(GUEST, 'GET', 'collection/att')).status, 403);
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
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npm test`
Expected: FAIL. The router tests fail on assertions: the collection returns unfiltered `att`, no cascade is recorded, and other managers' writes are not refused, because `guard` still ignores `body` and `loadDoc`. (Fast failures, no hang: the store is fake.)

- [ ] **Step 4: Add `deleteEventCascade` to `server/db.js`**

In `server/db.js`, after the `deleteDoc` function and before the `listCollection` doc comment, insert:

```js
// One statement, so the event, its roster and every attendee's record of it go together or not
// at all. (A data-modifying WITH runs to completion even though the main query never reads it.)
const CASCADE_SQL = `
  WITH gone AS (DELETE FROM documents WHERE path IN ($2, $3))
  UPDATE documents SET data = data #- ARRAY['records', $1::text], updated_at = now()
  WHERE path LIKE 'att/%' AND path NOT LIKE 'att/%/%' AND jsonb_exists(data->'records', $1::text)`;

/** Deletes an event with everything that hangs off it: its roster and each attendee's record of it. */
export async function deleteEventCascade(eventId) {
  await pool.query(CASCADE_SQL, [eventId, `events/${eventId}`, `roster/${eventId}`]);
}
```

- [ ] **Step 5: Update the router handlers**

In `server/routes.js` replace everything from `async function loadRolesDoc()` to the end of the file (the rest of `apiRouter`, including its closing `}`) with:

```js
  async function loadRolesDoc() {
    const snap = await getDoc('config/roles');
    return snap.exists ? snap.data : { entries: [] };
  }

  async function loadDoc(path) {
    const snap = await getDoc(path);
    return snap.exists ? snap.data : null;
  }

  // Sends 403 and returns null when the request isn't allowed; otherwise returns the caller's role.
  async function guard(req, res, path) {
    const rolesDoc = await loadRolesDoc();
    const ok = await authorize({
      method: req.method, path, session: req.session, rolesDoc, bootstrapAdminEmail, body: req.body, loadDoc,
    });
    if (!ok) {
      res.status(403).json({ error: 'forbidden' });
      return null;
    }
    return computeRole(rolesDoc, req.session?.email, bootstrapAdminEmail);
  }

  // Express 4 string wildcard: req.params[0] holds everything after '/doc/'.
  router.get('/doc/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    res.json(await getDoc(path));
  });

  router.put('/doc/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    await setDoc(path, req.body);
    res.json({ ok: true });
  });

  router.patch('/doc/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    try {
      await updateDoc(path, req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.code === 'invalid_argument' ? 404 : 500).json({ error: e.message });
    }
  });

  router.delete('/doc/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    // Deleting an event also removes its roster and every attendee's record of it.
    const eventId = path.match(/^events\/([^/]+)$/)?.[1];
    if (eventId) await deleteEventCascade(eventId);
    else await deleteDoc(path);
    res.json({ ok: true });
  });

  router.get('/collection/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    const role = await guard(req, res, path);
    if (!role) return;
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 500));
    let docs = await listCollection(path, limit);
    // A manager sees attendance only for the events they created; an admin sees everything.
    if (path === 'att' && !role.isAdmin) {
      docs = filterAttRecords(docs, eventIdsOwnedBy(await listCollection('events', 2000), req.session.email));
    }
    res.json({ docs });
  });

  return router;
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npm test`
Expected: PASS — `server/authorize.test.js` and `server/routes.test.js`, 0 fail, and the process exits by itself (no hang).

---

### Task 5: Verify the cascade SQL against a real Postgres engine

`deleteEventCascade` is the one piece the fake store cannot exercise. The Docker daemon may be off, so use PGlite (Postgres compiled to WASM) installed in the scratchpad, outside the project. Tell the user you installed a package there.

**Files:**
- Create (scratchpad only): `verify-cascade.mjs`

- [ ] **Step 1: Install PGlite in the scratchpad**

Run:

```bash
SCRATCH="/c/Users/sonph/AppData/Local/Temp/claude/D--Armitage-cyberrange/59a08cae-7941-42e8-bfb9-ff1bd3542ec5/scratchpad"
npm install --prefix "$SCRATCH" @electric-sql/pglite
```

Expected: install finishes without errors.

- [ ] **Step 2: Write the verification script**

Create `$SCRATCH/verify-cascade.mjs` (use the Windows path `C:\Users\sonph\AppData\Local\Temp\claude\D--Armitage-cyberrange\59a08cae-7941-42e8-bfb9-ff1bd3542ec5\scratchpad\verify-cascade.mjs`). Set `DB_JS` to the project's `server/db.js`:

```js
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

const DB_JS = 'G:/Research/NCKH2027/De tai VPU2027/Claude outputs/vpu-checkin/server/db.js';
// Take the SQL straight from the production file so this checks the real statement.
const sql = readFileSync(DB_JS, 'utf8').match(/const CASCADE_SQL = `([\s\S]*?)`;/)[1];

const db = new PGlite();
await db.exec(`CREATE TABLE documents (
  path TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
const put = (path, data) => db.query('INSERT INTO documents (path, data) VALUES ($1, $2::jsonb)', [path, JSON.stringify(data)]);

await put('events/e1', { title: 'one' });
await put('events/e2', { title: 'two' });
await put('roster/e1', { emails: ['a@x.vn'] });
await put('roster/e2', { emails: ['b@x.vn'] });
await put('att/ka', { uid: 'ka', records: { e1: { at: 1 }, e2: { at: 2 } } });
await put('att/kb', { uid: 'kb', records: { e1: { at: 3 } } });
await put('att/kc', { uid: 'kc', records: { e2: { at: 4 } } });
await put('att/kd/nested', { uid: 'kd', records: { e1: { at: 5 } } }); // deeper path must be left alone
await put('config/roles', { entries: [] });

await db.query(sql, ['e1', 'events/e1', 'roster/e1']);

const { rows } = await db.query('SELECT path, data FROM documents ORDER BY path');
const byPath = Object.fromEntries(rows.map((r) => [r.path, r.data]));

assert.deepEqual(Object.keys(byPath).sort(),
  ['att/ka', 'att/kb', 'att/kc', 'att/kd/nested', 'config/roles', 'events/e2', 'roster/e2']);
assert.deepEqual(Object.keys(byPath['att/ka'].records), ['e2']);
assert.deepEqual(byPath['att/kb'].records, {});
assert.deepEqual(Object.keys(byPath['att/kc'].records), ['e2']);
assert.deepEqual(Object.keys(byPath['att/kd/nested'].records), ['e1']);
console.log('cascade SQL OK');
```

- [ ] **Step 3: Run it**

Run: `node "$SCRATCH/verify-cascade.mjs"`
Expected: prints `cascade SQL OK`.
If Postgres rejects the statement (syntax or parameter typing), fix `CASCADE_SQL` in `server/db.js` and rerun until it passes; the regex in the script always re-reads the current text.

Note: this exercises the exact SQL on a real Postgres engine, but not the `pg` pool wiring in `deleteEventCascade` (one `pool.query` call). Say so in the final report.

---

### Task 6: Client predicates and the 403 message

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/platform.ts`

- [ ] **Step 1: Document the role and add the predicates in `src/lib/auth.ts`**

Replace

```ts
//   manager  — can create events and issue QR cards.
```

with

```ts
//   manager  — can create events and issue QR cards, and run (edit before it starts, delete)
//              the events they created. Other managers' events are theirs to attend only.
```

Then replace the end of the file

```ts
    canWrite: args.canEdit || args.isOwner,
  };
}
```

with

```ts
    canWrite: args.canEdit || args.isOwner,
  };
}

/** The manager who created the event; an event with no recorded creator belongs to nobody. */
export function isEventOwner(ev: { createdBy: string | null }, session: Session): boolean {
  return !!ev.createdBy && !!session.email && normalizeEmail(ev.createdBy) === session.email;
}

/**
 * Full edits (name, room, times, location, invite list): an admin any time, the creator only
 * before the event starts. Mirrors server/authorize.js, which is what actually enforces it.
 */
export function canEditEvent(ev: { createdBy: string | null; start: string }, session: Session, now: number): boolean {
  return session.isAdmin || (isEventOwner(ev, session) && now < Date.parse(ev.start));
}
```

- [ ] **Step 2: Sanity-check the predicates**

Run (Node 22 strips TypeScript types itself; an ExperimentalWarning line is fine):

```bash
node --input-type=module -e "
import { canEditEvent, isEventOwner } from './src/lib/auth.ts';
const s = { email: 'o@x.vn', name: '', source: null, isAdmin: false, isManager: true, canWrite: true };
const ev = (start, by = 'o@x.vn') => ({ createdBy: by, start });
const now = Date.parse('2026-09-25T10:00:00Z');
console.log(isEventOwner(ev('2026-09-25T12:00:00Z'), s), isEventOwner(ev('2026-09-25T12:00:00Z', 'x@x.vn'), s), isEventOwner({ createdBy: null, start: '' }, s));
console.log(canEditEvent(ev('2026-09-25T12:00:00Z'), s, now), canEditEvent(ev('2026-09-25T08:00:00Z'), s, now), canEditEvent(ev('2026-09-25T08:00:00Z'), { ...s, isAdmin: true }, now));
"
```

Expected output:

```
true false false
true false true
```

(If your Node cannot import `.ts`, skip this step; Task 10 type-checks and exercises the same logic in the UI.)

- [ ] **Step 3: Friendlier 403 in `src/lib/platform.ts`**

Above `function backendDoc(path: string): DocRef {` insert:

```ts
const FORBIDDEN_MSG = 'Bạn không có quyền thực hiện thao tác này. Có thể sự kiện đã bắt đầu hoặc không do bạn tạo.';

```

Then replace these three lines (each occurs once):

```ts
      if (!r.ok) throw new Error(`Không lưu được dữ liệu (mã ${r.status}).`);
```
→
```ts
      if (!r.ok) throw new Error(r.status === 403 ? FORBIDDEN_MSG : `Không lưu được dữ liệu (mã ${r.status}).`);
```

```ts
      if (!r.ok) throw { code: r.status === 404 ? 'invalid_argument' : 'unknown', message: `Không cập nhật được dữ liệu (mã ${r.status}).` };
```
→
```ts
      if (!r.ok) throw { code: r.status === 404 ? 'invalid_argument' : 'unknown', message: r.status === 403 ? FORBIDDEN_MSG : `Không cập nhật được dữ liệu (mã ${r.status}).` };
```

```ts
      if (!r.ok) throw new Error(`Không xoá được dữ liệu (mã ${r.status}).`);
```
→
```ts
      if (!r.ok) throw new Error(r.status === 403 ? FORBIDDEN_MSG : `Không xoá được dữ liệu (mã ${r.status}).`);
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -b`
Expected: no output, exit code 0.

---

### Task 7: `EventForm` edit mode

**Files:**
- Modify: `src/components/EventForm.tsx`

- [ ] **Step 1: Imports**

Replace

```tsx
  newEventId, parseMapCoordinates, resolveEmails, toLocalInput, uidsOf,
} from '@/lib/domain';
```

with

```tsx
  newEventId, parseMapCoordinates, resolveEmails, toLocalInput, toleranceOf, uidsOf, type EventRow, type RosterDoc,
} from '@/lib/domain';
```

- [ ] **Step 2: Helper and props/initial state**

Replace

```tsx
type Msg = { tone: 'ok' | 'bad' | 'info'; text: string } | null;

export function EventForm({ p, session, onCreated, onCancel }: {
  p: Platform; session: Session; onCreated: (id: string) => void; onCancel: () => void;
}) {
  const openedAt = useRef(new Date());
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [start, setStart] = useState(() => toLocalInput(new Date(Date.now() + 5 * 60e3)));
  const [end, setEnd] = useState(() => toLocalInput(new Date(Date.now() + 95 * 60e3)));
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS));
  const [tolerance, setTolerance] = useState(String(DEFAULT_TOLERANCE));
  const [win, setWin] = useState<number>(DEFAULT_WINDOW);
  const [mapText, setMapText] = useState('');
  const [emailsText, setEmailsText] = useState('');
```

with

```tsx
type Msg = { tone: 'ok' | 'bad' | 'info'; text: string } | null;

/** The stored ISO time when the form value still means the same minute, so an untouched field keeps its exact stored value. */
const keepIfSameMinute = (input: string, saved: string | undefined, fresh: Date) =>
  saved && input === toLocalInput(new Date(saved)) ? saved : fresh.toISOString();

/** Creates an event, or — when `initial` is given — edits that event in place (same id, creator and QR link). */
export function EventForm({ p, session, initial, onSaved, onCancel }: {
  p: Platform; session: Session; initial?: { event: EventRow; roster: RosterDoc }; onSaved: (id: string) => void; onCancel: () => void;
}) {
  const ev0 = initial?.event;
  const openedAt = useRef(new Date());
  const [title, setTitle] = useState(ev0?.title ?? '');
  const [location, setLocation] = useState(ev0?.location ?? '');
  const [start, setStart] = useState(() => toLocalInput(ev0 ? new Date(ev0.start) : new Date(Date.now() + 5 * 60e3)));
  const [end, setEnd] = useState(() => toLocalInput(ev0 ? new Date(ev0.end) : new Date(Date.now() + 95 * 60e3)));
  const [lat, setLat] = useState(ev0 ? String(ev0.lat) : '');
  const [lng, setLng] = useState(ev0 ? String(ev0.lng) : '');
  const [radius, setRadius] = useState(String(ev0?.radius ?? DEFAULT_RADIUS));
  const [tolerance, setTolerance] = useState(String(ev0 ? toleranceOf(ev0) : DEFAULT_TOLERANCE));
  const [win, setWin] = useState<number>(ev0 ? ev0.window ?? 0 : DEFAULT_WINDOW);
  const [mapText, setMapText] = useState('');
  const [emailsText, setEmailsText] = useState(initial?.roster.emails.join('\n') ?? '');
```

- [ ] **Step 3: Start-time validation**

Replace

```tsx
    if (isNaN(s.getTime()) || s < floorMinute) return setMsg({ tone: 'bad', text: 'Giờ bắt đầu không được sớm hơn thời điểm tạo điểm danh.' });
```

with

```tsx
    // Editing an event that already started (admin) must not trip over its own past start time.
    const startChanged = !ev0 || start !== toLocalInput(new Date(ev0.start));
    if (isNaN(s.getTime()) || (startChanged && s < floorMinute)) return setMsg({ tone: 'bad', text: 'Giờ bắt đầu không được sớm hơn thời điểm tạo điểm danh.' });
```

- [ ] **Step 4: Build the document for create or edit**

Replace

```tsx
      const id = newEventId();
```

with

```tsx
      const id = ev0?.id ?? newEventId();
```

Replace

```tsx
        start: s.toISOString(), end: e.toISOString(),
```

with

```tsx
        start: keepIfSameMinute(start, ev0?.start, s), end: keepIfSameMinute(end, ev0?.end, e),
```

Replace

```tsx
        createdAt: created.toISOString(), createdBy: session.email,
```

with

```tsx
        createdAt: ev0?.createdAt ?? created.toISOString(), createdBy: ev0 ? ev0.createdBy : session.email,
```

Replace

```tsx
      onCreated(id);
```

with

```tsx
      onSaved(id);
```

- [ ] **Step 5: Labels and the start picker's `min`**

Replace

```tsx
            <Input id="f-start" type="datetime-local" value={start} min={toLocalInput(openedAt.current)}
```

with

```tsx
            <Input id="f-start" type="datetime-local" value={start} min={ev0 ? undefined : toLocalInput(openedAt.current)}
```

Replace

```tsx
'Đang lưu…') : 'Tạo sự kiện và mã QR'}</Button>
```

with

```tsx
'Đang lưu…') : ev0 ? 'Lưu thay đổi' : 'Tạo sự kiện và mã QR'}</Button>
```

(Do not touch the long `progress ? ... :` part of that line; only the trailing `'Tạo sự kiện và mã QR'` changes.)

- [ ] **Step 6: Type-check**

Run: `npx tsc -b`
Expected: an error only in `src/components/AdminView.tsx` (it still passes `onCreated`). No errors in `EventForm.tsx`. That call site is fixed in Task 8.

---

### Task 8: `AdminView` — own events, edit dialog, server-side delete

**Files:**
- Modify: `src/components/AdminView.tsx`

- [ ] **Step 1: Import the predicates**

Replace

```tsx
import { normalizeEmail, type Session } from '@/lib/auth';
```

with

```tsx
import { canEditEvent, isEventOwner, normalizeEmail, type Session } from '@/lib/auth';
```

- [ ] **Step 2: List only the events this user runs**

Replace

```tsx
  const sorted = useMemo(() => {
    const rank = { open: 0, upcoming: 1, closed: 2 } as const;
    return [...events].sort((a, b) => rank[phaseOf(a, now)] - rank[phaseOf(b, now)]
      || (phaseOf(a, now) === 'closed' ? Date.parse(b.end) - Date.parse(a.end) : Date.parse(a.start) - Date.parse(b.start)));
  }, [events, now]);

  useEffect(() => {
    if (!selectedId || !events.some((e) => e.id === selectedId)) setSelectedId(sorted[0]?.id ?? null);
  }, [sorted, events, selectedId]);

  const countFor = (id: string) => attendees.filter((a) => a.records?.[id]).length;
  const selected = events.find((e) => e.id === selectedId) ?? null;
```

with

```tsx
  // An admin runs every event; a manager runs only the ones they created. Other managers'
  // events reach them through the check-in tab, like any attendee's.
  const mine = useMemo(() => (session.isAdmin ? events : events.filter((e) => isEventOwner(e, session))), [events, session]);

  const sorted = useMemo(() => {
    const rank = { open: 0, upcoming: 1, closed: 2 } as const;
    return [...mine].sort((a, b) => rank[phaseOf(a, now)] - rank[phaseOf(b, now)]
      || (phaseOf(a, now) === 'closed' ? Date.parse(b.end) - Date.parse(a.end) : Date.parse(a.start) - Date.parse(b.start)));
  }, [mine, now]);

  useEffect(() => {
    if (!selectedId || !mine.some((e) => e.id === selectedId)) setSelectedId(sorted[0]?.id ?? null);
  }, [sorted, mine, selectedId]);

  const countFor = (id: string) => attendees.filter((a) => a.records?.[id]).length;
  const selected = mine.find((e) => e.id === selectedId) ?? null;
```

Replace

```tsx
            <div className="eyebrow">Sự kiện · {events.length}</div>
```

with

```tsx
            <div className="eyebrow">Sự kiện · {mine.length}</div>
```

- [ ] **Step 3: Update the two call sites**

Replace

```tsx
            <EventDetail key={selected.id} p={p} ev={selected} now={now} attendees={attendees} baseUrl={baseUrl} onDeleted={() => setSelectedId(null)} driveReady={!!drive} />
```

with

```tsx
            <EventDetail key={selected.id} p={p} session={session} ev={selected} now={now} attendees={attendees} baseUrl={baseUrl} onDeleted={() => setSelectedId(null)} driveReady={!!drive} />
```

Replace

```tsx
onCreated={(id) => { setCreating(false); setSelectedId(id); }} />
```

with

```tsx
onSaved={(id) => { setCreating(false); setSelectedId(id); }} />
```

- [ ] **Step 4: `EventDetail` signature, state and permission flag**

Replace

```tsx
function EventDetail({ p, ev, now, attendees, baseUrl, onDeleted, driveReady }: {
  p: Platform; ev: EventRow; now: number; attendees: AttendeeDoc[]; baseUrl: string; onDeleted: () => void; driveReady: boolean;
}) {
```

with

```tsx
function EventDetail({ p, session, ev, now, attendees, baseUrl, onDeleted, driveReady }: {
  p: Platform; session: Session; ev: EventRow; now: number; attendees: AttendeeDoc[]; baseUrl: string; onDeleted: () => void; driveReady: boolean;
}) {
```

Replace

```tsx
  const [copyFallback, setCopyFallback] = useState<{ title: string; text: string } | null>(null);
```

with

```tsx
  const [copyFallback, setCopyFallback] = useState<{ title: string; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
```

Replace

```tsx
  const phase = phaseOf(ev, now);
```

with

```tsx
  const phase = phaseOf(ev, now);
  const canEdit = canEditEvent(ev, session, now);
```

- [ ] **Step 5: Delete is done by the server now**

Replace the whole `remove` function

```tsx
  async function remove() {
    try {
      // 1. Xoá event và roster
      await p.db.doc(`events/${ev.id}`).delete();
      await p.db.doc(`roster/${ev.id}`).delete();

      // 2. Dọn dẹp attendance records: xoá ev.id khỏi records của mỗi attendee
      for (const att of attendees) {
        if (att.records?.[ev.id]) {
          const updatedRecords = { ...att.records };
          delete updatedRecords[ev.id];
          await p.db.doc(`att/${att.uid}`).update({ records: updatedRecords });
        }
      }

      onDeleted();
    } catch (e: any) {
      setNote({ tone: 'bad', text: e?.message || 'Không xóa được sự kiện.' });
      setConfirmDel(false);
    }
  }
```

with

```tsx
  async function remove() {
    try {
      // The server also removes the roster and every attendee's record of this event.
      await p.db.doc(`events/${ev.id}`).delete();
      onDeleted();
    } catch (e: any) {
      setNote({ tone: 'bad', text: e?.message || 'Không xóa được sự kiện.' });
      setConfirmDel(false);
    }
  }
```

- [ ] **Step 6: Edit button, locked-state hint, edit dialog**

Replace

```tsx
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={roster === null}>Xuất CSV</Button>
```

with

```tsx
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={roster === null}>Xuất CSV</Button>
          {canEdit && <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={roster === null}>Sửa sự kiện</Button>}
```

Replace

```tsx
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
```

with

```tsx
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {!canEdit && (
        <p className="text-[13px] text-muted-foreground">
          Sự kiện đã bắt đầu nên không sửa được nội dung. Bạn vẫn chỉnh được thời gian nhận điểm danh và sai số GPS.
        </p>
      )}
```

Replace

```tsx
      <Dialog open={projector} onOpenChange={setProjector}>
```

with

```tsx
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sửa sự kiện điểm danh</DialogTitle>
            <DialogDescription>Liên kết mã QR không đổi. Nếu đổi giờ hoặc phòng, ảnh QR đã gửi trước đó vẫn ghi thông tin cũ.</DialogDescription>
          </DialogHeader>
          {roster && (
            <EventForm p={p} session={session} initial={{ event: ev, roster }} onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                setNote({ tone: 'ok', text: 'Đã lưu thay đổi. Nếu bạn đổi giờ hoặc phòng, hãy tải lại ảnh QR và gửi lại cho thành viên.' });
              }} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={projector} onOpenChange={setProjector}>
```

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc -b && npm run lint`
Expected: `tsc` prints nothing; `oxlint` reports 0 errors (existing warnings, if any, are not new).

---

### Task 9: `ManagersView` — edit an existing manager

**Files:**
- Modify: `src/components/ManagersView.tsx`

- [ ] **Step 1: State and edit helpers**

Replace

```tsx
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
```

with

```tsx
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // email of the entry being edited
```

Replace

```tsx
  async function add(ev: React.FormEvent) {
```

with

```tsx
  function startEdit(e: RoleEntry) {
    setEditing(e.email);
    setEmail(e.email);
    setName(e.name ?? '');
    setRole(e.role);
    setNote(null);
  }

  function cancelEdit() {
    setEditing(null);
    setEmail('');
    setName('');
    setRole('manager');
    setNote(null);
  }

  async function add(ev: React.FormEvent) {
```

- [ ] **Step 2: Allow saving a name-only edit and keep grant metadata**

Replace

```tsx
    if (existing?.role === role) {
```

with

```tsx
    if (!editing && existing?.role === role) {
```

Replace

```tsx
      const entry: RoleEntry = {
        email: addr,
        name: name.trim() || existing?.name || '',
        role,
        addedAt: new Date().toISOString(),
        addedBy: session.email,
      };
      await write([...current.filter((e) => normalizeEmail(e.email) !== addr), entry]);
      setEmail('');
      setName('');
      setNote({
        tone: 'ok',
        text: existing
          ? `Đã đổi quyền của ${addr} thành ${ROLE_LABEL[role].toLowerCase()}.`
          : `Đã thêm ${addr} làm ${ROLE_LABEL[role].toLowerCase()}. Người này đăng nhập bằng đúng email trên là dùng được ngay.`,
      });
```

with

```tsx
      const entry: RoleEntry = editing && existing
        ? { ...existing, name: name.trim(), role } // editing keeps who granted it and when
        : {
          email: addr,
          name: name.trim() || existing?.name || '',
          role,
          addedAt: new Date().toISOString(),
          addedBy: session.email,
        };
      await write([...current.filter((e) => normalizeEmail(e.email) !== addr), entry]);
      setEmail('');
      setName('');
      if (editing) {
        setEditing(null);
        setRole('manager');
      }
      setNote({
        tone: 'ok',
        text: editing
          ? `Đã cập nhật ${addr}.`
          : existing
            ? `Đã đổi quyền của ${addr} thành ${ROLE_LABEL[role].toLowerCase()}.`
            : `Đã thêm ${addr} làm ${ROLE_LABEL[role].toLowerCase()}. Người này đăng nhập bằng đúng email trên là dùng được ngay.`,
      });
```

- [ ] **Step 3: Revoking the entry being edited leaves edit mode**

Replace

```tsx
      await write((roles?.entries ?? []).filter((e) => normalizeEmail(e.email) !== normalizeEmail(addr)));
      setNote({ tone: 'ok', text: `Đã thu hồi quyền của ${addr}.` });
```

with

```tsx
      await write((roles?.entries ?? []).filter((e) => normalizeEmail(e.email) !== normalizeEmail(addr)));
      if (editing && normalizeEmail(editing) === normalizeEmail(addr)) cancelEdit();
      setNote({ tone: 'ok', text: `Đã thu hồi quyền của ${addr}.` });
```

- [ ] **Step 4: Form UI**

Replace

```tsx
        <div className="eyebrow">Cấp quyền</div>
```

with

```tsx
        <div className="eyebrow">{editing ? 'Sửa người quản lý' : 'Cấp quyền'}</div>
```

Replace

```tsx
            <Input id="r-email" className="mono" inputMode="email" autoComplete="off" value={email}
              onChange={(e) => { setEmail(e.target.value); setNote(null); }} placeholder="nguyen.van.a@tbd.edu.vn" />
```

with

```tsx
            <Input id="r-email" className="mono" inputMode="email" autoComplete="off" value={email} disabled={!!editing}
              onChange={(e) => { setEmail(e.target.value); setNote(null); }} placeholder="nguyen.van.a@tbd.edu.vn" />
```

Replace

```tsx
                ? 'Tạo sự kiện, sinh mã QR, theo dõi và xuất danh sách điểm danh.'
                : 'Toàn quyền của người quản lý, cộng thêm quyền cấp và thu hồi quyền cho người khác.'}
```

with

```tsx
                ? 'Tạo sự kiện, sinh mã QR; sửa (trước giờ bắt đầu), xoá, theo dõi và xuất danh sách điểm danh của sự kiện do mình tạo.'
                : 'Toàn quyền của người quản lý, cộng thêm quản lý mọi sự kiện và quyền cấp, sửa, thu hồi quyền cho người khác.'}
```

Replace

```tsx
          <Button type="submit" disabled={busy || !email.trim()}>{busy ? 'Đang lưu…' : 'Thêm người quản lý'}</Button>
```

with

```tsx
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !email.trim()}>{busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm người quản lý'}</Button>
            {editing && <Button type="button" variant="ghost" disabled={busy} onClick={cancelEdit}>Huỷ sửa</Button>}
          </div>
```

- [ ] **Step 5: "Sửa" button on each row**

Replace

```tsx
                        <Button size="sm" variant="ghost" className="text-bad hover:text-bad" disabled={busy}
                          onClick={() => setConfirmDrop(e.email)}>
                          {isSelf ? 'Bỏ quyền của tôi' : 'Thu hồi'}
                        </Button>
```

with

```tsx
                        <span className="inline-flex gap-1">
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => startEdit(e)}>Sửa</Button>
                          <Button size="sm" variant="ghost" className="text-bad hover:text-bad" disabled={busy}
                            onClick={() => setConfirmDrop(e.email)}>
                            {isSelf ? 'Bỏ quyền của tôi' : 'Thu hồi'}
                          </Button>
                        </span>
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc -b && npm run lint`
Expected: `tsc` prints nothing; `oxlint` reports 0 errors.

---

### Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: All automated checks**

Run: `npm test && npx tsc -b && npm run lint`
Expected: server tests all pass, `tsc` silent, `oxlint` 0 errors.

- [ ] **Step 2: Start the dev server in the background**

Run: `npm run dev` in the background (Vite, default `http://localhost:5173`). The app finds no `/health`, so it runs in demo mode with the in-memory store and seed data.

- [ ] **Step 3: Manager UI check (browser pane)**

Open `http://localhost:5173`. In the demo sign-in box type `lan.nt@tbd.edu.vn` and sign in, then confirm:

1. Tab **Quản lý** shows `Sự kiện · 0` and "Chưa có sự kiện" (the seeded events were created by `son.pt@tbd.edu.vn`).
2. Tab **Điểm danh** still lists both seeded events, and the open one can be checked in (she is on its invite list).
3. In **Quản lý**, create an event (default start is +5 min; set a valid location such as `12.2388, 109.1967` and one invited email). It appears in the list. Open it: **Sửa sự kiện** is visible; edit the title and the invite list, save, and confirm the header shows the new title and the invited count updates.
4. Inject an already-started event owned by her. In the page console run:

```js
const K = 'vpu.preview.memoryStore'; const d = JSON.parse(sessionStorage.getItem(K) || '{}'); const now = Date.now();
d['events/ev-lan-started'] = { title: 'Lan · đã bắt đầu', location: 'P1', start: new Date(now - 10 * 60e3).toISOString(), end: new Date(now + 60 * 60e3).toISOString(), lat: 12.2388, lng: 109.1967, radius: 30, tolerance: 50, window: 30, uids: [], emailHashes: [], invited: 1, unresolved: 1, createdAt: new Date(now).toISOString(), createdBy: 'lan.nt@tbd.edu.vn' };
d['roster/ev-lan-started'] = { emails: ['lan.nt@tbd.edu.vn'], map: {} };
sessionStorage.setItem(K, JSON.stringify(d)); location.reload();
```

   Open that event: there is **no** Sửa sự kiện button, the hint "Sự kiện đã bắt đầu nên không sửa được nội dung…" shows, the two quick-setting rows still work, and **Xóa sự kiện** still works.

- [ ] **Step 4: Admin UI check**

Sign out, sign in as `son.pt@tbd.edu.vn`:

1. **Quản lý** lists every event (seeded ones plus Lan's), and **Sửa sự kiện** is available on the started one too; saving it without touching the start time works (no "giờ bắt đầu sớm hơn" error).
2. **Quản trị**: press **Sửa** on `lan.nt@tbd.edu.vn`, change only the name, and save ("Đã cập nhật…"); the role and "Được cấp" columns are unchanged. Press **Sửa** then **Huỷ sửa** and confirm the form resets. Change her role to Quản trị viên and back.

- [ ] **Step 5: Stop the dev server and clean up**

Stop the background Vite process. Leave the scratchpad files in place (they are outside the project).

- [ ] **Step 6: Final report to the user (in Vietnamese)**

State plainly what was verified and what was not:
- Verified: server rules (tests), router wiring (tests with a fake store), cascade SQL (PGlite in the scratchpad; Docker was not running), type-check, lint, the demo-mode UI flows above.
- Not verified: a full run against the real Postgres backend with real Google sign-in (the production path); say so and suggest a quick smoke test after deploying (`docker compose up`, then create, edit, delete an event as a manager and as an admin).
- Mention the two deliberate deviations listed at the top of this plan, the extra finding that the old client-side cascade never removed records, and the out-of-scope items from spec §7.
