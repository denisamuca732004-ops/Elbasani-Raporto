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

Qytetarët **nuk kanë llogari dhe nuk lënë email**: faqja është vetëm për raportim.
* Hapi “Të dhënat e kontaktit” (si te BOS:311) ka një paragraf që i fton të lënë kontaktin dhe butonin
  **“Përfshi kontaktin”**. I fikur (si fillim) = anonim; i ndezur = emri dhe telefoni (të dyja të detyrueshme),
  që sektori t’i telefonojë nëse i duhen më shumë të dhëna. Numri nuk publikohet kurrë dhe nuk i dërgohet AI-së.
* Në fund marrin **numrin (ID) e raportimit**, me “Kopjo numrin” dhe shënimin “Ruajeni për ta ndjekur”:
  asgjë nuk u dërgohet me email.
* Lart në menu nuk ka “Hyr”. Stafi hyn nga fundi i faqes, “Hyrja për stafin” (`/hyrje`).
* Lidhjet e vjetra `/llogaria…` të çojnë te faqja kryesore. Të dhënat e vjetra nuk fshihen: llogaritë e
  qytetarëve nga prototipi nuk hyjnë dot më.
* **Emri dhe telefoni fshihen automatikisht** `CONTACT_RETENTION_DAYS` ditë (fillimisht 90) pas mbylljes
  së raportimit (ose pas ndryshimit të fundit, nëse u refuzua), bashkë me numrat dhe emailet e shkruara te
  përshkrimi. Raportimi mbetet për statistikat; paneli tregon datën kur u fshi kontakti. Afatin e vendos
  Bashkia, sipas rregullave të arkivimit dhe ligjit për mbrojtjen e të dhënave personale.

Kontrolli bëhet në tre nivele, dhe të tri duhet të kalojnë:
1. **proxy-ja** kontrollon cookie-n;
2. **çdo faqe dhe çdo veprim** e kontrollon llogarinë sërish në databazë: aktive, me të njëjtin
   version sesioni dhe me fjalëkalim jo të përkohshëm;
3. **çdo pyetje në databazë** kufizohet në sektorin e personit.

## Rrjedha e punës

- **Qytetari** raporton me 6 hapa: lloji → vendndodhja → foto → përshkrimi → kontakti → kontrolli.
  * Asnjë hap nuk anashkalohet.
  * Pa foto, pa përshkrim ose pa vendndodhje, raportimi **nuk krijohet**.
  * **Vendndodhja** (si te BOS:311): një fushë kërkimi dhe harta poshtë saj.
    - Kur shkruan, dalin menjëherë lagjet dhe fshatrat e Bashkisë (pa internet), dhe pas pak edhe rrugë e vende
      nga **OpenStreetMap** (`GEOCODER_URL`, si fillim Photon publik; `off` e fik). Kërkimin e bën serveri ynë,
      jo telefoni i qytetarit, dhe vetëm brenda kufijve të Bashkisë.
    - Kur zgjedh një rezultat, pika vendoset aty. Pika mund të preket, të tërhiqet ose të vendoset me **GPS**;
      kur lëviz, fusha merr emrin e rrugës aty (kur OpenStreetMap e njeh).
    - Zona gjendet gjithmonë nga pika, me kufijtë e 13 njësive administrative.
    - Një lagje ose fshat i zgjedhur pa e lëvizur pikën ruhet si "ai fshat" (pikë e përafërt), jo si pikë e saktë.
  * **Në hartën publike** çdo raportim del si pikë me ngjyrën e statusit, që kur merret ("Marrë", gri).
    - Fotoja dhe përshkrimi shfaqen vetëm pasi verifikohet.
    - Raportimet e refuzuara nuk shfaqen.
    - Raportimet me adresë pa pikë dalin edhe ato në hartë, në një **pikë të përafërt**: te fshati ose lagjja, kur dihen koordinatat e tij, përndryshe në mes të zonës. Kjo pikë vizatohet me rreth me vija dhe shënohet "e përafërt".
    - Administratori u vendos pikën e saktë te "Ndrysho detajet", dhe zona ndryshon vetë sipas pikës.
  * Listat e lagjeve dhe fshatrave janë marrë nga dokumentet e Bashkisë (2021, 2023). Administratori i ndryshon te *Administrimi → Zonat*.
  * Mollasi u hoq nga zonat, sepse i përket Bashkisë Cërrik.
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

## Kutia e kërkimit si udhëzues ("Pyesni ose kërkoni")

Kutia e kërkimit është lart djathtas në menu, në çdo faqe (në telefon, nën logon). U përgjigjet edhe pyetjeve.

- **Çfarë merr qytetari:**
  * *"si raportoj"* ose *"sa zgjat"*: një përgjigje e shkurtër me buton;
  * *"zjarr"* ose *"aksident"*: numrat e emergjencës, gjithmonë të parët;
  * *"EL-2026-00042"*: ecuria e raportimit;
  * *"gropë"*: lloji i problemit, për ta raportuar;
  * *"Rruga Rinia"*: raportimet e hapura aty.
- **Ku ruhen përgjigjet:** në databazë, në shqip dhe anglisht. Platforma nis me 17 pyetje.
- **Si i ndryshon Bashkia:** te faqja `/admin/guide` (nuk është më në menu). Aty mund të:
  * shtojë, ndryshojë ose fshehë pyetje, pa programues;
  * provojë kërkimin ashtu si qytetari.
- **Ku shfaqen:** te kutia e kërkimit. Kur qytetari e klikon, para se të shkruajë, del lista **Pyetje të shpeshta**: 6 pyetjet e para (sipas *Radhës*), butoni “Shiko të gjitha pyetjet” dhe në fund “Është emergjencë?”. Çdo pyetje hap përgjigjen aty. Te `/admin/guide` këto 6 kanë shenjën “Në listën e kërkimit”. Kur qytetari shkruan, dalin përgjigjet që përputhen. Menuja nuk ka më “Ndiq raportimin” dhe “Ndihmë”; raportimi ndiqet me butonin “Ndiq raportimin” në faqen kryesore ose duke shkruar numrin te kjo kuti. Lidhjet e vjetra vazhdojnë të punojnë (`/ndiq/EL-…` hap raportimin, `/ndihme` çon te faqja kryesore).
- **Pa AI:** kërkimi bëhet në telefonin e qytetarit. Është falas dhe i menjëhershëm, dhe nuk shpik kurrë përgjigje.
- **Siguria:** butoni nën përgjigje zgjidhet nga një listë e mbyllur (raporto, ndiq, harta, statistikat, privatësia, telefono 112). Administratori nuk mund të vendosë lidhje të jashtme.

## Kontrolli i fotos dhe i përshkrimit gjatë raportimit

Fotoja kontrollohet sapo qytetari e zgjedh, te hapi “Shtoni një foto”.

- **Foto e papërshtatshme** (nuditet ose përmbajtje seksuale, dhunë e rëndë ndaj njerëzve,
  imazhe të turpshme): refuzohet dhe qytetari duhet të zgjedhë një tjetër. Serveri e refuzon
  përsëri kur dërgohet raportimi, kështu që nuk mund të anashkalohet. Kërkon AI-në.
- **Dokument ose screenshot** (jo foto e vendit): refuzohet si më sipër, me mesazhin “Kjo duket
  si dokument ose screenshot, jo si foto e vendit”. Kërkon AI-në.
- **Foto që nuk tregon problemin** (selfie, foto e zgjedhur gabimisht nga galeria): del pyetja
  “A është kjo fotoja e problemit?”. Qytetari zgjedh një tjetër ose konfirmon. Nuk refuzohet,
  sepse AI mund të gabojë me një foto të errët ose nga larg; Bashkia e kontrollon gjithsesi.
  Kërkon AI-në.
- **Kur AI nuk përgjigjet** (çelës i gabuar, pa kredit): qytetari sheh “Fotoja nuk u kontrollua
  automatikisht”, dhe raportimi vazhdon. Shkakun e tregon butoni **Provo lidhjen me AI** te
  *Administrimi → Integrimi*.
- **Përshkrimi** kontrollohet kur qytetari shtyp “Vazhdo”: shkronja të rastit (“asdfkz kcp”)
  refuzohen edhe pa AI; me AI refuzohen edhe tekstet që nuk thonë asgjë (“test test”) dhe ato
  fyese ose të turpshme (zemërimi apo kritika ndaj Bashkisë lejohen). Nëse përshkrimi flet për
  një problem tjetër, del pyetja “A përputhet përshkrimi me llojin e zgjedhur?” me “Ndrysho
  llojin” ose “Po, vazhdo”. Emailet dhe numrat e telefonit fshihen para se teksti t'i shkojë AI-së.
- **Foto më e vjetër se 7 ditë:** del një shënim që sugjeron një foto të re. Punon edhe pa AI.
- **Aktivizimi:** te Vercel → *Settings → Environment Variables* vendosni `AI_ENABLED=true`,
  `AI_API_KEY` (çelësi i OpenAI) dhe `AI_MODEL=gpt-4o-mini`, pastaj *Redeploy*. Pa to, fotot nuk
  kontrollohen, por nuk publikohen kurrë para se sektori ta verifikojë raportimin.

## Nisja në kompjuter

Duhen **Node.js 24** (versioni që përdor Vercel) dhe **Docker Desktop** (ose PostgreSQL i instaluar).

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
2. Te paneli, karta **Hapat e parë** ka lidhjet për hapat 3–5 (këto faqe nuk janë më në menu).
3. Sektorët (`/admin/departments`): kontrolloni sektorët.
4. Llojet e raportimeve (`/admin/report-types`): lidhni çdo lloj me sektorin që e trajton.
5. Përdoruesit (`/admin/users`) → **Krijo llogari**: krijoni llogarinë e përgjegjësit të çdo sektori.
   * Fjalëkalimi i përkohshëm shfaqet **vetëm një herë**. Jepjani personit drejtpërdrejt.
   * Në hyrjen e parë, personi detyrohet ta ndryshojë.

Për prezantim: *Administrimi → Të dhëna demo → Krijo të dhëna shembull*. Krijohen 60 raportime
të shënuara "Demo", që nuk llogariten në statistikat publike dhe fshihen me një klik. Paneli i
shfaq gjithmonë (nuk ka më çelës "Shfaq të dhënat demo"). Fshijini para përdorimit zyrtar.

## Paneli i administratorit

- **Menuja** ka vetëm punën e përditshme: Paneli, **Departamentet**, Kërkesat për rishikim, dhe
  te *Administrimi*: Zonat, Emailet, Integrimi, Të dhëna demo. Logoja lart të çon te faqja
  kryesore publike. Sektorët nuk renditen më në menu:
  *Departamentet* (`/admin/sectors`) hap kartat e tyre në të djathtë, dhe çdo kartë hap
  raportimet e atij sektori (me lidhjen “← Departamentet” për t'u kthyer).
- **Jo në menu**, por faqet punojnë me adresën e tyre: Sektorët (`/admin/departments`),
  Përdoruesit (`/admin/users`), Llojet e raportimeve (`/admin/report-types`), Udhëzuesi
  (`/admin/guide`), Pamja (`/admin/appearance`) dhe Raportim i ri nga stafi (`/admin/reports/new`).
- **Paneli** dhe **Departamentet** tregojnë një kartë për çdo sektor: sa raportime ka, sa janë të hapura, sa me
  prioritet të lartë dhe sa me vonesë. Klikimi hap raportimet e sektorit; skedat e statusit
  (Të hapura, Për verifikim, Në punë, Zgjidhur, Mbyllur/refuzuar, Të gjitha) tregojnë numrin
  për secilin. Çdo raportim hapet dhe administratori e ndryshon (statusi, prioriteti, sektori,
  përgjegjësi, të dhënat, vendi në hartë).
- **Emri i platformës në anglisht:** me “EN” lart ndryshojnë edhe emrat: *Elbasan Reports* dhe
  *Municipality of Elbasan* (në shqip *Elbasani Raporton* dhe *Bashkia Elbasan*), edhe te titulli
  i skedës së shfletuesit. Të katër emrat ndryshohen te Pamja (`/admin/appearance`).
- **Kur raportimi nuk i përket sektorit:** sektori dërgon **kërkesë për rishikim**. Administratori
  e sheh te *Kërkesat për rishikim* dhe e dërgon raportimin te sektori i duhur.

## Vendosja në Vercel

1. Lidhni repository-n në Vercel. Projekti njihet si Next.js, dhe `vercel.json` vendos build-in
   dhe cron-in ditor.
2. Te **Storage**, shtoni:
   * **Postgres**: Neon nga Vercel Marketplace (rajon në Evropë). Neon i vendos vetë
     `DATABASE_URL` dhe `DATABASE_URL_UNPOOLED`; nuk duhet shtuar asgjë tjetër. Me një ofrues tjetër,
     vendosni `DIRECT_URL` (lidhja direkte).
   * **Blob**: krijojeni si **Private** dhe lidheni me projektin. Vercel shton vetë `BLOB_STORE_ID`
     (ose `BLOB_READ_WRITE_TOKEN`); të dyja funksionojnë.
   * **Upstash Redis**: `UPSTASH_REDIS_REST_URL` dhe `UPSTASH_REDIS_REST_TOKEN`.
3. Nga konsola e Upstash, shtoni **QStash**: `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`,
   `QSTASH_NEXT_SIGNING_KEY`.
4. Vendosni edhe këto variabla:
   * `APP_URL`, me `https://` (në Vercel mund të mos e vendosni: merret vetë adresa e projektit);
   * `AUTH_SECRET`, që krijohet me `npx auth secret`;
   * `ADMIN_EMAIL`;
   * `CRON_SECRET`;
   * `MAIL_DRIVER=smtp` dhe të dhënat SMTP, për emailet e sektorëve dhe të stafit. Pa to emailet
     vetëm shkruhen në log dhe nuk i dërgohen askujt. Qytetarëve nuk u dërgohet asnjë email;
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
npm test              # 138 teste me PostgreSQL të vërtetë
npm run check:i18n    # çdo tekst ekziston në shqip dhe anglisht
npm run build         # ndërtimi për prodhim
```
