import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Notice } from '@/components/bits';
import type { Platform } from '@/lib/platform';
import {
  DEFAULT_RADIUS, DEFAULT_TOLERANCE, DEFAULT_WINDOW, WINDOW_PRESETS, windowLabel, MAX_TOLERANCE, TOLERANCE_PRESETS, type EventDoc, emailsFromFile, extractEmails, getBestPosition,
  newEventId, parseMapCoordinates, resolveEmails, toLocalInput, uidsOf,
} from '@/lib/domain';
import { hashEmails, type Session } from '@/lib/auth';

type Msg = { tone: 'ok' | 'bad' | 'info'; text: string } | null;

export function EventForm({ p, session, onCreated, onCancel }: {
  p: Platform; session: Session; onCreated: (id: string) => void; onCancel: () => void;
}) {
  const openedAt = useRef(new Date());
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [start, setStart] = useState(() => toLocalInput(new Date(Date.now() + 5 * 60e3)));
  const [end, setEnd] = useState(() => toLocalInput(new Date(Date.now() + 95 * 60e3)));
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS));
  const [tolerance, setTolerance] = useState(String(DEFAULT_TOLERANCE));
  const [win, setWin] = useState<number>(DEFAULT_WINDOW);
  const [mapText, setMapText] = useState('');
  const [emailsText, setEmailsText] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [locating, setLocating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const emails = extractEmails(emailsText);

  function applyMapText(text: string) {
    setMapText(text);
    if (!text.trim()) return;
    const pt = parseMapCoordinates(text);
    if (pt) {
      setLat(String(pt.lat));
      setLng(String(pt.lng));
      setMsg({ tone: 'ok', text: `Đã lấy tọa độ ${pt.lat}, ${pt.lng}.` });
    } else {
      setMsg({ tone: 'bad', text: 'Không tìm thấy tọa độ. Trong Google Maps, nhấp chuột phải vào phòng họp và bấm dòng tọa độ để copy, hoặc copy URL có dạng @vĩ độ,kinh độ.' });
    }
  }

  async function useMyPosition() {
    setLocating(true);
    try {
      const c = await getBestPosition(15000, 10);
      setLat(c.latitude.toFixed(6));
      setLng(c.longitude.toFixed(6));
      setMsg({ tone: c.accuracy > 30 ? 'info' : 'ok', text: `Đã lấy vị trí hiện tại (sai số ±${Math.round(c.accuracy)} m).${c.accuracy > 30 ? ' Sai số lớn, nên đối chiếu lại trên Google Maps.' : ''}` });
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e.message });
    } finally {
      setLocating(false);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      const found = await emailsFromFile(file);
      if (!found.length) {
        setMsg({ tone: 'bad', text: `Không tìm thấy địa chỉ email nào trong ${file.name}.` });
        return;
      }
      const merged = [...new Set([...emails, ...found])];
      setEmailsText(merged.join('\n'));
      setMsg({ tone: 'ok', text: `Đã nhập ${found.length} email từ ${file.name}; danh sách có ${merged.length} email (đã bỏ trùng).` });
    } catch (e: any) {
      setMsg({ tone: 'bad', text: e.message });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const created = new Date();
    const s = new Date(start), e = new Date(end);
    const la = Number(lat), ln = Number(lng), r = Number(radius), tol = Number(tolerance);
    // datetime-local has minute resolution: tolerate the current minute.
    const floorMinute = new Date(created.getTime());
    floorMinute.setSeconds(0, 0);
    if (!title.trim()) return setMsg({ tone: 'bad', text: 'Nhập tên cuộc họp hoặc buổi học.' });
    if (isNaN(s.getTime()) || s < floorMinute) return setMsg({ tone: 'bad', text: 'Giờ bắt đầu không được sớm hơn thời điểm tạo điểm danh.' });
    if (isNaN(e.getTime()) || e <= s) return setMsg({ tone: 'bad', text: 'Giờ kết thúc phải sau giờ bắt đầu.' });
    if (!lat || !lng || !isFinite(la) || !isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return setMsg({ tone: 'bad', text: 'Tọa độ phòng chưa hợp lệ: vĩ độ trong [-90, 90], kinh độ trong [-180, 180].' });
    if (!isFinite(r) || r < 10 || r > 500) return setMsg({ tone: 'bad', text: 'Bán kính cho phép từ 10 đến 500 m.' });
    if (tolerance === '' || !isFinite(tol) || tol < 0 || tol > MAX_TOLERANCE) return setMsg({ tone: 'bad', text: `Sai số GPS cho phép từ 0 đến ${MAX_TOLERANCE} m.` });
    if (!emails.length) return setMsg({ tone: 'bad', text: 'Danh sách tham dự cần ít nhất một email hợp lệ.' });

    setSaving(true);
    try {
      const id = newEventId();
      // Eligibility runs on the hashed list; the directory lookup is only a
      // convenience for managers and must not block creating the event.
      const emailHashes = await hashEmails(emails);
      let map: Record<string, string | null> = {};
      try {
        map = await resolveEmails(p.search, emails, (d, t) => setProgress([d, t]));
      } catch {
        map = Object.fromEntries(emails.map((m) => [m, null]));
      }
      const uids = uidsOf(map);
      const doc: EventDoc = {
        title: title.trim(), location: location.trim(),
        start: s.toISOString(), end: e.toISOString(),
        lat: la, lng: ln, radius: Math.round(r), tolerance: Math.round(tol), window: win,
        uids, emailHashes, invited: emails.length, unresolved: emails.filter((m) => !map[m]).length,
        createdAt: created.toISOString(), createdBy: session.email,
      };
      await p.db.doc(`roster/${id}`).set({ emails, map });
      await p.db.doc(`events/${id}`).set(doc as unknown as Record<string, unknown>);
      onCreated(id);
    } catch (err: any) {
      setMsg({
        tone: 'bad',
        text: err?.code === 'invalid_argument'
          ? 'Tài khoản này không có quyền tạo sự kiện (cần quyền "Có thể chỉnh sửa" trên trang).'
          : err?.message || 'Không lưu được sự kiện.',
      });
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <fieldset className="grid gap-3">
        <legend className="eyebrow mb-1">Thông tin</legend>
        <div className="grid gap-1.5">
          <Label htmlFor="f-title">Tên cuộc họp / buổi học</Label>
          <Input id="f-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Họp giao ban Khoa CNTT tháng 9" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-loc">Phòng</Label>
          <Input id="f-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Phòng A2.05" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="f-start">Bắt đầu</Label>
            <Input id="f-start" type="datetime-local" value={start} min={toLocalInput(openedAt.current)}
              onChange={(e) => { setStart(e.target.value); }} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-end">Kết thúc</Label>
            <Input id="f-end" type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium" id="f-win-label">Thời gian nhận điểm danh (tính từ giờ bắt đầu)</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby="f-win-label">
            {WINDOW_PRESETS.map((m) => (
              <Button key={m} type="button" size="sm" role="radio" aria-checked={win === m} variant={win === m ? 'default' : 'outline'} className="h-8" onClick={() => setWin(m)}>
                {windowLabel(m)}
              </Button>
            ))}
          </div>
          <p className="text-[13px] text-muted-foreground">
            {(() => {
              const s0 = new Date(start), e0 = new Date(end);
              if (isNaN(s0.getTime())) return 'Chọn giờ bắt đầu để xem khung điểm danh.';
              const close = win ? new Date(Math.min(s0.getTime() + win * 60e3, isNaN(e0.getTime()) ? Infinity : e0.getTime())) : e0;
              const f = (d: Date) => isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
              return `Nhận điểm danh từ ${f(s0)} đến ${f(close)}; sau đó mã QR hết hiệu lực.`;
            })()}
          </p>
        </div>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="eyebrow mb-1">Vị trí phòng</legend>
        <div className="grid gap-1.5">
          <Label htmlFor="f-map">Dán từ Google Maps</Label>
          <Input id="f-map" value={mapText} onChange={(e) => applyMapText(e.target.value)}
            placeholder="12.2388, 109.1967  hoặc  https://www.google.com/maps/@12.2388,109.1967,19z" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_110px]">
          <div className="grid gap-1.5">
            <Label htmlFor="f-lat">Vĩ độ</Label>
            <Input id="f-lat" className="mono" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="12.238800" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-lng">Kinh độ</Label>
            <Input id="f-lng" className="mono" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="109.196700" />
          </div>
          <div className="col-span-2 grid gap-1.5 sm:col-span-1">
            <Label htmlFor="f-radius">Bán kính (m)</Label>
            <Input id="f-radius" className="mono" type="number" min={10} max={500} value={radius} onChange={(e) => setRadius(e.target.value)} />
          </div>
        </div>
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={useMyPosition} disabled={locating}>
            {locating ? 'Đang định vị…' : 'Dùng vị trí hiện tại của tôi'}
          </Button>
          <p className="mt-1.5 text-[13px] text-muted-foreground">Dùng khi bạn đang đứng trong phòng.</p>
        </div>
        <div className="grid gap-1.5 rounded-md border bg-muted/40 p-3">
          <Label htmlFor="f-tol">Sai số GPS chấp nhận thêm (m)</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="f-tol" className="mono w-24" type="number" min={0} max={MAX_TOLERANCE} step={5} value={tolerance} onChange={(e) => setTolerance(e.target.value)} />
            {TOLERANCE_PRESETS.map((v) => (
              <Button key={v} type="button" size="sm" variant={Number(tolerance) === v ? 'default' : 'outline'} className="h-8 px-2.5" onClick={() => setTolerance(String(v))}>
                {v === 0 ? 'Tắt' : `${v} m`}
              </Button>
            ))}
          </div>
          <p className="text-[13px] text-muted-foreground">
            Trong nhà GPS thường lệch 50–80 m. Người tham dự được chấp nhận khi khoảng cách ≤ bán kính + sai số điện thoại báo (tối đa mức này).
            Ngưỡng xa nhất hiện tại: <span className="mono font-semibold text-foreground">{(Number(radius) || 0) + Math.min(MAX_TOLERANCE, Math.max(0, Number(tolerance) || 0))} m</span>.
          </p>
        </div>
      </fieldset>

      <fieldset className="grid gap-2">
        <legend className="eyebrow mb-1">Danh sách tham dự</legend>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} id="f-file" type="file" accept=".csv,.xlsx,.txt" className="sr-only" onChange={(e) => importFile(e.target.files?.[0])} />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>Nhập từ CSV / XLSX</Button>
          <span className="num text-[13px] text-muted-foreground">{emails.length} email hợp lệ</span>
        </div>
        <Label htmlFor="f-emails" className="sr-only">Email được phép</Label>
        <Textarea id="f-emails" rows={6} className="mono text-[13px]" value={emailsText} onChange={(e) => setEmailsText(e.target.value)}
          placeholder={'Mỗi dòng một email, hoặc dán nguyên cột từ Excel\nnguyen.van.a@tbd.edu.vn\ntran.thi.b@tbd.edu.vn'} />
        <p className="text-[13px] text-muted-foreground">File có thể có dòng tiêu đề và nhiều cột; hệ thống tự lọc email, bỏ trùng, rồi đối chiếu từng email với tài khoản trong tổ chức. Email không khớp tài khoản sẽ được đánh dấu để bạn xử lý.</p>
      </fieldset>

      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>Hủy</Button>
        <Button type="submit" disabled={saving}>{saving ? (progress ? `Đang đối chiếu tài khoản ${progress[0]}/${progress[1]}…` : 'Đang lưu…') : 'Tạo sự kiện và mã QR'}</Button>
      </div>
    </form>
  );
}
