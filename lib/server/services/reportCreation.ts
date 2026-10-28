/**
 * Saves a new report (from a resident or from the admin) in one transaction:
 * case number, automatic routing to the department of the report type, photo,
 * first history event. Afterwards a background job runs the automatic check
 * (AI or keyword rules) and tells the department; the resident gets an email.
 */
import 'server-only';
import type { Channel, Priority } from '@/lib/shared/domain';
import type { RequestType } from '@/lib/generated/prisma/client';
import { Prisma, db, type Tx } from '../db';
import { queueEmails } from '../mail';
import * as tpl from '../mailTemplates';
import { enqueue } from '../queue';
import { deleteStoredImage, discardTemporaryUpload, storeImage, takeTemporaryUpload, type StoredImage } from '../storage';
import { nextCaseNumber } from './caseNumber';

export interface NewReport {
  type: RequestType;
  channel: Channel;
  priority?: Priority;
  description: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  neighbourhoodId: number | null;
  anonymous: boolean;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdById: string | null;
  clientRef: string | null;
  /** Key of the temporary upload (actions/upload.ts). */
  photoKey: string | null;
}

const DAY_MS = 86_400_000;

/** The department that handles this type, if that department is active (otherwise the admin routes it). */
export async function routeDepartmentId(type: Pick<RequestType, 'departmentId'>, tx: Tx = db): Promise<number | null> {
  if (!type.departmentId) return null;
  const department = await tx.department.findUnique({ where: { id: type.departmentId }, select: { id: true, active: true } });
  return department?.active ? department.id : null;
}

export async function persistNewReport(input: NewReport): Promise<{ report: { id: string; caseNumber: string; status: 'PENDING' | string }; duplicateSubmission: boolean }> {
  if (input.clientRef) {
    const existing = await db.report.findUnique({ where: { clientRef: input.clientRef }, select: { id: true, caseNumber: true, status: true } });
    if (existing) {
      if (input.photoKey) await discardTemporaryUpload(input.photoKey);
      return { report: existing, duplicateSubmission: true };
    }
  }

  const departmentId = await routeDepartmentId(input.type);
  const photo: StoredImage | null = input.photoKey ? await storeImage(await takeTemporaryUpload(input.photoKey)) : null;
  let report: { id: string; caseNumber: string; status: string };
  try {
    report = await db.$transaction(async (tx) => {
      const caseNumber = await nextCaseNumber(tx);
      const created = await tx.report.create({
        data: {
          caseNumber,
          requestTypeId: input.type.id,
          categoryId: input.type.categoryId,
          departmentId,
          neighbourhoodId: input.neighbourhoodId,
          kind: input.type.kind,
          status: 'PENDING',
          priority: input.priority ?? input.type.defaultPriority,
          channel: input.channel,
          description: input.description,
          address: input.address,
          latitude: input.latitude,
          longitude: input.longitude,
          anonymous: input.anonymous,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          wantsUpdates: Boolean(input.contactEmail),
          createdById: input.createdById,
          aiStatus: 'PENDING',
          dueAt: new Date(Date.now() + input.type.slaDays * DAY_MS),
          clientRef: input.clientRef,
        },
        select: { id: true, caseNumber: true, status: true, channel: true },
      });
      if (photo) {
        await tx.attachment.create({
          data: {
            reportId: created.id, kind: 'BEFORE', storageKey: photo.key, storageUrl: photo.url,
            mime: photo.mime, size: photo.size, width: photo.width, height: photo.height,
          },
        });
      }
      await tx.reportEvent.create({
        data: {
          reportId: created.id, type: 'CREATED', toStatus: 'PENDING', isPublic: true, actorId: input.createdById,
          meta: { channel: created.channel, departmentId },
        },
      });
      return created;
    });
  } catch (err) {
    if (photo) await deleteStoredImage(photo.key);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.clientRef) {
      const existing = await db.report.findUnique({ where: { clientRef: input.clientRef }, select: { id: true, caseNumber: true, status: true } });
      if (existing) return { report: existing, duplicateSubmission: true };
    }
    throw err;
  }
  if (input.photoKey) await discardTemporaryUpload(input.photoKey);

  await enqueue('triage', { reportId: report.id });
  if (input.contactEmail) {
    const mail = tpl.requestReceived({ caseNumber: report.caseNumber, typeNameSq: input.type.nameSq, typeNameEn: input.type.nameEn });
    await queueEmails([input.contactEmail], mail, report.id);
  }
  return { report, duplicateSubmission: false };
}
