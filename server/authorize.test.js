import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize, eventIdsOwnedBy, filterAttRecords } from './authorize.js';
import { attKeyOf, hashEmail } from './roles.js';

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
  'events/nostart': { title: 'N', createdBy: OWNER },
  'events/atstart': { title: 'A', start: new Date(NOW).toISOString(), end: END, createdBy: OWNER },
  'events/mixed': { title: 'M', start: FUTURE, end: END, createdBy: 'Owner@TBD.edu.vn' },
  'events/exmgr': { title: 'X', start: FUTURE, end: END, createdBy: GUEST },
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
  assert.equal(await can(OTHER, 'PUT', 'events/future', { createdBy: OWNER }), false);
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
  assert.equal(await can(OWNER, 'PUT', 'events', { createdBy: OWNER }), false);
  assert.equal(await can(ADMIN, 'PUT', 'events', { createdBy: ADMIN }), false);
  assert.equal(await can(OWNER, 'PUT', 'events/future/x', { createdBy: OWNER }), false);
  assert.equal(await can(ADMIN, 'PUT', 'events/future/x', { createdBy: OWNER }), true);
});

test('events: edge cases fail closed', async () => {
  // no usable start time counts as already started
  assert.equal(await can(OWNER, 'PUT', 'events/nostart', { createdBy: OWNER }), false);
  assert.equal(await can(OWNER, 'PATCH', 'events/nostart', { title: 'x' }), false);
  assert.equal(await can(OWNER, 'PATCH', 'events/nostart', { window: 30 }), true);
  // the start instant itself already counts as started
  assert.equal(await can(OWNER, 'PUT', 'events/atstart', { createdBy: OWNER }), false);
  // a stored creator address in another case still identifies its owner
  assert.equal(await can(OWNER, 'PUT', 'events/mixed', { createdBy: OWNER }), true);
  // a request without a body must be refused, not throw
  assert.equal(await can(OWNER, 'PUT', 'events/future'), false);
  // empty path segments are never valid ids
  assert.equal(await can(OWNER, 'PUT', 'events/', { createdBy: OWNER }), false);
  assert.equal(await can(ADMIN, 'PUT', 'events//x', { createdBy: ADMIN }), false);
  // patching a missing event: only an admin gets through (to the route's 404)
  assert.equal(await can(OWNER, 'PATCH', 'events/missing', { window: 30 }), false);
  assert.equal(await can(ADMIN, 'PATCH', 'events/missing', { window: 30 }), true);
});

test('events: without an injected clock the real time is used', async () => {
  // authorize() defaults `now` to Date.now(); a start in 2000 has passed, one in 2999 has not.
  const started = { 'events/old': { start: '2000-01-01T00:00:00.000Z', createdBy: OWNER }, 'events/far': { start: '2999-01-01T00:00:00.000Z', createdBy: OWNER } };
  const real = (method, path, body) => authorize({
    method, path, body, session: { email: OWNER }, rolesDoc, bootstrapAdminEmail: 'boot@tbd.edu.vn',
    loadDoc: async (p) => started[p] ?? null,
  });
  assert.equal(await real('PUT', 'events/old', { createdBy: OWNER }), false);
  assert.equal(await real('PUT', 'events/far', { createdBy: OWNER }), true);
});

test('events: other HTTP methods are refused', async () => {
  for (const method of ['POST', 'OPTIONS', 'TRACE']) {
    assert.equal(await can(OWNER, method, 'events/future', {}), false);
    assert.equal(await can(ADMIN, method, 'events/future', {}), false);
  }
});

test('events: the creator address in the body may be in any case', async () => {
  assert.equal(await can(OWNER, 'PUT', 'events/new', { createdBy: 'Owner@TBD.edu.vn' }), true);
  assert.equal(await can(OWNER, 'PUT', 'events/future', { createdBy: 'Owner@TBD.edu.vn' }), true);
});

test('the bootstrap admin is an admin even without a roles entry', async () => {
  const r = await authorize({
    method: 'DELETE', path: 'events/legacy', session: { email: 'boot@tbd.edu.vn' },
    rolesDoc, bootstrapAdminEmail: 'boot@tbd.edu.vn', loadDoc, now: NOW,
  });
  assert.equal(r, true);
});

test('roster: only the creator (writes only before the start) or an admin reads and writes it', async () => {
  assert.equal(await can(OWNER, 'GET', 'roster/future'), true);
  assert.equal(await can(OWNER, 'GET', 'roster/started'), true);
  assert.equal(await can(OTHER, 'GET', 'roster/future'), false);
  assert.equal(await can(GUEST, 'GET', 'roster/future'), false);
  assert.equal(await can(GUEST, 'GET', 'roster/exmgr'), false); // creator who lost manager status
  assert.equal(await can(OWNER, 'GET', 'roster/legacy'), false); // no creator recorded: admin only
  assert.equal(await can(ADMIN, 'GET', 'roster/future'), true);
  assert.equal(await can(ADMIN, 'GET', 'roster/missing'), true);
  assert.equal(await can(OWNER, 'GET', 'roster/missing'), false);
  assert.equal(await can(OWNER, 'GET', 'roster'), false);
  assert.equal(await can(OWNER, 'GET', 'roster/future/x'), false);
  assert.equal(await can(ADMIN, 'GET', 'roster/future/x'), false);

  assert.equal(await can(OWNER, 'PUT', 'roster/future', { emails: [] }), true);
  assert.equal(await can(OWNER, 'PUT', 'roster/started', { emails: [] }), false);
  assert.equal(await can(OTHER, 'PUT', 'roster/future', { emails: [] }), false);
  assert.equal(await can(ADMIN, 'PUT', 'roster/started', { emails: [] }), true);
  assert.equal(await can(OWNER, 'PUT', 'roster/legacy', { emails: [] }), false);
  assert.equal(await can(OWNER, 'PATCH', 'roster/started', { emails: [] }), false);
  assert.equal(await can(OWNER, 'HEAD', 'roster/future'), true); // HEAD follows the read rule
  assert.equal(await can(OTHER, 'HEAD', 'roster/brand-new'), false); // ...so it cannot probe an unclaimed id
  assert.equal(await can(OWNER, 'DELETE', 'roster/started'), false);
  assert.equal(await can(ADMIN, 'DELETE', 'roster/started'), true);
});

test('roster: any manager may write it before the event exists (the form saves it first)', async () => {
  assert.equal(await can(OWNER, 'PUT', 'roster/brand-new', { emails: [] }), true);
  assert.equal(await can(OTHER, 'PUT', 'roster/brand-new', { emails: [] }), true);
  assert.equal(await can(OTHER, 'DELETE', 'roster/brand-new'), true);
  assert.equal(await can(GUEST, 'PUT', 'roster/brand-new', { emails: [] }), false);
});

const attPath = async (email) => `att/${attKeyOf(await hashEmail(email))}`;

test('att: managers read the list but only touch their own document', async () => {
  assert.equal(await can(OWNER, 'GET', 'att'), true);
  assert.equal(await can(OWNER, 'HEAD', 'att'), true);
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
  assert.equal(await can(ADMIN, 'GET', `${await attPath(OWNER)}/nested`), false);
  assert.equal(await can(GUEST, 'GET', `${await attPath(GUEST)}x`), false); // own key plus a suffix is another key
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
    { id: 'kc', exists: true, data: { uid: 'kc', email: 'c@x.vn' } },
  ];
  const out = filterAttRecords(list, ['a']);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'ka');
  assert.equal(out[0].data.email, 'a@x.vn');
  assert.deepEqual(Object.keys(out[0].data.records), ['a']);
  assert.deepEqual(Object.keys(list[0].data.records), ['a', 'b']); // input not mutated
});

test('paths outside the known families are refused, even for an admin', async () => {
  for (const p of ['eventsX/1', 'rosterX/1', 'attX']) assert.equal(await can(ADMIN, 'GET', p), false);
});

test('a session without a usable email is not signed in', async () => {
  for (const session of [{}, { email: '  ' }]) {
    for (const path of ['att/e', 'events/future', 'config/roles']) {
      assert.equal(await authorize({ method: 'GET', path, session, rolesDoc, bootstrapAdminEmail: 'boot@tbd.edu.vn', loadDoc, now: NOW }), false);
    }
  }
});

test('unknown methods are refused in every family', async () => {
  for (const method of ['POST', 'OPTIONS', 'TRACE', 'head']) {
    for (const path of ['roster/future', 'roster/brand-new', 'att', await attPath(OWNER), 'config/app']) {
      assert.equal(await can(OWNER, method, path, {}), false);
    }
  }
});

test('events: createdBy must be a string', async () => {
  assert.equal(await can(OWNER, 'PUT', 'events/new', { createdBy: [OWNER] }), false);
  assert.equal(await can(OWNER, 'PUT', 'events/future', { createdBy: [OWNER] }), false);
});
