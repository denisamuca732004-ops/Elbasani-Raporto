/**
 * Residents' own accounts (optional): sign up with email + password or with
 * Google, sign in again, "my reports", and the rules that keep these accounts
 * apart from the staff and from each other.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { staffSessionExpired, STAFF_SESSION_SECONDS } from '@/auth.config';
import { loadPrincipal } from '@/lib/server/services/auth';
import { createCitizenReport } from '@/lib/server/services/publicReport';
import {
  deleteResidentAccount, googleSignInVerdict, listMyReports, loadResident, registerResident, setResidentPassword,
  signInWithGoogle, StaffAccountError, updateResidentProfile, verifyResidentCredentials, type Resident,
} from '@/lib/server/services/residents';
import { listUsers, resetPassword } from '@/lib/server/services/users';
import { safePublicNext } from '@/lib/shared/safeNext';
import type { Principal } from '@/lib/shared/types';
import { registerSchema } from '@/lib/validation/auth';
import { ADMIN_PASSWORD, adminSession, citizenData, db, rejects, setupTestDb, staffSession, teardown } from './helpers';

let admin: Principal;
before(async () => {
  await setupTestDb();
  admin = await adminSession();
});
after(teardown);

const PASSWORD = 'Qytetar-2026';
const google = (sub: string, email: string, extra: Record<string, unknown> = {}) => ({ sub, email, email_verified: true, name: 'Ana Hoxha', ...extra });

async function residentOf(id: string): Promise<Resident> {
  const row = await db.user.findUniqueOrThrow({ where: { id } });
  const resident = await loadResident(id, row.sessionVersion);
  assert.ok(resident);
  return resident;
}

describe('sign up and sign in with email + password', () => {
  test('a resident registers and signs in again with the same email and password', async () => {
    const created = await registerResident(registerSchema.parse({ name: 'Arben Leka', email: 'Arben@Example.com', password: PASSWORD }));
    assert.equal(created.role, 'USER');
    assert.equal(created.email, 'arben@example.com');
    const again = await verifyResidentCredentials('arben@example.com', PASSWORD);
    assert.equal(again?.id, created.id);
    assert.equal(await verifyResidentCredentials('arben@example.com', 'gabim-123'), null);
    assert.equal(await verifyResidentCredentials('askush@example.com', PASSWORD), null);
  });

  test('the same email twice, or a weak password, is refused', async () => {
    assert.equal((await rejects(() => registerResident(registerSchema.parse({ name: 'X Y', email: 'arben@example.com', password: PASSWORD })))).status, 409);
    assert.equal((await rejects(() => registerResident(registerSchema.parse({ name: 'X Y', email: 'tjeter@example.com', password: 'vetemshkronja' })))).status, 400);
  });

  test('a resident account never opens the panel, and a staff account never signs in here', async () => {
    const row = await db.user.findUniqueOrThrow({ where: { email: 'arben@example.com' } });
    assert.equal(await loadPrincipal(row.id, row.sessionVersion), null);
    await staffSession(admin, { email: 'sektori@example.com', departmentCode: 'water' });
    await assert.rejects(verifyResidentCredentials('sektori@example.com', 'Sektori-pass-123'), StaffAccountError);
    await assert.rejects(verifyResidentCredentials(admin.email, ADMIN_PASSWORD), StaffAccountError);
    const staff = await db.user.findUniqueOrThrow({ where: { email: 'sektori@example.com' } });
    assert.equal(await loadResident(staff.id, staff.sessionVersion), null);
  });

  test('the admin does not see residents in "Users" and cannot give them a password', async () => {
    const users = await listUsers(admin);
    assert.ok(users.every((u) => u.role !== 'USER'));
    const resident = await db.user.findUniqueOrThrow({ where: { email: 'arben@example.com' } });
    assert.equal((await rejects(() => resetPassword(admin, resident.id))).status, 400);
  });
});

describe('Google', () => {
  test('the first time creates the account; the next times sign in to the same one', async () => {
    const first = await signInWithGoogle(google('g-100', 'ana@gmail.com'));
    const second = await signInWithGoogle(google('g-100', 'ana@gmail.com'));
    assert.equal(first.id, second.id);
    const row = await db.user.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(row.role, 'USER');
    assert.equal(row.passwordHash, null);
    assert.ok(row.emailVerifiedAt);
    assert.equal(await verifyResidentCredentials('ana@gmail.com', 'anything-1'), null, 'no password, no password sign-in');
  });

  test('an email Google has not verified, a staff email and a disabled account are refused', async () => {
    assert.equal(await googleSignInVerdict(google('g-200', 'jo@gmail.com', { email_verified: false })), 'unverified');
    assert.equal(await googleSignInVerdict({ email: 'pa-sub@gmail.com', email_verified: true }), 'unverified');
    assert.equal(await googleSignInVerdict(google('g-201', 'sektori@example.com')), 'staff');
    assert.equal(await googleSignInVerdict(google('g-202', admin.email.toUpperCase())), 'staff');
    const disabled = await signInWithGoogle(google('g-203', 'mbyllur@gmail.com'));
    await db.user.update({ where: { id: disabled.id }, data: { active: false } });
    assert.equal(await googleSignInVerdict(google('g-203', 'mbyllur@gmail.com')), 'disabled');
    assert.equal((await rejects(() => signInWithGoogle(google('g-201', 'sektori@example.com')))).status, 403);
  });

  test('Google proves who owns an email registered earlier with a password: linked, old password and sessions gone', async () => {
    const squatter = await registerResident(registerSchema.parse({ name: 'Dikush', email: 'besa@gmail.com', password: PASSWORD }));
    const owner = await signInWithGoogle(google('g-300', 'besa@gmail.com'));
    assert.equal(owner.id, squatter.id, 'one account, linked');
    assert.equal(await verifyResidentCredentials('besa@gmail.com', PASSWORD), null, 'the old password no longer works');
    assert.equal(await loadResident(squatter.id, squatter.sessionVersion), null, 'the old session ended');
    assert.ok(await loadResident(owner.id, owner.sessionVersion));
  });

  test('a resident who signed up with Google can add a password and then sign in with either', async () => {
    const user = await signInWithGoogle(google('g-400', 'dita@gmail.com'));
    const resident = await residentOf(user.id);
    assert.equal(resident.hasPassword, false);
    await setResidentPassword(resident, { newPassword: PASSWORD });
    assert.equal((await verifyResidentCredentials('dita@gmail.com', PASSWORD))?.id, user.id);
    assert.equal((await signInWithGoogle(google('g-400', 'dita@gmail.com'))).id, user.id);
    const fresh = await residentOf(user.id);
    assert.equal(fresh.hasPassword && fresh.hasGoogle, true);
    assert.equal((await rejects(() => setResidentPassword(fresh, { currentPassword: 'gabim-123', newPassword: 'Tjeter-2027' }))).status, 400);
  });
});

describe('my reports', () => {
  test('a report made while signed in is in "my reports", also before verification; others do not see it', async () => {
    const user = await signInWithGoogle(google('g-500', 'erion@gmail.com'));
    const me = await residentOf(user.id);
    const other = await residentOf((await signInWithGoogle(google('g-501', 'klea@gmail.com'))).id);
    const res = await createCitizenReport(await citizenData({ anonymous: true, contactName: undefined, contactEmail: undefined }), { citizenId: me.id });
    const mine = await listMyReports(me);
    assert.deepEqual(mine.map((r) => r.caseNumber), [res.caseNumber]);
    assert.equal(mine[0]!.publicStatus, 'RECEIVED');
    assert.equal((await listMyReports(other)).length, 0);
    // Anonymous stays anonymous for the staff: no contact on the report.
    const report = await db.report.findUniqueOrThrow({ where: { caseNumber: res.caseNumber } });
    assert.equal(report.contactName, null);
    assert.equal(report.contactEmail, null);
  });

  test('deleting the account keeps the reports for the Municipality, no longer linked', async () => {
    const user = await signInWithGoogle(google('g-600', 'fshije@gmail.com'));
    const me = await residentOf(user.id);
    await updateResidentProfile(me, { name: 'Emër i Ri', phone: '+355 69 111 2222' });
    assert.equal((await residentOf(user.id)).phone, '+355 69 111 2222');
    const res = await createCitizenReport(await citizenData(), { citizenId: me.id });
    await deleteResidentAccount(me);
    assert.equal(await db.user.findUnique({ where: { id: user.id } }), null);
    const report = await db.report.findUniqueOrThrow({ where: { caseNumber: res.caseNumber } });
    assert.equal(report.citizenId, null);
  });
});

describe('sessions and return addresses', () => {
  test('staff sessions end after 12 hours; residents keep theirs', () => {
    const now = 2_000_000_000;
    assert.equal(staffSessionExpired(now - STAFF_SESSION_SECONDS + 60, now), false);
    assert.equal(staffSessionExpired(now - STAFF_SESSION_SECONDS - 60, now), true);
    assert.equal(staffSessionExpired(null, now), false, 'older cookies without a sign-in time keep their own expiry');
  });

  test('after signing in, only pages of the public site are allowed as the next address', () => {
    assert.equal(safePublicNext('/raporto?lloji=9'), '/raporto?lloji=9');
    assert.equal(safePublicNext('/ndiq/EL-2026-00001'), '/ndiq/EL-2026-00001');
    for (const bad of ['//evil.example', 'https://evil.example', '/admin', '/api/auth/signout', '/hyrje', '/../admin', 'javascript:alert(1)']) {
      assert.equal(safePublicNext(bad), null, bad);
    }
  });
});
