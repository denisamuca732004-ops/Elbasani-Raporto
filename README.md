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
| Roles | `MUNICIPALITY_STAFF` (department head), `ADMIN`. Residents have **no accounts** (see below) |
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
| Resident (no account) | **Ask or search** on the home page: a question ("si raportoj", "sa zgjat") gets a short answer with a button, "zjarr" or "aksident" gets the emergency numbers first, a report number opens its progress, a problem opens its report type, a street lists the open reports there. **Report** in six steps: type → location (either GPS / a tap on the map, with the zone found from the zone borders and no address needed, or by hand: zone → one of its lagje or villages → street, optional) → photo → description (10+ characters) → contact (name + phone number) or anonymous → review. Nothing can be skipped, and the server rejects incomplete reports and names the step to go back to. Works offline (queued on the phone). **Also:** track by case number, map, public statistics. |
| System | Routes each report to the department of its type and checks it (AI when enabled, keyword rules otherwise). Emails the department in the background (residents leave no email). |
| Department head (`MUNICIPALITY_STAFF`, **no longer used**: departments work by e-mail, see below) | Sees only their department, split into **High / Medium / Low** priority tabs. **Can:** verify, assign, start work, resolve with an "after" photo, reject with a reason, add notes, and call the resident when they left a phone number. **"Not our department":** sends a review request to the admin. |
| Admin (`ADMIN`) | Dashboard for **week / month / year**, starting with **a card per department** (its number of reports, open, high priority, overdue): a click opens that department's reports with the **number in each status** on the status tabs, and each report opens for editing. The platform and municipality names follow the language too ("Elbasani Raporton / Bashkia Elbasan" ↔ "Elbasan Reports / Municipality of Elbasan", also in the tab title); all four are set at `/admin/appearance` (`lib/shared/branding.ts`). The same cards are the menu's **Departamentet** page (`/admin/sectors`): the menu no longer lists every department or "all reports", and a department's reports keep that item highlighted, with a link back. Reports without a department get a red card while any are open. Also the review requests ("not our department" → the admin moves the report to the right department). **Can:** set any status, edit any detail, move or delete reports. The menu keeps only daily work plus *Zonat* and *Emailet*; the logo at the top leads to the public home page, and the name at the top right opens "my account". **Not in the menu, but still at their address:** departments `/admin/departments`, accounts `/admin/users`, report types `/admin/report-types`, the search guide `/admin/guide`, appearance `/admin/appearance`, the integration and AI test `/admin/integration`, demo data `/admin/demo`, my account `/admin/account`, and a report entered by staff `/admin/reports/new`; the dashboard's "first steps" card links to the first three. |

### Departments work only by e-mail (no sector accounts)

Departments have no accounts and no panel. The migration `20261107120000_sectors_email_only` turned every department with an e-mail address into an e-mail department and deactivated the old department-head accounts (not deleted; the users page can only create admins now).

- **Automatic sending:** every new report goes to the e-mail of its department (by the problem type), with a personal link `/sektori/<link>` ([`components/public/SectorReport.tsx`](components/public/SectorReport.tsx)). A department without an e-mail gets nothing: the report waits under "Të reja" on the admin's board, and the department card says "Pa email".
- **From the link** (no account) the department presses:
  - **E pranojmë** → `IN_PROGRESS` ("Në punë"), with an optional note the resident sees;
  - **Nuk mund ta trajtojmë** → a reason (and, optionally, the right department): the report goes back to the admin ("Kthyer nga sektori"), who moves it (it is e-mailed to the new department, the old link stops working) or keeps it there with a note (the department gets the answer with the same link);
  - after accepting, **U zgjidh** → `RESOLVED`, with a required note and an optional "after" photo.
- **Reminder:** a department that has not answered a report for 48 hours gets a reminder with the same link (`sector_reminder`, daily job, again every 48 hours, `report_links.reminded_at`); the board shows "Pa përgjigje prej N ditësh".
- **Safety:** the address is `<id>.<HMAC of the id with AUTH_SECRET>` ([`lib/server/services/reportLinks.ts`](lib/server/services/reportLinks.ts)): a changed or guessed address is refused. A link lasts 90 days from the last time it was sent, and stops when the report moves. The page is not indexed, not cached, sends no referrer, and its actions are rate-limited (`sector`). The e-mail asks not to forward it, since the link shows the resident's phone.
- **Needs SMTP** (`MAIL_DRIVER=smtp`): until then these e-mails are only logged, visible at *Emailet*. The board shows a yellow warning on top while it is off.

### The admin's board (`/admin/reports`)

The menu is short: **Raportimet**, **Paneli**, and under Administrimi **Sektorët**, **Zonat**, **Emailet**. "Raportimet" is one board ([`components/panel/Board.tsx`](components/panel/Board.tsx), [`lib/server/services/board.ts`](lib/server/services/board.ts)) with a tab per place a report can be, each with its number:

| Tab | Holds | The admin can |
|---|---|---|
| Të reja | received, not sent to any department (no department, or no e-mail) | send it to its department, or choose another |
| Dërguar te sektori | e-mailed, waiting for "E pranojmë" / "Nuk mund ta trajtojmë" | see when it was sent, opened, reminded; send it again or elsewhere |
| Kthyer nga sektori | the department cannot handle it (its reason) | move it to the right department, or keep it there with a note |
| Në punë | accepted by the department | open it |
| Zgjidhur | resolved or closed (with the note) | open it |
| Refuzuar | rejected (with the reason) | open it |

Each row says, in two lines, whether the request reached the sector (the last sector e-mail: sent, only logged because SMTP is off, or failed) and whether the sector accepted it (waiting / accepted, with when / cannot handle it).

Filters: department, priority, overdue, search; they live in the address (`?tab=sent&departmentId=3`). Without a tab it opens the first one with reports (Të reja, Kthyer, Dërguar, Në punë). The menu badge is the number waiting for the admin (Të reja + Kthyer).

Statuses (PostgreSQL enum):

- `PENDING`, `NEEDS_REVIEW`, `VERIFIED`, `ASSIGNED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `REJECTED`.
- Residents see the simplified statuses: received / open / in progress / resolved / closed / rejected.

## Run locally

Requirements: Node.js 24 (the version Vercel uses, pinned in `package.json`; 22 still works for local development), plus Docker (or any PostgreSQL 14+).

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
3. Use *Administrimi → Të dhëna demo* to create 60 sample reports for a presentation. The panel always shows them, marked "Demo" (there is no show/hide switch); they are never counted in public statistics, and one click deletes them before real use.

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
- residents' contact (a name and phone number or anonymous, no email stored, nothing emailed to them).

## Residents: no accounts, no email

The public site is only for reporting. Residents never sign up or sign in, and leave no email:
- **Contact step** (as on BOS:311): a short paragraph asking the resident to consider leaving contact details, and a **"Përfshi kontaktin"** switch. Off (the default) = anonymous; on = a name and a phone number, both required, so the department can call if it needs more details. The number is never published and never sent to the AI.
- **Final screen:** the report number (ID), with "Kopjo numrin" and a clear note to keep it: nothing is emailed, so the number is how the report is tracked (`/ndiq`, or the search box).
- **"I have this problem too"** while reporting adds one supporter, with no contact details.
- **The header** has no sign-in link. Staff sign in from the footer ("Hyrja për stafin", `/hyrje`); a signed-in staff member sees "Paneli" in the header.
- **Old links** to the former account pages (`/llogaria…`) land on the home page.
- **The contact is deleted automatically** by the daily job `CONTACT_RETENTION_DAYS` (default 90) after a report is closed, or after its last change if rejected: name, phone and email, any phone or email typed in the description or comment, followers' emails and the emails sent to those addresses. The report stays for the statistics; the panel shows when the contact was deleted (`reports.contact_erased_at`), and the privacy page shows the real number of days. The Municipality decides the period (its archiving rules and the personal-data law).

Older data is kept as it is (no schema change, nothing deleted): accounts with role `USER` from the prototype cannot sign in, and an older report that has an email still gets the status and "was it fixed?" emails. A report the admin records at `/admin/reports/new` can still carry an email.

## Location: one search field and a pin, zone always right

The location step works like BOS:311's "Select a Location": one **"Vendndodhja"** field and a map below it.

- **Typing** searches at once the lagje of the city and the villages of every zone ([`lib/shared/places.ts`](lib/shared/places.ts), no internet needed), and after a short pause streets and places from **OpenStreetMap** ([`lib/server/geocoder.ts`](lib/server/geocoder.ts)).
  - The OpenStreetMap search goes through a Photon server (`GEOCODER_URL`, by default the public `https://photon.komoot.io`; `off` turns it off). Our server asks it, never the browser, so the CSP stays strict and the resident's IP and position are not sent to a third party.
  - Only places inside the zone borders are offered. Answers are cached (a search for a week, a point for a month) and rate-limited per IP. If the service is slow or down, the lagje and villages are still found and nothing fails.
- **Choosing** a result puts the pin there and moves the map.
- **The pin** can be tapped, dragged or set by GPS ("Përdor vendndodhjen time", also asked once when the step opens). Moving it fills the field with the street at that point ("Rruga Qemal Stafa 7"), when OpenStreetMap knows one. The field can also be edited as a landmark.
- **The zone** always comes from the point, using the borders of the 13 administrative units ([`lib/shared/zones.ts`](lib/shared/zones.ts), data in `lib/shared/data/elbasan-zones.json`), in the browser too. A point outside the borders (Tirana, Cërrik, Durrës) is refused.
- **A lagje or village chosen and not moved** is saved as that place (the server's "address" mode: zone + lagje/village, approximate point), never as an exact point, so it is never taken for "the same problem nearby". Once the pin is moved, or the text changed, it is an exact point with that text.
- The server still accepts and checks both modes (`map` and `address`), so reports queued offline by the older form are not lost. In `address` mode a text naming a village of another zone is refused, with the right zone in the message.

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

## Photo check while a report is created

The photo step of the form checks the photo as soon as it is chosen ([`lib/server/services/photoCheck.ts`](lib/server/services/photoCheck.ts), [`lib/client/photoDate.ts`](lib/client/photoDate.ts)).

| The photo | With the AI on (`AI_ENABLED=true` + `AI_API_KEY`) | Without the AI |
|---|---|---|
| Inappropriate (nudity or sexual content, graphic violence against people, obscene images; a model that refuses to look counts too) | Refused: the resident must choose another photo. The server refuses it again when the report is sent, so skipping the form does not help, and deletes the upload. | Not detected. Photos are never public until the department verifies the report, and staff can hide a photo. |
| A document or a screenshot (not a photo of a place) | Refused, in the form and when the report is sent ("not_photo"). | Not detected. |
| Does not show the chosen problem (a selfie, a picture from the gallery by mistake) | Warning: "A është kjo fotoja e problemit?" The resident chooses another photo or confirms. Never refused, because the AI can be wrong about a dark or distant photo; the report check after sending sends it to a person. | Not detected. |
| Taken more than 7 days ago (EXIF camera date, else the file date, read in the browser before the photo is made smaller) | A note suggesting a new photo. | The same note. |

- One AI call per uploaded photo and report type, cached in `ai_results`: the form's check and the check when the report is sent cost one call. Rate limit `photoCheck` per IP, like uploads.
- Offline, or when the AI does not answer, the photo is "unchecked": the form says it was not checked automatically and the report goes on. The failure is logged (`[photo-check]`, key hidden), and *Administrimi → Integrimi → Provo lidhjen me AI* names the cause: wrong key, no credit, unknown model or timeout.
- The privacy page says that the AI checks photos, also before the report is sent.

### The description, checked the same way

When "Vazhdo" is pressed at the description step ([`lib/server/services/descriptionCheck.ts`](lib/server/services/descriptionCheck.ts), [`lib/shared/text.ts`](lib/shared/text.ts)):

| The description | With the AI on | Without the AI |
|---|---|---|
| Random letters ("asdfkz kcp zvkmv"), one letter repeated, no words | Refused (`gibberish`), in the form and when the report is sent. | The same: a check of letters, vowels and words, in the browser and on the server. |
| Says nothing ("test test test") | Refused (`gibberish`). | Not detected. |
| Obscene or sexual content, hate speech, threats, insults aimed at people (anger at the problem or criticism of the municipality is allowed) | Refused (`abusive`). | Not detected. |
| About another problem than the chosen type | Warning: "A përputhet përshkrimi me llojin e zgjedhur?" with "Ndrysho llojin" or "Po, vazhdo". | Not detected. |

E-mail addresses and phone numbers are masked before the text goes to the AI. One call per text and type, cached; rate limit `textCheck` per IP.

## Public site design (v2)

The public site follows the mentors' design v2 ([`components/site/SiteFrame.tsx`](components/site/SiteFrame.tsx), [`components/public/Home.tsx`](components/public/Home.tsx), the `.site` block at the end of [`app/globals.css`](app/globals.css)); the staff panel keeps its own look.
- **Header:** the green elbasani.gov.al strip, then a white header with the pin mark, Report, Map, Track, Statistics and the language button ("English" / "Shqip"). Staff login is in the footer; a signed-in staff member also gets "Paneli" in the header.
- **First screen:** "Raporto. Ndiqe. U rregullua." / "Report. Track. Fixed.", the "What needs fixing?" search (a matching problem opens the form at that type, otherwise at the categories), the categories as chips, and a schematic map of the city centre with the reports of the last 3 months as dots (open, in progress, fixed), the number open, fixed this month and the average days to fix. It ends in castle-wall battlements.
- **Below:** "Recently fixed" (with the municipality's note) next to "Frequently reported" (information only), then "How it works".
- **Footer:** about, contact e-mail, emergency numbers (112, 129, 128, 127), privacy, elbasani.gov.al, staff login.
- **Map page** (`/harta`): status (all / received / being fixed / fixed), area and category on top; the OpenStreetMap map (colours made livelier with a CSS filter) with its key on the left; the list of the same reports on the right, with a search (street, number or problem) and newest / oldest first. Marks: received = yellow ring, being fixed = blue dot, fixed = green tick, dashed ring = approximate point. The filters live in the address (`?status=in_progress&zone=3&category=streets`).
- **Type:** Source Sans 3 (self-hosted), sentence case.

## Help chat (the guide)

A round **chat button** sits at the bottom right of every page of the public site ([`components/site/ChatHelp.tsx`](components/site/ChatHelp.tsx)); on phones the chat takes the whole screen. It replaced the search box of the menu. It answers, instantly and without AI:
- a **question** ("si raportoj", "sa zgjat") with the guide's answer and its button; emergencies ("zjarr") show the numbers first;
- a **report number** (EL-2026-00042) with a link to its progress;
- a **problem** ("gropë") with its category, where the report starts (reports start only from a category);
- a **street or area** ("Rinia") with the OPEN reports there, so a problem is not reported twice.

When it opens it offers the common questions as buttons: the first `COMMON_COUNT` (6) active non-emergency questions in the admin's order, "All questions", then the emergency entry. They are offered again when nothing was found.

- **Where the answers live.** In the database (`guide_entries`), in Albanian and English. The seed adds 17 starting questions, including the emergency numbers (112, 127, 128, 129). The admin edits them at `/admin/guide` (not in the menu): add, edit, order, hide, and try them as a resident would. Running the seed again never overwrites those changes.
- **How matching works.** [`lib/shared/guide.ts`](lib/shared/guide.ts) runs in the browser: no AI, no request, instant. It ignores accents and common words ("si", "a", "një"), and accepts different word endings ("gropa" / "gropë").
- **Buttons under answers.** Each answer has one button from a fixed list: report, track, map, statistics, privacy, call 112, or none. The admin cannot type a link, and answers are plain text, never HTML.
- `/ndihme` (the old Help page) redirects to the home page. Migration `20261102140000_help_chat` rewords the starting answers that spoke of the search box, unless the admin changed them.
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
   - `MAIL_DRIVER=smtp` with the SMTP settings (without it e-mails are only logged; the final screen of the form then tells residents to keep their number instead of "we e-mail it to you")
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
