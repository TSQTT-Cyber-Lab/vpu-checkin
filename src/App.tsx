import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminView } from '@/components/AdminView';
import { CheckinView } from '@/components/CheckinView';
import { ManagersView } from '@/components/ManagersView';
import { Notice } from '@/components/bits';
import { clearDemoPreviewState, connect, markDemoSeeded, shouldSeedDemo, type GoogleUser, type Platform } from '@/lib/platform';
import { type EventDoc, type EventRow, resolveEmails, uidsOf } from '@/lib/domain';
import { attKeyOf, EMPTY_ROLES, hashEmail, hashEmails, resolveSession, type RolesDoc } from '@/lib/auth';
import { cn } from '@/lib/utils';
import logoUrl from '@/assets/logo.png';

// Default to the current page so QR links follow the actual app URL instead of a hardcoded Claude artifact.
const DEFAULT_BASE_URL = (() => {
  if (typeof window === 'undefined') return '';
  const u = new URL(window.location.href);
  u.hash = '';
  u.search = '';
  return u.toString();
})();

type Tab = 'checkin' | 'manage' | 'admin';

function readPreferredEvent(): string | null {
  try {
    const src = (location.hash || '') + '&' + (location.search || '');
    const m = src.match(/[#?&]e=([\w.-]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

async function seedDemo(p: Platform) {
  const now = Date.now();
  const mk = async (id: string, d: Omit<EventDoc, 'uids' | 'emailHashes' | 'invited' | 'unresolved' | 'createdAt' | 'createdBy'>, emails: string[]) => {
    const map = await resolveEmails(p.search, emails);
    await p.db.doc(`roster/${id}`).set({ emails, map });
    await p.db.doc(`events/${id}`).set({
      ...d,
      uids: uidsOf(map),
      emailHashes: await hashEmails(emails),
      invited: emails.length,
      unresolved: emails.filter((e) => !map[e]).length,
      createdAt: new Date(now).toISOString(),
      createdBy: 'son.pt@tbd.edu.vn',
    });
  };
  const staff = ['son.pt@tbd.edu.vn', 'lan.nt@tbd.edu.vn', 'minh.lv@tbd.edu.vn', 'hoa.tt@tbd.edu.vn', 'khoa.pd@tbd.edu.vn', 'thu.vt@tbd.edu.vn', 'khach.moi@gmail.com'];
  await mk('ev-demo-open', {
    title: 'Ví dụ · Họp giao ban Khoa CNTT', location: 'Phòng A2.05',
    start: new Date(now - 20 * 60e3).toISOString(), end: new Date(now + 70 * 60e3).toISOString(),
    lat: 12.2388, lng: 109.1967, radius: 30, tolerance: 50, window: 30,
  }, staff);
  await mk('ev-demo-next', {
    title: 'Ví dụ · Lớp Nhập môn KHDL – nhóm 2', location: 'Phòng B1.12',
    start: new Date(now + 3 * 3600e3).toISOString(), end: new Date(now + 5 * 3600e3).toISOString(),
    lat: 12.2391, lng: 109.1962, radius: 30, tolerance: 80, window: 15,
  }, ['sv01@tbd.edu.vn', 'sv02@tbd.edu.vn', 'son.pt@tbd.edu.vn']);

  // A couple of people already present at the open meeting.
  const rec = async (email: string, mins: number, dist: number, acc: number) => {
    const hash = await hashEmail(email);
    await p.db.doc(`att/${attKeyOf(hash)}`).set({
      uid: attKeyOf(hash), email, name: email.split('@')[0],
      records: { 'ev-demo-open': { at: new Date(now - mins * 60e3).toISOString(), lat: 12.2388, lng: 109.1967, dist, acc, limit: Math.round(30 + Math.min(acc, 50)) } },
    });
  };
  await rec('lan.nt@tbd.edu.vn', 18, 7.4, 12);
  await rec('minh.lv@tbd.edu.vn', 15, 58.3, 42);
  await rec('hoa.tt@tbd.edu.vn', 9, 12.2, 9);

  await p.db.doc('config/roles').set({
    entries: [
      { email: 'son.pt@tbd.edu.vn', name: 'Phan Thanh Sơn', role: 'admin', addedAt: new Date(now).toISOString(), addedBy: null },
      { email: 'lan.nt@tbd.edu.vn', name: 'Nguyễn Thị Lan', role: 'manager', addedAt: new Date(now).toISOString(), addedBy: 'son.pt@tbd.edu.vn' },
    ],
  });
}

export default function App() {
  const [p, setP] = useState<Platform | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [roles, setRoles] = useState<RolesDoc | null>(null);
  const [googleUser, setGoogleUser] = useState<GoogleUser | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [now, setNow] = useState(Date.now());
  const [preferred] = useState(readPreferredEvent);
  const [tab, setTab] = useState<Tab>('checkin');

  useEffect(() => {
    connect()
      .then(async (pl) => {
        try {
          if (pl.demo && shouldSeedDemo()) {
            await seedDemo(pl);
            markDemoSeeded();
          }
        } catch (e: any) {
          setLoadErr(e?.message || 'Không khởi tạo được dữ liệu demo.');
        }
        setGoogleUser(pl.google.current());
        setP(pl);
      })
      .catch((e: any) => {
        setLoadErr(e?.message || 'Không kết nối được máy chủ dữ liệu.');
      });
  }, []);

  const resetDemoData = useCallback(() => {
    if (!p?.demo) return;
    clearDemoPreviewState();
    window.location.reload();
  }, [p]);

  // Keep the signed-in address in React state; every permission check reads it.
  useEffect(() => (p ? p.google.subscribe(setGoogleUser) : undefined), [p]);

  useEffect(() => {
    if (!p) return;
    const u1 = p.db.collection('events').limit(500).onSnapshot(
      (s) => {
        setLoadErr(null);
        setEvents(s.docs.filter((d) => d.exists).map((d) => ({ id: d.id, ...(d.data() as EventDoc) })));
      },
      (e) => { setLoadErr(e?.message || 'Không tải được danh sách sự kiện.'); },
    );
    const u2 = p.db.doc('config/app').onSnapshot((s) => {
      const u = s.exists ? (s.data() as { baseUrl?: string }).baseUrl : '';
      setBaseUrl(u || DEFAULT_BASE_URL || '');
    });
    const u3 = p.db.doc('config/roles').onSnapshot(
      (s) => setRoles(s.exists ? (s.data() as RolesDoc) : EMPTY_ROLES),
      () => setRoles(EMPTY_ROLES),
    );
    return () => { u1(); u2(); u3(); };
  }, [p]);

  // Google sign-in is the identity of record; the claude.ai account is the fallback
  // when the page is published without the googleAuth capability. Once Google sign-in
  // is available, it is the SOLE identity source: falling back to p.me (a snapshot taken
  // once at connect time) after an explicit sign-out would resurrect the old address and
  // keep every now-unauthenticated request looking "signed in" to the UI.
  const useClaudeFallback = !p?.google.available;
  const session = useMemo(() => resolveSession({
    email: googleUser?.email ?? (useClaudeFallback ? p?.me.email ?? null : null),
    name: googleUser?.name || (useClaudeFallback ? p?.me.name || '' : ''),
    source: googleUser ? 'google' : (useClaudeFallback && p?.me.email) ? 'claude' : null,
    isOwner: !!p?.me.isOwner,
    ownerEmail: p?.me.email ?? null,
    canEdit: !!p?.me.canEdit,
    roles,
  }), [googleUser, p, roles, useClaudeFallback]);

  // Scanning a QR always lands on check-in; otherwise a manager starts in their console.
  useEffect(() => {
    if (preferred) { setTab('checkin'); return; }
    setTab((t) => (t === 'checkin' && session.isManager ? 'manage' : t));
  }, [preferred, session.isManager]);

  // A manager who signs out must not keep looking at the manager console.
  useEffect(() => {
    if (!session.isManager) setTab('checkin');
    else if (!session.isAdmin) setTab((t) => (t === 'admin' ? 'manage' : t));
  }, [session.isManager, session.isAdmin]);

  // Coarse clock so phases flip open/closed without a reload.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const saveBaseUrl = useCallback(async (u: string) => {
    if (!p) return;
    await p.db.doc('config/app').set({ baseUrl: u });
  }, [p]);

  const signOut = useCallback(async () => {
    await p?.google.signOut();
  }, [p]);

  const tabs: [Tab, string][] = [['checkin', 'Điểm danh']];
  if (session.isManager) tabs.push(['manage', 'Quản lý']);
  if (session.isAdmin) tabs.push(['admin', 'Quản trị']);

  return (
    <div className="min-h-full bg-background pb-10">
      <header className="border-b-4 border-destructive bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="TBD" className="h-9 w-9 rounded bg-white object-contain p-[3px]" />
            <div>
              <h1 className="text-lg font-bold leading-tight">VPU Điểm Danh</h1>
              <p className="text-[12px] opacity-80">Quét QR · xác minh danh sách, giờ và vị trí</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {session.email && (
              <div className="flex items-center gap-2 text-[12px]">
                <span className="hidden max-w-[220px] truncate opacity-90 sm:inline" title={session.email}>{session.email}</span>
                <button onClick={signOut} className="rounded border border-white/40 px-2 py-1 font-semibold transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                  Đăng xuất
                </button>
              </div>
            )}
            {tabs.length > 1 && (
              <nav className="inline-flex rounded-md bg-white/10 p-0.5 text-sm" role="tablist" aria-label="Chế độ">
                {tabs.map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                    className={cn('rounded px-3.5 py-1.5 font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
                      tab === k ? 'bg-white text-primary' : 'text-white/80 hover:text-white')}>
                    {label}
                  </button>
                ))}
              </nav>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <main className="space-y-4 pt-5">
          {p?.demo && (
            <Notice tone="info" title="Chế độ xem thử (chỉ dành cho phát triển cục bộ)">
              Không kết nối được máy chủ (`/api`) nên trang dùng dữ liệu ví dụ trong bộ nhớ trình duyệt; không có gì
              được lưu lại và không có ai khác thấy dữ liệu này. Nếu đây là trang đã triển khai thật, hãy kiểm tra
              lại dịch vụ backend (`docker compose ps`, `docker compose logs app`).
              Đăng nhập bằng <span className="mono">son.pt@tbd.edu.vn</span> để xem vai trò quản trị.
              <button type="button" onClick={resetDemoData} className="ml-2 text-sm font-semibold underline underline-offset-2">Xóa dữ liệu demo cũ</button>
            </Notice>
          )}
          {loadErr && session.email && <Notice tone="bad" title="Không kết nối được dữ liệu">{loadErr}</Notice>}
          {!p && !loadErr ? (
            <div className="grid gap-3" aria-busy="true">
              <div className="h-16 animate-pulse rounded-md bg-muted" />
              <div className="h-48 animate-pulse rounded-md bg-muted" />
            </div>
          ) : p ? (
            tab === 'admin' && session.isAdmin ? (
              <ManagersView p={p} session={session} roles={roles} />
            ) : tab === 'manage' && session.isManager ? (
              <AdminView p={p} session={session} events={events} now={now} baseUrl={baseUrl} onBaseUrl={saveBaseUrl} />
            ) : (
              <CheckinView p={p} session={session} events={events} now={now} preferredId={preferred} />
            )
          ) : null}
        </main>
      </div>
    </div>
  );
}
