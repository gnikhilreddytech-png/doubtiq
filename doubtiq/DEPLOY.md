# Deploying DoubtIQ to production

DoubtIQ is a **Node.js + Express** app backed by **PostgreSQL hosted on
Supabase** (node-postgres `pg`). There is no build step, no bundled database
server and no local data directory to persist — the database lives in
Supabase, so the app deploys to almost any Node host (VPS, Render, Railway,
Fly.io, Docker).

---

## What runs the site

| Layer | Technology |
|---|---|
| Server | **Node.js ≥ 18** + **Express** (single process, no build step) |
| Data | **Supabase PostgreSQL** via `pg` (connection pool) |
| Frontend | Static files served by Express (`public/`) |
| Start command | `npm start` → `node server/index.js` |
| Port | `PORT` env var, default **3000**, bound to `0.0.0.0` |
| Connection | `DATABASE_URL` env var (required) |

## Where the data lives

Everything lives in the **Supabase PostgreSQL database** named by
`DATABASE_URL`:

```
Tables: subjects · users · questions · answers · bookmarks · pages
        sessions · activity_log · question_views · settings
Plus:   questions.search_vector (tsvector trigger + GIN index for FTS)
```

- The schema and data were **already migrated** from the original SQLite
  database — the app connects and reads/writes rows only. It never creates,
  migrates or seeds the schema at runtime.
- **Backups** are handled by Supabase:
  - Supabase **Point-in-Time Recovery** (paid), or
  - `pg_dump "$DATABASE_URL" -f doubtiq-$(date +%F).sql` for plain snapshots.
  - Restore with `psql "$DATABASE_URL" -f doubtiq-<date>.sql`.
- The old local-file backup helper (`npm run backup`) is retained **only** as
  a utility for legacy SQLite archives; it is not the production backup path.

> ⚠️ **Do not paste your DATABASE_URL into code, logs or the repo.** Keep it
> in the platform's secret/environment store (or a local `.env` that is
> git-ignored — a `.env.example` template is provided).

---

## Supabase side (one-time setup)

1. Create a Supabase project.
2. Run **SQL Editor**: execute your existing migration script to load the
   schema and data (this is the "already created" database the app expects —
   tables/columns above, plus `questions.search_vector` + trigger + GIN
   index).
3. Project Settings → **Database → Connection string**. Use the **Session
   pooler** (transaction mode) connection string for the app, or the direct
   connection:
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`
4. Save it as `DATABASE_URL`.

The admin account in `users` already exists after migration — log in at
`/admin`. If you ever need a new one, insert a `users` row (password hash =
scrypt, format `salt:hash` — the app's `hashPassword()` helper in
`data/db.js` produces this).

---

## Option A — VPS (full control)

Any Ubuntu 22.04/24.04 server (DigitalOcean, Hetzner, Linode, AWS Lightsail).

```bash
# 1. Install Node 18+ and nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git

# 2. Get the code
sudo mkdir -p /var/www && cd /var/www
sudo git clone https://github.com/YOUR-USER/doubtiq.git   # or scp/rsync the folder
cd doubtiq
npm install --omit=dev

# 3. Configure the environment (never commit this file)
sudo nano /etc/doubtiq.env
#   DATABASE_URL=postgresql://postgres.<ref>:<password>@...pooler.supabase.com:6543/postgres
#   SITE_URL=https://yourdomain.com
#   COOKIE_SECURE=1
#   TRUST_PROXY=1

# 4. Run it with PM2 (auto-restart, survives reboots)
sudo npm install -g pm2
pm2 start server/index.js --name doubtiq --env-file /etc/doubtiq.env
pm2 save && pm2 startup   # follow the printed command to enable boot-start

# 5. Nginx reverse proxy → http://127.0.0.1:3000
sudo nano /etc/nginx/sites-available/doubtiq
```

`/etc/nginx/sites-available/doubtiq`:

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/doubtiq /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. Free HTTPS with Let's Encrypt
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Done — the site is live at `https://yourdomain.com` with `/admin` for the
dashboard.

---

## Option B — PaaS (Render / Railway / Fly.io)

Because the database is external (Supabase), **no persistent disk is needed**
for data — you only pass the connection string.

### Render (example)

1. **New Web Service** → connect your repo (root: project folder).
2. Build: `npm install`
3. Start: `npm start`
4. Environment:
   - `DATABASE_URL` = your Supabase connection string (**mark as secret**)
   - `PORT` = `10000` (Render sets this automatically)
   - `SITE_URL` = `https://your-app.onrender.com` (or your custom domain)
   - `COOKIE_SECURE` = `1`, `TRUST_PROXY` = `1`
5. Deploy. First boot connects straight to your existing Supabase database.

### Railway / Fly.io

Same pattern: add `DATABASE_URL` (+ `SITE_URL`) to the environment. On Fly.io
use `fly secrets set DATABASE_URL='…'`.

---

## Deployment safety (data never lost)

- The database is **external** (Supabase) and the app never writes to the
  schema — redeploys, restarts and even `npm run reset` cannot damage it.
- `npm run reset` **refuses to run** when `DATABASE_URL` is set (it would
  otherwise risk deleting the shared database).
- Verified: questions/answers/subjects survive logout → login → refresh →
  server restart against PostgreSQL; publish/unpublish and sitemap/SEO react
  immediately (see the audit in README).

## Production checklist

1. **HTTPS everywhere** (Let's Encrypt or your PaaS's automatic TLS).
2. **Run `npm run reset-stats` once** right after the first migration — it
   zeroes any view counts / live-view feed / activity log carried over from
   the old SQLite demo database, so your real statistics start at zero.
   It never touches content.
3. **Backups** — enable Supabase PITR, or schedule a nightly `pg_dump`:
   ```bash
   # cron example (runs 3am)
   0 3 * * *  pg_dump "$DATABASE_URL" -f /backup/doubtiq-$(date +\%F).sql
   ```
4. **Restart policy** — PM2 (`pm2 save`/`startup`) or the PaaS auto-restart.
5. **Node version** — stick to Node 20 LTS; the app requires ≥ 18.
6. **Never expose `DATABASE_URL`** in logs, client code or commits.

## Env vars reference

| Var | Required | Purpose | Default |
|---|---|---|---|
| `DATABASE_URL` | **yes** | Supabase PostgreSQL connection string (existing schema/data) | — |
| `PORT` | no | HTTP port | `3000` |
| `HOST` | no | Bind address | `0.0.0.0` |
| `SITE_URL` | **recommended** | Public origin for canonical URLs + sitemap (e.g. `https://yourdomain.com`) | `http://localhost:3000` |
| `COOKIE_SECURE` | set `1` behind HTTPS | Adds `Secure` to the admin session cookie | off |
| `TRUST_PROXY` | set `1` behind a proxy | Trusts `X-Forwarded-*` for rate-limiting IPs | off |
