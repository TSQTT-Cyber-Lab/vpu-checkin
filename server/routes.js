// Generic document/collection API matching src/lib/platform.ts's Store/DocRef/ColRef
// contract, with authorize.js enforcing who may read/write each path.
import express from 'express';
import { deleteDoc, getDoc, listCollection, setDoc, updateDoc } from './db.js';
import { authorize } from './authorize.js';

export function apiRouter({ bootstrapAdminEmail }) {
  const router = express.Router();

  async function loadRolesDoc() {
    const snap = await getDoc('config/roles');
    return snap.exists ? snap.data : { entries: [] };
  }

  async function guard(req, res, path) {
    const rolesDoc = await loadRolesDoc();
    const ok = await authorize({ method: req.method, path, session: req.session, rolesDoc, bootstrapAdminEmail });
    if (!ok) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  // Express 4 string wildcard: req.params[0] holds everything after '/doc/'.
  router.get('/doc/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    res.json(await getDoc(path));
  });

  router.put('/doc/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    await setDoc(path, req.body);
    res.json({ ok: true });
  });

  router.patch('/doc/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    try {
      await updateDoc(path, req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.code === 'invalid_argument' ? 404 : 500).json({ error: e.message });
    }
  });

  router.delete('/doc/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    await deleteDoc(path);
    res.json({ ok: true });
  });

  router.get('/collection/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 500));
    res.json({ docs: await listCollection(path, limit) });
  });

  return router;
}
