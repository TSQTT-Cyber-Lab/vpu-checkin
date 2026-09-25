// Domain helpers: geometry, parsing, hashing, formatting, data shapes.

export interface EventDoc {
  title: string;
  location: string;
  start: string; // ISO
  end: string; // ISO
  lat: number;
  lng: number;
  radius: number; // metres — physical size of the room zone
  tolerance?: number; // metres — extra GPS error accepted on top of radius (absent on older events)
  window?: number; // minutes after start during which check-in is accepted; 0/absent = whole meeting
  uids: string[]; // account ids resolved from the invite emails; attendees see ids only, never emails
  /**
   * SHA-256 of each invited email. This document travels with the QR code, so the
   * guest list is carried as hashes: an attendee can prove membership by hashing
   * their own address, and nobody can read the list off the event.
   */
  emailHashes?: string[];
  invited: number; // emails on the list
  unresolved: number; // emails with no matching account in the organization
  createdAt: string;
  createdBy: string | null; // email of the manager who created it
}
export type EventRow = EventDoc & { id: string };

export interface CheckinRecord {
  at: string;
  lat: number;
  lng: number;
  acc: number;
  dist: number;
  limit?: number; // threshold actually applied: radius + min(acc, tolerance)
}
export interface AttendeeDoc {
  /** Document key: `attKeyOf(emailHash)` for email sign-in, or a legacy claude account id. */
  uid: string;
  /** Address this person signed in with; the manager's roster is matched on it. */
  email?: string;
  name?: string;
  records: Record<string, CheckinRecord>;
}
/** Manager-only: the invite list and which account each email resolved to. */
export interface RosterDoc {
  emails: string[];
  map: Record<string, string | null>;
}

/**
 * Map each email to an organization account id via the directory search.
 * Sequential on purpose: a newer search() supersedes an in-flight one.
 * Only an unambiguous single hit counts as a match.
 */
export async function resolveEmails(
  search: (q: string) => Promise<{ id: string }[]>,
  emails: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  let i = 0;
  for (const e of emails) {
    let hits: { id: string }[] = [];
    try { hits = await search(e); } catch { hits = []; }
    out[e] = hits.length === 1 ? hits[0].id : null;
    onProgress?.(++i, emails.length);
  }
  return out;
}

export function uidsOf(map: Record<string, string | null>): string[] {
  return [...new Set(Object.values(map).filter((v): v is string => !!v))];
}

export const DEFAULT_RADIUS = 30;
export const DEFAULT_TOLERANCE = 50;
export const MAX_TOLERANCE = 80;
export const TOLERANCE_PRESETS = [0, 50, 65, 80] as const;

export const toleranceOf = (ev: { tolerance?: number }) =>
  Math.min(MAX_TOLERANCE, Math.max(0, ev.tolerance ?? DEFAULT_TOLERANCE));

/**
 * Geofence decision with GPS error allowance.
 * A fix counts as "in the room" when dist <= radius + min(accuracy, tolerance):
 * the reported error is credited, but never more than the event allows.
 */
export function judgeFix(ev: { radius: number; tolerance?: number }, dist: number, acc: number) {
  const tol = toleranceOf(ev);
  const credit = Math.min(Math.max(0, acc), tol);
  const limit = Math.round(ev.radius + credit);
  return {
    ok: dist <= limit,
    limit,
    tol,
    weakSignal: acc > tol, // the fix is less precise than the allowance covers
    viaTolerance: dist > ev.radius && dist <= limit,
  };
}

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;
  const q = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

/** Accepts Google Maps URLs (`@lat,lng`, `!3dlat!4dlng`, `q=`/`query=`/`ll=`) or a bare "lat, lng". */
export function parseMapCoordinates(text: string): { lat: number; lng: number } | null {
  const num = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
  const patterns = [
    new RegExp(String.raw`!3d${num}!4d${num}`), // exact pin, preferred over the viewport centre
    new RegExp(String.raw`@${num},\s*${num}`),
    new RegExp(String.raw`[?&](?:q|query|ll|destination)=${num}(?:,|%2C)\s*${num}`, 'i'),
    new RegExp(String.raw`(?:^|[^\d.-])${num}\s*,\s*${num}(?![\d.])`),
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export function extractEmails(text: string): string[] {
  return [...new Set((text.match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];
}

export function newEventId(): string {
  return 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

const dtf = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
const tf = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const fmtDateTime = (iso: string) => dtf.format(new Date(iso));
export const fmtTime = (iso: string) => tf.format(new Date(iso));
export function fmtRange(start: string, end: string) {
  const s = new Date(start), e = new Date(end);
  const sameDay = s.toDateString() === e.toDateString();
  return sameDay
    ? `${fmtDateTime(start)} – ${e.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
    : `${fmtDateTime(start)} – ${fmtDateTime(end)}`;
}

/** Check-in window presets, minutes from meeting start (0 = until the meeting ends). */
export const WINDOW_PRESETS = [5, 10, 15, 30, 0] as const;
export const DEFAULT_WINDOW = 15;
export const windowLabel = (m: number) => (m ? `${m} phút` : 'Cả buổi');

type Timed = Pick<EventDoc, 'start' | 'end'> & { window?: number };
/** When check-in closes: start + window, never later than the meeting end. */
export function checkinEndMs(ev: Timed): number {
  const end = Date.parse(ev.end);
  return ev.window ? Math.min(end, Date.parse(ev.start) + ev.window * 60e3) : end;
}
export const checkinEndIso = (ev: Timed) => new Date(checkinEndMs(ev)).toISOString();

export type Phase = 'upcoming' | 'open' | 'closed';
/** Phase of the CHECK-IN window (not of the meeting itself). */
export function phaseOf(ev: Timed, now = Date.now()): Phase {
  if (now < Date.parse(ev.start)) return 'upcoming';
  if (now > checkinEndMs(ev)) return 'closed';
  return 'open';
}
export const PHASE_LABEL: Record<Phase, string> = { upcoming: 'Chưa mở', open: 'Đang điểm danh', closed: 'Hết giờ điểm danh' };

export function fmtClock(iso: string | number) {
  return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
/** "14:00 – 14:15" for the check-in window. */
export const fmtWindow = (ev: Timed) => `${fmtClock(ev.start)} – ${fmtClock(checkinEndMs(ev))}`;
export function fmtRemaining(ms: number) {
  if (ms <= 0) return '0 phút';
  const m = Math.ceil(ms / 60e3);
  return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`;
}

export function toLocalInput(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

export function slugify(t: string) {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'su-kien';
}

export function csvEscape(v: unknown): string {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"';
}

export function geolocationBlockedByFrame(): boolean {
  const fp = (document as any).featurePolicy ?? (document as any).permissionsPolicy;
  try {
    return fp?.allowsFeature ? !fp.allowsFeature('geolocation') : false;
  } catch {
    return false;
  }
}

/**
 * Indoor fixes improve over a few seconds (Wi-Fi/cell assist). Watch for up to
 * `windowMs`, keep the most precise fix, stop early once accuracy <= `goodEnough`.
 */
export function getBestPosition(windowMs = 10000, goodEnough = 20, onFix?: (acc: number) => void): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Trình duyệt này không hỗ trợ định vị.'));
    if (geolocationBlockedByFrame()) return reject(new Error('Khung hiển thị hiện tại không cho phép truy cập vị trí. Hãy mở trang trong trình duyệt của điện thoại.'));
    let best: GeolocationCoordinates | null = null;
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      navigator.geolocation.clearWatch(id);
      clearTimeout(timer);
      if (best) resolve(best);
      else reject(err ?? new Error('Không xác định được vị trí. Kiểm tra GPS rồi thử lại.'));
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (!best || p.coords.accuracy < best.accuracy) {
          best = p.coords;
          onFix?.(p.coords.accuracy);
        }
        if (p.coords.accuracy <= goodEnough) finish();
      },
      (e) => {
        if (e.code === e.PERMISSION_DENIED) finish(new Error('Bạn chưa cấp quyền vị trí. Bật quyền Vị trí cho trình duyệt rồi thử lại.'));
        else if (!best && e.code !== e.TIMEOUT) finish(new Error('Không xác định được vị trí. Kiểm tra GPS rồi thử lại.'));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: windowMs },
    );
    const timer = setTimeout(() => finish(new Error('Lấy vị trí quá lâu. Bật Wi-Fi, ra gần cửa sổ rồi thử lại.')), windowMs);
  });
}

export function getPosition(): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Trình duyệt này không hỗ trợ định vị.'));
    if (geolocationBlockedByFrame()) return reject(new Error('Khung hiển thị hiện tại không cho phép truy cập vị trí. Hãy mở trang trong trình duyệt của điện thoại.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords),
      (e) => reject(new Error(
        e.code === e.PERMISSION_DENIED ? 'Bạn chưa cấp quyền vị trí. Bật quyền Vị trí cho trình duyệt rồi thử lại.'
          : e.code === e.TIMEOUT ? 'Lấy vị trí quá lâu. Ra gần cửa sổ hoặc bật Wi-Fi rồi thử lại.'
            : 'Không xác định được vị trí. Kiểm tra GPS rồi thử lại.',
      )),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

let xlsxPromise: Promise<any> | null = null;
export function loadXlsx(): Promise<any> {
  if ((window as any).XLSX) return Promise.resolve((window as any).XLSX);
  xlsxPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve((window as any).XLSX);
    s.onerror = () => { xlsxPromise = null; reject(new Error('Không tải được bộ đọc XLSX. Hãy lưu file dưới dạng CSV.')); };
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

export async function emailsFromFile(file: File): Promise<string[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) return extractEmails(await file.text());
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const cells: string[] = [];
    for (const sn of wb.SheetNames) {
      const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false });
      rows.forEach((r) => r.forEach((c) => cells.push(String(c ?? ''))));
    }
    return extractEmails(cells.join('\n'));
  }
  throw new Error('Chỉ hỗ trợ file .csv hoặc .xlsx.');
}
