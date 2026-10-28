/**
 * Application errors. Services throw AppError; Server Actions and Route
 * Handlers turn it into one format: { code, message, status, details }.
 */
import 'server-only';
import type { ActionError, FieldError } from '@/lib/shared/result';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: FieldError[] | Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON(): ActionError {
    return { code: this.code, message: this.message, status: this.status, ...(this.details ? { details: this.details } : {}) };
  }
}

export const badRequest = (message: string, details?: FieldError[] | Record<string, unknown>) => new AppError(400, 'BAD_REQUEST', message, details);
export const invalid = (details: FieldError[], message = 'Disa fusha mungojnë ose nuk janë të sakta.') =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
export const unauthorized = (message = 'Duhet të hyni në llogari.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Nuk keni leje për këtë veprim.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Nuk u gjet.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: Record<string, unknown>) => new AppError(409, 'CONFLICT', message, details);
export const tooMany = (message = 'Shumë kërkesa njëra pas tjetrës. Provoni përsëri pas pak.') => new AppError(429, 'RATE_LIMITED', message);
export const passwordChangeRequired = () =>
  new AppError(403, 'PASSWORD_CHANGE_REQUIRED', 'Ndryshoni fillimisht fjalëkalimin e përkohshëm.');
