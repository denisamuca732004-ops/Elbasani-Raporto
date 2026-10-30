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
| Roles | `USER` (a resident's own, optional account), `MUNICIPALITY_STAFF` (department head), `ADMIN` |
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
| Resident (no account) | **Ask or search** on the home page: a question ("si raportoj", "sa zgjat") gets a short answer with a button, "zjarr" or "aksident" gets the emergency numbers first, a report number opens its progress, a problem opens its report type, a street lists the open reports there. **Report** in six steps: type → location (either GPS / a tap on the map, with the zone found from the zone borders and no address needed, or by hand: zone → one of its lagje or villages → street) → photo → description (10+ characters) → contact or anonymous → review. Nothing can be skipped, and the server rejects incomplete reports and names the step to go back to. Works offline (queued on the phone). **Also:** track by case number, map, public statistics, confirm or reopen from the "resolved" email. |
| System | Routes each report to the department of its type and checks it (AI when enabled, keyword rules otherwise). Emails the department and the resident in the background. |
| Department head (`MUNICIPALITY_STAFF`) | Sees only their department, split into **High / Medium / Low** priority tabs. **Can:** verify, assign, start work, resolve with an "after" photo, reject with a reason, add notes and message the resident. **"Not our department":** sends a review request to the admin. |
| Admin (`ADMIN`) | Dashboard for **week / month / year**, starting with **a card per department** (its number of reports, open, high priority, overdue): a click opens that department's reports with the **number in each status** on the status tabs, and each report opens for editing. The same cards are the menu's **Departamentet** page (`/admin/sectors`): the menu no longer lists every department or "all reports", and a department's reports keep that item highlighted, with a link back. Reports without a department get a red card while any are open. Also the review requests ("not our department" → the admin moves the report to the right department). **Can:** set any status, edit any detail, move or delete reports. The menu keeps only daily work plus *Zonat, Emailet, Integrimi, Të dhëna demo*. **Not in the menu, but still at their address:** departments `/admin/departments`, accounts `/admin/users`, report types `/admin/report-types`, the search guide `/admin/guide`, appearance `/admin/appearance`, and a report entered by staff `/admin/reports/new`; the dashboard's "first steps" card links to the first three. |

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
2. Create the department heads' accounts at `/admin/users` (linked from the dashboard's "first steps" card).
3. Use *Administrimi → Të dhëna demo* to create 60 sample reports for a presentation. They are marked as demo and never counted in public statistics.

Without Vercel Blob, Upstash Redis or QStash, the app uses local fallbacks: a disk folder, in-memory cache and `after()`. Production requires the real services, and `lib/server/env.ts` refuses to start without them.

## Checks

```bash
npm run typecheck     # TypeScript, strict
npm test              # 138 tests against a real PostgreSQL (raporton_next_test)
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
- admin PATCH semantics;
- the search guide (what residents get for typical questions, emergencies first, admin edits, seed never overwrites them);
- the location (zone borders, GPS without an address, zone ↔ lagje/village always matching, phone reports and demo data in the right zone);
- residents' accounts (sign-up, Google linking rules, staff kept apart, my reports, account deletion, session limits).

## Residents' accounts (optional)

Reporting never needs an account. A resident who wants one signs up and signs in at `/llogaria/hyr`, in one of two ways:
- **"Vazhdo me Google".** Needs `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`; without them the button is hidden.
- **Email + password.**

With an account:
- reports made while signed in appear in **"Raportimet e mia"** (`/llogaria`) on any device;
- the contact step is filled in.

The account page also has the profile, setting or changing the password, signing out and deleting the account.

Rules (`lib/server/services/residents.ts`):
- **Kept apart from the panel.**
  - A resident account (`USER`) never opens the panel.
  - Google never signs in to a staff account, and staff cannot use the residents' sign-in page.
  - The admin's "Users" page lists staff only and cannot give a resident a password.
- **Google proves who owns the email.**
  - Google sign-in needs an email Google has verified.
  - If someone registered that email earlier with a password, Google sign-in links the account, removes that password and ends its other sessions. So whoever registered someone else's email loses access.
- **Anonymous stays anonymous.** `reports.citizen_id` is only used for "my reports". Staff never see which account made a report.
- **Session lengths.** Residents stay signed in for `RESIDENT_SESSION_DAYS` (30). Staff sessions still end `SESSION_MAX_AGE_HOURS` (12) after signing in, checked in the proxy and on the server.

Google setup: Google Cloud Console → *APIs & Services*.
- *OAuth consent screen*: app name, support email, and the privacy page `https://<domain>/privatesia`.
- *Credentials → OAuth client ID*: type *Web application*, authorized redirect URI `https://<domain>/api/auth/callback/google`.
- Put the two values in Vercel's environment variables and redeploy.

## Location: GPS or address, zone always right

A resident gives the place one of two ways. The server refuses anything else.

1. **GPS or a tap on the map.**
   - The zone is found from the point, using the borders of the 13 administrative units ([`lib/shared/zones.ts`](lib/shared/zones.ts), data in `lib/shared/data/elbasan-zones.json`). This works in the browser too, also offline.
   - No address is needed; a landmark is optional.
   - A point outside the borders (Tirana, Cërrik, Durrës) is refused, even inside the old rectangle.
2. **By hand.**
   - Choose the zone, then one of **its** lagje (city) or villages, then type the street, number or landmark. The list only shows the places of that zone, and the server checks it again.
   - A street that names a village or zone of another zone ("fshati Lleshan" with the city chosen) is refused, with the right zone in the message.
   - An optional pin can be added too, so the report is also on the map. It must be inside the chosen zone.

**On the public map** every report shows as a point coloured by its status, from the moment it is received ("Marrë", grey).
- Until a person verifies a report, its photo and description stay hidden. Phone numbers and emails typed in an address are masked.
- Rejected reports are never shown.
- **Reports typed by hand without a pin are on the map too, at an approximate point.**
  - The point is their lagje or village (`lib/server/data/locality-points.json`, built from an OpenStreetMap export with `scripts/build-locality-points.py`), else the middle of their zone.
  - It is drawn with a dashed ring, and the popup and the report page say it is approximate.
  - Every deployment (the seed) places reports that still have no point, and moves approximate ones to their village once its coordinates are known. Points set by a person are never moved.
  - Approximate points are never used for "the same problem nearby".
  - The admin can place the exact pin when editing a report, and the zone follows the pin.
   - Street names themselves are not checked yet: that needs the Municipality's street register.

**Sources:**
- *Zone borders:* geoBoundaries (OpenStreetMap, © OpenStreetMap contributors, ODbL), rebuilt with `scripts/build-zones.py`.
- *Lagje and villages:* the Municipality's "Ndarja administrativo-territoriale" (2021) and "Nëndarjet e Bashkisë" (2023).
- *Mollas* belongs to the Municipality of Cërrik, so it is not an Elbasan zone. The migration hides it on existing databases.

The admin edits lagje and villages in *Administrimi → Zonat*.

## Search guide ("Ask or search")

The search box sits at the right of the menu bar on every page (on phones, under the logo). It answers questions as well as finding reports. The menu has no "Track a report" or "Help" item: a report is tracked with the "Ndiq raportimin" button on the home page (`/ndiq`) or by typing its number in this box.

- **Where the answers live.** In the database (`guide_entries`), in Albanian and English. The seed adds 17 starting questions, including the emergency numbers (112, 127, 128, 129). The admin edits them at `/admin/guide` (not in the menu): add, edit, order, hide, and try the search as a resident would. Running the seed again never overwrites those changes.
- **How matching works.** [`lib/shared/guide.ts`](lib/shared/guide.ts) runs in the browser: no AI, no request, instant. It ignores accents and common words ("si", "a", "një"), and accepts different word endings ("gropa" / "gropë").
  - Emergencies always come first, already open.
  - When the text names a problem ("si raportoj një gropë"), the report type comes before the answers.
- **Buttons under answers.** Each answer has one button from a fixed list: report, track, map, statistics, privacy, call 112, or none. The admin cannot type a link, and answers are plain text, never HTML.
- **Where answers show.** Only in the search box. Clicked before anything is typed, it lists the common questions: the first `COMMON_COUNT` (6) active non-emergency questions in the admin's order, "See all questions", then the emergency entry; each opens its answer in place. The admin page marks those 6. While typing, the matching answers show. `/ndihme` (the old Help page) redirects to the home page; `/ndiq` and `/ndiq/EL-…` still work for old links and emails. Migration `20261030120000_search_in_menu` removes the "Track" button from the starting answers, unless the admin changed them.
- **AI later (phase 2).** An AI assistant could answer free questions using only these answers, after the Municipality approves it and with `AI_API_KEY` in Vercel.

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
