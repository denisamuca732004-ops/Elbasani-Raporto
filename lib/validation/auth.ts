/** Zod schemas for signing in and managing one's own account. */
import { z } from 'zod';
import { email, password, phone, singleLine } from './zod';

export const setupSchema = z.strictObject({ name: singleLine(2, 160), email, password });
export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
export const changePasswordSchema = z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword: password });
export const profileSchema = z
  .strictObject({ name: singleLine(2, 160), phone: phone.nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nuk ka asnjë ndryshim.' });

export type SetupInput = z.output<typeof setupSchema>;
export type LoginInput = z.output<typeof loginSchema>;
export type ChangePasswordInput = z.output<typeof changePasswordSchema>;
export type ProfileInput = z.output<typeof profileSchema>;
