/** Admin: a fixed report can be left out of "Rregulluar së fundmi" on the home page. */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { recentlyFixed } from '@/lib/server/services/publicReport';
import { getPublicCase } from '@/lib/server/services/publicReport';
import { resolveReport, setHomeVisibility } from '@/lib/server/services/report';
import type { Principal } from '@/lib/shared/types';
import { adminSession, setupTestDb, submitReport, teardown } from './helpers';

let admin: Principal;
before(async () => { await setupTestDb(); admin = await adminSession(); });
after(teardown);

describe('the home page and the admin', () => {
  test('a hidden report is not under "Rregulluar së fundmi" but stays public on its own page', async () => {
    const { report, result } = await submitReport({});
    await resolveReport(admin, report.id, { note: 'U rregullua.' });
    assert.ok((await recentlyFixed(10)).some((r) => r.caseNumber === result.caseNumber));
    const detail = await setHomeVisibility(admin, report.id, true);
    assert.equal(detail.hiddenFromHome, true);
    assert.ok(!(await recentlyFixed(10)).some((r) => r.caseNumber === result.caseNumber));
    assert.equal((await getPublicCase(result.caseNumber)).caseNumber, result.caseNumber);
    await setHomeVisibility(admin, report.id, false);
    assert.ok((await recentlyFixed(10)).some((r) => r.caseNumber === result.caseNumber));
  });
});
