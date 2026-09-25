// SMTP transport for the automatic end-of-check-in report. Reads SMTP_* from the
// environment (see .env.example) — if SMTP_HOST is unset, mail sending is a no-op so
// self-hosted installs without a mail server don't crash the report scheduler.
import nodemailer from 'nodemailer';

let transporter = null;

export function isMailerConfigured() {
  return !!process.env.SMTP_HOST;
}

function getTransporter() {
  if (!isMailerConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

export async function sendMail({ to, subject, text, html, attachments }) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP chưa được cấu hình (thiếu SMTP_HOST trong .env).');
  await t.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject, text, html, attachments,
  });
}
