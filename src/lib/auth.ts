// Identity, roles and email-based eligibility.
//
// The app has three roles:
//   admin    — the artifact owner, plus any email granted 'admin'. Can appoint managers.
//   manager  — can create events and issue QR cards.
//   attendee — must sign in; check-in is accepted only when the signed-in email
//              is on the event's invite list.
//
// Attendees are matched by a SHA-256 hash of their email rather than by the
// plaintext list: the event document is readable by everyone who scans the QR,
// so the guest list must not travel with it.

export type Role = 'admin' | 'manager';

export interface RoleEntry {
  email: string;
  name?: string;
  role: Role;
  addedAt: string; // ISO
  addedBy: string | null; // email of the admin who granted it
}

/** Stored at `config/roles`. Bootstrap admin is the artifact owner, always implicit. */
export interface RolesDoc {
  entries: RoleEntry[];
}

export const EMPTY_ROLES: RolesDoc = { entries: [] };

export const ROLE_LABEL: Record<Role, string> = { admin: 'Quản trị viên', manager: 'Người quản lý' };

export function normalizeEmail(raw: string): string {
  return String(raw ?? '').trim().toLowerCase();
}

const EMAIL_ONE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
export function isEmail(raw: string): boolean {
  return EMAIL_ONE.test(normalizeEmail(raw));
}

/**
 * SHA-256 of the normalized email, hex. Deterministic across devices, so an
 * attendee can prove membership without the list ever being published.
 */
export async function hashEmail(email: string): Promise<string> {
  const norm = normalizeEmail(email);
  if (!norm) return '';
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Trình duyệt không cho phép mã hoá (trang cần chạy trên HTTPS) nên không đối chiếu được danh sách mời.');
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(norm));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hashEmails(emails: string[]): Promise<string[]> {
  return Promise.all(emails.map((e) => hashEmail(e)));
}

/** Document id for an attendance record — derived from the hash, never the address itself. */
export function attKeyOf(emailHash: string): string {
  return 'e' + emailHash.slice(0, 32);
}

/** Case-insensitive membership test against an event's hashed invite list. */
export function isInvited(emailHash: string, hashes: string[] | undefined): boolean {
  return !!emailHash && !!hashes?.includes(emailHash);
}

export function findRole(roles: RolesDoc | null, email: string | null): RoleEntry | null {
  if (!email) return null;
  const norm = normalizeEmail(email);
  return roles?.entries?.find((e) => normalizeEmail(e.email) === norm) ?? null;
}

export interface Session {
  /** Signed-in address used for every authorization decision. */
  email: string | null;
  name: string;
  source: 'google' | 'claude' | null;
  isAdmin: boolean;
  isManager: boolean;
  /** The platform itself grants write access; without it DB writes are refused. */
  canWrite: boolean;
}

export function resolveSession(args: {
  email: string | null;
  name: string;
  source: 'google' | 'claude' | null;
  isOwner: boolean;
  /** Address of the claude.ai account that owns the page, when known. */
  ownerEmail: string | null;
  canEdit: boolean;
  roles: RolesDoc | null;
}): Session {
  // Every privilege hangs off a signed-in address — the page owner included.
  // Without an identity there is nobody to attribute an event or a grant to.
  const email = args.email ? normalizeEmail(args.email) : null;
  const entry = findRole(args.roles, email);
  const hasAnyAdmin = !!args.roles?.entries?.some((e) => e.role === 'admin');

  // Owning the page bootstraps admin, but only as *themselves*: signed in through
  // the owning claude.ai account, or with that account's own address, or while no
  // admin has been appointed yet (first run, and the escape hatch if the last
  // admin is ever removed). Otherwise owning the page would hand admin to whoever
  // happened to sign in on the owner's browser.
  const ownerBootstrap = !!email && args.isOwner && (
    args.source === 'claude'
    || (!!args.ownerEmail && email === normalizeEmail(args.ownerEmail))
    || !hasAnyAdmin
  );

  const isAdmin = ownerBootstrap || (!!email && entry?.role === 'admin');
  return {
    email,
    name: args.name,
    source: args.source,
    isAdmin,
    isManager: isAdmin || (!!email && entry?.role === 'manager'),
    canWrite: args.canEdit || args.isOwner,
  };
}
