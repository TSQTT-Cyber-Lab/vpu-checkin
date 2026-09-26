import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EventForm } from '@/components/EventForm';
import { Notice, PhasePill } from '@/components/bits';
import type { Platform } from '@/lib/platform';
import {
  type AttendeeDoc, type EventRow, type RosterDoc, MAX_TOLERANCE, TOLERANCE_PRESETS, WINDOW_PRESETS,
  checkinEndMs, csvEscape, fmtClock, fmtRange, fmtRemaining, fmtTime, fmtWindow, phaseOf, slugify, toleranceOf, windowLabel,
} from '@/lib/domain';
import { canEditEvent, isEventOwner, normalizeEmail, type Session } from '@/lib/auth';
import { BRAND, inviteText, renderQrCard } from '@/lib/qrcard';
import { cn } from '@/lib/utils';

export function AdminView({ p, session, events, now, baseUrl, onBaseUrl }: {
  p: Platform; session: Session; events: EventRow[]; now: number; baseUrl: string; onBaseUrl: (u: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attendees, setAttendees] = useState<AttendeeDoc[]>([]);
  const [attErr, setAttErr] = useState<string | null>(null);
  const [drive, setDrive] = useState(() => p.google.current());
  const [loggingIn, setLoggingIn] = useState(false);
  const [adminNote, setAdminNote] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);

  // All attendance docs (managers only; readable because of the `att` rule).
  useEffect(() => p.db.collection('att').limit(1000).onSnapshot(
    (s) => setAttendees(s.docs.filter((d) => d.exists).map((d) => d.data() as AttendeeDoc)),
    (e) => setAttErr(e?.message || 'Không đọc được dữ liệu điểm danh.'),
  ), [p]);

  // An admin runs every event; a manager runs only the ones they created. Other managers'
  // events reach them through the check-in tab, like any attendee's.
  const mine = useMemo(() => (session.isAdmin ? events : events.filter((e) => isEventOwner(e, session))), [events, session]);

  const sorted = useMemo(() => {
    const rank = { open: 0, upcoming: 1, closed: 2 } as const;
    return [...mine].sort((a, b) => rank[phaseOf(a, now)] - rank[phaseOf(b, now)]
      || (phaseOf(a, now) === 'closed' ? Date.parse(b.end) - Date.parse(a.end) : Date.parse(a.start) - Date.parse(b.start)));
  }, [mine, now]);

  useEffect(() => {
    if (!selectedId || !mine.some((e) => e.id === selectedId)) setSelectedId(sorted[0]?.id ?? null);
  }, [sorted, mine, selectedId]);

  const countFor = (id: string) => attendees.filter((a) => a.records?.[id]).length;
  const selected = mine.find((e) => e.id === selectedId) ?? null;

  // The manager's own sign-in doubles as the Google Drive connection.
  useEffect(() => p.google.subscribe(setDrive), [p]);

  const handleGoogleLogin = async () => {
    setLoggingIn(true);
    try {
      await p.google.signIn();
      setAdminNote({ tone: 'ok', text: 'Đã đăng nhập Google. Giờ bạn có thể export danh sách lên Google Drive.' });
    } catch (e: any) {
      setAdminNote({ tone: 'bad', text: e.message || 'Không đăng nhập được Google.' });
    } finally {
      setLoggingIn(false);
    }
  };

  const handleGoogleLogout = () => p.google.signOut();

  return (
    <>
      {adminNote && <Notice tone={adminNote.tone} className="mb-5">{adminNote.text}</Notice>}
      {!session.canWrite && (
        <Notice tone="warn" className="mb-5" title="Chưa đủ quyền ghi dữ liệu">
          Bạn có vai trò quản lý, nhưng trang này đang mở ở chế độ chỉ xem nên không lưu được sự kiện.
          Nhờ chủ sở hữu chia sẻ trang cho bạn ở mức “Có thể chỉnh sửa”.
        </Notice>
      )}
      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-3">
          {/* Google Drive export is only wired up inside claude.ai; self-hosted uses a plain file download instead. */}
          {p.uploadToDrive && (
            <div className="rounded-md border bg-card p-3">
              {drive ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-full bg-ok"></span>
                    <span className="text-sm font-medium">Google Drive: Đã kết nối</span>
                  </div>
                  <p className="mono truncate text-[12px] text-muted-foreground">{drive.email}</p>
                  <Button size="sm" variant="outline" className="w-full text-[12px]" onClick={handleGoogleLogout}>
                    Đăng xuất
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Đăng nhập Google</div>
                  <p className="text-[12px] text-muted-foreground">Kết nối Google Drive để lưu danh sách điểm danh.</p>
                  <Button size="sm" className="w-full" onClick={handleGoogleLogin} disabled={loggingIn}>
                    {loggingIn ? 'Đang đăng nhập…' : 'Đăng nhập Google'}
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div className="eyebrow">Sự kiện · {mine.length}</div>
            <Button size="sm" onClick={() => setCreating(true)}>Tạo sự kiện</Button>
          </div>
          {sorted.length === 0 ? (
            <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
              Chưa có sự kiện. Tạo sự kiện đầu tiên để sinh mã QR điểm danh.
            </div>
          ) : (
            <ul className="grid gap-1.5">
              {sorted.map((e) => {
                const n = countFor(e.id);
                return (
                  <li key={e.id}>
                    <button
                      onClick={() => setSelectedId(e.id)}
                      aria-current={e.id === selectedId}
                      className={cn(
                        'w-full rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        e.id === selectedId && 'border-primary ring-1 ring-primary',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="line-clamp-2 text-sm font-semibold leading-snug">{e.title}</span>
                        <PhasePill phase={phaseOf(e, now)} />
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
                        <span className="num truncate">{fmtRange(e.start, e.end)} · ĐD {windowLabel(e.window ?? 0)}</span>
                        <span className="num shrink-0 font-semibold text-foreground">{n}/{e.invited}</span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: `${e.invited ? Math.min(100, (n / e.invited) * 100) : 0}%` }} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <LinkSetting baseUrl={baseUrl} onSave={onBaseUrl} />
        </aside>

        <section className="min-w-0">
          {attErr && <Notice tone="bad" className="mb-3" title="Không tải được danh sách có mặt">{attErr}</Notice>}
          {selected ? (
            <EventDetail key={selected.id} p={p} session={session} ev={selected} now={now} attendees={attendees} baseUrl={baseUrl} onDeleted={() => setSelectedId(null)} driveReady={!!drive} />
          ) : (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">Chọn hoặc tạo một sự kiện.</div>
          )}
        </section>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tạo sự kiện điểm danh</DialogTitle>
            <DialogDescription>Mã QR được sinh ngay sau khi lưu. Người tham dự chỉ thấy tên sự kiện, không thấy danh sách email.</DialogDescription>
          </DialogHeader>
          <EventForm p={p} session={session} onCancel={() => setCreating(false)} onSaved={(id) => { setCreating(false); setSelectedId(id); }} />
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}

function LinkSetting({ baseUrl, onSave }: { baseUrl: string; onSave: (u: string) => Promise<void> }) {
  const [v, setV] = useState(baseUrl);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => setV(baseUrl), [baseUrl]);
  const trimmed = v.trim();
  const containsClaudeArtifact = /claude\.ai/i.test(trimmed);
  const valid = /^https:\/\/\S+$/.test(trimmed) && !containsClaudeArtifact;
  const warning = !trimmed
    ? 'URL đang trống. Mã QR sẽ không dẫn tới trang nào.'
    : !/^https:\/\//.test(trimmed)
      ? 'Cần dán URL bắt đầu bằng https://'
      : containsClaudeArtifact
        ? 'URL hiện đang trỏ vào Claude. Hãy thay bằng liên kết trang VPU thật của bạn.'
        : '';

  return (
    <details className="rounded-md border bg-card px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none font-medium">Liên kết trang trong mã QR</summary>
      <div className="mt-2 grid gap-1.5">
        <Label htmlFor="cfg-url" className="text-[13px] text-muted-foreground">Dán liên kết chia sẻ của trang này. Mã QR trỏ tới liên kết này.</Label>
        <Input id="cfg-url" className="mono text-[12px]" value={v} onChange={(e) => { setV(e.target.value); setState('idle'); }} placeholder="https://your-domain.example/..." />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!valid || v.trim() === baseUrl || state === 'saving'}
            onClick={async () => { setState('saving'); try { await onSave(v.trim()); setState('saved'); } catch { setState('error'); } }}>
            Lưu liên kết
          </Button>
          <span className="text-[12px] text-muted-foreground">{state === 'saved' ? 'Đã lưu' : state === 'error' ? 'Không lưu được' : ''}</span>
        </div>
        {warning && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2 text-[12px] text-destructive">
            {warning}
          </div>
        )}
      </div>
    </details>
  );
}

type Row = { key: string; email: string; name?: string; at?: string; dist?: number; acc?: number; limit?: number; uid: string | null; invited: boolean };

function EventDetail({ p, session, ev, now, attendees, baseUrl, onDeleted, driveReady }: {
  p: Platform; session: Session; ev: EventRow; now: number; attendees: AttendeeDoc[]; baseUrl: string; onDeleted: () => void; driveReady: boolean;
}) {
  const [roster, setRoster] = useState<RosterDoc | null>(null);
  const [qr, setQr] = useState('');
  const [projector, setProjector] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [filter, setFilter] = useState<'all' | 'present' | 'absent'>('all');
  const [note, setNote] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [savingTol, setSavingTol] = useState(false);
  const [savingWin, setSavingWin] = useState(false);
  const [card, setCard] = useState<{ url: string; blob: Blob } | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const [copyFallback, setCopyFallback] = useState<{ title: string; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  // The lists refresh every ~3 s: reopening the form before that would show the pre-save data.
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 4000);
    return () => clearTimeout(t);
  }, [justSaved]);

  async function changeWindow(m: number) {
    if ((ev.window ?? 0) === m) return;
    setSavingWin(true);
    try {
      await p.db.doc(`events/${ev.id}`).update({ window: m });
      const close = new Date(m ? Math.min(Date.parse(ev.end), Date.parse(ev.start) + m * 60e3) : Date.parse(ev.end));
      setNote({ tone: 'ok', text: `Điểm danh nhận đến ${fmtClock(close.getTime())} (${windowLabel(m).toLowerCase()} từ giờ bắt đầu). Ảnh QR đã gửi trước đó vẫn ghi khung giờ cũ — hãy xuất và gửi lại nếu cần.` });
    } catch (e: any) {
      setNote({ tone: 'bad', text: e?.message || 'Không cập nhật được thời gian điểm danh.' });
    } finally {
      setSavingWin(false);
    }
  }

  async function copy(title: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNote({ tone: 'ok', text: `Đã sao chép ${title.toLowerCase()}.` });
    } catch {
      setCopyFallback({ title, text }); // clipboard blocked in this frame: let the manager copy by hand
    }
  }

  async function changeTolerance(v: number) {
    if (v === toleranceOf(ev) && ev.tolerance != null) return;
    setSavingTol(true);
    try {
      await p.db.doc(`events/${ev.id}`).update({ tolerance: Math.max(0, Math.min(MAX_TOLERANCE, v)) });
      setNote({ tone: 'ok', text: `Đã đặt sai số GPS chấp nhận ${v} m. Áp dụng cho các lượt điểm danh từ bây giờ.` });
    } catch (e: any) {
      setNote({ tone: 'bad', text: e?.message || 'Không cập nhật được sai số.' });
    } finally {
      setSavingTol(false);
    }
  }

  const link = baseUrl ? `${baseUrl}#e=${encodeURIComponent(ev.id)}` : '';

  useEffect(() => p.db.doc(`roster/${ev.id}`).onSnapshot(
    (s) => setRoster(s.exists ? { ...(s.data() as RosterDoc) } : { emails: [], map: {} }),
    () => {}, // a failed poll keeps the last good list: faking an empty one would open the edit form with no invitees
  ), [p, ev.id]);

  useEffect(() => {
    if (!link) { setQr(''); return; }
    QRCode.toDataURL(link, { errorCorrectionLevel: 'Q', margin: 2, width: 720, color: { dark: BRAND.navyInk, light: BRAND.white } })
      .then(setQr).catch(() => setQr(''));
  }, [link]);

  // Invalidate the rendered card whenever anything printed on it changes.
  const cardKey = [link, ev.title, ev.location, ev.start, ev.end, ev.window, ev.radius, ev.tolerance].join('|');
  useEffect(() => {
    setCard((c) => { if (c) URL.revokeObjectURL(c.url); return null; });
  }, [cardKey]);

  async function ensureCard() {
    if (card) return card;
    const blob = await renderQrCard(ev, link);
    const next = { blob, url: URL.createObjectURL(blob) };
    setCard(next);
    return next;
  }

  async function openCard() {
    setCardBusy(true);
    try { await ensureCard(); setCardOpen(true); }
    catch (e: any) { setNote({ tone: 'bad', text: e?.message || 'Không tạo được ảnh QR.' }); }
    finally { setCardBusy(false); }
  }

  async function saveCard() {
    if (!p.save) { setNote({ tone: 'bad', text: 'Trang đang mở ở chế độ không hỗ trợ tải file.' }); return; }
    setCardBusy(true);
    try {
      const c = await ensureCard();
      await p.save(`QR-diem-danh_${slugify(ev.title)}_${ev.start.slice(0, 10)}.png`, c.blob);
      setNote({ tone: 'ok', text: 'Đã lưu ảnh mã QR. Đính kèm ảnh này vào email gửi các thành viên.' });
    } catch (e: any) {
      if (e?.code !== 'declined') setNote({ tone: 'bad', text: e?.message || 'Không lưu được ảnh.' });
    } finally {
      setCardBusy(false);
    }
  }

  const present = useMemo(() => attendees.filter((a) => a.records?.[ev.id]), [attendees, ev.id]);

  // Records written before email sign-in hold only an account id; resolve those names.
  const legacyUids = present.filter((a) => !a.email).map((a) => a.uid).filter(Boolean);
  const uidKey = [...legacyUids].sort().join(',');
  useEffect(() => {
    let alive = true;
    if (!legacyUids.length) { setNames({}); return; }
    p.profiles(legacyUids).then((ps) => {
      if (alive) setNames(Object.fromEntries(legacyUids.map((id) => [id, ps[id]?.name || ''])));
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uidKey, p]);

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const claimed = new Set<string>();
    // Attendance is keyed by the address people signed in with; older records
    // carry only a claude.ai account id, so both lookups are kept.
    const byEmail = new Map(present.filter((a) => a.email).map((a) => [normalizeEmail(a.email!), a]));
    const byUid = new Map(present.map((a) => [a.uid, a]));
    for (const email of roster?.emails ?? []) {
      const uid = roster?.map?.[email] ?? null;
      const hit = byEmail.get(normalizeEmail(email)) ?? (uid ? byUid.get(uid) : undefined);
      if (hit) claimed.add(hit.uid);
      const r = hit?.records[ev.id];
      out.push({
        key: email, email, uid, invited: true,
        at: r?.at, dist: r?.dist, acc: r?.acc, limit: r?.limit,
        name: hit?.name || (hit && !hit.email ? names[hit.uid] : undefined),
      });
    }
    for (const a of present) {
      if (claimed.has(a.uid)) continue;
      const r = a.records[ev.id];
      out.push({
        key: a.uid, email: a.email ?? '', uid: a.uid, invited: false,
        name: a.name || names[a.uid] || 'Tài khoản không rõ tên',
        at: r.at, dist: r.dist, acc: r.acc, limit: r.limit,
      });
    }
    return out.sort((x, y) => (x.at ? 0 : 1) - (y.at ? 0 : 1) || (x.at && y.at ? x.at.localeCompare(y.at) : x.email.localeCompare(y.email)));
  }, [roster, present, names, ev.id]);

  const nPresent = rows.filter((r) => r.at && r.invited).length;
  const nOutside = rows.filter((r) => r.at && !r.invited).length;
  const shown = rows.filter((r) => filter === 'all' || (filter === 'present' ? !!r.at : !r.at));
  const phase = phaseOf(ev, now);
  const canEdit = canEditEvent(ev, session, now);

  async function exportCsv() {
    const head = ['STT', 'Email', 'Tên tài khoản', 'Trạng thái', 'Thời điểm điểm danh', 'Khoảng cách (m)', 'Sai số GPS (m)', 'Ngưỡng áp dụng (m)', 'Ghi chú'];
    const body = rows.map((r, i) => [
      i + 1, r.email, r.name ?? '', r.at ? 'Có mặt' : 'Vắng',
      r.at ? new Date(r.at).toLocaleString('vi-VN') : '', r.dist ?? '', r.acc ?? '', r.limit ?? '',
      [!r.invited && 'Không có trong danh sách', r.dist != null && r.dist > ev.radius && 'Ngoài bán kính, chấp nhận nhờ sai số GPS'].filter(Boolean).join('; '),
    ]);
    const meta = [['Sự kiện', ev.title], ['Phòng', ev.location], ['Thời gian họp', fmtRange(ev.start, ev.end)], ['Khung điểm danh', `${fmtWindow(ev)} (${windowLabel(ev.window ?? 0)})`], ['Tọa độ', `${ev.lat}, ${ev.lng}`], ['Bán kính (m)', ev.radius], ['Sai số GPS chấp nhận (m)', toleranceOf(ev)], ['Có mặt', `${nPresent}/${ev.invited}`], []];
    const csv = '﻿' + [...meta, head, ...body].map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const safe = slugify(ev.title);
    const filename = `diem-danh_${safe}_${ev.start.slice(0, 10)}.csv`;

    if (p.uploadToDrive) {
      if (!driveReady) {
        setNote({ tone: 'bad', text: 'Cần đăng nhập Google Drive trước khi export. Nhấp nút "Đăng nhập Google" ở trên.' });
        return;
      }
      try {
        await p.uploadToDrive(filename, csv);
        setNote({ tone: 'ok', text: `Đã lưu "${filename}" vào Google Drive của bạn.` });
      } catch (e: any) {
        setNote({ tone: 'bad', text: e?.message || 'Không export được file.' });
      }
      return;
    }

    if (!p.save) {
      setNote({ tone: 'bad', text: 'Trang đang mở ở chế độ không hỗ trợ tải file.' });
      return;
    }
    try {
      await p.save(filename, csv);
      setNote({ tone: 'ok', text: `Đã tải "${filename}".` });
    } catch (e: any) {
      setNote({ tone: 'bad', text: e?.message || 'Không tải được file.' });
    }
  }

  async function remove() {
    try {
      await p.db.doc(`events/${ev.id}`).delete();
      // The backend has already removed the roster and every attendee's record of this event; the
      // in-memory preview and the claude.ai runtime have no server, so make sure the invite list goes too.
      await p.db.doc(`roster/${ev.id}`).delete();
      onDeleted();
    } catch (e: any) {
      setNote({ tone: 'bad', text: e?.message || 'Không xóa được sự kiện.' });
      setConfirmDel(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PhasePill phase={phase} />
            {ev.location && <span className="text-sm text-muted-foreground">{ev.location}</span>}
          </div>
          <h2 className="mt-1.5 text-2xl font-bold leading-tight">{ev.title}</h2>
          <div className="num mt-1 text-sm text-muted-foreground">
            Họp {fmtRange(ev.start, ev.end)} · <span className="font-semibold text-foreground">Điểm danh {fmtWindow(ev)}</span>
            {phase === 'open' && <span className="ml-1 font-semibold text-destructive">(còn {fmtRemaining(checkinEndMs(ev) - now)})</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={roster === null}>Xuất CSV</Button>
          {canEdit && <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={roster === null || justSaved}>Sửa sự kiện</Button>}
          {confirmDel ? (
            <>
              <Button variant="destructive" size="sm" onClick={remove}>Xác nhận xóa</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>Giữ lại</Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" className="text-bad hover:text-bad" onClick={() => setConfirmDel(true)}>Xóa sự kiện</Button>
          )}
        </div>
      </header>
      {note && <Notice tone={note.tone}>{note.text}</Notice>}
      {!canEdit && (
        <p className="text-[13px] text-muted-foreground">
          Sự kiện đã bắt đầu nên không sửa được nội dung. Bạn vẫn chỉnh được thời gian nhận điểm danh và sai số GPS.
        </p>
      )}

      <div className="grid gap-5 md:grid-cols-[250px_minmax(0,1fr)]">
        {/* QR */}
        <div className="space-y-2">
          <div className="rounded-md border bg-white p-2">
            {qr ? (
              <button onClick={() => setProjector(true)} className="block w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Phóng to mã QR để trình chiếu">
                <img src={qr} alt={`Mã QR điểm danh ${ev.title}`} className="aspect-square w-full" />
              </button>
            ) : (
              <div className="grid aspect-square place-items-center p-4 text-center text-[13px] text-slate-600">
                Chưa có liên kết trang. Mở mục “Liên kết trang trong mã QR” bên trái và dán liên kết chia sẻ.
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button variant="secondary" size="sm" disabled={!qr} onClick={() => setProjector(true)}>Trình chiếu</Button>
            <Button variant="secondary" size="sm" disabled={!qr || cardBusy} onClick={openCard}>Xem ảnh QR</Button>
          </div>

          <section className="rounded-md border border-primary/25 bg-accent/50 p-3" aria-labelledby="share-h">
            <h3 id="share-h" className="text-sm font-bold text-primary">Gửi mã QR cho thành viên</h3>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Ảnh ghi rõ khung giờ điểm danh {fmtWindow(ev)}.</p>
            <div className="mt-2 grid gap-1.5">
              <Button size="sm" disabled={!qr || cardBusy} onClick={saveCard}>{cardBusy ? 'Đang tạo ảnh…' : 'Tải ảnh QR (PNG)'}</Button>
              <Button size="sm" variant="outline" disabled={!link} onClick={() => copy('Nội dung email', inviteText(ev, link))}>Sao chép nội dung email</Button>
              <Button size="sm" variant="outline" disabled={!roster?.emails.length} onClick={() => copy('Danh sách email', (roster?.emails ?? []).join(', '))}>
                Sao chép {roster?.emails.length ?? 0} địa chỉ nhận
              </Button>
            </div>
          </section>

          <section className="grid gap-2.5 rounded-md border bg-card p-2.5" aria-label="Thiết lập điểm danh">
            <div>
              <div className="eyebrow">Nhận điểm danh trong</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Thời gian nhận điểm danh">
                {WINDOW_PRESETS.map((m) => (
                  <button key={m} role="radio" aria-checked={(ev.window ?? 0) === m} disabled={savingWin} onClick={() => changeWindow(m)}
                    className={cn('rounded border px-2 py-0.5 text-[12px] font-medium disabled:opacity-50',
                      (ev.window ?? 0) === m ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary/60')}>
                    {windowLabel(m)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="eyebrow">Sai số GPS chấp nhận</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Sai số GPS chấp nhận">
                {TOLERANCE_PRESETS.map((v) => (
                  <button key={v} role="radio" aria-checked={toleranceOf(ev) === v} disabled={savingTol} onClick={() => changeTolerance(v)}
                    className={cn('mono rounded border px-2 py-0.5 text-[12px] font-medium disabled:opacity-50',
                      toleranceOf(ev) === v ? 'border-primary bg-primary text-primary-foreground' : 'hover:border-primary/60')}>
                    {v === 0 ? 'Tắt' : `${v} m`}
                  </button>
                ))}
              </div>
            </div>
          </section>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-muted-foreground">Tọa độ</dt><dd className="mono truncate">{ev.lat.toFixed(6)}, {ev.lng.toFixed(6)}</dd>
            <dt className="text-muted-foreground">Bán kính</dt><dd className="mono">{ev.radius} m</dd>
            <dt className="text-muted-foreground">Ngưỡng</dt><dd className="mono">≤ {ev.radius + toleranceOf(ev)} m</dd>
            <dt className="text-muted-foreground">Mã</dt><dd className="mono truncate">{ev.id}</dd>
          </dl>
        </div>

        {/* Roster */}
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="num text-4xl font-bold leading-none">{nPresent}</span>
              <span className="num text-lg text-muted-foreground">/ {ev.invited} có mặt</span>
              {nOutside > 0 && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn">+{nOutside} ngoài danh sách</span>}
            </div>
            <div className="inline-flex rounded-md border p-0.5 text-[13px]" role="tablist">
              {(['all', 'present', 'absent'] as const).map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
                  className={cn('rounded px-2.5 py-1 font-medium', filter === f ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {{ all: 'Tất cả', present: 'Có mặt', absent: 'Vắng' }[f]}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border bg-card">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-muted/60 text-left text-[12px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Người tham dự</th>
                  <th className="px-3 py-2 font-medium">Trạng thái</th>
                  <th className="px-3 py-2 text-right font-medium">Giờ</th>
                  <th className="px-3 py-2 text-right font-medium">Cách phòng</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {roster === null ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Đang tải danh sách…</td></tr>
                ) : shown.length === 0 ? (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">Không có dòng nào.</td></tr>
                ) : shown.map((r) => (
                  <tr key={r.key}>
                    <td className="max-w-[280px] px-3 py-2">
                      {r.email ? <div className="mono truncate text-[13px]" title={r.email}>{r.email}</div> : null}
                      {r.name ? <div className="truncate text-[12px] text-muted-foreground">{r.name}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      {r.at ? (
                        <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', r.invited ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>
                          {r.invited ? 'Có mặt' : 'Ngoài danh sách'}
                        </span>
                      ) : (
                        <span className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{phase === 'closed' ? 'Vắng' : 'Chưa điểm danh'}</span>
                      )}
                    </td>
                    <td className="num px-3 py-2 text-right text-[13px]">{r.at ? fmtTime(r.at) : '—'}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right text-[13px] text-muted-foreground">
                      {r.dist != null ? `${Math.round(r.dist)} m ±${r.acc}` : '—'}
                      {r.dist != null && r.dist > ev.radius && (
                        <span className="ml-1 rounded bg-warn-soft px-1 text-[10px] font-semibold text-warn" title={`Ngoài bán kính ${ev.radius} m, được chấp nhận nhờ sai số GPS (ngưỡng ${r.limit ?? '—'} m)`}>SS</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sửa sự kiện điểm danh</DialogTitle>
            <DialogDescription>Liên kết mã QR không đổi. Nếu đổi giờ hoặc phòng, ảnh QR đã gửi trước đó vẫn ghi thông tin cũ.</DialogDescription>
          </DialogHeader>
          {roster && (
            <EventForm p={p} session={session} initial={{ event: ev, roster }} onCancel={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                setJustSaved(true);
                setNote({ tone: 'ok', text: 'Đã lưu thay đổi. Nếu bạn đổi giờ hoặc phòng, hãy tải lại ảnh QR và gửi lại cho thành viên.' });
              }} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={projector} onOpenChange={setProjector}>
        <DialogContent className="max-w-[min(92vw,720px)]">
          <DialogHeader>
            <DialogTitle className="text-2xl">{ev.title}</DialogTitle>
            <DialogDescription className="num">{ev.location ? `${ev.location} · ` : ''}Điểm danh {fmtWindow(ev)}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px] sm:items-center">
            <div className="rounded-md bg-white p-2"><img src={qr} alt="" className="aspect-square w-full" /></div>
            <div className="space-y-3">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                <li>Mở camera điện thoại, quét mã.</li>
                <li>Đăng nhập bằng email trường.</li>
                <li>Cho phép truy cập vị trí và bấm <b>Điểm danh</b>.</li>
              </ol>
              <div className={cn('rounded-md px-3 py-2', phase === 'open' ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground')}>
                <div className="text-[11px] font-semibold uppercase tracking-wider opacity-90">{phase === 'open' ? 'Còn lại' : phase === 'upcoming' ? 'Mở lúc' : 'Đã đóng lúc'}</div>
                <div className="num text-3xl font-bold">{phase === 'open' ? fmtRemaining(checkinEndMs(ev) - now) : phase === 'upcoming' ? fmtClock(ev.start) : fmtClock(checkinEndMs(ev))}</div>
              </div>
              <div>
                <div className="eyebrow">Đã có mặt</div>
                <div className="num text-5xl font-bold">{nPresent}<span className="text-2xl text-muted-foreground">/{ev.invited}</span></div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cardOpen} onOpenChange={setCardOpen}>
        <DialogContent className="max-h-[94dvh] max-w-[min(92vw,560px)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ảnh mã QR gửi thành viên</DialogTitle>
            <DialogDescription>Tải ảnh rồi đính kèm vào email gửi {roster?.emails.length ?? 0} người trong danh sách.</DialogDescription>
          </DialogHeader>
          {card && <img src={card.url} alt={`Ảnh mã QR điểm danh ${ev.title}`} className="w-full rounded border" />}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => copy('Nội dung email', inviteText(ev, link))}>Sao chép nội dung email</Button>
            <Button onClick={saveCard} disabled={cardBusy}>Tải ảnh (PNG)</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!copyFallback} onOpenChange={(o) => !o && setCopyFallback(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{copyFallback?.title}</DialogTitle>
            <DialogDescription>Trình duyệt chặn sao chép tự động. Nội dung đã được chọn sẵn — nhấn Ctrl+C (hoặc giữ để sao chép trên điện thoại).</DialogDescription>
          </DialogHeader>
          <textarea id="copy-fallback" readOnly rows={10} value={copyFallback?.text ?? ''} onFocus={(e) => e.currentTarget.select()} autoFocus
            className="mono w-full rounded-md border bg-muted/40 p-2 text-[12px]" />
        </DialogContent>
      </Dialog>
    </div>
  );
}
