// Server-side mirror of the role logic in src/lib/auth.ts's resolveSession — kept as
// the enforcement layer so write access can't be bypassed by calling the API directly.
// Keep this in sync with auth.ts if that logic ever changes.

export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

export async function hashEmail(email) {
  const norm = normalizeEmail(email);
  if (!norm) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(norm));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function attKeyOf(hash) {
  return `e${hash.slice(0, 32)}`;
}

function findRole(rolesDoc, email) {
  if (!email) return null;
  const norm = normalizeEmail(email);
  return rolesDoc?.entries?.find((e) => normalizeEmail(e.email) === norm) ?? null;
}

/**
 * `bootstrapAdminEmail` plays the role claude.ai's artifact-owner address plays in
 * resolveSession: always admin, a fixed escape hatch independent of the roles doc
 * (in case it's ever emptied out). Every other admin/manager comes from the roles doc.
 */
export function computeRole(rolesDoc, email, bootstrapAdminEmail) {
  const norm = email ? normalizeEmail(email) : null;
  const entry = findRole(rolesDoc, norm);
  const isBootstrap = !!norm && !!bootstrapAdminEmail && normalizeEmail(bootstrapAdminEmail) === norm;
  const isAdmin = isBootstrap || (!!norm && entry?.role === 'admin');
  const isManager = isAdmin || (!!norm && entry?.role === 'manager');
  return { isAdmin, isManager };
}
