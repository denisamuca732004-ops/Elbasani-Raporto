'use server';
/**
 * Server Actions of "Ndihmo qytetin" (lib/server/services/community.ts).
 * Public ones: a rate limit per address, Zod validation, then the service.
 * The organiser proves it is them with the secret link kept in their browser.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { checkFormGuard } from '@/lib/server/botGuard';
import { enforceRateLimit } from '@/lib/server/ratelimit';
import { requireAdmin } from '@/lib/server/session';
import * as community from '@/lib/server/services/community';
import {
  actionCloseSchema, actionCreateSchema, actionDraftSchema, actionJoinSchema, actionVoteSchema, adminActionDecisionSchema,
  communitySettingsSchema, organizerSchema, prizeChoiceSchema, redeemSchema,
} from '@/lib/validation/community';
import { clientIp, parseInput, run } from './_shared';

function refresh(code?: string) {
  revalidatePath('/ndihmo');
  if (code) revalidatePath(`/ndihmo/${code}`);
}

export async function draftActionAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('photoAnalyze', await clientIp());
    const { photoKey, notes } = parseInput(actionDraftSchema, input);
    return community.draftAction(photoKey, notes);
  });
}

export async function createActionAction(input: unknown) {
  return run(async () => {
    const data = parseInput(actionCreateSchema, input);
    checkFormGuard(data);
    await enforceRateLimit('action', await clientIp());
    const created = await community.createAction(data);
    refresh();
    return created;
  });
}

export async function organizerActionAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('actionOrganizer', await clientIp());
    const { code, token } = parseInput(organizerSchema, input);
    return community.getOrganizerAction(code, token);
  });
}

export async function joinActionAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('actionJoin', await clientIp());
    const data = parseInput(actionJoinSchema, input);
    const action = await community.joinAction(data);
    refresh(action.code);
    return action;
  });
}

export async function closeActionAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('actionOrganizer', await clientIp());
    const data = parseInput(actionCloseSchema, input);
    const action = await community.closeAction(data);
    refresh(action.code);
    return action;
  });
}

export async function choosePrizeAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('actionOrganizer', await clientIp());
    const data = parseInput(prizeChoiceSchema, input);
    const action = await community.choosePrize(data);
    refresh(action.code);
    return action;
  });
}

export async function voteActionAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('actionVote', await clientIp());
    const action = await community.voteAction(parseInput(actionVoteSchema, input));
    refresh(action.code);
    return action;
  });
}

export async function redeemPrizeAction(input: unknown) {
  return run(async () => {
    await enforceRateLimit('partnerPin', await clientIp());
    const { prizeCode, pin } = parseInput(redeemSchema, input);
    return community.redeemPrize(prizeCode, pin);
  });
}

/* ─── Admin ─── */

export async function decideActionAction(id: string, input: unknown) {
  return run(async () => {
    const user = await requireAdmin();
    const { decision, reason } = parseInput(adminActionDecisionSchema, input);
    const item = await community.decideAction(user, z.uuid().parse(id), decision, reason);
    refresh(item.code);
    revalidatePath('/admin/community');
    return item;
  });
}

export async function updateCommunitySettingsAction(input: unknown) {
  return run(async () => {
    const user = await requireAdmin();
    const settings = await community.updateCommunitySettings(user, parseInput(communitySettingsSchema, input));
    revalidatePath('/admin/community');
    refresh();
    return settings;
  });
}
