/**
 * Reference data: departments (sectors), report categories and types, areas,
 * settings. Used by `npm run db:seed`. Idempotent: running it again never
 * duplicates rows and never overwrites what the admin changed afterwards.
 *
 * NOTE: department names, deadlines and default priorities are a sensible
 * starting point and must be confirmed with the Municipality of Elbasan.
 */
import type { Priority, RequestKind } from '@/lib/shared/domain';
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

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
}
