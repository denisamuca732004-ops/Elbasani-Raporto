'use client';
/**
 * One report, as the person looking at it is allowed to handle it.
 *  - department head: the normal workflow, priority, assignment, notes, message
 *    to the resident, resolve with an "after" photo, reject with a reason, and
 *    "this is not our department" → a review request to the admin.
 *  - admin: everything, including any status, every detail, the department,
 *    the review decision and deleting the report.
 * Every button calls a Server Action, which checks the role and validates the
 * input with Zod again; the buttons shown here only follow `permissions`.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  addNoteAction, assignReportAction, changePriorityAction, changeStatusAction, deleteReportAction, messageCitizenAction,
  rejectReportAction, requestTransferAction, resolveReportAction, setPhotoVisibilityAction, setTestFlagAction, updateReportAction,
} from '@/actions/reports';
import Icon from '@/components/Icon';
import { LocationPicker, MiniMap } from '@/components/maps';
import { zoneCenter, zoneCodeAt } from '@/lib/shared/zones';
import PhotoInput from '@/components/PhotoInput';
import { useCatalog } from '@/components/providers';
import {
  ErrorAlert, Field, InternalStatusBadge, OverdueBadge, PriorityBadge, Segmented, SuccessAlert, TestBadge, TransferBadge,
} from '@/components/ui';
import { useI18n } from '@/i18n';
import { ActionFailure, call } from '@/lib/client/action';
import { departmentName, formatDate, key, typeName, type LatLng } from '@/lib/client/format';
import { uploadPhoto } from '@/lib/client/upload';
import { LIMITS, type Priority, type Status } from '@/lib/shared/domain';
import type { Principal, ReportDetail as Report } from '@/lib/shared/types';
import TransferDecision from './TransferDecision';

/** Statuses a department head moves to with one button (resolve and reject have their own forms). */
const QUICK_STATUSES: Status[] = ['NEEDS_REVIEW', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'CLOSED'];

/** The words on a status button depend on where the report is now. */
function actionLabel(from: Status, to: Status): string {
  if (to === 'IN_PROGRESS' && from === 'RESOLVED') return 'reopen';
  if (to === 'VERIFIED' && from === 'ASSIGNED') return 'release';
  if (to === 'ASSIGNED' && from === 'IN_PROGRESS') return 'pause';
  return key(to);
}

function Card({ title, icon, children, className = '' }: { title?: string; icon?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && <h2 className="card-title">{icon && <Icon name={icon} size={16} />} {title}</h2>}
      {children}
    </section>
  );
}

export interface AssignablePerson { id: string; name: string; role: string }

export default function ReportDetail({ principal, report: initial, assignable, backTo }: {
  principal: Principal; report: Report; assignable: AssignablePerson[]; backTo: string;
}) {
  const { t, lang } = useI18n();
  const { catalog, types, departments, typeById, departmentById } = useCatalog();
  const router = useRouter();
  const admin = principal.role === 'ADMIN';

  const [report, setReport] = useState(initial);
  const [actionError, setActionError] = useState<ActionFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Form state
  const [statusNote, setStatusNote] = useState('');
  const [publicNote, setPublicNote] = useState(true);
  const [adminStatus, setAdminStatus] = useState<Status | ''>('');
  const [resolveNote, setResolveNote] = useState('');
  const [afterPhoto, setAfterPhoto] = useState<Blob | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [assignee, setAssignee] = useState(initial.assignedTo?.id ?? '');
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferReason, setTransferReason] = useState('');
  const [transferDepartment, setTransferDepartment] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [edit, setEdit] = useState<{
    requestTypeId: string; departmentId: string; neighbourhoodId: string; address: string; description: string; pin: LatLng | null;
  } | null>(null);

  // Fresh data from the server (after router.refresh) replaces the local copy.
  useEffect(() => {
    setReport(initial);
    setAssignee(initial.assignedTo?.id ?? '');
  }, [initial]);

  /** Runs an action; the answer is the updated report. The menu counters refresh too. */
  async function act(name: string, run: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(name);
    setActionError(null);
    setNotice(null);
    try {
      const updated = await run();
      if (updated && typeof updated === 'object' && 'caseNumber' in updated && 'permissions' in updated) {
        setReport(updated as Report);
        setAssignee((updated as Report).assignedTo?.id ?? '');
      }
      router.refresh();
      setNotice(success);
      return true;
    } catch (err) {
      setActionError(err as ActionFailure);
      if ((err as ActionFailure).status === 409) router.refresh(); // someone else changed it: show the current state
      return false;
    } finally {
      setBusy(null);
    }
  }

  const id = report.id;
  const p = report.permissions;
  const final = report.status === 'CLOSED' || report.status === 'REJECTED';
  const quickStatuses = report.allowedStatuses.filter((s) => QUICK_STATUSES.includes(s));
  const suggestedType = report.ai.suggestedType ? typeById(report.ai.suggestedType.id) : undefined;
  const suggestedDepartmentOther = suggestedType?.departmentId && suggestedType.departmentId !== report.department?.id
    ? departmentById(suggestedType.departmentId) : undefined;
  const beforePhotos = report.attachments.filter((a) => a.kind === 'BEFORE');
  const afterPhotos = report.attachments.filter((a) => a.kind === 'AFTER');

  function startEdit() {
    setEdit({
      requestTypeId: String(report.type?.id ?? ''),
      departmentId: report.department ? String(report.department.id) : '',
      neighbourhoodId: report.neighbourhoodId ? String(report.neighbourhoodId) : '',
      address: report.address ?? '',
      description: report.description ?? '',
      pin: report.latitude !== null && report.longitude !== null ? { latitude: report.latitude, longitude: report.longitude } : null,
    });
  }

  async function saveEdit() {
    if (!edit) return;
    const body: Record<string, unknown> = {};
    if (Number(edit.requestTypeId) !== report.type?.id) body.requestTypeId = Number(edit.requestTypeId);
    const newDepartment = edit.departmentId ? Number(edit.departmentId) : null;
    if (newDepartment !== (report.department?.id ?? null)) body.departmentId = newDepartment;
    const newArea = edit.neighbourhoodId ? Number(edit.neighbourhoodId) : null;
    if (newArea !== report.neighbourhoodId) body.neighbourhoodId = newArea;
    if (edit.address.trim() !== (report.address ?? '')) body.address = edit.address.trim();
    if (edit.description.trim() !== (report.description ?? '')) body.description = edit.description.trim();
    if (edit.pin && (edit.pin.latitude !== report.latitude || edit.pin.longitude !== report.longitude)) {
      body.latitude = edit.pin.latitude;
      body.longitude = edit.pin.longitude;
    }
    if (!Object.keys(body).length) {
      setEdit(null);
      return;
    }
    const ok = await act('edit', () => call(updateReportAction(id, body)), t('detail.saved'));
    if (ok) setEdit(null);
  }

  async function removeReport() {
    if (!window.confirm(t('detail.confirmDelete', { n: report.caseNumber }))) return;
    setBusy('delete');
    try {
      await call(deleteReportAction(id));
      router.replace('/admin/reports');
      router.refresh();
    } catch (err) {
      setActionError(err as ActionFailure);
      setBusy(null);
    }
  }

  const statusPayload = (status: Status) => ({ status, ...(statusNote.trim() ? { note: statusNote.trim() } : {}), publicNote });

  return (
    <div className="stack">
      <Link href={backTo} className="back-link"><Icon name="arrowLeft" size={16} />{t('detail.backToList')}</Link>

      <header className="detail-head">
        <div>
          <div className="case-number" style={{ fontSize: '1.05rem' }}>{report.caseNumber}</div>
          <h1 style={{ margin: '4px 0 8px' }}>{typeName(report.type, lang)}</h1>
          <div className="row" style={{ gap: 8 }}>
            <PriorityBadge priority={report.priority} />
            <InternalStatusBadge status={report.status} />
            <OverdueBadge show={report.overdue} />
            <TransferBadge show={report.transferPending} />
            <TestBadge show={report.isTest} />
          </div>
        </div>
        <div className="detail-sector">
          <span className="label">{t('detail.sector')}</span>
          <strong>{departmentName(report.department, lang) ?? t('panel.nav.unrouted')}</strong>
          <a href={`/ndiq/${report.caseNumber}`} target="_blank" rel="noreferrer" className="small"><Icon name="external" size={14} /> {t('detail.publicPage')}</a>
        </div>
      </header>

      <SuccessAlert>{notice}</SuccessAlert>
      <ErrorAlert error={actionError} />

      {report.pendingTransfer && (
        <section className="transfer-banner" aria-live="polite">
          <div className="row" style={{ gap: 8 }}><Icon name="transfer" size={20} /><strong>{t('detail.transfer.pendingTitle')}</strong></div>
          <p style={{ margin: '8px 0' }}>
            {t('detail.transfer.pendingText', {
              who: report.pendingTransfer.requestedBy?.name ?? '—',
              sector: departmentName(report.pendingTransfer.fromDepartment, lang) ?? '—',
              date: formatDate(report.pendingTransfer.createdAt, lang, true),
            })}
          </p>
          <blockquote>{report.pendingTransfer.reason}</blockquote>
          {report.pendingTransfer.suggestedDepartment && <p className="small">{t('detail.transfer.suggested', { sector: departmentName(report.pendingTransfer.suggestedDepartment, lang) })}</p>}
          {admin ? (
            <TransferDecision
              transfer={report.pendingTransfer}
              currentDepartmentId={report.department?.id}
              onDone={(result, decision) => {
                setNotice(decision === 'approve'
                  ? t('detail.transfer.approvedNotice', { sector: departmentName(result.toDepartment, lang) })
                  : t('detail.transfer.declinedNotice'));
                router.refresh();
              }}
            />
          ) : <p className="small muted" style={{ margin: 0 }}>{t('detail.transfer.waitingAdmin')}</p>}
        </section>
      )}

      <div className="detail-grid">
        <div className="stack">
          <Card title={t('detail.report')} icon="list">
            <p style={{ whiteSpace: 'pre-wrap' }}>{report.description || <span className="muted">{t('detail.noDescription')}</span>}</p>
            <dl className="kv">
              <dt>{t('detail.address')}</dt><dd>{report.address || '–'}</dd>
              <dt>{t('detail.area')}</dt><dd>{report.neighbourhood || '–'}</dd>
              <dt>{t('detail.category')}</dt><dd>{(lang === 'en' ? report.category?.nameEn : report.category?.nameSq) ?? '–'}</dd>
              <dt>{t('detail.channel')}</dt><dd>{t(`channels.${key(report.channel)}`)}</dd>
              <dt>{t('detail.received')}</dt><dd>{formatDate(report.createdAt, lang, true)}</dd>
              <dt>{t('detail.due')}</dt><dd>{report.dueAt ? formatDate(report.dueAt, lang, true) : '–'} <OverdueBadge show={report.overdue} /></dd>
              {report.resolvedAt && (<><dt>{t('detail.resolvedAt')}</dt><dd>{formatDate(report.resolvedAt, lang, true)}</dd></>)}
              {report.closedAt && (<><dt>{t('detail.closedAt')}</dt><dd>{formatDate(report.closedAt, lang, true)}</dd></>)}
              {report.supporters > 0 && (<><dt>{t('detail.supporters')}</dt><dd>{report.supporters}</dd></>)}
              {report.createdBy && (<><dt>{t('detail.createdBy')}</dt><dd>{report.createdBy.name}</dd></>)}
              {report.closingNote && (<><dt>{t('detail.closingNote')}</dt><dd>{report.closingNote}</dd></>)}
              {report.rejectionReason && (<><dt>{t('detail.rejectionReason')}</dt><dd>{report.rejectionReason}</dd></>)}
              {report.citizenRating && (<><dt>{t('detail.rating')}</dt><dd>{report.citizenRating} / 5{report.citizenComment ? ` – “${report.citizenComment}”` : ''}</dd></>)}
            </dl>
            {report.latitude !== null && <div style={{ marginTop: 12 }}><MiniMap latitude={report.latitude} longitude={report.longitude} /></div>}
          </Card>

          <Card title={t('detail.photos')} icon="camera">
            {report.attachments.length === 0 && <p className="muted">{t('detail.noPhotos')}</p>}
            {([['before', beforePhotos], ['after', afterPhotos]] as const).map(([kind, list]) => list.length > 0 && (
              <div key={kind} style={{ marginBottom: 12 }}>
                <div className="label">{t(`detail.photo.${kind}`)}</div>
                <div className="photos">
                  {list.map((a) => (
                    <figure key={a.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by /api/admin/photos, which checks the session */}
                      <img src={a.url} alt={t(`detail.photo.${kind}`)} loading="lazy" />
                      <figcaption>
                        <span>{a.isPublic ? t('detail.photo.public') : t('detail.photo.hidden')}</span>
                        <button
                          type="button" className="btn btn-sm btn-ghost" disabled={busy === `photo-${a.id}`}
                          onClick={() => act(`photo-${a.id}`, () => call(setPhotoVisibilityAction(a.id, { isPublic: !a.isPublic })), t('detail.saved'))}
                        >
                          <Icon name={a.isPublic ? 'eyeOff' : 'eye'} size={14} />{a.isPublic ? t('detail.photo.hide') : t('detail.photo.show')}
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </Card>

          <Card title={t('detail.ai.title')} icon="sparkle" className="ai-panel">
            <p className="small"><span className="badge badge-ai">{t(`aiStatus.${key(report.ai.status)}`)}</span></p>
            {report.ai.summary && <p><strong>{t('detail.ai.summary')}:</strong> {report.ai.summary}</p>}
            <dl className="kv">
              {report.ai.confidence !== null && (<><dt>{t('detail.ai.confidence')}</dt><dd>{report.ai.confidence}%</dd></>)}
              {report.ai.suggestedPriority && (<><dt>{t('detail.ai.suggestedPriority')}</dt><dd><PriorityBadge priority={report.ai.suggestedPriority} /></dd></>)}
              {report.ai.suggestedType && (<><dt>{t('detail.ai.suggestedType')}</dt><dd>{typeName(report.ai.suggestedType, lang)}{suggestedDepartmentOther ? ` (${departmentName(suggestedDepartmentOther, lang)})` : ''}</dd></>)}
              {report.ai.privacyIssue && (<><dt>{t('detail.ai.privacy')}</dt><dd>{t('detail.ai.privacyText')}</dd></>)}
              {report.ai.closingFixed !== null && (<><dt>{t('detail.ai.closingCheck')}</dt><dd>{report.ai.closingFixed ? t('detail.ai.looksFixed') : t('detail.ai.notFixed')} ({report.ai.closingConfidence ?? '?'}%)</dd></>)}
              {report.ai.reason && (<><dt>{t('detail.ai.reason')}</dt><dd className="small">{report.ai.reason}</dd></>)}
            </dl>
            {!final && (
              <div className="row" style={{ marginTop: 10 }}>
                {report.ai.suggestedPriority && report.ai.suggestedPriority !== report.priority && p.canChangePriority && (
                  <button type="button" className="btn btn-sm btn-outline" disabled={Boolean(busy)} onClick={() => act('ai-priority', () => call(changePriorityAction(id, { priority: report.ai.suggestedPriority })), t('detail.saved'))}>
                    {t('detail.ai.acceptPriority')}
                  </button>
                )}
                {admin && report.ai.suggestedType && report.ai.suggestedType.id !== report.type?.id && (
                  <button type="button" className="btn btn-sm btn-outline" disabled={Boolean(busy)} onClick={() => act('ai-type', () => call(updateReportAction(id, { requestTypeId: report.ai.suggestedType!.id })), t('detail.saved'))}>
                    {t('detail.ai.acceptType')}
                  </button>
                )}
                {!admin && suggestedDepartmentOther && p.canRequestTransfer && (
                  <button type="button" className="btn btn-sm btn-outline" onClick={() => { setTransferOpen(true); setTransferDepartment(String(suggestedDepartmentOther.id)); }}>
                    {t('detail.ai.askTransfer')}
                  </button>
                )}
              </div>
            )}
          </Card>

          <Card title={t('detail.history')} icon="clock">
            <ol className="timeline">
              {report.events.map((e) => (
                <li key={e.id} className={e.isPublic ? '' : 'internal'}>
                  <div className="what">
                    {t(`events.${key(e.type)}`)}
                    {e.toStatus && e.type === 'STATUS_CHANGED' && ` → ${t(`internalStatus.${key(e.toStatus)}`)}`}
                    {!e.isPublic && <span className="muted small"> · {t('detail.internal')}</span>}
                  </div>
                  {e.message && <div style={{ whiteSpace: 'pre-wrap' }}>{e.message}</div>}
                  <div className="when">{formatDate(e.at, lang, true)}{e.actor ? ` · ${e.actor.name}` : ''}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="stack">
          {p.canChangeStatus && (
            <Card title={t('detail.status.title')} icon="flag">
              {admin ? (
                <>
                  <Field label={t('detail.status.adminSet')} htmlFor="d-status" hint={t('detail.status.adminHint')}>
                    <select id="d-status" value={adminStatus} onChange={(e) => setAdminStatus(e.target.value as Status | '')}>
                      <option value="">{t('detail.status.choose')}</option>
                      {report.allowedStatuses.map((s) => <option key={s} value={s}>{t(`internalStatus.${key(s)}`)}</option>)}
                    </select>
                  </Field>
                  <Field
                    label={adminStatus === 'REJECTED' ? t('detail.reject.reason') : t('detail.status.note')}
                    htmlFor="d-status-note"
                    hint={adminStatus === 'REJECTED' ? t('detail.reject.hint') : t('detail.status.noteHint')}
                    required={adminStatus === 'REJECTED'}
                  >
                    <textarea id="d-status-note" value={statusNote} maxLength={2000} onChange={(e) => setStatusNote(e.target.value)} style={{ minHeight: 70 }} />
                  </Field>
                  {adminStatus !== 'REJECTED' && adminStatus !== 'RESOLVED' && (
                    <label className="check small" style={{ marginBottom: 12 }}>
                      <input type="checkbox" checked={publicNote} onChange={(e) => setPublicNote(e.target.checked)} />
                      <span>{t('detail.status.publicNote')}</span>
                    </label>
                  )}
                  <button
                    type="button" className="btn btn-block"
                    disabled={!adminStatus || Boolean(busy) || (adminStatus === 'REJECTED' && statusNote.trim().length < LIMITS.minRejectReason)}
                    onClick={async () => {
                      if (!adminStatus) return;
                      const ok = await act('status', () => call(changeStatusAction(id, statusPayload(adminStatus))), t('detail.status.changed'));
                      if (ok) { setAdminStatus(''); setStatusNote(''); }
                    }}
                  >
                    {busy === 'status' ? t('common.wait') : t('detail.status.apply')}
                  </button>
                </>
              ) : (
                quickStatuses.length > 0 && (
                  <>
                    <Field label={t('detail.status.note')} htmlFor="d-status-note" hint={t('detail.status.noteHint')}>
                      <textarea id="d-status-note" value={statusNote} maxLength={2000} onChange={(e) => setStatusNote(e.target.value)} style={{ minHeight: 70 }} />
                    </Field>
                    <label className="check small" style={{ marginBottom: 12 }}>
                      <input type="checkbox" checked={publicNote} onChange={(e) => setPublicNote(e.target.checked)} />
                      <span>{t('detail.status.publicNote')}</span>
                    </label>
                    <div className="stack-sm">
                      {quickStatuses.map((s) => {
                        const label = actionLabel(report.status, s);
                        return (
                          <button
                            key={s} type="button" className={`btn btn-block${['verified', 'assigned', 'in_progress'].includes(label) ? '' : ' btn-outline'}`} disabled={Boolean(busy)}
                            onClick={async () => {
                              const ok = await act(`status-${s}`, () => call(changeStatusAction(id, statusPayload(s))), t('detail.status.changed'));
                              if (ok) setStatusNote('');
                            }}
                          >
                            {t(`detail.status.to.${label}`)}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )
              )}
            </Card>
          )}

          {p.canResolve && (
            <Card title={t('detail.resolve.title')} icon="check">
              <Field label={t('detail.resolve.note')} htmlFor="d-resolve-note" hint={t('detail.resolve.hint')}>
                <textarea id="d-resolve-note" value={resolveNote} maxLength={2000} onChange={(e) => setResolveNote(e.target.value)} style={{ minHeight: 70 }} />
              </Field>
              <div className="label">{t('detail.resolve.photo')}</div>
              <PhotoInput value={afterPhoto} onChange={setAfterPhoto} idPrefix="after-photo" />
              <button
                type="button" className="btn btn-block" style={{ marginTop: 12 }} disabled={Boolean(busy)}
                onClick={async () => {
                  const ok = await act('resolve', async () => {
                    const photoKey = afterPhoto ? await uploadPhoto(afterPhoto) : undefined;
                    return call(resolveReportAction(id, { ...(resolveNote.trim() ? { note: resolveNote.trim() } : {}), ...(photoKey ? { photoKey } : {}) }));
                  }, t('detail.resolve.done'));
                  if (ok) { setResolveNote(''); setAfterPhoto(null); }
                }}
              >
                {busy === 'resolve' ? t('common.wait') : t('detail.resolve.submit')}
              </button>
            </Card>
          )}

          {report.status === 'RESOLVED' && <div className="alert alert-info small">{t('detail.resolve.waiting')}</div>}

          {p.canChangePriority && (
            <Card title={t('detail.priority.title')} icon="arrowUp">
              <Segmented<Priority>
                label={t('detail.priority.title')}
                value={report.priority}
                onChange={(v) => { if (v !== report.priority) void act('priority', () => call(changePriorityAction(id, { priority: v })), t('detail.priority.changed')); }}
                options={[
                  { value: 'LOW', label: t('priority.low'), icon: 'arrowDown', disabled: Boolean(busy) },
                  { value: 'MEDIUM', label: t('priority.medium'), icon: 'minus', disabled: Boolean(busy) },
                  { value: 'HIGH', label: t('priority.high'), icon: 'arrowUp', disabled: Boolean(busy) },
                ]}
              />
            </Card>
          )}

          {p.canAssign && (
            <Card title={t('detail.assign.title')} icon="user">
              <Field label={t('detail.assign.person')} htmlFor="d-assign">
                <select id="d-assign" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">{t('detail.assign.nobody')}</option>
                  {assignable.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role === 'ADMIN' ? ` (${t('roles.admin')})` : ''}</option>)}
                </select>
              </Field>
              {report.department && assignable.filter((a) => a.role !== 'ADMIN').length === 0 && <p className="hint">{t('detail.assign.noHeads')}</p>}
              <button
                type="button" className="btn btn-block btn-outline" disabled={Boolean(busy) || assignee === (report.assignedTo?.id ?? '')}
                onClick={() => act('assign', () => call(assignReportAction(id, { userId: assignee || null })), t('detail.assign.done'))}
              >
                {t('detail.assign.submit')}
              </button>
            </Card>
          )}

          {!admin && p.canRequestTransfer && (
            <Card title={t('detail.transfer.title')} icon="transfer">
              {!transferOpen ? (
                <>
                  <p className="small muted">{t('detail.transfer.intro')}</p>
                  <button type="button" className="btn btn-block btn-outline" onClick={() => setTransferOpen(true)}>{t('detail.transfer.open')}</button>
                </>
              ) : (
                <>
                  <Field label={t('detail.transfer.reason')} htmlFor="d-transfer-reason" hint={t('detail.transfer.reasonHint')} required>
                    <textarea id="d-transfer-reason" value={transferReason} maxLength={1000} onChange={(e) => setTransferReason(e.target.value)} />
                  </Field>
                  <Field label={t('detail.transfer.suggest')} htmlFor="d-transfer-sector" hint={t('detail.transfer.suggestHint')}>
                    <select id="d-transfer-sector" value={transferDepartment} onChange={(e) => setTransferDepartment(e.target.value)}>
                      <option value="">{t('detail.transfer.dontKnow')}</option>
                      {departments.filter((s) => s.id !== report.department?.id).map((s) => <option key={s.id} value={s.id}>{departmentName(s, lang)}</option>)}
                    </select>
                  </Field>
                  <div className="row">
                    <button
                      type="button" className="btn" disabled={Boolean(busy) || transferReason.trim().length < LIMITS.minTransferReason}
                      onClick={async () => {
                        const ok = await act('transfer', () => call(requestTransferAction(id, {
                          reason: transferReason.trim(), suggestedDepartmentId: transferDepartment ? Number(transferDepartment) : null,
                        })), t('detail.transfer.sent'));
                        if (ok) { setTransferOpen(false); setTransferReason(''); setTransferDepartment(''); }
                      }}
                    >
                      {busy === 'transfer' ? t('common.wait') : t('detail.transfer.submit')}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setTransferOpen(false)}>{t('common.cancel')}</button>
                  </div>
                  {transferReason.trim().length > 0 && transferReason.trim().length < LIMITS.minTransferReason && <p className="hint">{t('detail.transfer.tooShort')}</p>}
                </>
              )}
            </Card>
          )}

          {p.canReject && (
            <Card title={t('detail.reject.title')} icon="close">
              <Field label={t('detail.reject.reason')} htmlFor="d-reject" hint={t('detail.reject.hint')} required>
                <textarea id="d-reject" value={rejectReason} maxLength={1000} onChange={(e) => setRejectReason(e.target.value)} style={{ minHeight: 70 }} />
              </Field>
              <button
                type="button" className="btn btn-block btn-danger" disabled={Boolean(busy) || rejectReason.trim().length < LIMITS.minRejectReason}
                onClick={async () => {
                  if (!window.confirm(t('detail.reject.confirm'))) return;
                  const ok = await act('reject', () => call(rejectReportAction(id, { reason: rejectReason.trim() })), t('detail.reject.done'));
                  if (ok) setRejectReason('');
                }}
              >
                {t('detail.reject.submit')}
              </button>
            </Card>
          )}

          {admin && (
            <Card title={t('detail.edit.title')} icon="edit">
              {!edit ? (
                <button type="button" className="btn btn-block btn-outline" onClick={startEdit}>{t('detail.edit.open')}</button>
              ) : (
                <>
                  <Field label={t('detail.edit.type')} htmlFor="e-type" hint={t('detail.edit.typeHint')}>
                    <select id="e-type" value={edit.requestTypeId} onChange={(e) => {
                      const ty = typeById(e.target.value);
                      setEdit({ ...edit, requestTypeId: e.target.value, departmentId: ty?.departmentId ? String(ty.departmentId) : edit.departmentId });
                    }}>
                      {catalog.categories.map((c) => (
                        <optgroup key={c.code} label={lang === 'en' ? c.nameEn : c.nameSq}>
                          {c.types.map((ty) => <option key={ty.id} value={ty.id}>{lang === 'en' ? ty.nameEn : ty.nameSq}</option>)}
                        </optgroup>
                      ))}
                      {!types.some((ty) => String(ty.id) === edit.requestTypeId) && report.type && <option value={report.type.id}>{typeName(report.type, lang)}</option>}
                    </select>
                  </Field>
                  <Field label={t('detail.edit.sector')} htmlFor="e-sector">
                    <select id="e-sector" value={edit.departmentId} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })}>
                      <option value="">{t('panel.nav.unrouted')}</option>
                      {departments.map((s) => <option key={s.id} value={s.id}>{departmentName(s, lang)}</option>)}
                    </select>
                  </Field>
                  <Field label={t('detail.area')} htmlFor="e-area">
                    <select id="e-area" value={edit.neighbourhoodId} onChange={(e) => setEdit({ ...edit, neighbourhoodId: e.target.value })}>
                      <option value="">–</option>
                      {catalog.neighbourhoods.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t('detail.address')} htmlFor="e-address">
                    <input id="e-address" type="text" value={edit.address} maxLength={LIMITS.maxAddress} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
                  </Field>
                  <Field label={t('detail.description')} htmlFor="e-desc">
                    <textarea id="e-desc" value={edit.description} maxLength={LIMITS.maxDescription} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                  </Field>
                  {/* The pin: also for a report sent with a typed address, so it appears on the public map. The zone follows the pin. */}
                  <div className="field">
                    <span className="label">{t('detail.edit.pin')}</span>
                    <LocationPicker
                      value={edit.pin}
                      center={(() => { const z = catalog.neighbourhoods.find((n) => n.id === Number(edit.neighbourhoodId)); return z?.code ? zoneCenter(z.code) : null; })()}
                      onChange={(p) => {
                        const code = zoneCodeAt(p.latitude, p.longitude);
                        const zone = code ? catalog.neighbourhoods.find((n) => n.code === code) : undefined;
                        setEdit({ ...edit, pin: p, neighbourhoodId: zone ? String(zone.id) : edit.neighbourhoodId });
                      }}
                      outside={Boolean(edit.pin && !zoneCodeAt(edit.pin.latitude, edit.pin.longitude))}
                    />
                    <p className="hint">{t('detail.edit.pinHint')}</p>
                  </div>
                  <div className="row">
                    <button type="button" className="btn" disabled={Boolean(busy)} onClick={saveEdit}>{busy === 'edit' ? t('common.wait') : t('common.save')}</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</button>
                  </div>
                </>
              )}
            </Card>
          )}

          <Card title={t('detail.contact.title')} icon="phone">
            {report.anonymous ? <p className="muted">{t('detail.contact.anonymous')}</p> : (
              <dl className="kv">
                <dt>{t('detail.contact.name')}</dt><dd>{report.contact.name || '–'}</dd>
                <dt>{t('detail.contact.email')}</dt><dd>{report.contact.email ? <a href={`mailto:${report.contact.email}`}>{report.contact.email}</a> : '–'}</dd>
                <dt>{t('detail.contact.phone')}</dt><dd>{report.contact.phone ? <a href={`tel:${report.contact.phone.replace(/\s/g, '')}`}>{report.contact.phone}</a> : '–'}</dd>
              </dl>
            )}
          </Card>

          <Card title={t('detail.note.title')} icon="edit">
            <Field label={t('detail.note.label')} htmlFor="d-note" hint={t('detail.note.hint')}>
              <textarea id="d-note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} style={{ minHeight: 70 }} />
            </Field>
            <button type="button" className="btn btn-block btn-outline" disabled={Boolean(busy) || !note.trim()} onClick={async () => {
              const ok = await act('note', () => call(addNoteAction(id, { message: note.trim() })), t('detail.note.done'));
              if (ok) setNote('');
            }}>{t('detail.note.submit')}</button>
          </Card>

          {report.contact.email && (
            <Card title={t('detail.message.title')} icon="mail">
              <Field label={t('detail.message.label')} htmlFor="d-message" hint={t('detail.message.hint')}>
                <textarea id="d-message" value={message} maxLength={2000} onChange={(e) => setMessage(e.target.value)} style={{ minHeight: 70 }} />
              </Field>
              <button type="button" className="btn btn-block btn-outline" disabled={Boolean(busy) || !message.trim()} onClick={async () => {
                const ok = await act('message', () => call(messageCitizenAction(id, { message: message.trim() })), t('detail.message.done'));
                if (ok) setMessage('');
              }}>{t('detail.message.submit')}</button>
            </Card>
          )}

          {report.transfers.filter((tr) => tr.status !== 'PENDING').length > 0 && (
            <Card title={t('detail.transfer.history')} icon="transfer">
              <ul className="plain-list">
                {report.transfers.filter((tr) => tr.status !== 'PENDING').map((tr) => (
                  <li key={tr.id}>
                    <span className={`badge ${tr.status === 'APPROVED' ? 'status-closed' : 'status-rejected'}`}>{t(`transfers.statuses.${key(tr.status)}`)}</span>{' '}
                    <span className="small">{formatDate(tr.decidedAt ?? tr.createdAt, lang)} · {departmentName(tr.fromDepartment, lang)}{tr.toDepartment ? ` → ${departmentName(tr.toDepartment, lang)}` : ''}</span>
                    {tr.decisionNote && <div className="small muted">{tr.decisionNote}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {admin && (
            <Card title={t('detail.danger.title')} icon="alert" className="danger-zone">
              <label className="check small" style={{ marginBottom: 12 }}>
                <input type="checkbox" checked={report.isTest} disabled={Boolean(busy)} onChange={(e) => act('test', () => call(setTestFlagAction(id, { isTest: e.target.checked })), t('detail.saved'))} />
                <span>{t('detail.danger.markTest')}</span>
              </label>
              <button type="button" className="btn btn-block btn-danger" disabled={Boolean(busy)} onClick={removeReport}>
                <Icon name="trash" size={16} />{t('detail.danger.delete')}
              </button>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
