// Path-based access rules for the generic document API. Applied on every request so
// permissions hold even when called directly (curl, a modified client), not just when
// the React UI happens to hide a button.
//
// An event belongs to the manager whose email is in its `createdBy`. Admins may do anything
// to any event except create one in someone else's name; the owner may replace it only before it starts, and afterwards may still
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
  if (segs.includes('')) return false; // empty segments (events/, events//x) are never valid ids

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
        && normalizeEmail(b.createdBy) === email;
    }
    if (method === 'PATCH') {
      if (isAdmin) return true; // a missing doc is answered with 404 by the route
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
