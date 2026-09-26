// Path-based access rules for the generic document API. Applied on every request so
// permissions hold even when called directly (curl, a modified client), not just when
// the React UI happens to hide a button.
//
// events/<id>  An event belongs to the manager named in its `createdBy`. That manager may replace
//              it only before it starts, and afterwards may only adjust QUICK_FIELDS. Admins may
//              edit or delete any event; a new event is always created under its creator's own email.
// roster/<id>  The plaintext invite list: its event's creator or an admin only.
// att/<key>    Attendance, one document per attendee: touched only by that attendee (or an admin).
//              Their own document accepts only valid, immutable check-in records (see checkin.js).
//              Managers read the whole list, which the route narrows to their own events.
// Keep canEditEvent in src/lib/auth.ts in sync with the events rules.
import { attendanceWriteAllowed } from './checkin.js';
import { attKeyOf, computeRole, hashEmail, normalizeEmail } from './roles.js';

const QUICK_FIELDS = new Set(['window', 'tolerance']);

function isOwner(eventDoc, email) {
  return !!eventDoc?.createdBy && !!email && normalizeEmail(eventDoc.createdBy) === normalizeEmail(email);
}

// An unparseable start compares false, i.e. counts as already started — the restrictive answer.
function notStarted(eventDoc, now) {
  return now < Date.parse(eventDoc.start);
}

/**
 * A roles list every reader survives and that keeps the bootstrap admin: plain objects with a string email and a
 * known role, no address twice, and `locked` only on the bootstrap entry, which must be an admin.
 * (One junk entry would make every request throw in computeRole, and the server could no longer start.)
 */
function rolesListValid(entries, bootstrapEmail) {
  if (!Array.isArray(entries)) return false;
  const boot = normalizeEmail(bootstrapEmail);
  const seen = new Set();
  let bootOk = false;
  for (const e of entries) {
    if (!e || typeof e !== 'object' || Array.isArray(e) || typeof e.email !== 'string') return false;
    if (e.role !== 'admin' && e.role !== 'manager') return false;
    const addr = normalizeEmail(e.email);
    if (!addr || seen.has(addr)) return false;
    seen.add(addr);
    if (addr === boot) bootOk = e.role === 'admin' && e.locked === true;
    else if ('locked' in e) return false;
  }
  return bootOk;
}

export async function authorize({ method, path, session, rolesDoc, bootstrapAdminEmail, body, loadDoc, now = Date.now() }) {
  if (!['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'].includes(method)) return false;
  const isWrite = method !== 'GET' && method !== 'HEAD'; // HEAD is served by the GET handler, so it is a read
  const email = normalizeEmail(session?.email) || null;
  const signedIn = !!email;
  const { isAdmin, isManager } = computeRole(rolesDoc, session?.email, bootstrapAdminEmail);
  const segs = path.split('/');
  // Empty segments (events/, events//x) are never valid ids; neither is __proto__, which the deep merge in db.js would drop.
  if (segs.includes('') || segs.includes('__proto__')) return false;

  if (path === 'config/roles') {
    if (!isWrite) return signedIn;
    if (!isAdmin) return false;
    // The bootstrap admin is the escape hatch: no write may remove, demote or unlock its entry (index.js seeds it locked).
    if (!bootstrapAdminEmail) return true;
    if (method === 'DELETE') return false;
    const b = body && typeof body === 'object' ? body : {};
    if (method === 'PATCH' && !('entries' in b)) return true; // nothing about the entries changes
    return rolesListValid(b.entries, bootstrapAdminEmail);
  }
  if (path === 'config/app') return isWrite ? isManager : signedIn;

  if (segs[0] === 'events') {
    if (!isWrite) return signedIn;
    if (!isManager || segs.length === 1) return false;
    if (segs.length > 2) return isAdmin;

    const existing = await loadDoc(path);
    const b = body && typeof body === 'object' ? body : {};
    const claimsSelf = typeof b.createdBy === 'string' && normalizeEmail(b.createdBy) === email;
    if (method === 'PUT') {
      if (!existing) return claimsSelf; // creating: only as yourself
      if (isAdmin) return true;
      return isOwner(existing, email) && notStarted(existing, now) && claimsSelf;
    }
    if (method === 'PATCH') {
      if (isAdmin) return true; // a missing doc is answered with 404 by the route
      if (!isOwner(existing, email) || 'createdBy' in b) return false;
      return notStarted(existing, now) || Object.keys(b).every((k) => QUICK_FIELDS.has(k));
    }
    if (method === 'DELETE') return isAdmin || isOwner(existing, email);
    return false;
  }

  // Plaintext invite list — only the event's creator or an admin may read it (see the comment in src/lib/auth.ts).
  if (segs[0] === 'roster') {
    if (!isManager || segs.length !== 2) return false;
    if (isAdmin) return true;
    const event = await loadDoc(`events/${segs[1]}`);
    if (!isWrite) return isOwner(event, email);
    // No events/<id>: either mid-create (the form saves the roster first) or already deleted. Any manager may write; only an admin may read.
    return !event || (isOwner(event, email) && notStarted(event, now));
  }

  if (segs[0] === 'att') {
    if (segs.length === 1) return !isWrite && isManager; // full list: managers only, narrowed per manager by the route
    if (segs.length !== 2 || !signedIn) return false;
    if (isAdmin) return true;
    // Everyone else, managers included, may only touch their own record.
    const emailHash = await hashEmail(email);
    const key = attKeyOf(emailHash);
    if (path !== `att/${key}`) return false;
    if (!isWrite) return true;
    return attendanceWriteAllowed({
      method, key, existing: await loadDoc(path), body: body && typeof body === 'object' ? body : {}, email, emailHash, now, loadDoc,
    });
  }

  return false;
}
