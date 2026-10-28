/**
 * Reference data: departments (sectors), report categories and types, areas,
 * the questions of the search guide, settings. Used by `npm run db:seed`. Idempotent: running it again never
 * duplicates rows and never overwrites what the admin changed afterwards.
 *
 * NOTE: department names, deadlines and default priorities are a sensible
 * starting point and must be confirmed with the Municipality of Elbasan.
 */
import type { GuideAction, Priority, RequestKind } from '@/lib/shared/domain';
import type { AppSettings } from '@/lib/shared/types';
import type { PrismaClient } from '@/lib/generated/prisma/client';

export const DEPARTMENTS = [
  { code: 'public_services', nameSq: 'Sektori i Shërbimeve Publike', nameEn: 'Public Services Sector', description: 'Mbetjet, pastrimi, gjelbërimi dhe parqet.' },
  { code: 'infrastructure', nameSq: 'Sektori i Infrastrukturës dhe Punëve Publike', nameEn: 'Infrastructure and Public Works Sector', description: 'Rrugët, trotuaret, sinjalistika dhe ndriçimi publik.' },
  { code: 'water', nameSq: 'Ujësjellës Kanalizime Elbasan', nameEn: 'Elbasan Water and Sewerage', description: 'Rrjeti i ujit, kanalizimet dhe pusetat.' },
  { code: 'urban_control', nameSq: 'Inspektorati i Mbrojtjes së Territorit', nameEn: 'Territory Protection Inspectorate', description: 'Ndërtimet pa leje, kantieret dhe mbetjet inerte.' },
  { code: 'public_health', nameSq: 'Sektori i Shëndetit Publik dhe Shërbimit Veterinar', nameEn: 'Public Health and Veterinary Sector', description: 'Kafshët, dezinsektimi dhe shëndeti publik.' },
  { code: 'municipal_police', nameSq: 'Policia Bashkiake', nameEn: 'Municipal Police', description: 'Zhurmat, zënia e hapësirës publike dhe automjetet e braktisura.' },
  { code: 'citizen_service', nameSq: 'Zyra e Shërbimit ndaj Qytetarit', nameEn: 'Citizen Service Office', description: 'Kërkesat e tjera që nuk i përkasin një sektori të caktuar.' },
] as const;

type TypeRow = [code: string, nameSq: string, nameEn: string, kind: RequestKind, department: string, slaDays: number, priority: Priority, keywords: string];

export const CATEGORIES: Array<{ code: string; icon: string; nameSq: string; nameEn: string; types: TypeRow[] }> = [
  {
    code: 'animals', icon: 'paw', nameSq: 'Kafshë', nameEn: 'Animals',
    types: [
      ['animals.stray_dog', 'Qen endacak', 'Stray dog', 'PROBLEM', 'public_health', 3, 'MEDIUM', 'qen,qenë,endacak,dog'],
      ['animals.dead_animal', 'Kafshë e ngordhur në rrugë', 'Dead animal on the street', 'PROBLEM', 'public_services', 1, 'MEDIUM', 'ngordhur,kufomë,dead'],
      ['animals.injured_animal', 'Kafshë e lënduar', 'Injured animal', 'PROBLEM', 'public_health', 1, 'HIGH', 'lënduar,plagosur,injured'],
    ],
  },
  {
    code: 'waste', icon: 'trash', nameSq: 'Mbeturina dhe riciklim', nameEn: 'Trash and recycling',
    types: [
      ['waste.illegal_dumping', 'Mbetje të hedhura paligjshëm', 'Illegal dumping', 'PROBLEM', 'public_services', 3, 'MEDIUM', 'mbetje,plehra,hedhje,pirg,dumping,garbage'],
      ['waste.overflowing_bin', 'Kontejner i mbushur', 'Overflowing bin', 'PROBLEM', 'public_services', 1, 'MEDIUM', 'kontejner,kosh,mbushur,bin'],
      ['waste.damaged_bin', 'Kontejner i dëmtuar ose që mungon', 'Damaged or missing bin', 'SERVICE', 'public_services', 7, 'LOW', 'kontejner,dëmtuar,mungon'],
      ['waste.bulky_pickup', 'Marrje e mbetjeve të mëdha (divan, frigorifer)', 'Bulky item pickup (sofa, fridge)', 'SERVICE', 'public_services', 7, 'LOW', 'divan,frigorifer,dyshek,mobilie,bulky'],
      ['waste.construction_debris', 'Mbetje inerte nga ndërtimi', 'Construction debris', 'PROBLEM', 'urban_control', 5, 'MEDIUM', 'inerte,ndërtim,beton,tulla,debris'],
    ],
  },
  {
    code: 'streets', icon: 'road', nameSq: 'Rrugë dhe trotuare', nameEn: 'Streets and sidewalks',
    types: [
      ['streets.pothole', 'Gropë në rrugë', 'Pothole', 'PROBLEM', 'infrastructure', 10, 'MEDIUM', 'gropë,asfalt,pothole'],
      ['streets.sidewalk', 'Trotuar i dëmtuar', 'Damaged sidewalk', 'PROBLEM', 'infrastructure', 14, 'LOW', 'trotuar,pllaka,sidewalk'],
      ['streets.signage', 'Sinjalistikë ose semafor i dëmtuar', 'Damaged road sign or traffic light', 'PROBLEM', 'infrastructure', 5, 'MEDIUM', 'tabelë,sinjal,semafor,sign'],
      ['streets.abandoned_vehicle', 'Automjet i braktisur', 'Abandoned vehicle', 'PROBLEM', 'municipal_police', 14, 'LOW', 'makinë,automjet,braktisur,vehicle'],
      ['streets.graffiti', 'Grafite', 'Graffiti', 'PROBLEM', 'public_services', 14, 'LOW', 'grafite,shkrime,graffiti'],
      ['streets.cleaning', 'Kërkesë për pastrim rruge', 'Street cleaning request', 'SERVICE', 'public_services', 3, 'LOW', 'pastrim,fshirje,cleaning'],
    ],
  },
  {
    code: 'lighting', icon: 'bulb', nameSq: 'Ndriçimi publik', nameEn: 'Street lighting',
    types: [
      ['lighting.light_out', 'Dritë rruge e fikur', 'Street light out', 'PROBLEM', 'infrastructure', 5, 'MEDIUM', 'dritë,llambë,ndriçim,fikur,light'],
      ['lighting.damaged_pole', 'Shtyllë e dëmtuar ose kabllo e zhveshur', 'Damaged pole or exposed cable', 'PROBLEM', 'infrastructure', 1, 'HIGH', 'shtyllë,kabllo,tel,zhveshur,cable'],
    ],
  },
  {
    code: 'water', icon: 'drop', nameSq: 'Ujë dhe kanalizime', nameEn: 'Water and sewer',
    types: [
      ['water.leak', 'Rrjedhje uji', 'Water leak', 'PROBLEM', 'water', 2, 'MEDIUM', 'rrjedhje,ujë,tub,çarë,leak'],
      ['water.blocked_drain', 'Kanal ose pusetë e bllokuar', 'Blocked drain', 'PROBLEM', 'water', 3, 'MEDIUM', 'kanal,bllokuar,pusetë,drain'],
      ['water.open_manhole', 'Pus i hapur', 'Open manhole', 'PROBLEM', 'water', 1, 'HIGH', 'pus,hapur,kapak,manhole'],
      ['water.drain_cleaning', 'Kërkesë për pastrim kanalesh', 'Drain cleaning request', 'SERVICE', 'water', 7, 'LOW', 'pastrim,kanal,shira'],
    ],
  },
  {
    code: 'parks', icon: 'tree', nameSq: 'Parqe dhe pemë', nameEn: 'Parks and trees',
    types: [
      ['parks.fallen_tree', 'Pemë e rrëzuar ose e rrezikshme', 'Fallen or dangerous tree', 'PROBLEM', 'public_services', 2, 'HIGH', 'pemë,rrëzuar,degë,rrezik,tree'],
      ['parks.tree_pruning', 'Krasitje peme', 'Tree pruning', 'SERVICE', 'public_services', 14, 'LOW', 'krasitje,degë,pruning'],
      ['parks.playground', 'Lodër e dëmtuar në park', 'Damaged playground', 'PROBLEM', 'public_services', 7, 'MEDIUM', 'lodër,park,kënd lojrash,playground'],
      ['parks.unmaintained_green', 'Gjelbërim i pamirëmbajtur', 'Unmaintained green area', 'PROBLEM', 'public_services', 10, 'LOW', 'bar,gjelbërim,lulishte,green'],
    ],
  },
  {
    code: 'construction', icon: 'building', nameSq: 'Ndërtime dhe banesa', nameEn: 'Housing and construction',
    types: [
      ['construction.illegal_building', 'Ndërtim pa leje', 'Construction without permit', 'PROBLEM', 'urban_control', 10, 'MEDIUM', 'leje,ndërtim,paligjshëm,kat'],
      ['construction.unsafe_site', 'Kantier pa masa sigurie', 'Unsafe construction site', 'PROBLEM', 'urban_control', 3, 'HIGH', 'kantier,siguri,rrezik'],
    ],
  },
  {
    code: 'health', icon: 'health', nameSq: 'Shëndeti publik', nameEn: 'Public health',
    types: [
      ['health.pest_control', 'Dezinsektim ose deratizim', 'Pest control', 'SERVICE', 'public_health', 7, 'LOW', 'minj,insekte,dezinsektim,deratizim,pest'],
      ['health.standing_water', 'Ujë i ndenjur ose mushkonja', 'Standing water or mosquitoes', 'PROBLEM', 'public_health', 5, 'MEDIUM', 'mushkonja,ujë i ndenjur,mosquito'],
    ],
  },
  {
    code: 'business', icon: 'store', nameSq: 'Biznese', nameEn: 'Business',
    types: [
      ['business.noise', 'Zhurmë nga lokal ose biznes', 'Noise from a venue or business', 'PROBLEM', 'municipal_police', 3, 'MEDIUM', 'zhurmë,muzikë,lokal,noise'],
      ['business.sidewalk_occupation', 'Zënie e trotuarit nga biznesi', 'Business blocking the sidewalk', 'PROBLEM', 'municipal_police', 7, 'LOW', 'tavolina,zënie,trotuar'],
    ],
  },
  {
    code: 'other', icon: 'other', nameSq: 'Tjetër', nameEn: 'Other',
    types: [
      ['other.problem', 'Problem tjetër', 'Other problem', 'PROBLEM', 'citizen_service', 10, 'MEDIUM', ''],
      ['other.request', 'Kërkesë tjetër për shërbim', 'Other service request', 'SERVICE', 'citizen_service', 10, 'LOW', ''],
    ],
  },
];

/** Administrative units of the Municipality of Elbasan (2015 territorial reform). */
export const NEIGHBOURHOODS = [
  'Elbasan (qyteti)', 'Bradashesh', 'Funarë', 'Gjergjan', 'Gjinar', 'Gracen', 'Labinot-Fushë',
  'Labinot-Mal', 'Mollas', 'Papër', 'Shirgjan', 'Shushicë', 'Tregan', 'Zavalinë',
];

/**
 * The guide of the search box ("Ask or search") and of the Help page. A
 * starting set: the admin edits, hides or adds questions in
 * Administrimi → Udhëzuesi, and the seed never overwrites those changes.
 * Answers are plain text; a line break starts a new line.
 */
export const GUIDE_ENTRIES: Array<{
  code: string; sortOrder: number; emergency?: boolean; action: GuideAction;
  questionSq: string; questionEn: string; answerSq: string; answerEn: string; keywords: string;
}> = [
  {
    code: 'emergency', sortOrder: 0, emergency: true, action: 'CALL_112',
    questionSq: 'Është emergjencë?',
    questionEn: 'Is it an emergency?',
    answerSq: 'Kjo platformë nuk është për emergjenca. Telefononi menjëherë:\n112 – numri i emergjencave\n127 – Ambulanca\n128 – Zjarrfikësja\n129 – Policia',
    answerEn: 'This platform is not for emergencies. Call immediately:\n112 – emergency number\n127 – Ambulance\n128 – Fire service\n129 – Police',
    keywords: 'emergjencë, emergjence, urgjencë, urgjent, zjarr, digjet, tym, aksident, aksidenti, përplasje, plagosur, gjakderdhje, ambulancë, polici, policia, zjarrfikës, vjedhje, vodhën, dhunë, sulm, gaz, shpërthim, përmbytje, tërmet, 112, rrezik për jetën, dikush u lëndua, emergency, urgent, fire, smoke, accident, crash, bleeding, ambulance, police, theft, violence, explosion, flood, earthquake, danger to life',
  },
  {
    code: 'how_to_report', sortOrder: 10, action: 'REPORT',
    questionSq: 'Si raportoj një problem?',
    questionEn: 'How do I report a problem?',
    answerSq: 'Shtypni “Raporto një problem” dhe ndiqni 6 hapat: lloji i problemit, vendi në hartë, fotoja, përshkrimi, kontakti (ose anonim) dhe kontrolli. Në fund merrni një numër raportimi, p.sh. EL-2026-00042, me të cilin e ndiqni.',
    answerEn: 'Press “Report a problem” and follow the 6 steps: type of problem, place on the map, photo, description, contact (or anonymous) and review. At the end you get a report number, e.g. EL-2026-00042, to follow it.',
    keywords: 'raportoj, raportim, raporto, dërgoj, ankesë, ankohem, denoncoj, sinjalizoj, report, complaint, submit',
  },
  {
    code: 'how_long', sortOrder: 20, action: 'TRACK',
    questionSq: 'Sa kohë zgjat zgjidhja?',
    questionEn: 'How long does it take?',
    answerSq: 'Çdo lloj problemi ka afatin e vet, zakonisht nga 1 deri në 14 ditë. Problemet e rrezikshme, si një pus i hapur ose një kabllo e zhveshur, trajtohen me përparësi. Ecurinë e shihni me numrin e raportimit.',
    answerEn: 'Each type of problem has its own deadline, usually 1 to 14 days. Dangerous problems, such as an open manhole or an exposed cable, are handled first. You can see the progress with the report number.',
    keywords: 'zgjat, kohë, afat, afati, ditë, shpejt, vonesë, vonon, pres, sa kohë, how long, time, deadline, days, delay, wait',
  },
  {
    code: 'privacy', sortOrder: 30, action: 'PRIVACY',
    questionSq: 'A e shohin të tjerët emrin tim?',
    questionEn: 'Can other people see my name?',
    answerSq: 'Jo. Emri, emaili dhe telefoni juaj nuk publikohen kurrë; i sheh vetëm stafi i Bashkisë që trajton raportimin. Fotoja publikohet pa të dhënat e fshehura (GPS, pajisja), dhe fotot me fytyra ose targa fshihen nga publiku.',
    answerEn: 'No. Your name, email and phone are never published; only the municipal staff handling the report see them. The photo is published without its hidden data (GPS, device), and photos showing faces or number plates are hidden from the public.',
    keywords: 'emri, emrin, privatësia, privatësi, të dhënat, publik, shohin, sheh, identiteti, gdpr, privacy, name, personal data, public, see',
  },
  {
    code: 'install', sortOrder: 40, action: 'NONE',
    questionSq: 'Si e instaloj në telefon?',
    questionEn: 'How do I install it on my phone?',
    answerSq: 'Nuk ju duhet Google Play apo App Store.\nAndroid (Chrome): hapni këtë faqe, shtypni ⋮ lart djathtas dhe zgjidhni “Instalo aplikacionin” (Install app) ose “Shto në ekranin bazë” (Add to Home screen).\niPhone (Safari): shtypni butonin Ndaj (katrori me shigjetë) dhe zgjidhni “Shto në ekranin bazë” (Add to Home Screen).',
    answerEn: 'No Google Play or App Store needed.\nAndroid (Chrome): open this page, tap ⋮ at the top right and choose “Install app” or “Add to Home screen”.\niPhone (Safari): tap the Share button (the square with an arrow) and choose “Add to Home Screen”.',
    keywords: 'instaloj, instalo, instalim, aplikacion, aplikacioni, app, shkarkoj, telefon, celular, android, iphone, ekran, play store, app store, install, download, phone, mobile, home screen',
  },
  {
    code: 'account', sortOrder: 50, action: 'REPORT',
    questionSq: 'A më duhet llogari për të raportuar?',
    questionEn: 'Do I need an account to report?',
    answerSq: 'Jo. Raportoni pa llogari, pa fjalëkalim dhe falas. Ruani numrin e raportimit që merrni në fund: me të e ndiqni raportimin në çdo kohë.',
    answerEn: 'No. You report without an account or password, free of charge. Keep the report number you get at the end: with it you can follow the report at any time.',
    keywords: 'llogari, regjistrim, regjistrohem, fjalëkalim, profil, falas, paguaj, pagesë, kushton, account, register, sign up, password, login, free, pay, cost',
  },
  {
    code: 'track', sortOrder: 60, action: 'TRACK',
    questionSq: 'Si e ndjek raportimin tim?',
    questionEn: 'How do I follow my report?',
    answerSq: 'Shkruani numrin e raportimit (p.sh. EL-2026-00042) në këtë kuti ose te “Ndiq raportimin”. Aty shihni statusin, sektorin dhe historikun. Nëse keni lënë email, ju njoftojmë në çdo hap.',
    answerEn: 'Type the report number (e.g. EL-2026-00042) in this box or under “Track a report”. There you see the status, the department and the history. If you left an email, we notify you at every step.',
    keywords: 'ndjek, ndiq, ndjekje, ecuria, ecurinë, gjendja, statusi, gjurmoj, njoftim, track, follow, progress, status, notification',
  },
  {
    code: 'statuses', sortOrder: 70, action: 'TRACK',
    questionSq: 'Çfarë do të thotë secili status?',
    questionEn: 'What does each status mean?',
    answerSq: 'Marrë: raportimi u regjistrua dhe po kontrollohet.\nHapur: u verifikua dhe e ka marrë sektori përgjegjës.\nNë punë: ekipi po punon për zgjidhjen.\nZgjidhur: Bashkia thotë se u rregullua; mund ta konfirmoni ose ta rihapni.\nMbyllur: përfundoi.\nRefuzuar: nuk mund të trajtohet; arsyeja shkruhet te raportimi.',
    answerEn: 'Received: the report was registered and is being checked.\nOpen: verified and taken by the responsible department.\nIn progress: the team is working on it.\nResolved: the Municipality says it is fixed; you can confirm or reopen it.\nClosed: finished.\nRejected: it cannot be handled; the reason is written on the report.',
    keywords: 'status, statuset, marrë, hapur, zgjidhur, mbyllur, refuzuar, kuptimi, në punë, do të thotë, received, open, in progress, resolved, closed, rejected, meaning',
  },
  {
    code: 'anonymous', sortOrder: 80, action: 'REPORT',
    questionSq: 'A mund të raportoj në mënyrë anonime?',
    questionEn: 'Can I report anonymously?',
    answerSq: 'Po. Te hapi “Kontakti” zgjidhni “Anonim”. Atëherë nuk mund t’ju njoftojmë, prandaj ruajeni numrin e raportimit për ta ndjekur vetë.',
    answerEn: 'Yes. At the “Contact” step choose “Anonymous”. We then cannot notify you, so keep the report number to follow it yourself.',
    keywords: 'anonim, anonime, anonimisht, pa emër, anonymous, anonymously, without name',
  },
  {
    code: 'photo', sortOrder: 90, action: 'REPORT',
    questionSq: 'Pse më kërkohet foto?',
    questionEn: 'Why do I need a photo?',
    answerSq: 'Fotoja është e detyrueshme: i tregon sektorit problemin dhe e ndihmon ta zgjidhë më shpejt. Fotografoni vetëm problemin, pa fytyra ose targa makinash. Vendndodhja dhe të dhënat e fshehura të fotos hiqen automatikisht.',
    answerEn: 'The photo is required: it shows the department the problem and helps it fix it faster. Photograph only the problem, without faces or number plates. The location and hidden data of the photo are removed automatically.',
    keywords: 'foto, fotoja, fotografi, imazh, kamera, ngarkoj, photo, picture, image, camera, upload',
  },
  {
    code: 'offline', sortOrder: 100, action: 'REPORT',
    questionSq: 'Po nëse nuk kam internet?',
    questionEn: 'What if I have no internet?',
    answerSq: 'Mund ta plotësoni raportimin edhe pa internet. Ai ruhet në telefon dhe dërgohet vetë sapo të lidheni; atëherë merrni edhe numrin e raportimit.',
    answerEn: 'You can fill in the report even without internet. It is saved on the phone and sent automatically as soon as you are connected; you then get the report number too.',
    keywords: 'internet, offline, lidhje, wifi, sinjal, rrjet, pa internet, connection, signal, network',
  },
  {
    code: 'already_reported', sortOrder: 110, action: 'MAP',
    questionSq: 'Problemi është raportuar tashmë. Çfarë bëj?',
    questionEn: 'The problem is already reported. What do I do?',
    answerSq: 'Shkruani rrugën në këtë kuti ose shikoni hartën. Nëse e gjeni problemin, hapeni dhe shtypni “Edhe unë e kam këtë problem”. Kështu Bashkia sheh sa qytetarë prek, pa raportime të dyfishta.',
    answerEn: 'Type the street in this box or look at the map. If you find the problem, open it and press “I have this problem too”. This way the Municipality sees how many residents it affects, without duplicate reports.',
    keywords: 'tashmë, njëjti, njëjtin, dyfishtë, dublikatë, mbështes, edhe unë, dikush tjetër, already, same, duplicate, someone else, support',
  },
  {
    code: 'lost_number', sortOrder: 120, action: 'MAP',
    questionSq: 'Humba numrin e raportimit. Çfarë bëj?',
    questionEn: 'I lost my report number. What can I do?',
    answerSq: 'Nëse keni lënë email, numri është te emaili që ju dërguam kur raportuat. Përndryshe shkruani rrugën në këtë kuti ose kërkojeni në hartë: raportimet e verifikuara shfaqen aty me numrin e tyre.',
    answerEn: 'If you left an email, the number is in the email we sent when you reported. Otherwise type the street in this box or look on the map: verified reports are shown there with their number.',
    keywords: 'humba, humbur, harrova, numrin, numri, kodi, lost, forgot, number, code',
  },
  {
    code: 'who_handles', sortOrder: 130, action: 'NONE',
    questionSq: 'Kush e trajton raportimin tim?',
    questionEn: 'Who handles my report?',
    answerSq: 'Platforma e dërgon vetë te sektori përgjegjës i Bashkisë sipas llojit të problemit, p.sh. ndriçimin te Infrastruktura dhe mbetjet te Shërbimet Publike. Nuk ka nevojë ta zgjidhni ju sektorin.',
    answerEn: 'The platform sends it automatically to the responsible department of the Municipality, based on the type of problem, e.g. street lights to Infrastructure and waste to Public Services. You do not need to choose the department.',
    keywords: 'kush, sektori, sektor, zyra, punonjës, përgjegjës, kujt, departament, trajton, who, department, office, responsible, handles',
  },
  {
    code: 'reopen', sortOrder: 140, action: 'REPORT',
    questionSq: 'U shënua “Zgjidhur”, por problemi është ende aty',
    questionEn: 'It says “Resolved”, but the problem is still there',
    answerSq: 'Nëse keni lënë email, hapni lidhjen te emaili që ju dërguam kur u zgjidh dhe zgjidhni “Jo, nuk është rregulluar”: raportimi rihapet dhe sektori njoftohet. Pa email, bëni një raportim të ri dhe shkruani numrin e të vjetrit te përshkrimi.',
    answerEn: 'If you left an email, open the link in the email we sent when it was resolved and choose “No, it is not fixed”: the report is reopened and the department is notified. Without an email, make a new report and write the old number in the description.',
    keywords: 'rihap, rihapur, rihapet, ende, akoma, rregulluar, nuk u rregullua, reopen, still, not fixed',
  },
  {
    code: 'what_to_report', sortOrder: 150, action: 'REPORT',
    questionSq: 'Çfarë mund të raportoj këtu?',
    questionEn: 'What can I report here?',
    answerSq: 'Probleme në hapësirat publike: gropa, ndriçim, mbetje, ujë dhe kanalizime, pemë, kafshë endacake, zhurmë, ndërtime pa leje e të tjera. Zgjidhni kategorinë në faqen kryesore. Kjo platformë nuk është për emergjenca, për dokumente apo për taksa.',
    answerEn: 'Problems in public spaces: potholes, street lights, waste, water and sewers, trees, stray animals, noise, illegal construction and more. Choose the category on the home page. This platform is not for emergencies, documents or taxes.',
    keywords: 'lloje, kategori, kategoritë, taksa, tatim, dokumente, certifikatë, çertifikatë, types, categories, taxes, documents, certificate',
  },
  {
    code: 'stats', sortOrder: 160, action: 'STATS',
    questionSq: 'Sa raportime zgjidh Bashkia?',
    questionEn: 'How many reports does the Municipality resolve?',
    answerSq: 'Te “Statistikat” shihni sa raportime merren dhe zgjidhen çdo muaj, sipas kategorisë, dhe sa ditë duhen mesatarisht deri në zgjidhje.',
    answerEn: 'Under “Statistics” you see how many reports are received and resolved each month, by category, and how many days it takes on average to resolve them.',
    keywords: 'statistika, statistikat, transparencë, performancë, rezultate, statistics, numbers, transparency, performance, results',
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  branding: {
    municipalityName: 'Bashkia Elbasan',
    appName: 'Elbasani Raporton',
    logoUrl: '/logo-bashkia-elbasan.svg',
    headerColor: '#06B006',
    footerColor: '#0B3D0B',
    buttonColor: '#067A06',
  },
  embed: { allowedOrigins: ['https://elbasani.gov.al', 'https://www.elbasani.gov.al'] },
};


export async function seedReferenceData(db: PrismaClient): Promise<void> {
  const departmentId: Record<string, number> = {};
  for (const d of DEPARTMENTS) {
    const row = await db.department.upsert({ where: { code: d.code }, create: { ...d }, update: {} });
    departmentId[d.code] = row.id;
  }

  for (const [ci, c] of CATEGORIES.entries()) {
    const category = await db.category.upsert({
      where: { code: c.code },
      create: { code: c.code, icon: c.icon, nameSq: c.nameSq, nameEn: c.nameEn, sortOrder: ci },
      update: {},
    });
    for (const [ti, t] of c.types.entries()) {
      const [code, nameSq, nameEn, kind, department, slaDays, defaultPriority, keywords] = t;
      await db.requestType.upsert({
        where: { code },
        create: {
          code, nameSq, nameEn, kind, slaDays, defaultPriority, keywords: keywords || null,
          categoryId: category.id, departmentId: departmentId[department] ?? null, sortOrder: ti,
        },
        update: {},
      });
    }
  }

  for (const [i, name] of NEIGHBOURHOODS.entries()) {
    await db.neighbourhood.upsert({ where: { name }, create: { name, sortOrder: i }, update: {} });
  }

  for (const { code, emergency, ...entry } of GUIDE_ENTRIES) {
    await db.guideEntry.upsert({ where: { code }, create: { code, emergency: emergency ?? false, ...entry }, update: {} });
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
}
