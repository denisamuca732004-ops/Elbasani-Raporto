/**
 * Shapes of the data the server sends to pages (DTOs). Dates are ISO strings,
 * so the same objects can be cached, sent through Server Actions and
 * rendered by client components. Never contains storage URLs or password data.
 */
import type {
  AttachmentKind, Channel, EventType, PanelRole, Priority, PublicStatus, RequestKind, Status, TransferStatus,
} from './domain';

export interface NamedRef { id: number; code: string; nameSq: string; nameEn: string }
export interface TypeRef extends NamedRef { kind: RequestKind }
export interface CategoryRef extends NamedRef { icon: string }
export interface PersonRef { id: string; name: string }

/** The signed-in municipal user, as loaded fresh from the database on every request. */
export interface Principal {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: PanelRole;
  departmentId: number | null;
  departmentNameSq: string | null;
  departmentNameEn: string | null;
  mustChangePassword: boolean;
}

/* ─── Public (no account) ─── */

export interface PublicTimelineItem { type: EventType; status: PublicStatus | null; message: string | null; at: string }

/** What anyone can see with the case number. Never contains contact details. */
export interface PublicCase {
  caseNumber: string;
  publicStatus: PublicStatus;
  kind: RequestKind;
  category: CategoryRef | null;
  type: TypeRef | null;
  description: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  neighbourhood: string | null;
  departmentSq: string | null;
  departmentEn: string | null;
  beforePhotoUrl: string | null;
  afterPhotoUrl: string | null;
  closingNote: string | null;
  rejectionReason: string | null;
  supporters: number;
  isTest: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  timeline: PublicTimelineItem[];
}

export interface PublicCard {
  caseNumber: string;
  publicStatus: PublicStatus;
  category: CategoryRef | null;
  type: TypeRef | null;
  address: string | null;
  neighbourhood: string | null;
  latitude: number | null;
  longitude: number | null;
  photoUrl: string | null;
  supporters: number;
  createdAt: string;
  distanceMeters: number | null;
  isTest: boolean;
}

export interface MapPoint {
  caseNumber: string;
  publicStatus: PublicStatus;
  latitude: number;
  longitude: number;
  categoryCode: string | null;
  icon: string | null;
  typeNameSq: string | null;
  typeNameEn: string | null;
  isTest: boolean;
  createdAt: string;
}

/* ─── Staff ─── */

export interface TransferSummary {
  id: string;
  status: TransferStatus;
  reason: string;
  fromDepartment: NamedRef | null;
  suggestedDepartment: NamedRef | null;
  toDepartment: NamedRef | null;
  requestedBy: PersonRef | null;
  decidedBy: PersonRef | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface TransferListItem extends TransferSummary {
  report: { id: string; caseNumber: string; status: Status; priority: Priority; type: TypeRef | null; address: string | null; description: string | null };
}

/** A row in a report list. */
export interface ReportListItem {
  id: string;
  caseNumber: string;
  status: Status;
  publicStatus: PublicStatus;
  priority: Priority;
  channel: Channel;
  kind: RequestKind;
  type: TypeRef | null;
  category: CategoryRef | null;
  department: NamedRef | null;
  neighbourhood: string | null;
  address: string | null;
  aiSummary: string | null;
  assignedTo: PersonRef | null;
  supporters: number;
  dueAt: string | null;
  overdue: boolean;
  transferPending: boolean;
  isTest: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportAttachment { id: string; kind: AttachmentKind; isPublic: boolean; url: string; width: number | null; height: number | null; createdAt: string }

export interface ReportEventItem {
  id: string;
  type: EventType;
  fromStatus: Status | null;
  toStatus: Status | null;
  message: string | null;
  isPublic: boolean;
  actor: PersonRef | null;
  meta: Record<string, unknown> | null;
  at: string;
}

export interface ReportPermissions {
  canEditDetails: boolean;
  canChangeStatus: boolean;
  canSetAnyStatus: boolean;
  canAssign: boolean;
  canChangePriority: boolean;
  canRequestTransfer: boolean;
  canResolve: boolean;
  canReject: boolean;
  canDelete: boolean;
}

/** The full report for municipal staff. */
export interface ReportDetail extends ReportListItem {
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  neighbourhoodId: number | null;
  departmentId: number | null;
  requestTypeId: number;
  anonymous: boolean;
  contact: { name: string | null; email: string | null; phone: string | null; wantsUpdates: boolean };
  ai: {
    status: string;
    summary: string | null;
    confidence: number | null;
    privacyIssue: boolean;
    suggestedType: TypeRef | null;
    suggestedPriority: Priority | null;
    reason: string | null;
    closingFixed: boolean | null;
    closingConfidence: number | null;
  };
  rejectionReason: string | null;
  closingNote: string | null;
  citizenRating: number | null;
  citizenComment: string | null;
  reopenCount: number;
  verifiedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdBy: PersonRef | null;
  allowedStatuses: Status[];
  permissions: ReportPermissions;
  pendingTransfer: TransferSummary | null;
  transfers: TransferSummary[];
  attachments: ReportAttachment[];
  events: ReportEventItem[];
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; pages: number }

/* ─── Catalogue and settings (public) ─── */

export interface CatalogType { id: number; code: string; nameSq: string; nameEn: string; kind: RequestKind; departmentId: number | null }
export interface CatalogCategory { id: number; code: string; icon: string; nameSq: string; nameEn: string; types: CatalogType[] }
export interface Catalog {
  categories: CatalogCategory[];
  neighbourhoods: Array<{ id: number; name: string }>;
  departments: Array<{ id: number; code: string; nameSq: string; nameEn: string; description: string | null }>;
}

export interface Branding { municipalityName: string; appName: string; logoUrl: string; headerColor: string; footerColor: string; buttonColor: string }
export interface AppSettings { branding: Branding; embed: { allowedOrigins: string[] } }
export interface PublicSettings extends AppSettings {
  rules: { serviceArea: { minLat: number; minLng: number; maxLat: number; maxLng: number }; minDescription: number; minAddress: number; maxUploadBytes: number };
}
