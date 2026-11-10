/**
 * The weekly summary for the people who run the service (every admin), on
 * Monday morning with the daily maintenance:
 *  - the numbers of the last 7 days (received, fixed, open, overdue), sector by
 *    sector, and where most reports came from;
 *  - places where the same problem keeps coming back (3 or more reports of the
 *    same kind within 60 m in 90 days): a repair that does not last, or a
 *    container that is too small for the street;
 *  - the AI's spending this month.
 * Every number is counted here, in the database. With the AI on, it only writes
 * a short paragraph on top from these numbers (it never adds numbers of its own);
 * without it the e-mail is the same without that paragraph.
 */
import 'server-only';
import { OPEN_STATUSES } from '@/lib/shared/domain';
import type { RepeatPlace } from '@/lib/shared/types';
import { AiUnavailableError, aiEnabled, aiUsageThisMonth, chatJson, hideKeys } from '../ai';
import { db } from '../db';
import { config } from '../env';
import { queueEmails } from '../mail';
import type { MailContent } from '../mailTemplates';
import { distanceMeters } from './geo';
import { adminRecipients } from './notification';

const DAY = 86_400_000;
export const REPEAT_RADIUS_METERS = 60;
export const REPEAT_MIN_REPORTS = 3;
export const REPEAT_LOOKBACK_DAYS = 90;


export interface WeeklySummary {
  from: Date; to: Date;
  received: number; receivedBefore: number; resolved: number; openNow: number; overdueNow: number; avgDaysToFix: number | null;
  sectors: Array<{ name: string; received: number; resolved: number; open: number; overdue: number }>;
  areas: Array<{ name: string; count: number }>;
  types: Array<{ name: string; count: number }>;
  repeats: RepeatPlace[];
  ai: { calls: number; costUsd: number; budgetUsd: number } | null;
}

/**
 * Places where the same kind of problem was reported again and again: reports with a pin (not a
 * whole village), merged duplicates and those waiting for the admin's decision left out (they are one
 * problem), grouped greedily around the
 * most recent report of each kind.
 */
export async function findRepeatPlaces(now = new Date()): Promise<RepeatPlace[]> {
  const rows = await db.report.findMany({
    where: {
      isTest: false, mergedIntoId: null, possibleDuplicateOfId: null, status: { not: 'REJECTED' }, locationApproximate: false,
      latitude: { not: null }, longitude: { not: null }, createdAt: { gte: new Date(now.getTime() - REPEAT_LOOKBACK_DAYS * DAY) },
    },
    select: { id: true, caseNumber: true, requestTypeId: true, latitude: true, longitude: true, address: true, neighbourhood: { select: { name: true } }, requestType: { select: { nameSq: true, nameEn: true } } },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });
  const byType = new Map<number, typeof rows>();
  for (const r of rows) byType.set(r.requestTypeId, [...(byType.get(r.requestTypeId) ?? []), r]);
  const places: RepeatPlace[] = [];
  for (const list of byType.values()) {
    const left = [...list];
    while (left.length >= REPEAT_MIN_REPORTS) {
      const centre = left[0]!;
      const group = left.filter((r) => distanceMeters(centre.latitude!, centre.longitude!, r.latitude!, r.longitude!) <= REPEAT_RADIUS_METERS);
      for (const r of group) left.splice(left.indexOf(r), 1);
      if (group.length < REPEAT_MIN_REPORTS) continue;
      const named = group.find((r) => r.address?.trim());
      places.push({
        typeNameSq: centre.requestType.nameSq, typeNameEn: centre.requestType.nameEn, latestId: centre.id,
        place: [named?.address?.trim(), centre.neighbourhood?.name].filter(Boolean).join(', ') || `${centre.latitude!.toFixed(5)}, ${centre.longitude!.toFixed(5)}`,
        count: group.length,
        caseNumbers: group.map((r) => r.caseNumber).slice(0, 5),
        latitude: centre.latitude!, longitude: centre.longitude!,
      });
    }
  }
  return places.sort((a, b) => b.count - a.count).slice(0, 8);
}

export async function computeWeeklySummary(now = new Date()): Promise<WeeklySummary> {
  const from = new Date(now.getTime() - 7 * DAY);
  const before = new Date(from.getTime() - 7 * DAY);
  const real = { isTest: false };
  const open = { ...real, status: { in: [...OPEN_STATUSES] } };
  const [received, receivedBefore, resolvedRows, openNow, overdueNow, departments, areaGroups, typeGroups, repeats] = await Promise.all([
    db.report.count({ where: { ...real, mergedIntoId: null, createdAt: { gte: from, lt: now } } }),
    db.report.count({ where: { ...real, mergedIntoId: null, createdAt: { gte: before, lt: from } } }),
    db.report.findMany({ where: { ...real, resolvedAt: { gte: from, lt: now } }, select: { createdAt: true, resolvedAt: true, departmentId: true } }),
    db.report.count({ where: open }),
    db.report.count({ where: { ...open, dueAt: { lt: now } } }),
    db.department.findMany({ where: { active: true }, select: { id: true, nameSq: true } }),
    db.report.groupBy({ by: ['neighbourhoodId'], where: { ...real, mergedIntoId: null, createdAt: { gte: from, lt: now }, neighbourhoodId: { not: null } }, _count: { _all: true } }),
    db.report.groupBy({ by: ['requestTypeId'], where: { ...real, mergedIntoId: null, createdAt: { gte: from, lt: now } }, _count: { _all: true } }),
    findRepeatPlaces(now),
  ]);
  const sectors = await Promise.all(departments.map(async (d) => {
    const [rec, op, over] = await Promise.all([
      db.report.count({ where: { ...real, mergedIntoId: null, departmentId: d.id, createdAt: { gte: from, lt: now } } }),
      db.report.count({ where: { ...open, departmentId: d.id } }),
      db.report.count({ where: { ...open, departmentId: d.id, dueAt: { lt: now } } }),
    ]);
    return { name: d.nameSq, received: rec, resolved: resolvedRows.filter((r) => r.departmentId === d.id).length, open: op, overdue: over };
  }));
  const top = <T extends { _count: { _all: number } }>(groups: T[]) => [...groups].sort((a, b) => b._count._all - a._count._all).slice(0, 3);
  const areaNames = new Map((await db.neighbourhood.findMany({ select: { id: true, name: true } })).map((n) => [n.id, n.name]));
  const typeNames = new Map((await db.requestType.findMany({ select: { id: true, nameSq: true } })).map((t) => [t.id, t.nameSq]));
  const days = resolvedRows.map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / DAY);
  let ai: WeeklySummary['ai'] = null;
  if (aiEnabled()) {
    const usage = await aiUsageThisMonth();
    ai = { calls: usage.calls, costUsd: usage.costUsd, budgetUsd: usage.budgetUsd };
  }
  return {
    from, to: now, received, receivedBefore, resolved: resolvedRows.length, openNow, overdueNow,
    avgDaysToFix: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
    sectors: sectors.filter((s) => s.received || s.resolved || s.open).sort((a, b) => b.overdue - a.overdue || b.open - a.open),
    areas: top(areaGroups).map((g) => ({ name: areaNames.get(g.neighbourhoodId!) ?? '–', count: g._count._all })),
    types: top(typeGroups).map((g) => ({ name: typeNames.get(g.requestTypeId) ?? '–', count: g._count._all })),
    repeats,
    ai,
  };
}

const INTRO_SYSTEM = `You write the opening paragraph of a weekly e-mail for the managers of the Municipality of Elbasan (Albania) about residents' reports.
Answer ONLY with a JSON object: {"textSq": string}.
textSq: 3-4 short sentences IN ALBANIAN, plain and factual, for a busy manager: what changed this week, which sector needs attention, and the most important repeated place if there is one.
Use ONLY the numbers and names in the data you are given; never invent or estimate a number. No greeting, no sign-off, no lists.`;

/** The AI's short paragraph from the counted numbers; null without the AI or without an answer. */
export async function summaryIntro(s: WeeklySummary): Promise<string | null> {
  if (!aiEnabled()) return null;
  const data = {
    week: `${day(s.from)} – ${day(s.to)}`, received: s.received, receivedPreviousWeek: s.receivedBefore, resolved: s.resolved,
    openNow: s.openNow, overdueNow: s.overdueNow, averageDaysToFix: s.avgDaysToFix, sectors: s.sectors, topAreas: s.areas, topProblems: s.types,
    repeatedPlaces: s.repeats.map((r) => ({ problem: r.typeNameSq, place: r.place, reports: r.count })),
  };
  try {
    const out = await chatJson({ kind: 'weekly-summary', system: INTRO_SYSTEM, userText: JSON.stringify(data) });
    const text = typeof out.textSq === 'string' ? out.textSq.replace(/\s+/g, ' ').trim() : '';
    return text.length >= 20 ? text.slice(0, 900) : null;
  } catch (err) {
    if (err instanceof AiUnavailableError) console.error('[weekly-summary] AI unavailable:', hideKeys(err.message));
    else console.error('[weekly-summary] failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

const day = (d: Date) => new Intl.DateTimeFormat('sq-AL', { timeZone: 'Europe/Tirane', day: 'numeric', month: 'numeric', year: 'numeric' }).format(d);
const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lng.toFixed(5)}#map=18/${lat.toFixed(5)}/${lng.toFixed(5)}`;

export function weeklySummaryMail(s: WeeklySummary, intro: string | null): MailContent {
  const change = s.received - s.receivedBefore;
  const lines: string[] = [];
  if (intro) lines.push(intro, '');
  lines.push(
    'NË SHIFRA',
    `• Raportime të reja: ${s.received} (java e kaluar: ${s.receivedBefore}${change ? `, ${change > 0 ? '+' : ''}${change}` : ''})`,
    `• Të zgjidhura këtë javë: ${s.resolved}${s.avgDaysToFix !== null ? ` (mesatarisht ${String(s.avgDaysToFix).replace('.', ',')} ditë)` : ''}`,
    `• Të hapura tani: ${s.openNow}, prej tyre me afat të kaluar: ${s.overdueNow}`,
    '',
  );
  if (s.sectors.length) {
    lines.push('SIPAS SEKTORIT (të reja · të zgjidhura · të hapura · me vonesë)');
    for (const x of s.sectors) lines.push(`• ${x.name}: ${x.received} · ${x.resolved} · ${x.open} · ${x.overdue}`);
    lines.push('');
  }
  if (s.areas.length) lines.push(`Ku u raportua më shumë: ${s.areas.map((a) => `${a.name} (${a.count})`).join(', ')}`);
  if (s.types.length) lines.push(`Problemet më të shpeshta: ${s.types.map((t) => `${t.name} (${t.count})`).join(', ')}`);
  if (s.areas.length || s.types.length) lines.push('');
  lines.push('VENDE KU PROBLEMI PËRSËRITET');
  if (s.repeats.length) {
    lines.push(`I njëjti problem, ${REPEAT_MIN_REPORTS} ose më shumë herë brenda ${REPEAT_RADIUS_METERS} m në ${REPEAT_LOOKBACK_DAYS} ditët e fundit. Ia vlen një zgjidhje e qëndrueshme, jo vetëm riparim:`);
    for (const r of s.repeats) lines.push(`• ${r.typeNameSq} – ${r.place} – ${r.count} raportime (${r.caseNumbers.join(', ')}) – ${mapLink(r.latitude, r.longitude)}`);
  } else {
    lines.push('Asnjë vend me të njëjtin problem të përsëritur.');
  }
  if (s.ai) {
    const cost = s.ai.costUsd > 0 && s.ai.costUsd < 0.01 ? 'më pak se $0.01' : `rreth $${s.ai.costUsd.toFixed(2)}`;
    lines.push('', `AI këtë muaj: ${s.ai.calls} thirrje, ${cost}${s.ai.budgetUsd > 0 ? ` nga kufiri $${s.ai.budgetUsd}` : ''}.`);
  }
  return {
    template: 'weekly_summary',
    subject: `Përmbledhja javore: ${s.received} raportime të reja, ${s.resolved} të zgjidhura`,
    text: `Përmbledhja javore e Elbasani Raporton (${day(s.from)} – ${day(s.to)})

${lines.join('\n')}

Paneli: ${config().appUrl}/admin
—
Elbasani Raporton · Bashkia Elbasan
Ky është një email automatik. Shifrat numërohen nga sistemi${intro ? '; paragrafi i parë shkruhet nga AI mbi këto shifra' : ''}.`,
  };
}

/**
 * Builds and queues the summary for all active admins, or (preview: "Dërgoje tani" in the panel)
 * only for the given address; a preview does not count as this week's summary.
 */
export async function sendWeeklySummary(now = new Date(), previewTo?: string): Promise<number> {
  const recipients = previewTo ? [previewTo] : await adminRecipients();
  if (!recipients.length) return 0;
  const summary = await computeWeeklySummary(now);
  const mail = weeklySummaryMail(summary, await summaryIntro(summary));
  const ids = await queueEmails(recipients, previewTo ? { ...mail, template: 'weekly_summary_preview' } : mail);
  return ids.length;
}

/** Monday (Elbasan time), once: called every day by the daily maintenance. */
export async function weeklySummaryIfDue(now = new Date()): Promise<number> {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Tirane', weekday: 'short' }).format(now);
  if (weekday !== 'Mon') return 0;
  const already = await db.emailLog.count({ where: { template: 'weekly_summary', createdAt: { gte: new Date(now.getTime() - 5 * DAY) }, reportId: null } });
  if (already) return 0;
  return sendWeeklySummary(now);
}
