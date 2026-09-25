// Automatic end-of-check-in report: once an event's check-in window closes, the
// attendance list is emailed once to the manager who created it (EventForm.tsx sets
// `createdBy` to the creator's sign-in email). A periodic scan (see startReportScheduler
// in index.js) is used instead of a per-request timer because closing happens with no
// request in flight — nobody is necessarily looking at the page when the window ends.
import { getDoc, listCollection, updateDoc } from './db.js';
import { isMailerConfigured, sendMail } from './mailer.js';

const RETRY_AFTER_MS = 5 * 60 * 1000; // back off a failed send instead of retrying every scan

function checkinEndMs(ev) {
  const end = Date.parse(ev.end);
  return ev.window ? Math.min(end, Date.parse(ev.start) + ev.window * 60e3) : end;
}

function csvEscape(v) {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"';
}

function fmtRange(start, end) {
  return `${new Date(start).toLocaleString('vi-VN')} – ${new Date(end).toLocaleString('vi-VN')}`;
}

function buildAttendanceCsv(ev, roster, attendees) {
  const normalize = (e) => String(e ?? '').trim().toLowerCase();
  const byEmail = new Map(attendees.filter((a) => a.email).map((a) => [normalize(a.email), a]));
  const byUid = new Map(attendees.map((a) => [a.uid, a]));
  const claimed = new Set();

  const rows = [];
  for (const email of roster?.emails ?? []) {
    const uid = roster?.map?.[email] ?? null;
    const hit = byEmail.get(normalize(email)) ?? (uid ? byUid.get(uid) : undefined);
    if (hit) claimed.add(hit.uid);
    const r = hit?.records?.[ev.id];
    rows.push([email, hit?.name ?? '', r ? 'Có mặt' : 'Vắng', r?.at ? new Date(r.at).toLocaleString('vi-VN') : '', r?.dist ?? '', r?.acc ?? '', r?.limit ?? '', '']);
  }
  for (const a of attendees) {
    if (claimed.has(a.uid)) continue;
    const r = a.records?.[ev.id];
    if (!r) continue;
    rows.push([a.email ?? '', a.name ?? '', 'Có mặt', new Date(r.at).toLocaleString('vi-VN'), r.dist ?? '', r.acc ?? '', r.limit ?? '', 'Không có trong danh sách']);
  }

  const present = rows.filter((r) => r[2] === 'Có mặt').length;
  const head = ['Email', 'Tên', 'Trạng thái', 'Thời điểm điểm danh', 'Khoảng cách (m)', 'Sai số GPS (m)', 'Ngưỡng áp dụng (m)', 'Ghi chú'];
  const meta = [
    ['Sự kiện', ev.title], ['Phòng', ev.location || ''], ['Thời gian họp', fmtRange(ev.start, ev.end)],
    ['Có mặt', `${present}/${ev.invited ?? roster?.emails?.length ?? 0}`], [],
  ];
  return '﻿' + [...meta, head, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

/** Scans `events` for ones whose check-in window just closed and mails the roster once. */
export async function sendClosedEventReports(now = Date.now()) {
  if (!isMailerConfigured()) return;

  const events = await listCollection('events', 2000);
  const due = events.filter(({ data }) => {
    if (!data?.createdBy || !data?.start || !data?.end) return false;
    if (now <= checkinEndMs(data)) return false; // still open or upcoming
    if (data.reportSentAt) return false;
    if (data.reportAttemptAt && now - Date.parse(data.reportAttemptAt) < RETRY_AFTER_MS) return false;
    return true;
  });
  if (!due.length) return;

  const attendees = (await listCollection('att', 2000)).map((d) => d.data);

  for (const { id, data: ev } of due) {
    try {
      const rosterSnap = await getDoc(`roster/${id}`);
      const roster = rosterSnap.exists ? rosterSnap.data : { emails: [], map: {} };
      const csv = buildAttendanceCsv({ ...ev, id }, roster, attendees);
      const present = attendees.filter((a) => a.records?.[id]).length;

      await sendMail({
        to: ev.createdBy,
        subject: `[VPU Điểm danh] Danh sách điểm danh: ${ev.title}`,
        text: `Điểm danh cho "${ev.title}" đã kết thúc lúc ${new Date(checkinEndMs(ev)).toLocaleString('vi-VN')}.\n`
          + `Có mặt: ${present}/${ev.invited ?? roster.emails.length}.\n\nDanh sách chi tiết đính kèm (CSV, mở được bằng Excel).`,
        attachments: [{ filename: `diem-danh_${id}.csv`, content: csv, contentType: 'text/csv; charset=utf-8' }],
      });

      await updateDoc(`events/${id}`, { reportSentAt: new Date().toISOString() });
      console.log(`Report sent for event ${id} to ${ev.createdBy}`);
    } catch (e) {
      console.error(`Failed to send report for event ${id}:`, e.message);
      await updateDoc(`events/${id}`, { reportAttemptAt: new Date().toISOString() }).catch(() => {});
    }
  }
}

export function startReportScheduler(intervalMs = 60_000) {
  if (!isMailerConfigured()) {
    console.warn('SMTP_HOST is not set — automatic attendance-report emails are disabled.');
    return;
  }
  const tick = () => sendClosedEventReports().catch((e) => console.error('Report scheduler error:', e));
  tick();
  setInterval(tick, intervalMs);
}
