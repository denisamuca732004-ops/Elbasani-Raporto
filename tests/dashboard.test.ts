/** Dashboard: statistics for a week (7 days), a month (30 days) and a year (12 months), in Tirana time. */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { getDashboard } from '@/lib/server/services/dashboard';
import { changeStatus } from '@/lib/server/services/report';
import type { Principal } from '@/lib/shared/types';
import { dashboardSchema } from '@/lib/validation/report';
import { adminSession, backdate, db, departmentId, setupTestDb, staffSession, submitReport, teardown, typeId } from './helpers';

let admin: Principal;
let infra: Principal;
const reports: Array<{ id: string; createdAt: Date; priority: string; department: string }> = [];

const localDate = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
/** Calendar arithmetic on a YYYY-MM-DD string (immune to daylight saving changes). */
const shiftDate = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

before(async () => {
  await setupTestDb();
  admin = await adminSession();
  infra = (await staffSession(admin, { email: 'infra@example.com', departmentCode: 'infrastructure' })).principal;
  const plan: Array<{ type: string; daysAgo: number }> = [
    { type: 'streets.pothole', daysAgo: 0 },
    { type: 'streets.pothole', daysAgo: 0 },
    { type: 'lighting.damaged_pole', daysAgo: 0 }, // HIGH
    { type: 'streets.pothole', daysAgo: 3 },
    { type: 'water.leak', daysAgo: 8 }, // previous week, this month
    { type: 'streets.sidewalk', daysAgo: 10 }, // LOW
    { type: 'water.leak', daysAgo: 40 }, // previous month, this year
    { type: 'streets.pothole', daysAgo: 400 }, // outside the year
  ];
  for (const p of plan) {
    const { report } = await submitReport({ requestTypeId: await typeId(p.type) });
    if (p.daysAgo) await backdate(report.id, p.daysAgo, ['created_at', 'due_at']);
    const fresh = await db.report.findUniqueOrThrow({ where: { id: report.id }, include: { department: true } });
    reports.push({ id: fresh.id, createdAt: fresh.createdAt, priority: fresh.priority, department: fresh.department!.code });
  }
  // One report of today is resolved today, within its deadline.
  await changeStatus(admin, reports[0]!.id, { status: 'RESOLVED', note: 'U rregullua.', publicNote: true });
});
after(teardown);

const dashboard = (query: Record<string, string>, user: Principal = admin) => getDashboard(user, dashboardSchema.parse(query));

describe('dashboard periods', () => {
  test('week: 7 daily columns ending today, compared with the 7 days before', async () => {
    const d = await dashboard({ period: 'week' });
    const today = localDate(new Date());
    assert.equal(d.unit, 'day');
    assert.equal(d.trend.length, 7);
    assert.equal(d.trend.at(-1)!.bucket, today);
    assert.equal(d.trend[0]!.bucket, shiftDate(today, -6));
    const inWindow = (r: { createdAt: Date }) => localDate(r.createdAt) >= shiftDate(today, -6);
    const inPrevious = (r: { createdAt: Date }) => localDate(r.createdAt) >= shiftDate(today, -13) && localDate(r.createdAt) < shiftDate(today, -6);
    assert.equal(d.totals.received, reports.filter(inWindow).length);
    assert.equal(d.totals.receivedPrevious, reports.filter(inPrevious).length);
    for (const bucket of d.trend) {
      assert.equal(bucket.received, reports.filter((r) => localDate(r.createdAt) === bucket.bucket).length, bucket.bucket);
    }
    assert.equal(d.totals.resolved, 1);
    assert.equal(d.trend.at(-1)!.resolved, 1);
    assert.equal(d.totals.onTimePct, 100);
    assert.ok(d.totals.avgDaysToResolve !== null && d.totals.avgDaysToResolve < 1);
    assert.equal(d.byStatus.reduce((acc, s) => acc + s.count, 0), d.totals.received);
  });

  test('month: 30 daily columns', async () => {
    const d = await dashboard({ period: 'month' });
    const today = localDate(new Date());
    assert.equal(d.trend.length, 30);
    assert.equal(d.trend[0]!.bucket, shiftDate(today, -29));
    assert.equal(d.totals.received, reports.filter((r) => localDate(r.createdAt) >= shiftDate(today, -29)).length);
    assert.equal(d.totals.receivedPrevious, reports.filter((r) => {
      const day = localDate(r.createdAt);
      return day >= shiftDate(today, -59) && day < shiftDate(today, -29);
    }).length);
  });

  test('year: 12 monthly columns ending with this month', async () => {
    const d = await dashboard({ period: 'year' });
    const today = localDate(new Date());
    assert.equal(d.unit, 'month');
    assert.equal(d.trend.length, 12);
    assert.equal(d.trend.at(-1)!.bucket, `${today.slice(0, 7)}-01`);
    const firstMonth = d.trend[0]!.bucket;
    assert.equal(d.totals.received, reports.filter((r) => localDate(r.createdAt) >= firstMonth).length);
    assert.equal(d.trend.reduce((acc, b) => acc + b.received, 0), d.totals.received);
    assert.ok(reports.some((r) => localDate(r.createdAt) < firstMonth), 'the 400-day-old report is outside');
  });

  test('open reports by priority, by department (admin) and the requests waiting', async () => {
    const d = await dashboard({ period: 'month' });
    const open = reports.slice(1); // the first one is resolved
    assert.equal(d.totals.openNow, open.length);
    assert.equal(d.openByPriority.HIGH, open.filter((r) => r.priority === 'HIGH').length);
    assert.equal(d.openByPriority.LOW, open.filter((r) => r.priority === 'LOW').length);
    assert.equal(d.openByPriority.MEDIUM, open.filter((r) => r.priority === 'MEDIUM').length);
    const infraRow = d.byDepartment!.find((s) => s.code === 'infrastructure')!;
    assert.equal(infraRow.open, open.filter((r) => r.department === 'infrastructure').length);
    assert.equal(infraRow.openHigh, 1);
    assert.equal(d.pendingTransfers, 0);
    assert.ok(d.byCategory.length > 0);
    assert.ok(d.byNeighbourhood.length > 0);
  });

  test('one department at a time: the admin can filter, a department head always gets their own', async () => {
    const waterId = String(await departmentId('water'));
    const water = await dashboard({ period: 'year', departmentId: waterId });
    assert.equal(water.department?.code, 'water');
    assert.equal(water.byDepartment, null);
    assert.equal(water.totals.openNow, reports.filter((r) => r.department === 'water').length);
    const own = await dashboard({ period: 'year', departmentId: waterId }, infra);
    assert.equal(own.department?.code, 'infrastructure');
    assert.equal(own.totals.openNow, reports.slice(1).filter((r) => r.department === 'infrastructure').length);
  });

  test('invalid periods are refused by validation', () => {
    assert.equal(dashboardSchema.safeParse({ period: 'decade' }).success, false);
  });
});
