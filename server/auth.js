// Session cookie (hand-rolled HMAC, no JWT dependency needed for one fixed shape) +
// Google ID-token verification. No client secret is used: verifyIdToken only needs the
// client id, which is public by design (it's already shipped to the browser).
import crypto from 'node:crypto';
import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { upsertUser } from './db.js';

const COOKIE_NAME = 'vpu_session';
const MAX_AGE_MS = 30 * 24 * 3600e3; // 30 days

function sign(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token, secret) {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i === -1) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(req, res, token, maxAgeSeconds) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure ? '; Secure' : ''}`,
  );
}

export function sessionMiddleware(secret) {
  return (req, _res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const payload = verify(cookies[COOKIE_NAME], secret);
    req.session = payload ? { email: payload.email, name: payload.name, picture: payload.picture } : null;
    next();
  };
}

export function authRouter({ secret, googleClientId }) {
  const router = express.Router();
  const client = googleClientId ? new OAuth2Client(googleClientId) : null;

  router.get('/config', (_req, res) => res.json({ googleClientId: googleClientId || null }));

  router.get('/auth/me', (req, res) => res.json(req.session ?? { email: null }));

  router.post('/auth/google', async (req, res) => {
    if (!client) {
      return res.status(400).json({ error: 'Google sign-in chưa được cấu hình (thiếu GOOGLE_CLIENT_ID trên máy chủ).' });
    }
    try {
      const ticket = await client.verifyIdToken({ idToken: req.body?.credential, audience: googleClientId });
      const payload = ticket.getPayload();
      if (!payload?.email) throw new Error('Token không có địa chỉ email.');
      const user = { email: payload.email.toLowerCase(), name: payload.name || '', picture: payload.picture || '' };
      await upsertUser(user);
      const token = sign({ ...user, exp: Date.now() + MAX_AGE_MS }, secret);
      setSessionCookie(req, res, token, MAX_AGE_MS / 1000);
      res.json(user);
    } catch (e) {
      res.status(401).json({ error: 'Không xác minh được đăng nhập Google.', detail: e?.message });
    }
  });

  router.post('/auth/signout', (req, res) => {
    setSessionCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  return router;
}
