/**
 * Background jobs: emails, the AI check of new reports, the closing check.
 * The person who clicked never waits for them.
 *
 *   QStash configured → the job is published to Upstash QStash, which calls
 *                       /api/jobs/[name] (signed request) and retries on failure.
 *   otherwise         → the job runs right after the response with Next.js after().
 *   tests             → jobs wait in memory until drainJobs() runs them.
 *
 * Payloads are small JSON objects with ids only; jobs read fresh data.
 */
import 'server-only';
import { Client } from '@upstash/qstash';
import { config } from './env';

export type JobPayloads = {
  /** AI check (or keyword rules) of a new report, then the department is told. */
  triage: { reportId: string };
  /** After the "after" photo: does it look fixed? */
  'closing-check': { reportId: string };
  /** Sends emails that were written to the email log. */
  'deliver-email': { ids: string[] };
};
export type JobName = keyof JobPayloads;
export const JOB_NAMES: readonly JobName[] = ['triage', 'closing-check', 'deliver-email'];

type Mode = 'auto' | 'manual';
let mode: Mode = 'auto';
const pending: Array<{ name: JobName; payload: unknown }> = [];

/** Tests: keep jobs in memory until drainJobs(). */
export function setJobMode(next: Mode): void {
  mode = next;
}

let qstash: Client | null | undefined;
function qstashClient(): Client | null {
  if (qstash === undefined) {
    const q = config().qstash;
    qstash = q ? new Client({ token: q.token, ...(q.baseUrl ? { baseUrl: q.baseUrl } : {}) }) : null;
  }
  return qstash;
}

export async function runJob<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<void> {
  const { handlers } = await import('./jobs');
  await handlers[name](payload as never);
}

async function runAfterResponse<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<void> {
  const work = () => runJob(name, payload).catch((err) => console.error(`[job ${name}] failed`, err));
  try {
    // Imported lazily so services stay usable outside Next.js (scripts, tests).
    const { after } = await import('next/server');
    after(work);
  } catch {
    void work(); // not inside a request (e.g. a script): run it now
  }
}

export async function enqueue<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<void> {
  if (mode === 'manual') {
    pending.push({ name, payload });
    return;
  }
  const client = qstashClient();
  if (client) {
    try {
      await client.publishJSON({
        url: `${config().appUrl}/api/jobs/${name}`,
        body: payload,
        retries: 3,
        ...(name === 'triage' ? { deduplicationId: `triage-${(payload as JobPayloads['triage']).reportId}` } : {}),
      });
      return;
    } catch (err) {
      console.error(`[queue] QStash publish of "${name}" failed; running it after the response instead`, err);
    }
  }
  await runAfterResponse(name, payload);
}

/** Tests: runs every waiting job, including jobs queued by those jobs. */
export async function drainJobs(): Promise<void> {
  while (pending.length) {
    const job = pending.shift()!;
    await runJob(job.name, job.payload as never);
  }
}

export function pendingJobCount(): number {
  return pending.length;
}
