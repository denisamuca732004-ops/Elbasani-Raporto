#!/usr/bin/env node
// Run with: node --import tsx scripts/check-i18n.mjs  (npm run check:i18n)
/** Checks that every t('key') used in the code exists in Albanian and English, and that both have the same keys. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
const { default: sq } = await import('../i18n/sq.ts');
const { default: en } = await import('../i18n/en.ts');

// { one, other } is one text with a singular and a plural form.
const isPlural = (v) => Boolean(v) && typeof v === 'object' && typeof v.one === 'string' && typeof v.other === 'string';
const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' && !isPlural(v) ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const sqKeys = new Set(flatten(sq));
const enKeys = new Set(flatten(en));
const problems = [];
for (const k of sqKeys) if (!enKeys.has(k)) problems.push(`missing in en: ${k}`);
for (const k of enKeys) if (!sqKeys.has(k)) problems.push(`missing in sq: ${k}`);

const files = [];
const skip = new Set(['node_modules', '.next', 'generated', 'tests', 'scripts', 'prisma', '.uploads', '.uploads-test']);
const walk = (d) => readdirSync(d).forEach((n) => {
  const f = path.join(d, n);
  if (statSync(f).isDirectory()) { if (!skip.has(n)) walk(f); } else if (/\.(tsx?|mjs)$/.test(f)) files.push(f);
});
walk('.');
const used = new Set();
for (const f of files) {
  const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of code.matchAll(/\bt\(\s*(['"])([^'"$]+?)\1/g)) used.add(m[2]);
  for (const m of code.matchAll(/\bt\(\s*`([^`$]*?)\$\{/g)) {
    const prefix = m[1];
    if (![...sqKeys].some((k) => k.startsWith(prefix))) problems.push(`no keys for dynamic prefix: ${prefix} (${f})`);
  }
}
for (const k of used) if (!sqKeys.has(k)) problems.push(`used but missing: ${k}`);

// Keys built from enum values (t(`internalStatus.${status.toLowerCase()}`) and so on) must exist for EVERY value.
const domain = await import('../lib/shared/domain.ts');
const lower = (list) => list.map((v) => String(v).toLowerCase());
const enumKeys = {
  internalStatus: lower(domain.STATUSES),
  status: lower(domain.PUBLIC_STATUSES),
  statusHelp: lower(domain.PUBLIC_STATUSES),
  priority: lower(domain.PRIORITIES),
  channels: lower(domain.CHANNELS),
  events: lower(domain.EVENT_TYPES),
  kind: lower(domain.REQUEST_KINDS),
  aiStatus: lower(domain.AI_STATUSES),
  roles: lower(['USER', ...domain.PANEL_ROLES]),
  'transfers.statuses': lower(domain.TRANSFER_STATUSES),
  'admin.emails.statuses': lower(domain.MAIL_STATUSES),
  'dashboard.periods': lower(domain.DASHBOARD_PERIODS),
  'detail.status.to': [...lower(domain.STATUSES).filter((s) => !['pending', 'resolved', 'rejected'].includes(s)), 'reopen', 'release', 'pause'],
  timeline: ['created', 'status_changed', 'citizen_confirmed', 'citizen_reopened'],
};
for (const [prefix, values] of Object.entries(enumKeys)) {
  for (const v of values) if (!sqKeys.has(`${prefix}.${v}`)) problems.push(`missing enum key: ${prefix}.${v}`);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`i18n OK: ${sqKeys.size} keys, ${used.size} static keys used`);
