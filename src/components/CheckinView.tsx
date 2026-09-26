import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CheckLine, Notice, PhasePill } from '@/components/bits';
import type { Platform } from '@/lib/platform';
import {
  type AttendeeDoc, type CheckinRecord, type EventRow,
  checkinEndMs, fmtClock, fmtRange, fmtRemaining, fmtTime, fmtWindow, getBestPosition, haversine, judgeFix, phaseOf, toleranceOf,
} from '@/lib/domain';
import { attKeyOf, hashEmail, isInvited, type Session } from '@/lib/auth';
import { cn } from '@/lib/utils';

type Outcome = { tone: 'ok' | 'bad'; title: string; body?: string } | null;

export function CheckinView({ p, session, events, now, preferredId }: {
  p: Platform; session: Session; events: EventRow[]; now: number; preferredId: string | null;
}) {
  const [myDoc, setMyDoc] = useState<AttendeeDoc | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [lastDist, setLastDist] = useState<{ dist: number; acc: number; ok: boolean; limit: number } | null>(null);
  const [liveAcc, setLiveAcc] = useState<number | null>(null);
  const [myHash, setMyHash] = useState<string | null>(null);
  const [hashErr, setHashErr] = useState<string | null>(null);

  // The signed-in address, hashed once, is the only credential a check-in needs.
  useEffect(() => {
    let alive = true;
    if (!session.email) { setMyHash(null); return; }
    setHashErr(null);
    hashEmail(session.email)
      .then((h) => { if (alive) setMyHash(h); })
      .catch((e) => { if (alive) { setMyHash(null); setHashErr(e?.message || 'Không đối chiếu được danh sách mời.'); } });
    return () => { alive = false; };
  }, [session.email]);

  const attKey = myHash ? attKeyOf(myHash) : null;

  // Own attendance doc (private to this viewer + admins; a manager sees others' records only through the filtered list).
  useEffect(() => {
    if (!attKey) { setMyDoc(null); return; }
    return p.db.doc(`att/${attKey}`).onSnapshot(
      (s) => setMyDoc(s.exists ? (s.data() as AttendeeDoc) : null),
      () => setMyDoc(null),
    );
  }, [p, attKey]);

  // Eligibility: the signed-in email is on the event's (hashed) invite list.
  // Events created before email sign-in fall back to the resolved account ids.
  const eligible = useMemo(() => Object.fromEntries(events.map((e) => [
    e.id,
    e.emailHashes?.length
      ? isInvited(myHash ?? '', e.emailHashes)
      : !!p.me.id && (e.uids ?? []).includes(p.me.id),
  ])), [events, myHash, p.me.id]);

  // Events worth showing to an attendee: open now, or starting within 12 h, or closed within 2 h.
  const visible = useMemo(() => {
    const rank = { open: 0, upcoming: 1, closed: 2 } as const;
    return events
      .filter((e) => {
        const ph = phaseOf(e, now);
        if (e.id === preferredId) return true;
        if (ph === 'open') return true;
        if (ph === 'upcoming') return Date.parse(e.start) - now < 12 * 3600e3;
        return now - checkinEndMs(e) < 2 * 3600e3;
      })
      .sort((a, b) => rank[phaseOf(a, now)] - rank[phaseOf(b, now)] || Date.parse(a.start) - Date.parse(b.start));
  }, [events, now, preferredId]);

  useEffect(() => {
    if (selectedId && visible.some((e) => e.id === selectedId)) return;
    const preferred = visible.find((e) => e.id === preferredId);
    // If preferredId is set but event not found (deleted), don't fallback — show error
    if (preferredId && !preferred) {
      setSelectedId(null);
      return;
    }
    const pick = preferred
      ?? visible.find((e) => phaseOf(e, now) === 'open' && eligible[e.id])
      ?? visible[0];
    setSelectedId(pick?.id ?? null);
  }, [visible, preferredId, eligible, selectedId, now]);

  const avatar = p.google.current()?.picture || p.me.avatarUrl;
  const ev = visible.find((e) => e.id === selectedId) ?? null;
  const record: CheckinRecord | undefined = ev ? myDoc?.records?.[ev.id] : undefined;
  const phase = ev ? phaseOf(ev, now) : null;
  const isEligible = ev ? eligible[ev.id] : undefined;

  useEffect(() => { setOutcome(null); setLastDist(null); }, [selectedId]);

  async function checkIn() {
    if (!ev || !attKey || !session.email) return;
    setBusy(true);
    setOutcome(null);
    try {
      const t = Date.now();
      if (t < Date.parse(ev.start) || t > checkinEndMs(ev)) {
        setOutcome({ tone: 'bad', title: 'Ngoài thời gian điểm danh', body: `Chỉ nhận điểm danh từ ${fmtWindow(ev)}.` });
        return;
      }
      setLiveAcc(null);
      const c = await getBestPosition(10000, 20, (a) => setLiveAcc(a));
      const dist = haversine(ev.lat, ev.lng, c.latitude, c.longitude);
      const j = judgeFix(ev, dist, c.accuracy);
      setLastDist({ dist, acc: c.accuracy, ok: j.ok, limit: j.limit });
      if (!j.ok) {
        setOutcome(j.weakSignal ? {
          tone: 'bad',
          title: 'Tín hiệu định vị quá yếu',
          body: `Điện thoại báo sai số ±${Math.round(c.accuracy)} m, lớn hơn mức cho phép ${j.tol} m, và vị trí đo được cách phòng ${Math.round(dist)} m. Bật Wi-Fi (không cần kết nối), ra gần cửa sổ rồi bấm lại.`,
        } : {
          tone: 'bad',
          title: 'Bạn không ở phòng họp',
          body: `Vị trí đo được cách phòng khoảng ${Math.round(dist)} m, vượt ngưỡng ${j.limit} m (bán kính ${ev.radius} m + sai số GPS ${Math.round(Math.min(c.accuracy, j.tol))} m).`,
        });
        return;
      }
      if (Date.now() > checkinEndMs(ev)) {
        setOutcome({ tone: 'bad', title: 'Vừa hết giờ điểm danh', body: `Điểm danh đã đóng lúc ${fmtClock(checkinEndMs(ev))}.` });
        return;
      }
      const rec: CheckinRecord = { at: new Date().toISOString(), lat: c.latitude, lng: c.longitude, acc: Math.round(c.accuracy), dist: Math.round(dist * 10) / 10, limit: j.limit };
      const ref = p.db.doc(`att/${attKey}`);
      const cur = await ref.get();
      if (cur.exists) await ref.update({ email: session.email, name: session.name, records: { [ev.id]: rec } });
      else await ref.set({ uid: attKey, email: session.email, name: session.name, records: { [ev.id]: rec } });
      setOutcome({ tone: 'ok', title: 'Đã ghi nhận có mặt', body: `Lúc ${fmtTime(rec.at)}, cách điểm đăng ký ${Math.round(dist)} m.` });
    } catch (err: any) {
      const code = err?.code;
      setOutcome({
        tone: 'bad',
        title: 'Chưa điểm danh được',
        body: code === 'invalid_argument'
          ? 'Tài khoản của bạn chưa có quyền ghi điểm danh. Liên hệ người tổ chức để được cấp quyền "Có thể tương tác" với trang này.'
          : code === 'quota_exceeded' ? 'Kho dữ liệu điểm danh đã đầy. Báo người tổ chức để dọn các sự kiện cũ.'
            : code === 'forbidden' ? 'Máy chủ từ chối lượt điểm danh. Kiểm tra giờ trên điện thoại (không lệch quá 10 phút), khung giờ điểm danh, vị trí và email của bạn có trong danh sách mời; nếu vừa có người sửa sự kiện, hãy tải lại trang rồi thử lại.'
              : err?.message || 'Lỗi không xác định. Thử lại sau vài giây.',
      });
    } finally {
      setBusy(false);
      setLiveAcc(null);
    }
  }

  // ---------- render ----------
  if (!session.email) {
    return <SignInGate p={p} event={events.find((e) => e.id === preferredId) ?? null} />;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Who + which event */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 rounded-md border bg-card p-3.5">
          {avatar ? <img src={avatar} alt="" className="h-10 w-10 rounded-full" /> : <div className="h-10 w-10 rounded-full bg-secondary" />}
          <div className="min-w-0">
            <div className="eyebrow">Điểm danh với tư cách</div>
            <div className="truncate font-semibold">{session.name || session.email}</div>
            <div className="mono truncate text-[13px] text-muted-foreground" title={session.email}>{session.email}</div>
          </div>
        </div>

        {hashErr && <Notice tone="bad" title="Không kiểm tra được danh sách mời">{hashErr}</Notice>}

        <div>
          <div className="eyebrow mb-2">Sự kiện hôm nay</div>
          {visible.length === 0 ? (
            <div className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">
              Không có buổi họp hay buổi học nào đang mở điểm danh. Nếu bạn vừa quét mã QR, hãy kiểm tra lại giờ bắt đầu với người tổ chức.
            </div>
          ) : (
            <ul className="grid gap-2" role="listbox" aria-label="Chọn sự kiện">
              {visible.map((e) => {
                const ph = phaseOf(e, now);
                const done = !!myDoc?.records?.[e.id];
                return (
                  <li key={e.id}>
                    <button
                      role="option"
                      aria-selected={e.id === selectedId}
                      onClick={() => setSelectedId(e.id)}
                      className={cn(
                        'w-full rounded-md border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        e.id === selectedId && 'border-primary ring-1 ring-primary',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold leading-snug">{e.title}</span>
                        {done ? <span className="shrink-0 rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold text-ok">Đã có mặt</span> : <PhasePill phase={ph} />}
                      </div>
                      <div className="mt-1 text-[13px] text-muted-foreground">
                        {e.location && <span>{e.location} · </span>}
                        <span className="num">Điểm danh {fmtWindow(e)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Verification + action */}
      <section className="rounded-md border bg-card p-5">
        {!ev ? (
          <p className="text-sm text-muted-foreground">
            {preferredId
              ? 'Mã QR trỏ tới một sự kiện không còn tồn tại. Liên hệ người tổ chức để nhận mã mới.'
              : 'Chọn một sự kiện để điểm danh.'}
          </p>
        ) : (
          <>
            <div className="eyebrow">Xác minh điểm danh</div>
            <h2 className="mt-1 text-xl font-bold leading-tight">{ev.title}</h2>

            <ul className="mt-3 divide-y">
              <CheckLine
                state={myHash === null ? 'wait' : isEligible ? 'pass' : 'fail'}
                label="Có tên trong danh sách"
                detail={myHash === null ? 'Đang đối chiếu danh sách mời…'
                  : isEligible ? `Email ${session.email} nằm trong danh sách được mời.`
                    : `Email ${session.email} không có trong danh sách được mời của buổi này.`}
              />
              <CheckLine
                state={phase === 'open' ? 'pass' : 'fail'}
                label={phase === 'open' ? 'Trong giờ điểm danh' : phase === 'upcoming' ? 'Chưa đến giờ điểm danh' : 'Đã hết giờ điểm danh'}
                detail={<span className="num">{fmtWindow(ev)}{phase === 'open' ? ` · còn ${fmtRemaining(checkinEndMs(ev) - now)}` : ''} · họp {fmtRange(ev.start, ev.end)}</span>}
              />
              <CheckLine
                state={record ? 'pass' : lastDist ? (lastDist.ok ? 'pass' : 'fail') : busy ? 'wait' : 'idle'}
                label="Trong phạm vi phòng"
                detail={record
                  ? `Cách ${Math.round(record.dist)} m (±${record.acc} m)`
                  : lastDist ? `Cách ${Math.round(lastDist.dist)} m (±${Math.round(lastDist.acc)} m) · ngưỡng ${lastDist.limit} m`
                    : busy ? (liveAcc != null ? `Đang tinh chỉnh vị trí… sai số hiện tại ±${Math.round(liveAcc)} m` : 'Đang xác định vị trí…')
                      : `Bán kính ${ev.radius} m, chấp nhận thêm sai số GPS tới ${toleranceOf(ev)} m`}
              />
            </ul>

            <div className="mt-4 space-y-3">
              {record ? (
                <Notice tone="ok" title="Bạn đã điểm danh sự kiện này">
                  Ghi nhận lúc <span className="num font-semibold">{fmtTime(record.at)}</span>. Không cần điểm danh lại.
                </Notice>
              ) : myHash === null ? (
                <Notice tone="info" title="Đang đối chiếu danh sách mời">Chờ một chút…</Notice>
              ) : !isEligible ? (
                <>
                  <Notice tone="bad" title="Bạn không thuộc danh sách tham dự">
                    Buổi này chỉ nhận điểm danh từ những email đã được mời. Nếu bạn đăng nhập nhầm tài khoản,
                    hãy đăng xuất rồi đăng nhập lại bằng email trường; nếu đúng là nhầm lẫn danh sách, gửi email
                    <span className="mono"> {session.email} </span> cho người tổ chức để được bổ sung.
                  </Notice>
                  <Button variant="outline" className="w-full" onClick={() => p.google.signOut()}>
                    Đăng nhập bằng tài khoản khác
                  </Button>
                </>
              ) : phase !== 'open' ? (
                <Notice tone="warn" title={phase === 'upcoming' ? 'Điểm danh chưa mở' : 'Điểm danh đã đóng'}>
                  {phase === 'upcoming' ? `Mở lúc ${fmtClock(ev.start)}, đóng lúc ${fmtClock(checkinEndMs(ev))}. Trang tự cập nhật khi đến giờ.` : `Điểm danh đã đóng lúc ${fmtClock(checkinEndMs(ev))}. Liên hệ người tổ chức nếu bạn có mặt nhưng chưa kịp điểm danh.`}
                </Notice>
              ) : (
                <>
                <div className="flex items-baseline justify-between rounded-md bg-accent px-3.5 py-2">
                  <span className="text-[13px] font-medium text-accent-foreground">Còn lại để điểm danh</span>
                  <span className={cn('num text-lg font-bold', checkinEndMs(ev) - now <= 3 * 60e3 ? 'text-destructive' : 'text-primary')}>{fmtRemaining(checkinEndMs(ev) - now)}</span>
                </div>
                <Button size="lg" className="h-14 w-full text-base font-semibold" disabled={busy || isEligible !== true} onClick={checkIn}>
                  {busy ? 'Đang xác định vị trí (tối đa 10 giây)…' : 'Điểm danh'}
                </Button>
                </>
              )}
              {outcome && <Notice tone={outcome.tone} title={outcome.title}>{outcome.body}</Notice>}
              {!record && phase === 'open' && isEligible && (
                <p className="text-[13px] text-muted-foreground">
                  Trình duyệt sẽ hỏi quyền truy cập vị trí. Vị trí chỉ được dùng để tính khoảng cách tới phòng và lưu kèm lượt điểm danh.
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Nothing is shown about an event until the visitor says who they are: the invite
 * list is the access control, so identity comes first.
 */
function SignInGate({ p, event }: { p: Platform; event: EventRow | null }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [demoEmail, setDemoEmail] = useState('');
  const btnRef = useRef<HTMLDivElement | null>(null);
  const useRealButton = !p.demo && !!p.google.renderButton;

  // Self-hosted backend: mount Google's own button instead of our generic one, so
  // sign-in goes through a real, verifiable Google flow rather than free-text entry.
  useEffect(() => {
    if (useRealButton && btnRef.current) p.google.renderButton!(btnRef.current);
  }, [useRealButton, p]);

  async function signIn() {
    setBusy(true);
    setErr(null);
    try {
      await p.google.signIn(demoEmail);
    } catch (e: any) {
      setErr(e?.message || 'Không đăng nhập được.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <section className="rounded-md border bg-card p-6 text-center">
        <div className="eyebrow">Điểm danh</div>
        <h2 className="mt-1 text-xl font-bold leading-tight">
          {event ? event.title : 'Đăng nhập để điểm danh'}
        </h2>
        {event && (
          <p className="num mt-1 text-sm text-muted-foreground">
            {event.location ? `${event.location} · ` : ''}Điểm danh {fmtWindow(event)}
          </p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          Hãy đăng nhập bằng <b>email trường</b> đã được mời họp. Chỉ những email có trong danh sách mời
          mới điểm danh được.
        </p>

        {p.demo && (
          <div className="mt-4 grid gap-1.5 text-left">
            <Label htmlFor="demo-email">Chế độ xem thử — nhập email muốn đăng nhập thử</Label>
            <Input id="demo-email" className="mono" inputMode="email" value={demoEmail}
              onChange={(e) => setDemoEmail(e.target.value)} placeholder="lan.nt@tbd.edu.vn" />
          </div>
        )}

        {useRealButton ? (
          <div ref={btnRef} className="mt-4 flex justify-center" />
        ) : (
          <Button size="lg" className="mt-4 h-12 w-full text-base font-semibold" disabled={busy} onClick={signIn}>
            {busy ? 'Đang đăng nhập…' : 'Đăng nhập bằng Google'}
          </Button>
        )}

        {err && <Notice tone="bad" className="mt-3 text-left" title="Chưa đăng nhập được">{err}</Notice>}

        {!p.google.available && !p.demo && (
          <Notice tone="warn" className="mt-3 text-left" title="Trang chưa bật đăng nhập Google">
            Người tổ chức cần bật tính năng đăng nhập Google cho trang này, hoặc bạn đăng nhập claude.ai
            bằng email trường rồi mở lại liên kết từ mã QR.
          </Notice>
        )}
      </section>
    </div>
  );
}
