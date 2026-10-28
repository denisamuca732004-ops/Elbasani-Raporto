# Elbasani Raporton – udhëzime në shqip

Ky version është ndërtuar me **Next.js 16** (App Router) dhe **TypeScript**, dhe bëhet gati për
**Vercel**. Dizajni është i njëjti me v2 (jeshil), por backend-i është rishkruar plotësisht.

**Teknologjitë:**
- **Baza e të dhënave:** **PostgreSQL**, e lidhur me **Prisma**.
- **Hyrja e stafit:** **Auth.js**, me sesion të enkriptuar në cookie HTTP-only.
- **Fotot:** **Vercel Blob**, private.
- **Cache dhe kufizimi i kërkesave:** **Upstash Redis**.
- **Email-et në sfond:** **Upstash QStash**.

## Katër skedarët e kërkuar

1. `prisma/schema.prisma`: modeli i të dhënave. SQL-ja e plotë, me rregullat `CHECK`, është te
   `prisma/migrations/20261028120000_init/migration.sql`.
2. `proxy.ts`: middleware-i, që në Next.js 16 quhet `proxy.ts`. Ai mbyll `/admin` dhe `/api/admin`
   për këdo që nuk është `MUNICIPALITY_STAFF` ose `ADMIN`. Vendos edhe CSP-në dhe header-at e sigurisë.
3. `actions/reports.ts` dhe `actions/upload.ts`: Server Actions. Secili veprim punon me këtë radhë:
   kontrolli i rolit → Zod → Prisma → email në sfond → rifreskimi i faqeve.
4. `app/admin/reports/page.tsx`: lista e raportimeve në panel.

## Rolet

| Roli | Kush është | Çfarë sheh |
|---|---|---|
| `ADMIN` | Administratori kryesor | Gjithçka: të gjitha raportimet, sektorët, llogaritë, llojet, zonat, pamjen, email-et, demon |
| `MUNICIPALITY_STAFF` | Përgjegjësi i një sektori | Vetëm raportimet e sektorit të vet dhe kërkesat që ka dërguar ai sektor |
| `USER` | (rezervë për të ardhmen) | Nuk ka akses në panel |

Qytetari nuk ka nevojë për llogari.

Kontrolli bëhet në tre nivele, dhe të tri duhet të kalojnë:
1. **proxy-ja** kontrollon cookie-n;
2. **çdo faqe dhe çdo veprim** e kontrollon llogarinë sërish në databazë: aktive, me të njëjtin
   version sesioni dhe me fjalëkalim jo të përkohshëm;
3. **çdo pyetje në databazë** kufizohet në sektorin e personit.

## Rrjedha e punës

- **Qytetari** raporton me 6 hapa: lloji → vendndodhja → foto → përshkrimi → kontakti → kontrolli.
  * Asnjë hap nuk anashkalohet.
  * Pa foto, pa përshkrim, pa pikë në hartë, pa adresë ose pa zonë, raportimi **nuk krijohet**.
  * Serveri i kontrollon sërish të gjitha. Nëse mungon diçka, e kthen qytetarin te hapi përkatës.
- **Sistemi** e dërgon raportimin te sektori që mbulon atë lloj problemi.
- **Përgjegjësi i sektorit:**
  * i sheh raportimet të ndara në **E lartë / Mesatare / E ulët**;
  * i verifikon, i merr përsipër, i zgjidh me foto "pas", ose i refuzon me arsye;
  * nëse raportimi nuk i përket sektorit të tij, dërgon **kërkesë për rishikim** te administratori.
- **Administratori:**
  * vendos për kërkesën: e kalon raportimin te sektori i duhur, ose e mban aty me shpjegim;
  * mund të vendosë çdo status dhe të ndryshojë çdo detaj;
  * paneli i tij tregon statistikat për **javë, muaj dhe vit**.

Statuset janë ato të v2: `PENDING`, `NEEDS_REVIEW`, `VERIFIED`, `ASSIGNED`, `IN_PROGRESS`,
`RESOLVED`, `CLOSED`, `REJECTED`. Refuzimi kërkon gjithmonë arsye.

## Nisja në kompjuter

Duhen **Node.js 22** dhe **Docker Desktop** (ose PostgreSQL i instaluar).

```bash
docker compose up -d        # ngre PostgreSQL-në
npm install
npm run db:deploy           # krijon tabelat
npm run db:seed             # sektorët, llojet e raportimeve, zonat
npm run dev                 # http://localhost:3000
```

Llogaritë krijohen me këtë radhë:
1. Hapni `/hyrje` → **Krijo llogarinë e administratorit**. Lokalisht lejohet vetëm emaili
   `admin@example.com`.
2. *Administrimi → Sektorët*: kontrolloni sektorët.
3. *Administrimi → Llojet e raportimeve*: lidhni çdo lloj me sektorin që e trajton.
4. *Administrimi → Përdoruesit → Krijo llogari*: krijoni llogarinë e përgjegjësit të çdo sektori.
   * Fjalëkalimi i përkohshëm shfaqet **vetëm një herë**. Jepjani personit drejtpërdrejt.
   * Në hyrjen e parë, personi detyrohet ta ndryshojë.

Për prezantim: *Administrimi → Të dhëna demo → Krijo të dhëna shembull*. Krijohen 60 raportime
të shënuara "Demo", që nuk llogariten në statistikat publike dhe fshihen me një klik.

## Vendosja në Vercel

1. Lidhni repository-n në Vercel. Projekti njihet si Next.js, dhe `vercel.json` vendos build-in
   dhe cron-in ditor.
2. Te **Storage**, shtoni:
   * **Postgres**: Neon nga Vercel Marketplace (rajon në Evropë) ose Supabase. Vendosni
     `DATABASE_URL` (lidhja "pooled") dhe `DIRECT_URL` (lidhja direkte).
   * **Blob**: `BLOB_READ_WRITE_TOKEN` shtohet vetë.
   * **Upstash Redis**: `UPSTASH_REDIS_REST_URL` dhe `UPSTASH_REDIS_REST_TOKEN`.
3. Nga konsola e Upstash, shtoni **QStash**: `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`,
   `QSTASH_NEXT_SIGNING_KEY`.
4. Vendosni edhe këto variabla:
   * `APP_URL`, me `https://`;
   * `AUTH_SECRET`, që krijohet me `npx auth secret`;
   * `ADMIN_EMAIL`;
   * `CRON_SECRET`;
   * `MAIL_DRIVER=smtp` dhe të dhënat SMTP;
   * për AI: `AI_ENABLED=true` dhe `AI_API_KEY`.
5. Bëni **Deploy**. Build-i krijon tabelat (`prisma migrate deploy`), shton të dhënat fillestare
   dhe ndërton faqen.
6. Hapni `https://<domeni>/hyrje/konfigurimi` dhe krijoni administratorin e parë.

## Siguria: rregulla që nuk ndryshojnë

- **Mos e ngjitni kurrë çelësin e AI-së, fjalëkalimin SMTP ose token-at në chat, në kod apo në
  GitHub.** Vendosen vetëm te *Vercel → Settings → Environment Variables*.
- Në demo nuk përdoren të dhëna reale personale.
- Stema e Bashkisë përdoret publikisht vetëm me lejen e saj.
- Emrat e sektorëve, afatet dhe prioritetet fillestare duhen konfirmuar me Bashkinë para nisjes.

## Kontrollet

```bash
npm run typecheck     # TypeScript
npm test              # 91 teste me PostgreSQL të vërtetë
npm run check:i18n    # çdo tekst ekziston në shqip dhe anglisht
npm run build         # ndërtimi për prodhim
```
