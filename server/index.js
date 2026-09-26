import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authRouter, sessionMiddleware } from './auth.js';
import { apiRouter } from './routes.js';
import { getDoc, pool, setDoc, waitForDb } from './db.js';
import { normalizeEmail } from './roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const AUTH_SECRET = process.env.AUTH_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const BOOTSTRAP_ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL || 'son.pt@tbd.edu.vn';

if (!AUTH_SECRET || AUTH_SECRET === 'replace-with-a-strong-random-secret') {
  console.error('AUTH_SECRET is unset or still the placeholder value — refusing to start. Generate one with `openssl rand -base64 32`.');
  process.exit(1);
}
if (!GOOGLE_CLIENT_ID) {
  console.warn('GOOGLE_CLIENT_ID is not set — sign-in will be unavailable until it is configured.');
}

/** Ensures BOOTSTRAP_ADMIN_EMAIL has a real, `locked` admin entry in config/roles. The client reads roles
 * from that document, so what it shows must match what the server enforces (roles.js always treats this
 * address as admin, and authorize.js refuses any write that removes, demotes or unlocks the entry).
 * A stale `locked` flag on any other address (the env var changed) is cleared. */
async function seedBootstrapAdmin() {
  const snap = await getDoc('config/roles');
  const roles = snap.exists ? snap.data : { entries: [] };
  // Junk (a null, a string, a missing address) is dropped: it would make every request throw.
  const raw = Array.isArray(roles.entries) ? roles.entries : [];
  const entries = raw.filter((e) => e && typeof e === 'object' && !Array.isArray(e) && typeof e.email === 'string');
  const isBoot = (e) => normalizeEmail(e.email) === normalizeEmail(BOOTSTRAP_ADMIN_EMAIL);
  const settled = Array.isArray(roles.entries) && entries.length === raw.length
    && entries.filter(isBoot).length === 1
    && entries.some((e) => isBoot(e) && e.role === 'admin' && e.locked === true)
    && !entries.some((e) => !isBoot(e) && 'locked' in e);
  if (settled) return;
  const others = entries.filter((e) => !isBoot(e)).map((e) => {
    const rest = { ...e };
    delete rest.locked;
    return rest;
  });
  const found = entries.find(isBoot);
  await setDoc('config/roles', {
    ...roles,
    entries: [...others, { email: BOOTSTRAP_ADMIN_EMAIL, name: '', addedAt: new Date().toISOString(), addedBy: null, ...found, role: 'admin', locked: true }],
  });
  console.log(`Locked bootstrap admin: ${BOOTSTRAP_ADMIN_EMAIL}`);
}

async function main() {
  await waitForDb();
  await seedBootstrapAdmin();

  const app = express();
  app.set('trust proxy', true); // nginx terminates TLS in front of this
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.status(200).send('ok');
    } catch {
      res.status(503).send('db unavailable');
    }
  });

  app.use(sessionMiddleware(AUTH_SECRET));
  app.use('/api', authRouter({ secret: AUTH_SECRET, googleClientId: GOOGLE_CLIENT_ID }));
  app.use('/api', apiRouter({ bootstrapAdminEmail: BOOTSTRAP_ADMIN_EMAIL }));

  const distDir = path.join(__dirname, '..', 'dist');
  app.use(express.static(distDir, { index: false }));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

  app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
}

main().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});
