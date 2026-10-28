/** Zod schemas for administration (admin only). */
import { z } from 'zod';
import { PRIORITIES, REQUEST_KINDS } from '@/lib/shared/domain';
import { email, id, nullableId, optionalEmail, optionalText, password, phone, singleLine } from './zod';

const code = z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().min(2).max(80).regex(/^[a-z0-9_.-]+$/));
const name160 = singleLine(2, 160);
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/*
 * Each entity has its fields once, without defaults. The "create" schema adds
 * the defaults; the "patch" schema is the same fields, all optional and with
 * NO defaults, so a PATCH that renames something never resets its other
 * fields (department, deadline, priority, active…) to the default values.
 */
const departmentFields = {
  code,
  nameSq: name160,
  nameEn: name160,
  description: optionalText(1000),
  email: optionalEmail,
  active: z.boolean(),
};
export const departmentSchema = z.strictObject({ ...departmentFields, active: z.boolean().default(true) });
export const departmentPatchSchema = z.strictObject(departmentFields).partial().refine((v) => Object.keys(v).length > 0, { message: 'Nuk ka asnjë ndryshim.' });
export type DepartmentInput = z.output<typeof departmentSchema>;
export type DepartmentPatch = z.output<typeof departmentPatchSchema>;

const categoryFields = {
  code,
  nameSq: name160,
  nameEn: name160,
  icon: z.string().max(40),
  sortOrder: z.coerce.number().int(),
  active: z.boolean(),
};
export const categorySchema = z.strictObject({
  ...categoryFields,
  icon: categoryFields.icon.default('other'),
  sortOrder: categoryFields.sortOrder.default(0),
  active: z.boolean().default(true),
});
export const categoryPatchSchema = z.strictObject(categoryFields).partial().refine((v) => Object.keys(v).length > 0, { message: 'Nuk ka asnjë ndryshim.' });

const requestTypeFields = {
  code,
  categoryId: id,
  departmentId: nullableId,
  nameSq: name160,
  nameEn: name160,
  kind: z.enum(REQUEST_KINDS),
  slaDays: z.coerce.number().int().min(1).max(365),
  defaultPriority: z.enum(PRIORITIES),
  keywords: optionalText(500),
  sortOrder: z.coerce.number().int(),
  active: z.boolean(),
};
export const requestTypeSchema = z.strictObject({
  ...requestTypeFields,
  departmentId: requestTypeFields.departmentId.default(null),
  kind: requestTypeFields.kind.default('PROBLEM'),
  slaDays: requestTypeFields.slaDays.default(10),
  defaultPriority: requestTypeFields.defaultPriority.default('MEDIUM'),
  sortOrder: requestTypeFields.sortOrder.default(0),
  active: z.boolean().default(true),
});
export const requestTypePatchSchema = z.strictObject(requestTypeFields).partial().refine((v) => Object.keys(v).length > 0, { message: 'Nuk ka asnjë ndryshim.' });
export type RequestTypeInput = z.output<typeof requestTypeSchema>;

const neighbourhoodFields = { name: name160, sortOrder: z.coerce.number().int(), active: z.boolean() };
export const neighbourhoodSchema = z.strictObject({
  ...neighbourhoodFields,
  sortOrder: neighbourhoodFields.sortOrder.default(0),
  active: z.boolean().default(true),
});
export const neighbourhoodPatchSchema = z.strictObject(neighbourhoodFields).partial().refine((v) => Object.keys(v).length > 0, { message: 'Nuk ka asnjë ndryshim.' });

/** Accounts that can open the panel. USER accounts have no panel and are not created here. */
const panelRole = z.enum(['MUNICIPALITY_STAFF', 'ADMIN']);

export const userCreateSchema = z
  .strictObject({ email, name: name160, phone, role: panelRole, departmentId: nullableId.default(null) })
  .superRefine((v, ctx) => {
    if (v.role === 'MUNICIPALITY_STAFF' && !v.departmentId) {
      ctx.addIssue({ code: 'custom', path: ['departmentId'], message: 'Zgjidhni sektorin.', params: { code: 'required' } });
    }
  })
  .transform((v) => ({ ...v, departmentId: v.role === 'ADMIN' ? null : v.departmentId }));
export type UserCreateInput = z.output<typeof userCreateSchema>;

export const userPatchSchema = z
  .strictObject({ name: name160, email, phone: phone.nullable(), role: panelRole, departmentId: nullableId, active: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nuk ka asnjë ndryshim.' });
export type UserPatchInput = z.output<typeof userPatchSchema>;

const origin = z.string().trim().transform((s) => s.replace(/\/$/, '')).pipe(z.string().regex(/^https?:\/\/[^/\s]+$/));

export const settingsSchema = z.strictObject({
  branding: z
    .strictObject({
      municipalityName: singleLine(2, 120),
      appName: singleLine(2, 120),
      logoUrl: z.string().trim().max(500).regex(/^(\/[^\s]*|https:\/\/[^\s]+)$/),
      headerColor: hexColor,
      footerColor: hexColor,
      buttonColor: hexColor,
    })
    .partial()
    .optional(),
  embed: z.strictObject({ allowedOrigins: z.array(origin).max(20) }).optional(),
});
export type SettingsInput = z.output<typeof settingsSchema>;

export const emailLogSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: optionalText(100),
});
export type EmailLogQuery = z.output<typeof emailLogSchema>;

export { password };
