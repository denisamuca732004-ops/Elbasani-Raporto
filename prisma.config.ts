/**
 * Prisma CLI configuration (Prisma 7). Loads the same .env files as Next.js.
 * Migrations use DIRECT_URL when it is set: hosted Postgres (Neon, Supabase,
 * Vercel Postgres) gives a pooled URL for the app and a direct one for migrations.
 */
import nextEnv from '@next/env';
import { defineConfig } from 'prisma/config';

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
});
