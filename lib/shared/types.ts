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
  /** The point was worked out from a typed address (lagje / village / zone), not given on the map. */
  locationApproximate: boolean;
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

/** A report the municipality fixed, for "Rregulluar së fundmi" on the home page. */
export interface FixedReport {
  caseNumber: string;
  category: CategoryRef | null;
  type: TypeRef | null;
  place: string | null;
  resolvedAt: string;
  /** The municipality's note for the resident ("Shënimi i Bashkisë"), public on the report's page too. */
  note: string | null;
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
  /** Worked out from a typed address: drawn as an approximate point. */
  approximate: boolean;
  /** The zone (administrative unit) and the place as the resident wrote it (contacts masked). */
  zoneId: number | null;
  place: string | null;
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
  /** Asked from the e-mail link of a sector without an account (no person). */
  requestedByEmail: string | null;
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

export interface SectorMailStatus { status: 'QUEUED' | 'SENDING' | 'LOGGED' | 'SENT' | 'FAILED'; at: string; error: string | null }

/** A row of the admin's board: the list item, plus where it was sent and why it came back. */
export interface BoardItem extends ReportListItem {
  departmentEmail: string | null;
  /** The e-mail to the sector (the working link): when it was sent, reminded, opened. */
  sent: { email: string; sentAt: string; remindedAt: string | null; lastUsedAt: string | null; expiresAt: string } | null;
  /** The sector's "Nuk mund ta trajtojmë", waiting for the admin. */
  returned: TransferSummary | null;
  /** The last e-mail to the sector about it (report or reminder): did it really leave? LOGGED = SMTP is not set up. */
  mail: SectorMailStatus | null;
  /** When the sector pressed "E pranojmë" (the report went "Në punë"). */
  acceptedAt: string | null;
  closingNote: string | null;
  rejectionReason: string | null;
  resolvedAt: string | null;
}

export interface Board {
  bucket: string;
  counts: Record<string, number>;
  /** How many reports of each priority are in this column (the groups "E lartë / Mesatare / E ulët"). */
  byPriority: Record<string, number>;
  items: BoardItem[];
  total: number;
  page: number;
  pages: number;
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
  /** The point was worked out from a typed address (lagje / village / zone), not given on the map. */
  locationApproximate: boolean;
  neighbourhoodId: number | null;
  departmentId: number | null;
  requestTypeId: number;
  anonymous: boolean;
  /** erasedAt: when the daily job deleted the contact (CONTACT_RETENTION_DAYS after closing). */
  contact: { name: string | null; email: string | null; phone: string | null; wantsUpdates: boolean; erasedAt: string | null };
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
  /**
   * The report's sector works by e-mail (no panel account): where and when its link was sent, and
   * when the sector last used it. url: only for the admin ("Hap faqen e sektorit").
   */
  sectorMail: {
    email: string | null; sentAt: string | null; expiresAt: string | null; lastUsedAt: string | null; url: string | null;
    mail: SectorMailStatus | null; acceptedAt: string | null;
  } | null;
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
  /**
   * Active zones; `code` links a zone to its border, `localities` are its lagje or villages (active only, A–Z),
   * with their point when known (the "Vendndodhja" search of the report form).
   */
  neighbourhoods: Array<{ id: number; name: string; code: string | null; localities: Array<{ id: number; name: string; latitude: number | null; longitude: number | null }> }>;
  departments: Array<{ id: number; code: string; nameSq: string; nameEn: string; description: string | null }>;
}

/** Who is looking at the public site: a signed-in staff member, or anyone else (residents have no accounts). */
export type Viewer = { kind: 'staff'; name: string } | null;

/** The names exist in Albanian and English: the site shows the ones of the visitor's language (lib/shared/branding.ts). */
export interface Branding {
  municipalityName: string; appName: string; municipalityNameEn: string; appNameEn: string;
  logoUrl: string; headerColor: string; footerColor: string; buttonColor: string;
}
export interface AppSettings { branding: Branding; embed: { allowedOrigins: string[] } }
export interface PublicSettings extends AppSettings {
  rules: {
    serviceArea: { minLat: number; minLng: number; maxLat: number; maxLng: number }; minDescription: number; minAddress: number; maxUploadBytes: number;
    /** The photo and the description are checked by the AI while the report is created (the AI is on). */
    aiChecks: boolean;
  };
}
