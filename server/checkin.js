// Server-side mirror of the check-in rules, so an attendee's own document att/<key> can only
// ever hold check-ins the client itself would have produced: for an event they were invited to,
// inside its check-in window, within its geofence, and never rewritten afterwards.
// Keep in sync with src/lib/domain.ts (judgeFix, haversine, checkinEndMs, toleranceOf)
import { normalizeEmail } from './roles.js';

// How far a record's own timestamp may drift from the server clock (phones are often a few minutes off).
export const CLOCK_SKEW_MS = 10 * 60e3;

const DEFAULT_TOLERANCE = 50;
const MAX_TOLERANCE = 80;
// The client checks the deadline just before sending, so network latency (or a phone clock a few seconds
// off) must not turn a check-in at the very edge of the window into a 403.
export const WINDOW_GRACE_MS = 30e3;

// dist is rounded to 0.1 m by the client; allow a metre for float and rounding differences.
const DIST_SLACK_M = 1;
const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REC_KEYS = ['at', 'lat', 'lng', 'acc', 'dist', 'limit'];
const REQUIRED_REC_KEYS = ['at', 'lat', 'lng', 'acc', 'dist'];
const BODY_KEYS = new Set(['uid', 'email', 'name', 'records']);
const MAX_NAME_LENGTH = 200;

export const isPlainObject = (x) => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function haversine(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

export const toleranceOf = (ev) => Math.min(MAX_TOLERANCE, Math.max(0, ev.tolerance ?? DEFAULT_TOLERANCE));

/** A fix is "in the room" when dist <= radius + min(accuracy, tolerance). */
export function judgeFix(ev, dist, acc) {
  const credit = Math.min(Math.max(0, acc), toleranceOf(ev));
  const limit = Math.round(ev.radius + credit);
  return { ok: dist <= limit, limit };
}

export function checkinEndMs(ev) {
  const end = Date.parse(ev.end);
  return ev.window ? Math.min(end, Date.parse(ev.start) + ev.window * 60e3) : end;
}

/** Deep equality independent of object key order (Postgres jsonb reorders keys). */
export function sameJson(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && sameJson(a[k], b[k]));
  }
  return a === b;
}

/** Would the client have been allowed to write this check-in record for this attendee, right now? */
export function recordAllowed({ event, rec, emailHash, now }) {
  if (!isPlainObject(event) || !Array.isArray(event.emailHashes) || !event.emailHashes.includes(emailHash)) return false;
  if (typeof event.start !== 'string' || typeof event.end !== 'string') return false; // Date.parse would coerce numbers
  const start = Date.parse(event.start);
  const end = checkinEndMs(event);
  if (!Number.isFinite(start) || !Number.isFinite(Date.parse(event.end)) || !Number.isFinite(end)) return false;
  if (now < start - WINDOW_GRACE_MS || now > end + WINDOW_GRACE_MS) return false;
  if (!isNum(event.lat) || !isNum(event.lng) || !isNum(event.radius)) return false;

  if (!isPlainObject(rec)) return false;
  const keys = Object.keys(rec);
  if (!keys.every((k) => REC_KEYS.includes(k)) || !REQUIRED_REC_KEYS.every((k) => keys.includes(k))) return false;
  // Exactly what the client sends (Date#toISOString): Date.parse alone accepts free-form strings that would be stored verbatim.
  if (typeof rec.at !== 'string' || !ISO_AT.test(rec.at)) return false;
  const at = Date.parse(rec.at);
  if (!Number.isFinite(at) || Math.abs(at - now) > CLOCK_SKEW_MS) return false;
  if (at < start - WINDOW_GRACE_MS || at > end + WINDOW_GRACE_MS) return false; // the client only checks in inside the window
  const { lat, lng, acc, dist } = rec;
  if (![lat, lng, acc, dist].every(isNum)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || acc < 0 || dist < 0) return false;

  // Trust the coordinates, not the claimed distance.
  const computed = haversine(event.lat, event.lng, lat, lng);
  if (Math.abs(computed - dist) > DIST_SLACK_M) return false;
  const verdict = judgeFix(event, computed, acc);
  if (!verdict.ok) return false;
  // The client derives `limit` from the unrounded accuracy, so with a fractional radius it can differ from ours by 1.
  return !('limit' in rec) || (isNum(rec.limit) && Math.abs(rec.limit - verdict.limit) <= 1);
}

/**
 * May a non-admin write this body to their own att/<key> document?
 * `existing` is the stored document (or null); `loadDoc(path)` returns a document's data or null.
 * Existing records are immutable: a write may add records for new events but never drop or change one.
 */
export async function attendanceWriteAllowed({ method, key, existing, body, email, emailHash, now, loadDoc }) {
  if (method !== 'PUT' && method !== 'PATCH') return false; // includes DELETE: nobody erases their own history
  if (!isPlainObject(body) || !Object.keys(body).every((k) => BODY_KEYS.has(k))) return false;
  if ('uid' in body && body.uid !== key) return false;
  if ('email' in body && (typeof body.email !== 'string' || normalizeEmail(body.email) !== email)) return false;
  // A new document must say whose it is (the manager's list is matched on these).
  if (method === 'PUT' && (body.uid !== key || !('email' in body))) return false;
  if ('name' in body && (typeof body.name !== 'string' || body.name.length > MAX_NAME_LENGTH)) return false;
  if ('records' in body && !isPlainObject(body.records)) return false;

  const stored = isPlainObject(existing?.records) ? existing.records : {};
  const sent = body.records ?? {};
  for (const [id, old] of Object.entries(stored)) {
    // PUT replaces the document, so a stored record must be re-sent; PATCH keeps what is not mentioned.
    if (Object.hasOwn(sent, id) ? !sameJson(sent[id], old) : method === 'PUT') return false;
  }
  for (const [id, rec] of Object.entries(sent)) {
    if (Object.hasOwn(stored, id)) continue;
    if (!/^[^/]+$/.test(id)) return false;
    const event = await loadDoc(`events/${id}`);
    if (!recordAllowed({ event, rec, emailHash, now })) return false;
  }
  return true;
}
