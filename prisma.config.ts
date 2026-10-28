/**
 * Prisma CLI configuration (Prisma 7). Loads the same .env files as Next.js.
 * Migrations need a direct (not pooled) connection. Hosted Postgres gives a
 * pooled URL for the app and a direct one for migrations: DIRECT_URL, or the
 * name the Vercel integration sets on its own (Neon: DATABASE_URL_UNPOOLED).
 */
import nextEnv from '@next/env';
import { defineConfig } from 'prisma/config';

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL,
  },
});
