/**
 * npm run db:seed  (also run by `prisma migrate reset` / `prisma db seed`)
 *
 * Inserts the reference data: departments, report categories and types,
 * areas, the questions of the search guide and the default settings. Idempotent: running it again never
 * duplicates rows and never overwrites what the admin changed later.
 *
 * It does NOT create any account. The first admin is created once, in the
 * browser, at /hyrje/konfigurimi, and only with the address in ADMIN_EMAIL.
 */
import nextEnv from '@next/env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../lib/generated/prisma/client';
import { seedReferenceData } from '../lib/server/referenceData';

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

const url = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL (or DIRECT_URL) is not set.');
  process.exit(1);
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

try {
  await seedReferenceData(db);
  const [departments, types, areas, places, guide] = await Promise.all([
    db.department.count(), db.requestType.count(), db.neighbourhood.count({ where: { active: true } }), db.locality.count(), db.guideEntry.count(),
  ]);
  console.log(`Seed OK: ${departments} departments, ${types} report types, ${areas} active zones with ${places} lagje and villages, ${guide} guide questions.`);
} catch (err) {
  console.error('Seed failed:', err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
