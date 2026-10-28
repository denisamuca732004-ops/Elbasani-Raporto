/**
 * Where the problem is. A resident gives the place ONE of two ways:
 *  - GPS or a tap on the map: the zone comes from the zone borders, no address is needed;
 *  - by hand: zone → one of THAT zone's lagje or villages → street (no point on the map).
 * The zone and the place can never disagree.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import * as adminService from '@/lib/server/services/admin';
import { getCatalog } from '@/lib/server/services/catalog';
import { createCitizenReport } from '@/lib/server/services/publicReport';
import { createStaffReport } from '@/lib/server/services/report';
import type { Principal } from '@/lib/shared/types';
import { BORDER_TOLERANCE_M, ZONE_CODES, otherZonePlace, zoneCodeAt } from '@/lib/shared/zones';
import { localityPatchSchema, localitySchema } from '@/lib/validation/admin';
import { staffReportSchema } from '@/lib/validation/report';
import { adminSession, citizenData, db, drainJobs, ELBASAN, rejects, setupTestDb, staffSession, teardown, typeId } from './helpers';

let admin: Principal;
before(async () => {
  await setupTestDb();
  admin = await adminSession();
});
after(teardown);

/** A point well inside each zone (the centroid of its largest polygon, checked by scripts/build-zones.py). */
const INSIDE: Record<string, [number, number]> = {
  elbasan: [41.11157, 20.0802], bradashesh: [41.12536, 20.02917], funare: [41.21159, 20.0539], gjergjan: [41.03024, 20.03506],
  gjinar: [41.02031, 20.20483], gracen: [41.16235, 19.95682], labinot_fushe: [41.14725, 20.13028], labinot_mal: [41.2175, 20.15718],
  paper: [41.08671, 19.94359], shirgjan: [41.06614, 20.05517], shushice: [41.09957, 20.16346], tregan: [41.0056, 20.10516],
  zavaline: [40.97561, 20.26385],
};
const GJINAR = { latitude: INSIDE.gjinar![0], longitude: INSIDE.gjinar![1] };

const zoneId = async (code: string) => (await db.neighbourhood.findUniqueOrThrow({ where: { code } })).id;
const placeId = async (code: string, name: string) =>
  (await db.locality.findFirstOrThrow({ where: { name, neighbourhood: { code } } })).id;

async function problemsOf(input: unknown) {
  const err = await rejects(() => createCitizenReport(input));
  assert.equal(err.status, 400);
  return (err.details as Array<{ field: string; code: string; step: string; message: string }>).map((p) => {
    assert.equal(p.step, 'location');
    return [p.field, p.code];
  });
}

/** A resident who types the address: no point on the map. */
async function byHand(overrides: Record<string, unknown>) {
  const data = await citizenData({ locationMode: 'address', ...overrides }) as Record<string, unknown>;
  delete data.latitude;
  delete data.longitude;
  return data;
}

describe('the zone borders', () => {
  test('every zone of the Municipality has a border, and a point inside it finds it', () => {
    assert.equal(ZONE_CODES.length, 13);
    for (const [code, [lat, lng]] of Object.entries(INSIDE)) assert.equal(zoneCodeAt(lat, lng), code, code);
    assert.equal(zoneCodeAt(ELBASAN.latitude, ELBASAN.longitude), 'elbasan');
  });

  test('places of other municipalities are outside, even inside the old rectangle', () => {
    assert.equal(zoneCodeAt(41.3275, 19.8187), null); // Tirana
    assert.equal(zoneCodeAt(41.0317, 19.9761), null); // Cërrik (Mollas is one of its units)
    assert.equal(zoneCodeAt(41.3233, 19.4414), null); // Durrës
    assert.equal(zoneCodeAt(Number.NaN, 20), null);
    assert.ok(BORDER_TOLERANCE_M <= 200);
  });

  test('the seed adds the 13 zones with their border code, 21 lagje of the city and 116 villages', async () => {
    const zones = await db.neighbourhood.findMany({ include: { _count: { select: { localities: true } } } });
    assert.equal(zones.length, 13);
    assert.ok(zones.every((z) => z.code && ZONE_CODES.includes(z.code)));
    const count = (code: string) => zones.find((z) => z.code === code)!._count.localities;
    assert.equal(count('elbasan'), 21);
    assert.equal(count('bradashesh'), 17);
    assert.equal(count('paper'), 13);
    assert.equal(await db.locality.count(), 137);
  });
});

describe('way 1: GPS or a tap on the map', () => {
  test('no address and no zone are needed: the zone comes from the point', async () => {
    const res = await createCitizenReport(await citizenData({ ...GJINAR, address: '', neighbourhoodId: undefined }));
    await drainJobs();
    const report = await db.report.findUniqueOrThrow({ where: { caseNumber: res.caseNumber }, include: { neighbourhood: true } });
    assert.equal(report.neighbourhood?.code, 'gjinar');
    assert.equal(report.address, null);
    assert.equal(report.latitude, GJINAR.latitude);
  });

  test('a landmark is kept; a zone sent by an older version of the app never overrides the point', async () => {
    const res = await createCitizenReport(await citizenData({ ...GJINAR, address: 'përballë shkollës', neighbourhoodId: await zoneId('elbasan') }));
    const report = await db.report.findUniqueOrThrow({ where: { caseNumber: res.caseNumber }, include: { neighbourhood: true } });
    assert.equal(report.neighbourhood?.code, 'gjinar');
    assert.equal(report.address, 'përballë shkollës');
  });

  test('without a point, or outside the borders, it is refused', async () => {
    const noPin = await citizenData();
    delete (noPin as Record<string, unknown>).latitude;
    delete (noPin as Record<string, unknown>).longitude;
    assert.deepEqual(await problemsOf(noPin), [['latitude', 'required']]);
    assert.deepEqual(await problemsOf(await citizenData({ latitude: 41.3275, longitude: 19.8187 })), [['latitude', 'outside_area']]);
  });
});

describe('way 2: typing the address', () => {
  test('zone, one of its villages and the street: the report has the zone and no point', async () => {
    const res = await createCitizenReport(await byHand({
      neighbourhoodId: await zoneId('gjinar'), localityId: await placeId('gjinar', 'Lleshan'), address: 'pranë shkollës',
    }));
    const report = await db.report.findUniqueOrThrow({ where: { caseNumber: res.caseNumber }, include: { neighbourhood: true } });
    assert.equal(report.neighbourhood?.code, 'gjinar');
    assert.equal(report.address, 'pranë shkollës, fshati Lleshan, njësia Gjinar');
    const city = await createCitizenReport(await byHand({
      neighbourhoodId: await zoneId('elbasan'), localityId: await placeId('elbasan', 'Qemal Stafa'), address: 'Rruga Qemal Stafa 12',
    }));
    assert.equal((await db.report.findUniqueOrThrow({ where: { caseNumber: city.caseNumber } })).address, 'Rruga Qemal Stafa 12, Lagjja Qemal Stafa');
    assert.equal(report.latitude, null);
    assert.equal(report.longitude, null);
  });

  test('a lagje of the city cannot go with a village zone (the case from the pilot)', async () => {
    const mixed = await byHand({ neighbourhoodId: await zoneId('gjinar'), localityId: await placeId('elbasan', 'Qemal Stafa'), address: 'Rruga Qemal Stafa 12' });
    assert.deepEqual(await problemsOf(mixed), [['localityId', 'other_zone']]);
  });

  test('zone, lagje or village and street are all required', async () => {
    assert.deepEqual(await problemsOf(await byHand({ neighbourhoodId: undefined, address: 'Rruga e Re 4' })), [['neighbourhoodId', 'required']]);
    assert.deepEqual(await problemsOf(await byHand({ neighbourhoodId: 99999, address: 'Rruga e Re 4' })), [['neighbourhoodId', 'unknown']]);
    assert.deepEqual(await problemsOf(await byHand({ neighbourhoodId: await zoneId('gracen'), address: 'Rruga e Re 4' })), [['localityId', 'required']]);
    assert.deepEqual(
      await problemsOf(await byHand({ neighbourhoodId: await zoneId('gracen'), localityId: await placeId('gracen', 'Bodin'), address: ' ' })),
      [['address', 'required']],
    );
  });

  test('a street that names a village of another zone is refused, with the right zone in the message', async () => {
    const data = await byHand({ neighbourhoodId: await zoneId('elbasan'), localityId: await placeId('elbasan', '5 Maji'), address: 'fshati Lleshan, te ura' });
    const problems = await rejects(() => createCitizenReport(data));
    const detail = (problems.details as Array<{ field: string; code: string; message: string }>)[0]!;
    assert.deepEqual([detail.field, detail.code], ['address', 'other_zone']);
    assert.match(detail.message, /Lleshan.*Gjinar/);
  });

  test('names of people and dates (lagje of the city) are fine in a village address', async () => {
    const catalog = await getCatalog();
    const gjinar = await zoneId('gjinar');
    assert.equal(otherZonePlace('Rruga Skënderbej, pranë shkollës 5 Maji', gjinar, catalog.neighbourhoods), null);
    assert.equal(otherZonePlace('Rruga e Elbasanit', gjinar, catalog.neighbourhoods), null);
    assert.deepEqual(otherZonePlace('afër Bradasheshit? jo, në Bradashesh', gjinar, catalog.neighbourhoods), { place: 'Bradashesh', zone: 'Bradashesh' });
  });
});

describe('the admin', () => {
  test('adds, renames and hides lagje and villages; residents only see the active ones', async () => {
    const city = await zoneId('elbasan');
    const added = await adminService.createLocality(admin, localitySchema.parse({ neighbourhoodId: city, name: 'Lagjja e Re' }));
    assert.equal((await rejects(() => adminService.createLocality(admin, localitySchema.parse({ neighbourhoodId: city, name: 'Lagjja e Re' })))).status, 409);
    let zone = (await getCatalog()).neighbourhoods.find((n) => n.id === city)!;
    assert.ok(zone.localities.some((l) => l.id === added.id));
    await adminService.updateLocality(admin, added.id, localityPatchSchema.parse({ name: 'Lagjja e Re 2' }));
    await adminService.updateLocality(admin, added.id, localityPatchSchema.parse({ active: false }));
    zone = (await getCatalog()).neighbourhoods.find((n) => n.id === city)!;
    assert.ok(!zone.localities.some((l) => l.id === added.id), 'hidden at once (catalogue cache cleared)');
    assert.equal((await db.locality.findUniqueOrThrow({ where: { id: added.id } })).name, 'Lagjja e Re 2');
    assert.equal((await rejects(() => adminService.createLocality(admin, localitySchema.parse({ neighbourhoodId: 99999, name: 'X Y' })))).status, 404);

    const { principal } = await staffSession(admin, { email: 'zonat@example.com', departmentCode: 'water' });
    assert.equal((await rejects(() => adminService.createLocality(principal, localitySchema.parse({ neighbourhoodId: city, name: 'Tjetër' })))).status, 403);
  });

  test('a report taken by phone with a pin gets the zone of the pin; a different zone is refused', async () => {
    const base = { requestTypeId: await typeId('lighting.light_out'), channel: 'PHONE', description: 'Drita e rrugës është fikur prej disa ditësh.' };
    const city = await zoneId('elbasan');
    const { caseNumber } = await createStaffReport(admin, staffReportSchema.parse({ ...base, ...GJINAR }));
    assert.equal((await db.report.findUniqueOrThrow({ where: { caseNumber }, include: { neighbourhood: true } })).neighbourhood?.code, 'gjinar');
    const wrong = await rejects(() => createStaffReport(admin, staffReportSchema.parse({ ...base, ...GJINAR, neighbourhoodId: city })));
    assert.equal(wrong.status, 400);
    const detail = (wrong.details as Array<{ field: string; code: string; message: string }>)[0]!;
    assert.deepEqual([detail.field, detail.code], ['neighbourhoodId', 'other_zone']);
    assert.match(detail.message, /Gjinar/);
  });

  test('demo data puts every report in the zone of its point', async () => {
    await adminService.loadSampleData(admin, 12);
    const demo = await db.report.findMany({ where: { isTest: true }, include: { neighbourhood: true } });
    assert.equal(demo.length, 12);
    for (const r of demo) assert.equal(r.neighbourhood?.code, zoneCodeAt(r.latitude!, r.longitude!));
  });
});
