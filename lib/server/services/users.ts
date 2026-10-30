/**
 * Panel accounts, managed by the admin: the admin creates a head
 * (përgjegjës) for every department, gives them a temporary password, and can
 * reset it or disable the account. Temporary passwords are shown once to the
 * admin and never emailed.
 */
import 'server-only';
import { OPEN_STATUSES, type PanelRole, type Status } from '@/lib/shared/domain';
import type { Principal } from '@/lib/shared/types';
import type { UserCreateInput, UserPatchInput } from '@/lib/validation/admin';
import { Prisma, db, type Tx } from '../db';
import { badRequest, conflict, notFound } from '../errors';
import { queueEmails } from '../mail';
import * as tpl from '../mailTemplates';
import { temporaryPassword } from '../tokens';
import { assertAdmin } from './access';
import { forgetUserState, hashPassword } from './auth';

export const ROLE_LABELS: Record<PanelRole | 'USER', string> = { ADMIN: 'Administrator', MUNICIPALITY_STAFF: 'Përgjegjës sektori', USER: 'Përdorues' };

export interface UserDto {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: PanelRole | 'USER';
  departmentId: number | null;
  departmentName: string | null;
  departmentActive: boolean | null;
  mustChangePassword: boolean;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const withDepartment = { department: { select: { nameSq: true, active: true } } } as const;
type UserRow = Prisma.UserGetPayload<{ include: typeof withDepartment }>;

function toDto(u: UserRow): UserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
    departmentId: u.departmentId,
    departmentName: u.department?.nameSq ?? null,
    departmentActive: u.department ? u.department.active : null,
    mustChangePassword: u.mustChangePassword,
    active: u.active,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

async function reload(id: string, tx: Tx = db): Promise<UserRow> {
  const user = await tx.user.findUnique({ where: { id }, include: withDepartment });
  if (!user) throw notFound('Llogaria nuk u gjet.');
  return user;
}

async function requireActiveDepartment(departmentId: number | null | undefined) {
  if (!departmentId) throw badRequest('Përgjegjësi i sektorit duhet të ketë një sektor.', [{ field: 'departmentId', code: 'required', message: 'Zgjidhni sektorin.' }]);
  const department = await db.department.findUnique({ where: { id: departmentId } });
  if (!department || !department.active) {
    throw badRequest('Ky sektor nuk ekziston ose është çaktivizuar.', [{ field: 'departmentId', code: 'unknown', message: 'Ky sektor nuk ekziston ose është çaktivizuar.' }]);
  }
  return department;
}

const emailTaken = () => conflict('Ekziston tashmë një llogari me këtë email.', { field: 'email' });

export async function listUsers(admin: Principal): Promise<UserDto[]> {
  assertAdmin(admin);
  // Panel accounts only: residents' own accounts are private and are not managed here.
  const users = await db.user.findMany({ where: { role: { in: ['MUNICIPALITY_STAFF', 'ADMIN'] } }, include: withDepartment, orderBy: [{ role: 'desc' }, { name: 'asc' }] });
  return users.map(toDto);
}

export async function createUser(admin: Principal, input: UserCreateInput): Promise<{ user: UserDto; temporaryPassword: string }> {
  assertAdmin(admin);
  const department = input.role === 'MUNICIPALITY_STAFF' ? await requireActiveDepartment(input.departmentId) : null;
  if (await db.user.findUnique({ where: { email: input.email }, select: { id: true } })) throw emailTaken();
  const password = temporaryPassword();
  let created: UserRow;
  try {
    created = await db.user.create({
      data: {
        email: input.email,
        name: input.name,
        phone: input.phone ?? null,
        passwordHash: await hashPassword(password),
        role: input.role,
        departmentId: department?.id ?? null,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      },
      include: withDepartment,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw emailTaken();
    throw err;
  }
  await queueEmails([created.email], tpl.accountCreated({
    name: created.name, email: created.email, roleLabel: ROLE_LABELS[created.role], departmentNameSq: department?.nameSq ?? null,
  }));
  // Shown ONCE to the admin, who gives it to the person. Never emailed.
  return { user: toDto(created), temporaryPassword: password };
}

/** Takes a person off the open reports they can no longer work on (account disabled or moved). */
async function releaseAssignments(tx: Tx, userId: string, keepDepartmentId: number | null, actorId: string, reason: string): Promise<number> {
  const reports = await tx.report.findMany({
    where: {
      assignedToId: userId,
      status: { in: [...OPEN_STATUSES] },
      ...(keepDepartmentId !== null ? { NOT: { departmentId: keepDepartmentId } } : {}),
    },
    select: { id: true, status: true },
  });
  for (const report of reports) {
    const next: Status = report.status === 'ASSIGNED' ? 'VERIFIED' : report.status;
    await tx.report.update({ where: { id: report.id }, data: { assignedToId: null, status: next } });
    await tx.reportEvent.create({ data: { reportId: report.id, type: 'ASSIGNED', actorId, message: `U hoq caktimi: ${reason}`, meta: { assigneeId: null } } });
    if (next !== report.status) {
      await tx.reportEvent.create({ data: { reportId: report.id, type: 'STATUS_CHANGED', fromStatus: report.status, toStatus: next, actorId, isPublic: false } });
    }
  }
  return reports.length;
}

export async function updateUser(admin: Principal, id: string, patch: UserPatchInput): Promise<UserDto> {
  assertAdmin(admin);
  const user = await reload(id);
  if (user.role === 'USER') throw badRequest('Kjo llogari nuk ka akses në panel.');
  if (user.id === admin.id && (patch.active === false || (patch.role && patch.role !== 'ADMIN'))) {
    throw badRequest('Nuk mund ta çaktivizoni veten ose t\'i hiqni vetes rolin e administratorit.');
  }
  const role: PanelRole = patch.role ?? user.role;
  let departmentId: number | null = patch.departmentId !== undefined ? patch.departmentId : user.departmentId;
  if (role === 'ADMIN') departmentId = null;
  if (role === 'MUNICIPALITY_STAFF' && (patch.role !== undefined || patch.departmentId !== undefined)) {
    departmentId = (await requireActiveDepartment(departmentId)).id;
  }
  const active = patch.active ?? user.active;
  if (user.role === 'ADMIN' && user.active && (role !== 'ADMIN' || !active)) {
    const admins = await db.user.count({ where: { role: 'ADMIN', active: true } });
    if (admins <= 1) throw badRequest('Duhet të mbetet gjithmonë të paktën një administrator aktiv.');
  }
  if (patch.email && patch.email !== user.email && (await db.user.findUnique({ where: { email: patch.email }, select: { id: true } }))) {
    throw emailTaken();
  }

  try {
    await db.$transaction(async (tx) => {
      const leavesDepartment = user.role === 'MUNICIPALITY_STAFF' && (role !== 'MUNICIPALITY_STAFF' || departmentId !== user.departmentId);
      await tx.user.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.email ? { email: patch.email } : {}),
          role,
          departmentId,
          active,
          // A disabled account is signed out everywhere immediately.
          ...(user.active && !active ? { sessionVersion: { increment: 1 } } : {}),
        },
      });
      if (!active) await releaseAssignments(tx, id, null, admin.id, 'llogaria u çaktivizua');
      else if (leavesDepartment) {
        await releaseAssignments(tx, id, role === 'MUNICIPALITY_STAFF' ? departmentId : null, admin.id, 'personi kaloi në një sektor tjetër');
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw emailTaken();
    throw err;
  }
  await forgetUserState(id);
  return toDto(await reload(id));
}

/** A new temporary password; the person must change it at the next sign-in. Their open sessions end. */
export async function resetPassword(admin: Principal, id: string): Promise<{ user: UserDto; temporaryPassword: string }> {
  assertAdmin(admin);
  if (id === admin.id) throw badRequest('Për llogarinë tuaj përdorni "Ndrysho fjalëkalimin".');
  const user = await reload(id);
  // A resident's own account is never given a password by the Municipality.
  if (user.role === 'USER') throw badRequest('Kjo llogari nuk ka akses në panel.');
  const password = temporaryPassword();
  await db.user.update({
    where: { id },
    data: { passwordHash: await hashPassword(password), mustChangePassword: true, passwordChangedAt: new Date(), sessionVersion: { increment: 1 } },
  });
  await forgetUserState(id);
  await queueEmails([user.email], tpl.passwordReset({ name: user.name }));
  return { user: toDto(await reload(id)), temporaryPassword: password };
}
