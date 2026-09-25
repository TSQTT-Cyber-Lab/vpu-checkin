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
  'events/nostart': { title: 'N', createdBy: OWNER },
  'events/atstart': { title: 'A', start: new Date(NOW).toISOString(), end: END, createdBy: OWNER },
  'events/mixed': { title: 'M', start: FUTURE, end: END, createdBy: 'Owner@TBD.edu.vn' },
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

test('the bootstrap admin is an admin even without a roles entry', async () => {
  const r = await authorize({
    method: 'DELETE', path: 'events/legacy', session: { email: 'boot@tbd.edu.vn' },
    rolesDoc, bootstrapAdminEmail: 'boot@tbd.edu.vn', loadDoc, now: NOW,
  });
  assert.equal(r, true);
});
