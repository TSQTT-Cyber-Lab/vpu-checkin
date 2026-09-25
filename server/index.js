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

/** Ensures BOOTSTRAP_ADMIN_EMAIL always has a real admin entry in config/roles, so the
 * client's normal role resolution (src/lib/auth.ts resolveSession) picks it up without
 * any special-casing — it just looks like any other admin grant. */
async function seedBootstrapAdmin() {
  const snap = await getDoc('config/roles');
  const roles = snap.exists ? snap.data : { entries: [] };
  const already = roles.entries?.some((e) => normalizeEmail(e.email) === normalizeEmail(BOOTSTRAP_ADMIN_EMAIL));
  if (already) return;
  roles.entries = [...(roles.entries ?? []), {
    email: BOOTSTRAP_ADMIN_EMAIL, name: '', role: 'admin', addedAt: new Date().toISOString(), addedBy: null,
  }];
  await setDoc('config/roles', roles);
  console.log(`Seeded bootstrap admin: ${BOOTSTRAP_ADMIN_EMAIL}`);
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
