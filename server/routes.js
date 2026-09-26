// Generic document/collection API matching src/lib/platform.ts's Store/DocRef/ColRef
// contract, with authorize.js enforcing who may read/write each path.
import express from 'express';
import * as db from './db.js';
import { authorize, eventIdsOwnedBy, filterAttRecords } from './authorize.js';
import { computeRole } from './roles.js';

// `store` is injectable so the routes can be tested without Postgres.
export function apiRouter({ bootstrapAdminEmail, store = db }) {
  const { deleteDoc, deleteEventCascade, getDoc, listCollection, setDoc, updateDoc } = store;
  const router = express.Router();

  async function loadRolesDoc() {
    const snap = await getDoc('config/roles');
    return snap.exists ? snap.data : { entries: [] };
  }

  async function loadDoc(path) {
    const snap = await getDoc(path);
    return snap.exists ? snap.data : null;
  }

  // Sends 403 and returns null when the request isn't allowed; otherwise returns the caller's role.
  async function guard(req, res, path) {
    const rolesDoc = await loadRolesDoc();
    const ok = await authorize({
      method: req.method, path, session: req.session, rolesDoc, bootstrapAdminEmail, body: req.body, loadDoc,
    });
    if (!ok) {
      res.status(403).json({ error: 'forbidden' });
      return null;
    }
    return computeRole(rolesDoc, req.session?.email, bootstrapAdminEmail);
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
    // Deleting an event also removes its roster and every attendee's record of it.
    const eventId = path.match(/^events\/([^/]+)$/)?.[1];
    if (eventId) await deleteEventCascade(eventId);
    else await deleteDoc(path);
    res.json({ ok: true });
  });

  router.get('/collection/*', async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    const role = await guard(req, res, path);
    if (!role) return;
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 500));
    // A manager sees attendance only for the events they created; an admin sees everything.
    // Filtering happens after the fetch, so read the maximum and cut to `limit` afterwards.
    const narrowed = path === 'att' && !role.isAdmin;
    let docs = await listCollection(path, narrowed ? 2000 : limit);
    if (narrowed) {
      docs = filterAttRecords(docs, eventIdsOwnedBy(await listCollection('events', 2000), req.session.email)).slice(0, limit);
    }
    res.json({ docs });
  });

  return router;
}
