/**
 * "Vendndodhja" on the report form: the address search and the street at the
 * pin (lib/server/geocoder.ts) against a fake Photon server, and the lagje /
 * village search that needs no internet (lib/shared/places.ts).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { clearMemoryCache } from '@/lib/server/cache';
import { resetConfigForTests } from '@/lib/server/env';
import { placeAt, searchPlaces } from '@/lib/server/geocoder';
import { getCatalog } from '@/lib/server/services/catalog';
import { createCitizenReport } from '@/lib/server/services/publicReport';
import { localityPlace, searchLocalities } from '@/lib/shared/places';
import { zoneCodeAt } from '@/lib/shared/zones';
import { citizenData, db, drainJobs, setupTestDb, teardown } from './helpers';

const requests: URL[] = [];
let failing = false;
const feature = (lon: number, lat: number, properties: Record<string, string>) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });
const fake = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fake');
  requests.push(url);
  if (failing) {
    res.writeHead(503).end('busy');
    return;
  }
  const features = url.pathname === '/reverse'
    ? [feature(20.0825, 41.1131, { street: 'Rruga Qemal Stafa', housenumber: '12', city: 'Elbasan', osm_key: 'building', type: 'house' })]
    : [
      feature(20.0822, 41.1125, { name: 'Rruga Qemal Stafa', osm_key: 'highway', type: 'street', city: 'Elbasan' }),
      feature(20.0830, 41.1140, { name: 'Shkolla Qemal Stafa', street: 'Rruga Qemal Stafa', osm_key: 'amenity', type: 'house', city: 'Elbasan' }),
      feature(20.0823, 41.1126, { name: 'Rruga Qemal Stafa', osm_key: 'highway', type: 'street', city: 'Elbasan' }), // a second piece of the same street
      feature(19.4414, 41.3233, { name: 'Rruga Qemal Stafa', osm_key: 'highway', type: 'street', city: 'Durrës' }), // another municipality
    ];
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'FeatureCollection', features }));
});

before(async () => {
  await setupTestDb();
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  process.env.GEOCODER_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
  resetConfigForTests();
});
after(async () => {
  process.env.GEOCODER_URL = 'off';
  resetConfigForTests();
  fake.close();
  await teardown();
});

describe('the address search (OpenStreetMap through Photon, asked by the server)', () => {
  test('only places inside the Municipality, each once, with where they are; the answer is cached', async () => {
    clearMemoryCache();
    requests.length = 0;
    const found = await searchPlaces('qemal stafa');
    assert.deepEqual(found.map((f) => f.label), ['Rruga Qemal Stafa, Elbasan', 'Shkolla Qemal Stafa, Rruga Qemal Stafa, Elbasan']);
    assert.deepEqual(found.map((f) => f.kind), ['street', 'house']);
    assert.ok(found.every((f) => zoneCodeAt(f.latitude, f.longitude)), 'never a place outside the zone borders');
    const asked = requests[0]!;
    assert.equal(asked.pathname, '/api');
    assert.equal(asked.searchParams.get('q'), 'qemal stafa');
    assert.ok(asked.searchParams.get('bbox'), 'limited to the area of the Municipality');

    await searchPlaces('Qemal  Stafa');
    assert.equal(requests.length, 1, 'the same words are answered from the cache');
    assert.deepEqual(await searchPlaces('qe'), [], 'too short: nothing is asked');
    assert.equal(requests.length, 1);
  });

  test('when the service is down nothing fails, and the failure is not cached', async () => {
    clearMemoryCache();
    failing = true;
    try {
      assert.deepEqual(await searchPlaces('skenderbej'), []);
      assert.deepEqual(await placeAt(41.1131, 20.0825), { label: null });
    } finally {
      failing = false;
    }
    assert.equal((await searchPlaces('skenderbej')).length, 2, 'asked again once it works');
  });

  test('the street at the pin, only inside the Municipality', async () => {
    clearMemoryCache();
    requests.length = 0;
    assert.deepEqual(await placeAt(41.1131, 20.0825), { label: 'Rruga Qemal Stafa 12' });
    assert.equal(requests[0]!.pathname, '/reverse');
    assert.deepEqual(await placeAt(41.11312, 20.08251), { label: 'Rruga Qemal Stafa 12' });
    assert.equal(requests.length, 1, 'a point a metre away is answered from the cache');
    assert.deepEqual(await placeAt(41.3233, 19.4414), { label: null }, 'Durrës: not asked at all');
    assert.equal(requests.length, 1);
  });

  test('"off" asks nobody', async () => {
    clearMemoryCache();
    const url = process.env.GEOCODER_URL;
    process.env.GEOCODER_URL = 'off';
    resetConfigForTests();
    requests.length = 0;
    try {
      assert.deepEqual(await searchPlaces('qemal stafa'), []);
      assert.deepEqual(await placeAt(41.1131, 20.0825), { label: null });
      assert.equal(requests.length, 0);
    } finally {
      process.env.GEOCODER_URL = url;
      resetConfigForTests();
    }
  });
});

describe('the lagje and villages (no internet needed)', () => {
  test('found as typed, with or without ë/ç, named like the address the server saves', async () => {
    const zones = (await getCatalog()).neighbourhoods;
    const shushice = searchLocalities('shushic', zones);
    assert.equal(shushice[0]?.label, 'Fshati Shushicë');
    assert.equal(shushice[0]?.kind, 'locality');
    assert.ok(shushice[0]?.zoneId && shushice[0].localityId);
    assert.equal(zoneCodeAt(shushice[0]!.latitude, shushice[0]!.longitude), 'shushice', 'the point is inside its zone');
    assert.equal(searchLocalities('kala', zones)[0]?.label, 'Lagjja Kala');
    assert.ok(searchLocalities('lleshan', zones).some((s) => s.label === 'Fshati Lleshan, njësia Gjinar'));
    assert.deepEqual(searchLocalities('x', zones), [], 'one letter is not searched');
  });

  test('a village chosen and not moved is saved as that village, approximately; the address matches the form', async () => {
    const zones = (await getCatalog()).neighbourhoods;
    const pick = searchLocalities('lleshan', zones).find((s) => s.label.includes('Lleshan'))!;
    const result = await createCitizenReport(await citizenData({
      locationMode: 'address', neighbourhoodId: pick.zoneId, localityId: pick.localityId, address: '', latitude: undefined, longitude: undefined,
    }));
    await drainJobs();
    const report = await db.report.findUniqueOrThrow({ where: { caseNumber: result.caseNumber } });
    const zone = zones.find((z) => z.id === pick.zoneId)!;
    assert.equal(report.address, localityPlace(zone, zone.localities.find((l) => l.id === pick.localityId)!));
    assert.equal(report.locationApproximate, true);
    assert.equal(report.neighbourhoodId, pick.zoneId);
  });
});
