'use server';
/**
 * A sector that works by e-mail, from its report link (/sektori/<link>), without an account.
 * The link itself is the permission (lib/server/services/reportLinks.ts): every action checks it
 * again, and they are rate-limited per IP.
 */
import { enforceRateLimit } from '@/lib/server/ratelimit';
import { sectorRequestReview, sectorResolve, sectorStart } from '@/lib/server/services/sectorLink';
import { sectorResolveSchema, sectorStartSchema, sectorToken, transferRequestSchema } from '@/lib/validation/report';
import { clientIp, parseInput, run } from './_shared';

export async function sectorStartAction(token: unknown, input: unknown) {
  return run(async () => {
    await enforceRateLimit('sector', await clientIp());
    await sectorStart(parseInput(sectorToken, token), parseInput(sectorStartSchema, input));
    return { done: true };
  });
}

export async function sectorResolveAction(token: unknown, input: unknown) {
  return run(async () => {
    await enforceRateLimit('sector', await clientIp());
    await sectorResolve(parseInput(sectorToken, token), parseInput(sectorResolveSchema, input));
    return { done: true };
  });
}

export async function sectorReviewAction(token: unknown, input: unknown) {
  return run(async () => {
    await enforceRateLimit('sector', await clientIp());
    const data = parseInput(transferRequestSchema, input);
    await sectorRequestReview(parseInput(sectorToken, token), { ...data, suggestedDepartmentId: data.suggestedDepartmentId ?? undefined });
    return { done: true };
  });
}
