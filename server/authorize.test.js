import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from './authorize.js';
import { attKeyOf, hashEmail } from './roles.js';
import { haversine, judgeFix } from './checkin.js';

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

const BOOT_ENTRY = { email: 'boot@tbd.edu.vn', role: 'admin', locked: true };

test('config/roles: no write may remove, demote or unlock the bootstrap admin', async () => {
  const put = (entries) => can(ADMIN, 'PUT', 'config/roles', { entries });
  assert.equal(await put([BOOT_ENTRY, { email: OWNER, role: 'manager' }]), true);
  assert.equal(await put([{ email: OWNER, role: 'manager' }]), false); // removed
  assert.equal(await put([]), false);
  assert.equal(await put([{ ...BOOT_ENTRY, role: 'manager' }]), false); // demoted
  assert.equal(await put([{ email: BOOT_ENTRY.email, role: 'admin' }]), false); // unlocked
  assert.equal(await put([{ ...BOOT_ENTRY, locked: 'true' }]), false); // must be the boolean true
  assert.equal(await put([{ ...BOOT_ENTRY, email: 'BOOT@tbd.edu.vn' }]), true); // case-insensitive
  assert.equal(await put('nope'), false); // entries is not a list
  // A list every reader must survive: junk entries, unknown roles, repeated addresses or a stray lock are refused.
  assert.equal(await put([null, BOOT_ENTRY]), false);
  assert.equal(await put([BOOT_ENTRY, 'x']), false);
  assert.equal(await put([BOOT_ENTRY, [1]]), false);
  assert.equal(await put([BOOT_ENTRY, { role: 'manager' }]), false); // no address
  assert.equal(await put([BOOT_ENTRY, { email: 42, role: 'manager' }]), false);
  assert.equal(await put([BOOT_ENTRY, { email: OWNER, role: 'owner' }]), false); // unknown role
  assert.equal(await put([BOOT_ENTRY, { email: OWNER }]), false);
  assert.equal(await put([BOOT_ENTRY, { email: '  ', role: 'manager' }]), false);
  assert.equal(await put([BOOT_ENTRY, { email: OWNER, role: 'manager' }, { email: OWNER.toUpperCase(), role: 'admin' }]), false); // same address twice
  assert.equal(await put([{ email: BOOT_ENTRY.email, role: 'manager' }, BOOT_ENTRY]), false); // bootstrap address twice
  assert.equal(await put([BOOT_ENTRY, { email: OWNER, role: 'manager', locked: true }]), false); // only the bootstrap admin is locked
  assert.equal(await put([BOOT_ENTRY, { email: OWNER, role: 'manager', locked: false }]), false);
  assert.equal(await can(ADMIN, 'PUT', 'config/roles', null), false);
  assert.equal(await can(ADMIN, 'PUT', 'config/roles'), false);
  // PATCH merges: without `entries` nothing about the list changes; with it the same rule applies
  assert.equal(await can(ADMIN, 'PATCH', 'config/roles', {}), true);
  assert.equal(await can(ADMIN, 'PATCH', 'config/roles', { entries: [] }), false);
  assert.equal(await can(ADMIN, 'PATCH', 'config/roles', { entries: [BOOT_ENTRY] }), true);
  assert.equal(await can(ADMIN, 'DELETE', 'config/roles'), false);
  // non-admins never write, whatever the body; reads are unchanged
  assert.equal(await can(OWNER, 'PUT', 'config/roles', { entries: [BOOT_ENTRY] }), false);
  assert.equal(await can(GUEST, 'GET', 'config/roles'), true);
  assert.equal(await can(null, 'GET', 'config/roles'), false);
});

test('config/roles: with no bootstrap admin configured any admin write is allowed', async () => {
  const r = (method, body) => authorize({ method, path: 'config/roles', body, session: { email: ADMIN }, rolesDoc, bootstrapAdminEmail: '', loadDoc, now: NOW });
  assert.equal(await r('PUT', { entries: [] }), true);
  assert.equal(await r('DELETE'), true);
});

test('config: roles are admin-only to write, app settings manager-only', async () => {
  assert.equal(await can(GUEST, 'GET', 'config/roles'), true);
  assert.equal(await can(OWNER, 'PUT', 'config/roles', {}), false);
  assert.equal(await can(ADMIN, 'PUT', 'config/roles', { entries: [BOOT_ENTRY] }), true);
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
  assert.equal(await can(OWNER, 'PUT', own, { uid: own.slice(4), email: OWNER }), true);
  assert.equal(await can(OWNER, 'PUT', own, {}), false); // a new document must say whose it is
  assert.equal(await can(OWNER, 'PATCH', own, {}), true);

  const theirs = await attPath(OTHER);
  assert.equal(await can(OWNER, 'GET', theirs), false);
  assert.equal(await can(OWNER, 'PATCH', theirs, {}), false);
  assert.equal(await can(OWNER, 'DELETE', theirs), false);
  assert.equal(await can(ADMIN, 'PATCH', theirs, {}), true);
  assert.equal(await can(ADMIN, 'GET', theirs), true);
});

test('att: an attendee touches only their own document', async () => {
  const guestPath = await attPath(GUEST);
  assert.equal(await can(GUEST, 'PUT', guestPath, { uid: guestPath.slice(4), email: GUEST }), true);
  assert.equal(await can(GUEST, 'GET', await attPath(OWNER)), false);
  assert.equal(await can(null, 'GET', await attPath(OWNER)), false);
  assert.equal(await can(OWNER, 'GET', `${await attPath(OWNER)}/nested`), false);
  assert.equal(await can(ADMIN, 'GET', `${await attPath(OWNER)}/nested`), false);
  assert.equal(await can(GUEST, 'GET', `${await attPath(GUEST)}x`), false); // own key plus a suffix is another key
});

test('att: own-key writes accept only valid check-in records, never DELETE', async () => {
  const day = Date.parse('2026-09-25T09:00:00Z'); // inside the event below, unlike the shared NOW
  const start = new Date(day).toISOString();
  const end = new Date(day + 3 * 3600e3).toISOString();
  const rec = (event, metres, at = NOW) => {
    const lat = event.lat + metres / 111195;
    const dist = Math.round(haversine(event.lat, event.lng, lat, event.lng) * 10) / 10;
    return { at: new Date(at).toISOString(), lat, lng: event.lng, acc: 10, dist, limit: judgeFix(event, dist, 10).limit };
  };
  for (const who of [GUEST, OWNER]) {
    const hash = await hashEmail(who);
    const event = { start, end, lat: 21, lng: 105.8, radius: 30, emailHashes: [hash] };
    const notInvited = { ...event, emailHashes: [await hashEmail(OTHER)] };
    const load = async (p) => ({ 'events/mine': event, 'events/theirs': notInvited })[p] ?? docs[p] ?? null;
    const go = (email, method, path, body) => authorize({
      method, path, body, session: { email }, rolesDoc, bootstrapAdminEmail: 'boot@tbd.edu.vn', loadDoc: load, now: NOW,
    });
    const own = await attPath(who);
    const good = rec(event, 10);
    assert.equal(await go(who, 'PUT', own, { uid: own.slice(4), email: who, name: 'N', records: { mine: good } }), true, who);
    assert.equal(await go(who, 'PATCH', own, { email: who, name: 'N', records: { mine: good } }), true, who);
    assert.equal(await go(who, 'GET', own), true, who);
    assert.equal(await go(who, 'PATCH', own, { records: { mine: { ...good, dist: 1 } } }), false, who); // forged distance
    assert.equal(await go(who, 'PATCH', own, { records: { mine: { ...good, extra: 1 } } }), false, who);
    assert.equal(await go(who, 'PATCH', own, { records: { theirs: rec(notInvited, 10) } }), false, who); // not invited
    assert.equal(await go(who, 'PATCH', own, { records: { none: good } }), false, who); // unknown event
    assert.equal(await go(who, 'PATCH', own, { email: OTHER, records: { mine: good } }), false, who);
    assert.equal(await go(who, 'DELETE', own), false, who);
    // History stored server-side cannot be dropped by a PUT nor altered by a PATCH.
    const withHistory = (p) => (p === own ? { uid: own.slice(4), records: { mine: good } } : load(p));
    const goH = (method, body) => authorize({ method, path: own, body, session: { email: who }, rolesDoc, bootstrapAdminEmail: 'boot@tbd.edu.vn', loadDoc: withHistory, now: NOW });
    assert.equal(await goH('PUT', { records: {} }), false, who);
    assert.equal(await goH('PATCH', { records: { mine: { ...good, dist: 1 } } }), false, who);
    assert.equal(await goH('PATCH', { records: { mine: good } }), true, who);
    assert.equal(await go(ADMIN, 'DELETE', own), true, 'admin may delete');
    assert.equal(await go(ADMIN, 'PUT', own, { anything: [1] }), true, 'admin may write anything');
    assert.equal(await go(ADMIN, 'PATCH', own, { records: { mine: { forged: true } } }), true);
  }
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

test('paths containing __proto__ are refused, even for an admin', async () => {
  for (const p of ['events/__proto__', 'roster/__proto__', 'att/__proto__', 'events/x/__proto__']) {
    assert.equal(await can(ADMIN, 'GET', p), false, p);
    assert.equal(await can(ADMIN, 'PUT', p, { createdBy: ADMIN }), false, p);
  }
});

test('a damaged roles document does not break authorization for everyone', async () => {
  const run = (rolesDoc, method, path, body) => authorize({
    method, path, body, session: { email: OWNER }, rolesDoc, bootstrapAdminEmail: 'boot@tbd.edu.vn', loadDoc, now: NOW,
  });
  for (const damaged of [
    { entries: [null, 'x', {}, { email: 5 }, [1], { email: OWNER, role: 'manager' }] },
    { entries: 'nope' },
    { entries: null },
    {},
  ]) {
    assert.equal(await run(damaged, 'GET', 'events/future'), true);
  }
  // A manager listed after the junk entries is still recognised as one (and owns the event).
  const junk = { entries: [null, 'x', {}, { email: OWNER, role: 'manager' }] };
  assert.equal(await run(junk, 'PATCH', 'events/future', { title: 'x' }), true);
  assert.equal(await run({ entries: [null] }, 'PATCH', 'events/future', { title: 'x' }), false);
});
