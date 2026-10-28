# Elbasani Raporton — Next.js edition

Municipal reporting platform (BOS:311 style) for the **Municipality of Elbasan**.
Residents report problems in six mandatory steps, the system routes every report to the right
department, department heads work on their own department's reports, and the main admin
controls everything. The interface is the green v2 design, unchanged.

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Server Actions, Route Handlers), React 19, TypeScript (strict) |
| Database | **PostgreSQL** through **Prisma 7** (`@prisma/adapter-pg`), strict foreign keys and `CHECK` constraints |
| Auth | Auth.js v5: email + password, encrypted JWT session (JWE) in an HTTP-only cookie |
| Roles | `USER`, `MUNICIPALITY_STAFF` (department head), `ADMIN` |
| Photos | Vercel Blob, private, one-file client upload tokens, re-encoded on the server (EXIF/GPS removed) |
| Cache and rate limits | Upstash Redis (in-memory fallback for development and tests) |
| Background jobs | Upstash QStash (signed callbacks), or Next.js `after()` when QStash is not configured |
| Validation | Zod 4 on every Server Action, Route Handler and URL parameter, with Albanian messages |
| Hosting | Vercel (cron for the daily job, `fra1` region) |

## The four requested files

| # | File | What it does |
|---|---|---|
| 1 | [`prisma/schema.prisma`](prisma/schema.prisma) | The data model. The SQL, including the extra `CHECK` constraints, is in `prisma/migrations/20261028120000_init/migration.sql`. |
| 2 | [`proxy.ts`](proxy.ts) | The middleware. In Next.js 16 the file is called `proxy.ts`. It blocks `/admin` and `/api/admin` for anyone without a `MUNICIPALITY_STAFF`/`ADMIN` session, and sets the CSP with a per-request nonce plus the security headers. Uses [`auth.config.ts`](auth.config.ts) and [`auth.ts`](auth.ts). |
| 3 | [`actions/reports.ts`](actions/reports.ts), [`actions/upload.ts`](actions/upload.ts) | Server Actions: role check, then Zod, then Prisma (in transactions), then emails queued for QStash, then revalidation. `upload.ts` hands out the Vercel Blob client token for exactly one photo. |
| 4 | [`app/admin/reports/page.tsx`](app/admin/reports/page.tsx) | The staff report list (Server Component). It re-checks the role against the database, validates the URL with Zod and scopes the query to the department. |

## Security model

Every request is checked in layers.

1. **Proxy (`proxy.ts`).** It only *reads* the session cookie (`getToken`, decrypted with `AUTH_SECRET`). `/admin/*` redirects to `/hyrje`, and `/api/admin/*` answers 401 or 403, unless the role is `MUNICIPALITY_STAFF` or `ADMIN`.
2. **Server check against the database (`lib/server/session.ts`).** Every page, Route Handler and Server Action calls one of these:
   - `pageStaff()` / `pageAdmin()` for pages;
   - `requireStaff()` / `requireAdmin()` for actions and handlers.

   The account must be active, have the same session version (so a reset password or a disabled account signs out everywhere), have a panel role and a permanent password. Role and department always come from the database, never from the browser.
3. **Zod (`lib/validation/*`).**
   - Statuses, priorities, ids, filters and form fields must be exactly the allowed values. Unknown fields are refused (`strictObject`).
   - Admin PATCH schemas have **no defaults**, so an edit never resets other fields.
4. **Service layer (`lib/server/services/*`).**
   - The department scope is applied in SQL. A department head can never read or change another department's report, even by typing an id.
   - Status changes use optimistic concurrency. If someone else changed the report meanwhile, the answer is 409 with "Raportimi u ndryshua ndërkohë".
5. **Database constraints.** Foreign keys plus `CHECK` constraints:
   - a department head must have a department;
   - a rejection must have a reason;
   - only one open review request per report;
   - values must be in range.
6. **Photos.**
   - The browser never gets the Blob read-write token.
   - `requestPhotoUploadAction` gives permission for a single `tmp/<uuid>.<ext>` key, one content type, the maximum size and 10 minutes:
     - with a Blob read-write token: a Blob client token, and the browser uploads straight to Blob;
     - with a store connected through OIDC (Vercel's default for new stores, no long-lived token): an HMAC-signed address of the app (`/api/uploads/photo`, at most 4 MB), and the server writes the file to Blob.
   - The server re-reads the file, verifies it is an image, stores a clean JPEG copy under `reports/YYYY-MM/` and deletes the temporary file.
   - Photos are private and only served through `/api/public/photos/[id]` (only public photos of verified reports) and `/api/admin/photos/[id]` (staff with access to the report).
7. **Headers.**
   - CSP with a nonce and `strict-dynamic`, and `frame-ancestors 'none'`. The only exception is `/embed`, which allows the sites the admin listed.
   - Also: `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and HSTS on HTTPS.
8. **Abuse.**
   - Rate limits per IP address, with Upstash Ratelimit: new reports, uploads, sign-ins, follows, feedback and first-admin setup.
   - The first admin can be created only once, only with `ADMIN_EMAIL`, and serialised with a table lock.
9. **Secrets.**
   - The AI key, SMTP password and tokens live only in Vercel environment variables.
   - `.env`, `.env*.local`, `.env.production` and `.env.staging` are git-ignored.
   - The committed `.env.development` and `.env.test` contain no real secrets.

## Workflow

| Who | What |
|---|---|
| Resident (no account) | **Report** in six steps: type → location (pin inside the municipality, address, area) → photo → description (10+ characters) → contact or anonymous → review. Nothing can be skipped, and the server rejects incomplete reports and names the step to go back to. Works offline (queued on the phone). **Also:** track by case number, map, public statistics, confirm or reopen from the "resolved" email. |
| System | Routes each report to the department of its type and checks it (AI when enabled, keyword rules otherwise). Emails the department and the resident in the background. |
| Department head (`MUNICIPALITY_STAFF`) | Sees only their department, split into **High / Medium / Low** priority tabs. **Can:** verify, assign, start work, resolve with an "after" photo, reject with a reason, add notes and message the resident. **"Not our department":** sends a review request to the admin. |
| Admin (`ADMIN`) | Dashboard for **week / month / year**, every report, one link per department, reports without a department and the review requests. **Can:** set any status, edit any detail, move or delete reports. **Manages:** departments, accounts, report types (routing, deadline, default priority), areas, appearance, email log, embed code and demo data. |

Statuses (PostgreSQL enum):

- `PENDING`, `NEEDS_REVIEW`, `VERIFIED`, `ASSIGNED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `REJECTED`.
- Residents see the simplified statuses: received / open / in progress / resolved / closed / rejected.

## Run locally

Requirements: Node.js 22+, plus Docker (or any PostgreSQL 14+).

```bash
docker compose up -d          # PostgreSQL with raporton_next_dev and raporton_next_test
npm install                   # also runs `prisma generate`
npm run db:deploy             # creates the tables (prisma migrate deploy)
npm run db:seed               # departments, report types, areas, default settings
npm run dev                   # http://localhost:3000
```

Then:

1. Open `/hyrje` and choose **Krijo llogarinë e administratorit**. Locally this is allowed only for `admin@example.com`, from `.env.development`.
2. Use *Administrimi → Të dhëna demo* to create 60 sample reports for a presentation. They are marked as demo and never counted in public statistics.

Without Vercel Blob, Upstash Redis or QStash, the app uses local fallbacks: a disk folder, in-memory cache and `after()`. Production requires the real services, and `lib/server/env.ts` refuses to start without them.

## Checks

```bash
npm run typecheck     # TypeScript, strict
npm test              # 91 tests against a real PostgreSQL (raporton_next_test)
npm run check:i18n    # every text exists in Albanian and English, including every enum value
npm run build         # production build
```

The tests cover:

- strict reporting;
- routing;
- every status transition and permission;
- department isolation;
- review requests;
- concurrency (409);
- the AI checks (against a fake server);
- signed uploads (cannot be reused, changed or used late);
- cache invalidation;
- rate limits;
- background emails (sent once);
- the dashboard periods in Tirana time;
- admin PATCH semantics.

## Deploy on Vercel

1. Import the repository in Vercel. The framework is detected as Next.js, and `vercel.json` sets the build command and the daily cron.
2. **Storage** (Project → Storage):
   - **Postgres.** Use Neon from the Vercel Marketplace, in an EU region near `fra1`, or Supabase. The integration sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct, used for migrations automatically). With another provider, set `DIRECT_URL` to the direct URL.
   - **Blob.** Create a **Private** store and connect it. Vercel adds `BLOB_STORE_ID` (OIDC) or `BLOB_READ_WRITE_TOKEN`; both work.
   - **Upstash Redis.** `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; the `KV_REST_API_*` names also work.
3. **QStash** (Upstash console): `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`.
4. **Other variables** (see `.env.example`):
   - `APP_URL` (https; optional on Vercel, where the production domain is used)
   - `AUTH_SECRET` (`npx auth secret`)
   - `ADMIN_EMAIL`
   - `CRON_SECRET`
   - `MAIL_DRIVER=smtp` with the SMTP settings
   - optionally `AI_ENABLED=true` with `AI_API_KEY`
5. Deploy. The build runs `prisma migrate deploy`, then the idempotent seed, then `next build`.
6. Open `https://<domain>/hyrje/konfigurimi` and create the first admin with `ADMIN_EMAIL`.

Staging is Vercel's Preview environment, configured with its own variables (`.env.staging.example`).

## Project layout

```
app/                    pages (public site in Albanian URLs, /admin panel, /embed widget) and API route handlers
actions/                Server Actions (reports, upload, auth, admin, panel)
components/             UI (ported from v2: same classes, same CSS)
lib/server/             env, db, session, cache, rate limits, storage, queue, mail, AI, services
lib/validation/         Zod schemas
lib/shared/             types and enums shared by server and browser
lib/client/             browser helpers (action errors, photo upload, offline queue, formatting)
i18n/                   Albanian (default) and English texts
prisma/                 schema, migration, seed
tests/                  node:test suites
```

## Before the public launch

- The department names, deadlines and default priorities in `lib/server/referenceData.ts` are a starting point. They must be confirmed with the Municipality.
- Use the municipality's coat of arms (`public/logo-bashkia-elbasan.svg`) publicly only with its permission.
- Never put real personal data in demo data.
