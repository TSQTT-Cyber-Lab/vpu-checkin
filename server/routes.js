// Generic document/collection API matching src/lib/platform.ts's Store/DocRef/ColRef
// contract, with authorize.js enforcing who may read/write each path.
import express from 'express';
import * as db from './db.js';
import { authorize } from './authorize.js';
import { computeRole } from './roles.js';

// Express 4 does not catch a rejected promise from an async handler, and Node exits on an
// unhandled rejection: one bad request (or a database hiccup) would take the whole server down.
const safe = (handler) => (req, res) => {
  Promise.resolve(handler(req, res)).catch((e) => {
    console.error(`${req.method} ${req.originalUrl} failed:`, e);
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  });
};

// Every stored document is a JSON object; an array would be stored as a Postgres array, not jsonb.
const isPlainObject = (b) => b !== null && typeof b === 'object' && !Array.isArray(b);

// `store` is injectable so the routes can be tested without Postgres.
export function apiRouter({ bootstrapAdminEmail, store = db }) {
  const { deleteDoc, deleteEventCascade, getDoc, listAttForEvents, listCollection, listEventIdsCreatedBy, setDoc, updateDoc } = store;
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
  router.get('/doc/*', safe(async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    res.json(await getDoc(path));
  }));

  router.put('/doc/*', safe(async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    if (!isPlainObject(req.body)) return res.status(400).json({ error: 'body must be a JSON object' });
    await setDoc(path, req.body);
    res.json({ ok: true });
  }));

  router.patch('/doc/*', safe(async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    if (!isPlainObject(req.body)) return res.status(400).json({ error: 'body must be a JSON object' });
    try {
      await updateDoc(path, req.body);
      res.json({ ok: true });
    } catch (e) {
      res.status(e.code === 'invalid_argument' ? 404 : 500).json({ error: e.message });
    }
  }));

  router.delete('/doc/*', safe(async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    if (!(await guard(req, res, path))) return;
    // Deleting an event also removes its roster and every attendee's record of it.
    const eventId = path.match(/^events\/([^/]+)$/)?.[1];
    if (eventId) await deleteEventCascade(eventId);
    else await deleteDoc(path);
    res.json({ ok: true });
  }));

  router.get('/collection/*', safe(async (req, res) => {
    const path = decodeURIComponent(req.params[0]);
    const role = await guard(req, res, path);
    if (!role) return;
    const limit = Math.min(2000, Math.max(1, Number(req.query.limit) || 500));
    // A manager sees attendance only for the events they created (filtered in SQL); an admin sees everything.
    const docs = path === 'att' && !role.isAdmin
      ? await listAttForEvents(await listEventIdsCreatedBy(req.session.email), limit)
      : await listCollection(path, limit);
    res.json({ docs });
  }));

  return router;
}
