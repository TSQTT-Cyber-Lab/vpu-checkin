// Renders a shareable PNG "attendance card": title, time window, room, QR, instructions.
// Brand: white ground, deep navy, bright red accent.
import QRCode from 'qrcode';
import { type EventRow, fmtClock, fmtWindow, checkinEndMs, windowLabel, toleranceOf } from '@/lib/domain';

export const BRAND = { navy: '#0B2A66', navyInk: '#0A1B3F', red: '#E5172F', white: '#FFFFFF', mist: '#EEF2FA', slate: '#4A5878' };

const FONT = "'Be Vietnam Pro', 'Segoe UI', Roboto, system-ui, sans-serif";

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxW && last.length) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function renderQrCard(ev: EventRow, link: string): Promise<Blob> {
  try { await document.fonts?.ready; } catch { /* fonts optional */ }
  const W = 1080, H = 1440, P = 72;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;

  // ground
  ctx.fillStyle = BRAND.white;
  ctx.fillRect(0, 0, W, H);

  // header band
  ctx.fillStyle = BRAND.navy;
  ctx.fillRect(0, 0, W, 360);
  ctx.fillStyle = BRAND.red;
  ctx.fillRect(0, 360, W, 12);

  ctx.fillStyle = BRAND.white;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 28px ${FONT}`;
  ctx.globalAlpha = 0.8;
  ctx.fillText('VPU ĐIỂM DANH · MÃ QR TỰ ĐIỂM DANH', P, P + 28);
  ctx.globalAlpha = 1;
  ctx.font = `700 64px ${FONT}`;
  const titleLines = wrap(ctx, ev.title, W - 2 * P, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, P, P + 110 + i * 78));
  ctx.font = `500 32px ${FONT}`;
  ctx.globalAlpha = 0.85;
  const meetDate = new Date(ev.start).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  ctx.fillText(`${ev.location ? ev.location + ' · ' : ''}${meetDate}`, P, 320);
  ctx.globalAlpha = 1;

  // window strip
  const stripY = 420;
  roundRect(ctx, P, stripY, W - 2 * P, 150, 20);
  ctx.fillStyle = BRAND.mist;
  ctx.fill();
  ctx.fillStyle = BRAND.red;
  roundRect(ctx, P, stripY, 14, 150, 7);
  ctx.fill();
  ctx.fillStyle = BRAND.slate;
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(`THỜI GIAN ĐIỂM DANH · ${windowLabel(ev.window ?? 0).toUpperCase()}`, P + 44, stripY + 50);
  ctx.fillStyle = BRAND.navyInk;
  ctx.font = `700 64px ${FONT}`;
  ctx.fillText(fmtWindow(ev), P + 44, stripY + 122);
  ctx.textAlign = 'right';
  ctx.fillStyle = BRAND.red;
  ctx.font = `700 30px ${FONT}`;
  ctx.fillText(`Đóng lúc ${fmtClock(checkinEndMs(ev))}`, W - P - 32, stripY + 122);
  ctx.textAlign = 'left';

  // QR
  const qrSize = 560;
  const qx = (W - qrSize) / 2, qy = 620;
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, link, { errorCorrectionLevel: 'Q', margin: 0, width: qrSize, color: { dark: BRAND.navyInk, light: BRAND.white } });
  roundRect(ctx, qx - 28, qy - 28, qrSize + 56, qrSize + 56, 28);
  ctx.strokeStyle = BRAND.navy;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.drawImage(qrCanvas, qx, qy, qrSize, qrSize);
  // red corner ticks
  ctx.fillStyle = BRAND.red;
  const t = 44, k = 10, o = 28;
  for (const [x, y, sx, sy] of [[qx - o, qy - o, 1, 1], [qx + qrSize + o, qy - o, -1, 1], [qx - o, qy + qrSize + o, 1, -1], [qx + qrSize + o, qy + qrSize + o, -1, -1]] as const) {
    ctx.fillRect(sx > 0 ? x : x - t, sy > 0 ? y : y - k, t, k);
    ctx.fillRect(sx > 0 ? x : x - k, sy > 0 ? y : y - t, k, t);
  }

  // steps
  const sy0 = 1260;
  ctx.fillStyle = BRAND.navyInk;
  ctx.font = `600 30px ${FONT}`;
  const steps = ['Có mặt tại phòng, quét mã hoặc mở liên kết', 'Đăng nhập tài khoản trường', 'Bật vị trí, bấm Điểm danh'];
  const colW = (W - 2 * P) / 3;
  steps.forEach((s, i) => {
    const x = P + i * colW;
    ctx.fillStyle = BRAND.red;
    ctx.beginPath(); ctx.arc(x + 22, sy0 - 10, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = BRAND.white;
    ctx.font = `700 26px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), x + 22, sy0 - 1);
    ctx.textAlign = 'left';
    ctx.fillStyle = BRAND.navyInk;
    ctx.font = `600 26px ${FONT}`;
    wrap(ctx, s, colW - 70, 2).forEach((l, j) => ctx.fillText(l, x + 58, sy0 + j * 34));
  });

  // footer
  ctx.fillStyle = BRAND.slate;
  ctx.font = `400 22px ${FONT}`;
  ctx.fillText(`Chỉ nhận trong bán kính ${ev.radius} m của phòng (+ sai số GPS tới ${toleranceOf(ev)} m) · Mã ${ev.id}`, P, H - 48);

  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Không tạo được ảnh.'))), 'image/png'));
}

export function inviteText(ev: EventRow, link: string): string {
  return [
    `[Điểm danh] ${ev.title}`,
    '',
    `Thời gian họp: ${new Date(ev.start).toLocaleString('vi-VN', { dateStyle: 'full', timeStyle: 'short' })} – ${fmtClock(ev.end)}`,
    ev.location ? `Địa điểm: ${ev.location}` : '',
    `Điểm danh: ${fmtWindow(ev)} (${ev.window ? `trong ${ev.window} phút đầu` : 'suốt buổi họp'})`,
    '',
    'Khi có mặt tại phòng, quét mã QR đính kèm (hoặc mở liên kết dưới đây), đăng nhập tài khoản claude.ai bằng email trường, cho phép truy cập vị trí và bấm "Điểm danh".',
    link,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
}
