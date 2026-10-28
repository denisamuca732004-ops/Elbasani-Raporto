/**
 * Calls a Server Action and turns { ok: false, error } into a thrown
 * ActionFailure, so components can use try/catch and <ErrorAlert>.
 */
import type { ActionError, ActionResult } from '@/lib/shared/result';

export class ActionFailure extends Error implements ActionError {
  readonly code: string;
  readonly status: number;
  readonly details: ActionError['details'];
  constructor(error: ActionError) {
    super(error.message);
    this.code = error.code;
    this.status = error.status;
    this.details = error.details;
  }
}

export async function call<T>(promise: Promise<ActionResult<T>>): Promise<T> {
  let result: ActionResult<T>;
  try {
    result = await promise;
  } catch {
    // The action could not be reached at all (offline, server restarting).
    throw new ActionFailure({ code: 'NETWORK', status: 0, message: 'network' });
  }
  if (!result.ok) {
    if (result.error.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') window.location.assign('/hyrje/fjalekalimi');
    if (result.error.status === 401 && typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
      window.location.assign(`/hyrje?next=${encodeURIComponent(window.location.pathname)}`);
    }
    throw new ActionFailure(result.error);
  }
  return result.data;
}

/** Field errors of a failed action, by field name. */
export function fieldErrorsOf(err: unknown): Record<string, string> {
  if (!(err instanceof ActionFailure) || !Array.isArray(err.details)) return {};
  return Object.fromEntries(err.details.filter((d) => d.field).map((d) => [d.field, d.message]));
}
