/** Protection of the public report form against scripts (lib/server/botGuard.ts). */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MIN_FORM_SECONDS, checkFormGuard, formTokenTime, issueFormToken } from '@/lib/server/botGuard';
import { AppError } from '@/lib/server/errors';

const codeOf = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof AppError ? err.code : 'OTHER';
  }
};

describe('the report form against scripts', () => {
  const opened = Date.parse('2026-11-11T10:00:00Z');
  const token = issueFormToken(opened);

  test('a person who filled in the form is let through', () => {
    assert.equal(codeOf(() => checkFormGuard({ website: '', formToken: token }, opened + 30_000)), null);
    assert.equal(formTokenTime(token, opened + 1000), opened);
  });

  test('a report sent sooner than a person could fill in the form is refused', () => {
    assert.equal(codeOf(() => checkFormGuard({ formToken: token }, opened + (MIN_FORM_SECONDS * 1000) - 1)), 'TOO_FAST');
  });

  test('without a token, or with a changed or invented one, it is refused', () => {
    assert.equal(codeOf(() => checkFormGuard({}, opened + 30_000)), 'FORM_EXPIRED');
    const [time, sig] = token.split('.') as [string, string];
    assert.equal(codeOf(() => checkFormGuard({ formToken: `${Number(time) - 60_000}.${sig}` }, opened + 30_000)), 'FORM_EXPIRED', 'an older time with the same signature');
    assert.equal(codeOf(() => checkFormGuard({ formToken: `${time}.${'A'.repeat(32)}` }, opened + 30_000)), 'FORM_EXPIRED');
    assert.equal(codeOf(() => checkFormGuard({ formToken: issueFormToken(opened + 3_600_000) }, opened)), 'FORM_EXPIRED', 'from the future');
  });

  test('the hidden field filled in (only bots see it) is refused', () => {
    assert.equal(codeOf(() => checkFormGuard({ website: 'http://spam.example', formToken: token }, opened + 30_000)), 'BAD_REQUEST');
  });

  test('a report queued offline is still accepted days later', () => {
    assert.equal(codeOf(() => checkFormGuard({ formToken: token }, opened + 5 * 86_400_000)), null);
  });
});
