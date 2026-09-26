// Generic document store on top of Postgres, mirroring the Store/DocRef/ColRef shape
// src/lib/platform.ts already defines (see memoryStore() there for the reference shape).
import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function waitForDb(retries = 30, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

function deepMerge(a, b) {
  const out = { ...a };
  for (const k of Object.keys(b)) {
    const bv = b[k];
    out[k] = bv && typeof bv === 'object' && !Array.isArray(bv) && a?.[k] && typeof a[k] === 'object'
      ? deepMerge(a[k], bv)
      : bv;
  }
  return out;
}

function idOf(path) {
  return path.split('/').pop();
}

export async function getDoc(path) {
  const { rows } = await pool.query('SELECT data FROM documents WHERE path = $1', [path]);
  return { id: idOf(path), exists: rows.length > 0, data: rows[0]?.data ?? null };
}

export async function setDoc(path, data) {
  await pool.query(
    `INSERT INTO documents (path, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (path) DO UPDATE SET data = $2, updated_at = now()`,
    [path, data ?? {}],
  );
}

export async function updateDoc(path, patch) {
  const { rows } = await pool.query('SELECT data FROM documents WHERE path = $1', [path]);
  if (!rows.length) {
    const e = new Error('missing');
    e.code = 'invalid_argument';
    throw e;
  }
  const merged = deepMerge(rows[0].data, patch ?? {});
  await pool.query('UPDATE documents SET data = $2, updated_at = now() WHERE path = $1', [path, merged]);
  return merged;
}

export async function deleteDoc(path) {
  await pool.query('DELETE FROM documents WHERE path = $1', [path]);
}

// One statement, so the event, its roster and every attendee's record of it go together or not
// at all. (A data-modifying WITH runs to completion even though the main query never reads it.)
// An attendee can store any JSON in their own document, so only touch a `records` that really
// is an object: `?` also matches array elements, and `#-` on an array would fail the whole statement.
const CASCADE_SQL = `
  WITH gone AS (DELETE FROM documents WHERE path IN ($2, $3))
  UPDATE documents SET data = data #- ARRAY['records', $1::text], updated_at = now()
  WHERE path LIKE 'att/%' AND path NOT LIKE 'att/%/%'
    AND jsonb_typeof(data->'records') = 'object' AND data->'records' ? $1::text`;

/** Deletes an event with everything that hangs off it: its roster and each attendee's record of it. */
export async function deleteEventCascade(eventId) {
  await pool.query(CASCADE_SQL, [eventId, `events/${eventId}`, `roster/${eventId}`]);
}

/** Ids of the events whose `createdBy` is `email` (compared case-insensitively). */
export async function listEventIdsCreatedBy(email) {
  const { rows } = await pool.query(
    `SELECT substr(path, 8) AS id FROM documents
     WHERE path LIKE 'events/%' AND path NOT LIKE 'events/%/%'
       AND jsonb_typeof(data->'createdBy') = 'string'
       AND lower(regexp_replace(data->>'createdBy', '^\\s+|\\s+$', '', 'g')) = $1`,
    [String(email ?? '').trim().toLowerCase()],
  );
  return rows.map((r) => r.id);
}

/**
 * Attendance documents holding a record of any of `eventIds`, reduced to just those records — so a manager
 * never receives another event's records. Malformed `records` (not an object) are skipped.
 */
export async function listAttForEvents(eventIds, limit) {
  if (!eventIds.length) return [];
  const { rows } = await pool.query(
    `SELECT a.path, jsonb_set(a.data, '{records}', (
              SELECT jsonb_object_agg(r.k, r.v) FROM jsonb_each(a.data->'records') AS r(k, v) WHERE r.k = ANY($1::text[])
            )) AS data
     FROM documents a
     WHERE a.path LIKE 'att/%' AND a.path NOT LIKE 'att/%/%'
       AND jsonb_typeof(a.data->'records') = 'object' AND a.data->'records' ?| $1::text[]
     ORDER BY a.path LIMIT $2`,
    [eventIds, limit],
  );
  return rows.map((r) => ({ id: r.path.split('/').pop(), exists: true, data: r.data }));
}

/** Every document one level deeper than `prefix` — e.g. prefix "events" matches "events/ev-1", not "events/ev-1/x". */
export async function listCollection(prefix, limit) {
  const { rows } = await pool.query(
    `SELECT path, data FROM documents
     WHERE path LIKE $1 AND path NOT LIKE $2
     ORDER BY path
     LIMIT $3`,
    [`${prefix}/%`, `${prefix}/%/%`, limit],
  );
  return rows.map((r) => ({ id: idOf(r.path), exists: true, data: r.data }));
}

export async function upsertUser({ email, name, picture }) {
  await pool.query(
    `INSERT INTO users (email, name, picture) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = $2, picture = $3`,
    [email, name || '', picture || null],
  );
}
