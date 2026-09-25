# Deploy to Synology NAS

## 0. Before you start

`checkin.ddnsfree.com` currently serves Synology's own **Web Station** default page on
ports 80/443 — DSM's built-in reverse proxy already owns those ports, so the `nginx`
container in this stack can't bind them until you free them up. Pick one:

- **Recommended — DSM reverse proxy, no `nginx` container needed.** In DSM: Control
  Panel → Login Portal → Advanced → Reverse Proxy → Create. Source: `checkin.ddnsfree.com`,
  HTTPS, port 443 (DSM can issue/renew the certificate for you here). Destination:
  `localhost`, HTTP, port `3000` (the `app` container, published directly). This also
  means you don't need the `nginx` service or the self-signed cert step below at all —
  just run `docker compose up -d app db` (omit `nginx`).
- **Or: move Web Station off 80/443**, then let the `nginx` container in this
  `docker-compose.yml` bind them as written (Control Panel → Login Portal or Web
  Station's own port settings — exact location varies by DSM version).

Either way, confirm before continuing:
```bash
curl -I http://checkin.ddnsfree.com   # should NOT say "Web Station" once this is fixed
```

## 1. Prepare folders
On the NAS, create:

- `/volume1/docker/vpu-checkin`
- `/volume1/docker/vpu-checkin/ssl` (only if using the `nginx` container, not the DSM reverse-proxy route)

Then copy these files into that folder:
- `docker-compose.yml`
- `.env.production`
- `nginx.conf` (only if using the `nginx` container)
- `../init-db.sql` → `/volume1/docker/vpu-checkin/init-db.sql`

## 2. Configure `.env`

Rename first:
```bash
cp /volume1/docker/vpu-checkin/.env.production /volume1/docker/vpu-checkin/.env
```

Then edit it and set, at minimum:
- `AUTH_SECRET` — generate with `openssl rand -base64 32`. The server **refuses to
  start** on the placeholder value.
- `GOOGLE_CLIENT_ID` — required for real sign-in. In
  [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services →
  Credentials → Create OAuth client ID → **Web application**. Under "Authorized
  JavaScript origins" add `https://checkin.ddnsfree.com`. No redirect URI is needed —
  this app uses the ID-token flow, not a redirect (`GOOGLE_CLIENT_SECRET` stays blank).
- `BOOTSTRAP_ADMIN_EMAIL` — the Google address that should always be admin (defaults
  to `son.pt@tbd.edu.vn`). Whoever signs in with this address gets admin rights the
  moment they sign in, independent of the roles list.
- `DB_PASSWORD` (and matching `DATABASE_URL`) — change from the placeholder.

## 3. Certs (only if using the `nginx` container, not the DSM reverse-proxy route)

```bash
mkdir -p /volume1/docker/vpu-checkin/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /volume1/docker/vpu-checkin/ssl/privkey.pem \
  -out /volume1/docker/vpu-checkin/ssl/fullchain.pem \
  -subj "/CN=checkin.ddnsfree.com"
```
For production, use a real certificate (Let's Encrypt or DSM's own Certificate manager)
instead of a self-signed one — otherwise every visitor's browser will show a warning,
and some phone browsers block `geolocation` on an untrusted HTTPS page.

## 4. Start the stack

With the DSM reverse-proxy route (recommended):
```bash
cd /volume1/docker/vpu-checkin
docker compose up -d --build app db
```

With the `nginx` container instead:
```bash
docker compose up -d --build
```

## 5. Verify

```bash
docker compose ps                     # app and db both healthy
docker compose logs -f app            # look for "Seeded bootstrap admin: ..." and "Server running"
curl -I https://checkin.ddnsfree.com/health   # expect 200
```
Then open the site, sign in with `BOOTSTRAP_ADMIN_EMAIL`'s Google account, and confirm
the "Quản trị" tab appears.

## 6. DNS / router notes
Make sure:
- `checkin.ddnsfree.com` points to your NAS's public IP
- ports 80 and 443 are forwarded to the NAS
- DDNS is updated correctly
