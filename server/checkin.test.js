import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOCK_SKEW_MS, WINDOW_GRACE_MS, attendanceWriteAllowed, checkinEndMs, haversine, isPlainObject, judgeFix, recordAllowed, sameJson, toleranceOf } from './checkin.js';
import { attKeyOf, hashEmail } from './roles.js';

const START = Date.parse('2026-09-25T10:00:00.000Z');
const END = Date.parse('2026-09-25T12:00:00.000Z');
const NOW = START + 30 * 60e3;
const iso = (ms) => new Date(ms).toISOString();
const H = 'a'.repeat(64);

// A copy of `obj` without one key (keeps the tests free of unused destructured variables).
const without = (obj, key) => Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));
const ev = (over = {}) => ({ emailHashes: [H, 'b'.repeat(64)], start: iso(START), end: iso(END), lat: 21.0, lng: 105.8, radius: 30, ...over });
// A record `metres` north of the event, built the way CheckinView.checkIn builds it.
function recAt(event, metres, acc = 10, now = NOW) {
  const lat = event.lat + metres / 111195;
  const dist = Math.round(haversine(event.lat, event.lng, lat, event.lng) * 10) / 10;
  return { at: iso(now), lat, lng: event.lng, acc, dist, limit: judgeFix(event, dist, acc).limit };
}
const ok = (event, rec, over = {}) => recordAllowed({ event, rec, emailHash: H, now: NOW, ...over });

test('haversine: zero distance, known distance, symmetric', () => {
  assert.equal(haversine(21, 105.8, 21, 105.8), 0);
  const d = haversine(0, 0, 0, 1); // one degree of longitude on the equator
  assert.ok(Math.abs(d - 111194.9266) < 0.01);
  assert.equal(haversine(1, 2, 3, 4), haversine(3, 4, 1, 2));
});

test('toleranceOf: default 50, clamped to 0..80', () => {
  assert.equal(toleranceOf({}), 50);
  assert.equal(toleranceOf({ tolerance: 0 }), 0);
  assert.equal(toleranceOf({ tolerance: 65 }), 65);
  assert.equal(toleranceOf({ tolerance: 500 }), 80);
  assert.equal(toleranceOf({ tolerance: -5 }), 0);
});

test('judgeFix: credit is min(acc, tolerance), limit rounded, boundary inclusive', () => {
  assert.deepEqual(judgeFix({ radius: 30 }, 40, 10), { ok: true, limit: 40 });
  assert.deepEqual(judgeFix({ radius: 30 }, 40.1, 10), { ok: false, limit: 40 });
  assert.equal(judgeFix({ radius: 30 }, 0, 500).limit, 80); // credit capped at the default 50
  assert.equal(judgeFix({ radius: 30, tolerance: 20 }, 0, 500).limit, 50);
  assert.equal(judgeFix({ radius: 30 }, 0, -7).limit, 30); // negative acc gives no credit
  assert.equal(judgeFix({ radius: 30.4 }, 0, 0.2).limit, 31); // rounded
});

test('checkinEndMs: whole meeting, shorter window, longer window', () => {
  assert.equal(checkinEndMs(ev()), END);
  assert.equal(checkinEndMs(ev({ window: 0 })), END);
  assert.equal(checkinEndMs(ev({ window: 15 })), START + 15 * 60e3);
  assert.equal(checkinEndMs(ev({ window: 500 })), END);
});

test('sameJson ignores key order but not values, types or array order', () => {
  assert.equal(sameJson({ a: 1, b: { c: [1, 2], d: 'x' } }, { b: { d: 'x', c: [1, 2] }, a: 1 }), true);
  assert.equal(sameJson({ a: 1 }, { a: 2 }), false);
  assert.equal(sameJson({ a: 1 }, { a: 1, b: 1 }), false);
  assert.equal(sameJson({ a: 1, b: 1 }, { a: 1 }), false);
  assert.equal(sameJson([1, 2], [2, 1]), false);
  assert.equal(sameJson([1], { 0: 1 }), false);
  assert.equal(sameJson(1, '1'), false);
  assert.equal(sameJson(null, {}), false);
  assert.equal(sameJson({}, null), false);
  assert.equal(sameJson(null, null), true);
  assert.equal(sameJson([1], [1, 2]), false);
  assert.equal(sameJson({ a: undefined }, { b: 1 }), false);
});

test('isPlainObject', () => {
  assert.equal(isPlainObject({}), true);
  for (const x of [null, [], 'x', 1, undefined]) assert.equal(isPlainObject(x), false);
});

test('CLOCK_SKEW_MS is ten minutes', () => assert.equal(CLOCK_SKEW_MS, 600000));

test('recordAllowed: a client-shaped record is accepted', () => {
  assert.equal(ok(ev(), recAt(ev(), 12)), true);
  const noLimit = without(recAt(ev(), 12), 'limit');
  assert.equal(ok(ev(), noLimit), true); // limit is optional
});

test('recordAllowed: invitation', () => {
  assert.equal(ok(ev(), recAt(ev(), 5), { emailHash: 'c'.repeat(64) }), false);
  assert.equal(ok(ev({ emailHashes: [] }), recAt(ev(), 5)), false);
  const bare = without(ev(), 'emailHashes');
  assert.equal(ok(bare, recAt(ev(), 5)), false);
  assert.equal(ok(ev({ emailHashes: H }), recAt(ev(), 5)), false); // not an array
  assert.equal(ok(null, recAt(ev(), 5)), false);
  assert.equal(ok([], recAt(ev(), 5)), false);
  assert.equal(ok('x', recAt(ev(), 5)), false);
});

test('recordAllowed: time window', () => {
  const e = ev();
  const G = WINDOW_GRACE_MS;
  assert.equal(ok(e, recAt(e, 5, 10, START - G - 1), { now: START - G - 1 }), false); // before start, beyond the grace
  assert.equal(ok(e, recAt(e, 5, 10, START - G), { now: START - G }), true); // last instant of the start grace
  assert.equal(ok(e, recAt(e, 5, 10, START), { now: START }), true); // exactly at start
  assert.equal(ok(e, recAt(e, 5, 10, END), { now: END }), true); // exactly at the end
  assert.equal(ok(e, recAt(e, 5, 10, END + G), { now: END + G }), true); // last instant of the end grace
  assert.equal(ok(e, recAt(e, 5, 10, END + G + 1), { now: END + G + 1 }), false);
  const w = ev({ window: 15 });
  const wEnd = START + 15 * 60e3;
  assert.equal(ok(w, recAt(w, 5, 10, wEnd), { now: wEnd }), true);
  assert.equal(ok(w, recAt(w, 5, 10, wEnd + G), { now: wEnd + G }), true);
  assert.equal(ok(w, recAt(w, 5, 10, wEnd + G + 1), { now: wEnd + G + 1 }), false); // after the window, inside the meeting
});

test('recordAllowed: malformed event dates or geometry', () => {
  for (const bad of [{ start: 'nope' }, { end: 'nope' }, { start: undefined }, { end: undefined }, { start: 5 }, { end: null }]) {
    assert.equal(ok(ev(bad), recAt(ev(), 5)), false, JSON.stringify(bad));
  }
  for (const bad of [{ lat: '21' }, { lng: NaN }, { radius: Infinity }, { radius: undefined }, { lat: undefined }, { lng: undefined }, { radius: '30' }]) {
    assert.equal(ok(ev(bad), recAt(ev(), 5)), false, JSON.stringify(bad));
  }
});

test('recordAllowed: rec must be a plain object with exactly the known keys', () => {
  const e = ev();
  const r = recAt(e, 5);
  for (const bad of [null, [], 'x', 5, undefined]) assert.equal(ok(e, bad), false);
  assert.equal(ok(e, { ...r, extra: 1 }), false);
  for (const k of ['at', 'lat', 'lng', 'acc', 'dist']) {
    const { [k]: _, ...rest } = r;
    assert.equal(ok(e, rest), false, `missing ${k}`);
  }
});

test('recordAllowed: at must be a recent ISO string', () => {
  const e = ev();
  const r = recAt(e, 5);
  assert.equal(ok(e, { ...r, at: iso(NOW + 9 * 60e3) }), true);
  assert.equal(ok(e, { ...r, at: iso(NOW - 9 * 60e3) }), true);
  assert.equal(ok(e, { ...r, at: iso(NOW + CLOCK_SKEW_MS) }), true);
  assert.equal(ok(e, { ...r, at: iso(NOW - CLOCK_SKEW_MS) }), true);
  assert.equal(ok(e, { ...r, at: iso(NOW + CLOCK_SKEW_MS + 1) }), false);
  assert.equal(ok(e, { ...r, at: iso(NOW - CLOCK_SKEW_MS - 1) }), false);
  assert.equal(ok(e, { ...r, at: iso(NOW + 11 * 60e3) }), false);
  assert.equal(ok(e, { ...r, at: iso(NOW - 11 * 60e3) }), false);
  assert.equal(ok(e, { ...r, at: NOW }), false);
  assert.equal(ok(e, { ...r, at: 'garbage' }), false);
  assert.equal(ok(e, { ...r, at: null }), false);
  assert.equal(ok(e, { ...r, at: [iso(NOW)] }), false); // an array would coerce to a parseable string
});

test('recordAllowed: numbers must be finite numbers in range', () => {
  const e = ev();
  const r = recAt(e, 5);
  for (const k of ['lat', 'lng', 'acc', 'dist']) {
    for (const bad of [NaN, Infinity, -Infinity, String(r[k]), null]) {
      assert.equal(ok(e, { ...r, [k]: bad }), false, `${k}=${bad}`);
    }
  }
  const bare = without(r, 'limit');
  assert.equal(ok(ev({ radius: '30' }), bare), false);
  assert.equal(ok(ev({ radius: Infinity }), bare), false);
  const far = ev({ lat: 89.9999, lng: 179.9999 });
  assert.equal(ok(far, { ...recAt(far, 0), lat: 91 }), false);
  assert.equal(ok(far, { ...recAt(far, 0), lat: -91 }), false);
  assert.equal(ok(far, { ...recAt(far, 0), lng: 181 }), false);
  assert.equal(ok(far, { ...recAt(far, 0), lng: -181 }), false);
  // Out-of-range coordinates whose claimed distance is honest: only the range check stops them.
  const overLat = ev({ lat: 89.9999, lng: 10 }), overLng = ev({ lat: 0, lng: 179.9999 }), underLng = ev({ lat: 0, lng: -179.9999 });
  for (const [event, lat, lng] of [[overLat, 90.0001, 10], [overLng, 0, 180.0001], [underLng, 0, -180.0001]]) {
    const dist = haversine(event.lat, event.lng, lat, lng);
    assert.ok(dist < 30);
    assert.equal(ok(event, { at: iso(NOW), lat, lng, acc: 0, dist }), false, String([lat, lng]));
  }
  const underLat = ev({ lat: -89.9999, lng: 10 });
  assert.equal(ok(underLat, { at: iso(NOW), lat: -90.0001, lng: 10, acc: 0, dist: haversine(-89.9999, 10, -90.0001, 10) }), false);
  const edge = ev({ lat: 90, lng: 180 });
  assert.equal(ok(edge, { at: iso(NOW), lat: 90, lng: 180, acc: 0, dist: 0 }), true); // bounds inclusive
  const edge2 = ev({ lat: -90, lng: -180 });
  assert.equal(ok(edge2, { at: iso(NOW), lat: -90, lng: -180, acc: 0, dist: 0 }), true);
  assert.equal(ok(e, { ...r, acc: -1, limit: undefined }), false);
  const noLimit = without(r, 'limit');
  assert.equal(ok(e, { ...noLimit, acc: -1 }), false);
  assert.equal(ok(e, { ...noLimit, acc: 0 }), true);
  assert.equal(ok(e, { ...noLimit, dist: -r.dist }), false);
  assert.equal(ok(e, { at: iso(NOW), lat: e.lat, lng: e.lng, acc: 0, dist: -0.5 }), false); // within the 1 m slack of 0, still negative
});

test('recordAllowed: dist must match the recomputed distance within 1 m', () => {
  const e = ev();
  const r = without(recAt(e, 12), 'limit');
  assert.equal(ok(e, { ...r, dist: r.dist + 0.5 }), true);
  assert.equal(ok(e, { ...r, dist: r.dist - 0.5 }), true);
  assert.equal(ok(e, { ...r, dist: r.dist + 2 }), false);
  assert.equal(ok(e, { ...r, dist: r.dist - 2 }), false);
  assert.equal(ok(e, { ...r, dist: r.dist + 0.99 }), true);
  assert.equal(ok(e, { ...r, dist: r.dist - 0.99 }), true);
  assert.equal(ok(e, { ...r, dist: r.dist + 1.05 }), false);
  // A record claiming to be in the room while the coordinates say otherwise.
  assert.equal(ok(e, { ...recAt(e, 500), dist: 5 }), false);
});

test('recordAllowed: geofence uses radius plus min(acc, tolerance)', () => {
  const e = ev(); // radius 30, tolerance 50
  assert.equal(ok(e, recAt(e, 20, 0)), true);
  assert.equal(ok(e, recAt(e, 45, 0)), false); // outside radius, no accuracy credit
  assert.equal(ok(e, recAt(e, 45, 20)), true); // inside radius + acc
  assert.equal(ok(e, recAt(e, 70, 500)), true); // credit capped at 50 -> limit 80
  assert.equal(ok(e, recAt(e, 90, 500)), false); // outside limit
  // The verdict rests on the recomputed distance, not the claimed one (which may be up to 1 m kinder).
  const g = ev({ radius: 30, tolerance: 10 }); // acc 10 -> limit 40
  const glat = g.lat + 40.6 / 111195;
  const gd = haversine(g.lat, g.lng, glat, g.lng);
  assert.ok(gd > 40 && gd < 40.9);
  assert.equal(ok(g, { at: iso(NOW), lat: glat, lng: g.lng, acc: 10, dist: gd - 0.7 }), false);
  assert.equal(ok(g, { at: iso(NOW), lat: glat, lng: g.lng, acc: 10, dist: gd }), false);
  const t = ev({ tolerance: 10 });
  assert.equal(ok(t, recAt(t, 55, 500)), false); // limit only 40
});

test('recordAllowed: limit, when present, must be within 1 of the computed limit', () => {
  const e = ev();
  const r = recAt(e, 20, 10);
  assert.equal(ok(e, r), true);
  assert.equal(ok(e, { ...r, limit: r.limit + 1 }), true); // a fractional radius can shift it by 1
  assert.equal(ok(e, { ...r, limit: r.limit - 1 }), true);
  assert.equal(ok(e, { ...r, limit: r.limit + 2 }), false);
  assert.equal(ok(e, { ...r, limit: r.limit - 2 }), false);
  assert.equal(ok(e, { ...r, limit: String(r.limit) }), false);
  assert.equal(ok(e, { ...r, limit: null }), false);
});

// ---- attendanceWriteAllowed ----

const EMAIL = 'guest@tbd.edu.vn';
const HASH = await hashEmail(EMAIL);
const KEY = attKeyOf(HASH);
const E1 = ev({ emailHashes: [HASH] });
const E2 = ev({ emailHashes: [HASH], lat: 21.1 });
const docs = { 'events/e1': E1, 'events/e2': E2 };
const loadDoc = async (p) => docs[p] ?? null;
const R1 = recAt(E1, 10);
const R2 = recAt(E2, 10);

const write = (method, body, existing = null, over = {}) => attendanceWriteAllowed({
  method, key: KEY, existing, body, email: EMAIL, emailHash: HASH, now: NOW, loadDoc, ...over,
});
const stored = { uid: KEY, email: EMAIL, name: 'G', records: { e1: R1 } };
const own = { uid: KEY, email: EMAIL }; // what a PUT must always carry
// Same record with its keys in another order, as jsonb hands it back.
const reordered = { records: { e1: Object.fromEntries(Object.entries(R1).reverse()) }, name: 'G', email: EMAIL, uid: KEY };

test('attendance: DELETE is denied, other methods too', async () => {
  assert.equal(await write('DELETE', undefined, stored), false);
  assert.equal(await write('DELETE', {}, null), false);
  assert.equal(await write('POST', { records: {} }), false);
  assert.equal(await write('GET', {}), false);
});

test('attendance: first PUT with a valid record', async () => {
  assert.equal(await write('PUT', { uid: KEY, email: EMAIL, name: 'G', records: { e1: R1 } }), true);
  assert.equal(await write('PUT', { records: { e1: R1 } }), false); // a new document must say whose it is
  assert.equal(await write('PUT', { uid: KEY, records: { e1: R1 } }), false);
  assert.equal(await write('PUT', { email: EMAIL, records: { e1: R1 } }), false);
  assert.equal(await write('PUT', { uid: KEY, email: 42, records: { e1: R1 } }), false); // email must be a string
  assert.equal(await write('PUT', { uid: KEY, email: [EMAIL], records: { e1: R1 } }), false);
});

test('attendance: PATCH adds a second event, keeps the first', async () => {
  assert.equal(await write('PATCH', { email: EMAIL, name: 'G', records: { e2: R2 } }, stored), true);
});

test('attendance: PATCH re-sending an identical record is fine, changing it is not', async () => {
  assert.equal(await write('PATCH', { records: { e1: R1 } }, stored), true);
  assert.equal(await write('PATCH', { records: { e1: R1 } }, reordered), true); // key order irrelevant
  assert.equal(await write('PATCH', { records: { e1: { ...R1, at: iso(NOW + 1000) } } }, stored), false);
  assert.equal(await write('PATCH', { records: { e1: { ...R1, extra: 1 } } }, stored), false);
  assert.equal(await write('PATCH', { records: { e1: recAt(E1, 11) } }, stored), false);
});

test('attendance: PUT may not drop or alter history', async () => {
  assert.equal(await write('PUT', { ...own, records: { e1: R1, e2: R2 } }, stored), true);
  assert.equal(await write('PUT', { ...own, records: { e1: R1 } }, reordered), true);
  assert.equal(await write('PUT', { ...own, records: { e2: R2 } }, stored), false); // omits e1
  assert.equal(await write('PUT', { ...own, name: 'G' }, stored), false); // no records at all
  assert.equal(await write('PUT', { ...own, records: { e1: { ...R1, dist: 0 }, e2: R2 } }, stored), false);
});

test('attendance: an old record is kept even if its event is gone; junk stored records count as none', async () => {
  const gone = { ...stored, records: { ghost: R1 } };
  assert.equal(await write('PUT', { ...own, records: { ghost: R1, e2: R2 } }, gone), true);
  assert.equal(await write('PATCH', { records: { ghost: R1 } }, gone), true);
  assert.equal(await write('PUT', { ...own, records: { e1: R1 } }, { records: 'junk' }), true);
  assert.equal(await write('PUT', { ...own, records: { e1: R1 } }, { records: [R1] }), true);
});

test('attendance: empty bodies', async () => {
  assert.equal(await write('PUT', {}), false); // a new document must say whose it is
  assert.equal(await write('PUT', own), true);
  assert.equal(await write('PATCH', {}), true);
  assert.equal(await write('PATCH', {}, stored), true);
  assert.equal(await write('PATCH', { records: {} }, stored), true);
  assert.equal(await write('PUT', { ...own, records: {} }), true);
  assert.equal(await write('PUT', own, stored), false); // would erase e1
  assert.equal(await write('PUT', { ...own, records: {} }, stored), false);
});

test('attendance: uid must equal the key', async () => {
  assert.equal(await write('PATCH', { uid: 'eother' }), false);
  assert.equal(await write('PATCH', { uid: 5 }), false);
  assert.equal(await write('PATCH', { uid: KEY }), true);
});

test('attendance: email must be the caller, in any case', async () => {
  assert.equal(await write('PATCH', { email: 'someone@tbd.edu.vn' }), false);
  assert.equal(await write('PATCH', { email: '' }), false);
  assert.equal(await write('PATCH', { email: EMAIL.toUpperCase() }), true);
  assert.equal(await write('PATCH', { email: ` ${EMAIL} ` }), true);
});

test('attendance: name must be a string of at most 200 characters', async () => {
  assert.equal(await write('PATCH', { name: 'x'.repeat(200) }), true);
  assert.equal(await write('PATCH', { name: 'x'.repeat(201) }), false);
  assert.equal(await write('PATCH', { name: '' }), true);
  for (const bad of [5, null, ['a'], { a: 1 }]) assert.equal(await write('PATCH', { name: bad }), false);
});

test('attendance: unknown top-level keys and bad shapes are refused', async () => {
  assert.equal(await write('PATCH', { admin: true }), false);
  assert.equal(await write('PATCH', { records: {}, extra: 1 }), false);
  for (const bad of [[], 'x', 5, null]) {
    assert.equal(await write('PATCH', { records: bad }), false);
    assert.equal(await write('PUT', { records: bad }), false);
  }
  for (const body of [null, undefined, [], 'x', 5]) {
    assert.equal(await write('PUT', body), false);
    assert.equal(await write('PATCH', body), false);
  }
});

test('attendance: new record ids must be plain ids of known, valid events', async () => {
  assert.equal(await write('PATCH', { records: { nope: R1 } }), false); // unknown event
  assert.equal(await write('PATCH', { records: { 'e1/x': R1 } }), false);
  assert.equal(await write('PATCH', { records: { 'e1/x': R1 } }, null, { loadDoc: async () => E1 }), false); // even if such a path resolved
  assert.equal(await write('PATCH', { records: { nope: { at: iso(NOW), lat: E1.lat, lng: E1.lng, acc: 0, dist: 0 } } }), false);
  assert.equal(await write('PATCH', { records: { '': R1 } }), false);
  assert.equal(await write('PATCH', { records: { e1: { ...R1, dist: 999 } } }), false);
  assert.equal(await write('PATCH', { records: { e1: R1, e2: { ...R2, extra: 1 } } }), false); // one bad record sinks the write
});

test('attendance: the caller must be invited and inside the time window', async () => {
  assert.equal(await write('PATCH', { records: { e1: R1 } }, null, { emailHash: 'c'.repeat(64) }), false);
  const late = END + 20 * 60e3;
  assert.equal(await write('PATCH', { records: { e1: recAt(E1, 10, 10, late) } }, null, { now: late }), false);
});

test('attendance: loadDoc is only asked for events of NEW records', async () => {
  const asked = [];
  const spy = async (p) => { asked.push(p); return docs[p] ?? null; };
  await write('PATCH', { records: { e1: R1, e2: R2 } }, stored, { loadDoc: spy });
  assert.deepEqual(asked, ['events/e2']);
});

test('recordAllowed: at must be an ISO timestamp inside the check-in window', () => {
  const e = ev({ window: 15 });
  const inside = START + 60e3;
  const base = recAt(e, 5, 10, inside);
  assert.equal(ok(e, base, { now: inside }), true);
  // Free-form strings that Date.parse accepts would be stored verbatim, so only Date#toISOString output is allowed.
  for (const at of ['Sep 25 2026 09:10:00 GMT', '2026', '9/25/2026 9:10 UTC', new Date(inside).toISOString().replace('Z', '+00:00'), ` ${new Date(inside).toISOString()}`, 12345, null]) {
    assert.equal(ok(e, { ...base, at }, { now: inside }), false, String(at));
  }
  const G = WINDOW_GRACE_MS;
  const stamp = (ms) => new Date(ms).toISOString();
  // Inside the skew of "now" but before the event started (a back-dated record): refused.
  assert.equal(ok(e, { ...base, at: stamp(START - G - 1) }, { now: START + 1000 }), false);
  assert.equal(ok(e, { ...base, at: stamp(START - G) }, { now: START + 1000 }), true);
  // ...and after the window closed.
  const wEnd = START + 15 * 60e3;
  assert.equal(ok(e, { ...base, at: stamp(wEnd + G + 1) }, { now: wEnd + G }), false);
  assert.equal(ok(e, { ...base, at: stamp(wEnd + G) }, { now: wEnd + G }), true);
});
