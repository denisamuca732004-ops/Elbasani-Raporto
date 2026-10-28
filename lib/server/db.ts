/**
 * The Prisma client (Prisma 7 with the node-postgres driver adapter).
 * Every query goes through Prisma, so values are always sent as parameters.
 * The few hand-written SQL queries (dashboard) use Prisma.sql tagged
 * templates, which are parameterised too.
 */
import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@/lib/generated/prisma/client';
import type * as $Enums from '@/lib/generated/prisma/enums';
import type * as D from '@/lib/shared/domain';
import { config } from './env';

export { Prisma };
export type Tx = Prisma.TransactionClient;

function createClient(): PrismaClient {
  const c = config();
  const adapter = new PrismaPg({
    connectionString: c.databaseUrl,
    // Serverless functions each keep a few connections; use a pooled DATABASE_URL in production.
    max: c.isStrict ? 5 : 10,
  });
  return new PrismaClient({ adapter, log: c.env === 'development' ? ['warn', 'error'] : ['error'] });
}

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

function client(): PrismaClient {
  if (!globalForPrisma.__prisma) globalForPrisma.__prisma = createClient();
  return globalForPrisma.__prisma;
}

/** Created on first use, so importing this file never needs a database (e.g. during `next build`). */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === 'function' ? value.bind(c) : value;
  },
});

export async function disconnectDb(): Promise<void> {
  if (globalForPrisma.__prisma) {
    await globalForPrisma.__prisma.$disconnect();
    globalForPrisma.__prisma = undefined;
  }
}

/* The shared vocabulary must stay identical to the database enums. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const enumsMatch: [
  Same<D.Role, $Enums.Role>,
  Same<D.Status, $Enums.ReportStatus>,
  Same<D.Priority, $Enums.Priority>,
  Same<D.RequestKind, $Enums.RequestKind>,
  Same<D.Channel, $Enums.Channel>,
  Same<D.AiStatus, $Enums.AiStatus>,
  Same<D.AttachmentKind, $Enums.AttachmentKind>,
  Same<D.TransferStatus, $Enums.TransferStatus>,
  Same<D.EventType, $Enums.EventType>,
  Same<D.MailStatus, $Enums.MailStatus>,
  Same<D.GuideAction, $Enums.GuideAction>,
] = [true, true, true, true, true, true, true, true, true, true, true];
void enumsMatch;
