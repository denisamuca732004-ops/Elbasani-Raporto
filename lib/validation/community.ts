/**
 * Zod schemas for "Ndihmo qytetin" (lib/server/services/community.ts).
 */
import { z } from 'zod';
import { uploadKey } from './report';
import { latitude, longitude, singleLine } from './zod';

/** A random reference the browser keeps for itself (no account): who scanned, who answered. */
export const deviceRef = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const actionCode = z.string().trim().toUpperCase().regex(/^AK-\d{4}-\d{4,6}$/);
export const organizerToken = z.string().regex(/^[A-Za-z0-9_-]{20,64}$/);

const pushSubscription = z.strictObject({
  endpoint: z.string().url().max(600),
  keys: z.strictObject({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
}).optional();

const lang = z.enum(['sq', 'en']).default('sq');

export const actionCreateSchema = z.strictObject({
  photoKey: uploadKey,
  title: singleLine(6, 120),
  description: z.string().trim().min(15).max(1000),
  bring: z.string().trim().max(200).optional().default(''),
  place: singleLine(3, 200),
  latitude,
  longitude,
  startsAt: z.coerce.date(),
  minutes: z.coerce.number().int().min(15).max(480),
  peopleNeeded: z.coerce.number().int().min(1).max(50),
  organizerName: z.string().trim().max(40).optional().default(''),
  organizerPhone: z.string().trim().max(30).regex(/^[0-9 +()-]+$/),
  deviceRef,
  safetyAccepted: z.literal(true),
  push: pushSubscription,
  lang,
  formToken: z.string().max(200).optional(),
  website: z.string().max(200).optional(),
});
export type ActionCreateInput = z.output<typeof actionCreateSchema>;

export const actionDraftSchema = z.strictObject({ photoKey: uploadKey, notes: z.string().trim().max(500).default('') });

export const actionJoinSchema = z.strictObject({
  code: actionCode,
  token: z.string().regex(/^[A-Za-z0-9_-]{8,32}$/),
  deviceRef,
  latitude,
  longitude,
  name: z.string().trim().max(40).optional().default(''),
  push: pushSubscription,
  lang,
});

export const actionViewSchema = z.strictObject({ code: actionCode, deviceRef });
export const organizerSchema = z.strictObject({ code: actionCode, token: organizerToken });
export const actionCloseSchema = z.strictObject({ code: actionCode, token: organizerToken, photoKey: uploadKey });
export const prizeChoiceSchema = z.strictObject({ code: actionCode, token: organizerToken, choice: z.enum(['COFFEE', 'MARKET']) });
export const actionVoteSchema = z.strictObject({ code: actionCode, deviceRef, done: z.boolean() });
export const redeemSchema = z.strictObject({ prizeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,16}$/), pin: z.string().trim().min(4).max(12) });

export const adminActionDecisionSchema = z.strictObject({
  decision: z.enum(['publish', 'reject', 'verify', 'not_verified', 'release_prize', 'redeemed']),
  reason: z.string().trim().max(500).optional().default(''),
});

export const communitySettingsSchema = z.strictObject({
  enabled: z.boolean(),
  rewards: z.boolean().default(false),
  tiers: z.array(z.strictObject({ minPeople: z.coerce.number().int().min(1).max(100), amount: z.coerce.number().int().min(0).max(100_000) })).min(1).max(6),
  coffeePartner: singleLine(2, 80),
  marketPartner: singleLine(2, 80),
  monthlyBudget: z.coerce.number().int().min(0).max(10_000_000),
  checkFrom: z.coerce.number().int().min(0).max(100_000),
  /** Empty: keep the PIN as it is. */
  partnerPin: z.string().trim().regex(/^(\d{4,12})?$/).optional().default(''),
});
export type CommunitySettingsInput = z.output<typeof communitySettingsSchema>;
