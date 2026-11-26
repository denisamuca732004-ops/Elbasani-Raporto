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
  /** The same problem was reported earlier: this report was joined to that one (follow it there). */
  mergedInto: string | null;
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
  /** The "after" photo (or, without one, the verified "before" photo); null when none is public. */
  photoUrl: string | null;
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
  /** Admin: left out of "Rregulluar së fundmi" on the home page. */
  hiddenFromHome: boolean;
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
  /** Probably the same problem as an earlier open report: waits here instead of going to the sector. */
  duplicate: DuplicateHint | null;
}

export interface DuplicateHint {
  id: string;
  caseNumber: string;
  typeNameSq: string;
  typeNameEn: string;
  address: string | null;
  /** Between the two pins; null when the match is the same typed address. */
  meters: number | null;
  createdAt: string;
  status: Status;
  supporters: number;
  /** The AI's comparison of the two photos; null without the AI or without an answer. */
  photos: { same: boolean; confidence: number; reason: string | null } | null;
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

export interface CatalogType { id: number; code: string; nameSq: string; nameEn: string; kind: RequestKind; departmentId: number | null; /** The municipality's deadline for this type, in days. */ slaDays: number }
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
    /** The public key for "Më njoftoni në këtë telefon" (browser push); null when notifications are off. */
    pushKey: string | null;
    /** "Ndihmo qytetin" is on (the report form may invite residents to fix small things themselves). */
    community: boolean;
  };
}

/** A place where the same kind of problem keeps being reported (lib/server/services/weeklySummary.ts). */
export interface RepeatPlace {
  typeNameSq: string; typeNameEn: string; place: string; count: number;
  /** The most recent report there (opens it in the panel), and up to 5 case numbers. */
  latestId: string; caseNumbers: string[]; latitude: number; longitude: number;
}

/* ─── "Ndihmo qytetin": actions residents organise themselves ─── */

export type ActionStatusName = 'REVIEW' | 'PUBLISHED' | 'REJECTED' | 'CLOSING' | 'VERIFIED' | 'NOT_VERIFIED' | 'CANCELLED';
export type PrizeChoiceName = 'COFFEE' | 'MARKET';

/** What anyone sees on the action's page. Never the organiser's phone. */
export interface PublicAction {
  code: string;
  status: ActionStatusName;
  title: string;
  description: string;
  bring: string | null;
  place: string;
  latitude: number;
  longitude: number;
  startsAt: string;
  minutes: number;
  peopleNeeded: number;
  organizerName: string | null;
  /** The organiser plus everyone who scanned the QR on the spot. */
  people: number;
  /** First names of those who scanned (only the ones who wrote one). */
  names: string[];
  beforePhotoUrl: string | null;
  afterPhotoUrl: string | null;
  /** Scanning is possible now (the action is public and it is around its time). */
  joinOpen: boolean;
  /** The full version: people confirm on the spot with the QR (and the group may get a reward). Off in the MVP. */
  checkIn: boolean;
  prize: { amount: number; choice: PrizeChoiceName | null; partner: string | null; held: boolean; redeemed: boolean } | null;
  /** Neighbours' answers to "A u bë vërtet?" after closing. */
  votes: { done: number; notDone: number };
  rejectReason: string | null;
  closedAt: string | null;
  verifiedAt: string | null;
}

export interface ActionCard {
  code: string; status: ActionStatusName; title: string; place: string; startsAt: string; minutes: number;
  peopleNeeded: number; people: number; photoUrl: string | null; prizeAmount: number | null;
}

/** The organiser's view (with the secret link): the QR, closing and the prize code. */
export interface OrganizerAction extends PublicAction {
  /** What the QR carries right now (changes every 30 seconds); null when scanning is closed. */
  joinToken: string | null;
  prizeCode: string | null;
  reviewReason: string | null;
}

export interface CommunitySettings {
  enabled: boolean;
  /** The full version: QR check-in on the spot, rewards, AI approval. Off: the staff approves and verifies each action. */
  rewards: boolean;
  /** Prize for the whole group by how many people took part (organiser included). */
  tiers: Array<{ minPeople: number; amount: number }>;
  coffeePartner: string;
  marketPartner: string;
  /** Lek per month for all prizes; when spent, actions are thanked without a prize. */
  monthlyBudget: number;
  /** Prizes of this value or more wait for a person's OK. */
  checkFrom: number;
  /** The partners' PIN for "Shëno si të përdorur" is set (the PIN itself is never sent). */
  hasPartnerPin: boolean;
}

/** A row of the admin's "Aksionet". */
export interface AdminActionItem extends PublicAction {
  id: string;
  organizerPhone: string;
  reviewReason: string | null;
  ai: { safe: boolean | null; confidence: number | null; reason: string | null; fixed: boolean | null; fixedConfidence: number | null };
  prizeCode: string | null;
  createdAt: string;
}

/** A reward's page for the partner (café or market). */
export interface PrizeView { code: string; actionCode: string; title: string; amount: number; choice: 'COFFEE' | 'MARKET'; partner: string; people: number; redeemedAt: string | null; held: boolean }
