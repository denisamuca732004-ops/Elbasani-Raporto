/** What each background job does. Called by lib/server/queue.ts and by /api/jobs/[name]. */
import 'server-only';
import { deliverEmails } from './mail';
import type { JobName, JobPayloads } from './queue';
import { sendActionPush } from './services/community';
import { sendReportPush } from './services/push';
import { runClosingCheck, runIntakeTriage } from './services/triage';

export const handlers: { [N in JobName]: (payload: JobPayloads[N]) => Promise<void> } = {
  triage: ({ reportId }) => runIntakeTriage(reportId),
  'closing-check': ({ reportId }) => runClosingCheck(reportId),
  'deliver-email': ({ ids }) => deliverEmails(ids),
  push: async (p) => { await sendReportPush(p); },
  'action-push': async (p) => { await sendActionPush(p); },
};
