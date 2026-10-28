/**
 * What every Server Action returns. Actions never throw to the browser:
 * an error comes back as { ok: false, error } with a message in Albanian
 * and, for forms, one entry per field.
 */
export type FieldError = { field: string; code: string; message: string; step?: string };

export type ActionError = {
  code: string;
  message: string;
  status: number;
  details?: FieldError[] | Record<string, unknown>;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };
