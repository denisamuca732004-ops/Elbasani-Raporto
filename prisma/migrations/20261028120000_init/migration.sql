-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'MUNICIPALITY_STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'NEEDS_REVIEW', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "RequestKind" AS ENUM ('PROBLEM', 'SERVICE');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WEB', 'APP', 'EMBED', 'IN_PERSON', 'PHONE', 'FACEBOOK', 'EMAIL');

-- CreateEnum
CREATE TYPE "AiStatus" AS ENUM ('PENDING', 'DONE', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('BEFORE', 'AFTER');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'ROUTING_CHANGED', 'PRIORITY_CHANGED', 'DETAILS_UPDATED', 'AI_TRIAGE', 'AI_CLOSING_CHECK', 'NOTE', 'MESSAGE_TO_CITIZEN', 'FOLLOWER_ADDED', 'CITIZEN_CONFIRMED', 'CITIZEN_REOPENED', 'PHOTO_VISIBILITY', 'TRANSFER_REQUESTED', 'TRANSFER_APPROVED', 'TRANSFER_DECLINED');

-- CreateEnum
CREATE TYPE "MailStatus" AS ENUM ('QUEUED', 'SENDING', 'LOGGED', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(40),
    "password_hash" VARCHAR(200) NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "department_id" INTEGER,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "password_changed_at" TIMESTAMPTZ(3),
    "session_version" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name_sq" VARCHAR(160) NOT NULL,
    "name_en" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "email" VARCHAR(200),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name_sq" VARCHAR(160) NOT NULL,
    "name_en" VARCHAR(160) NOT NULL,
    "icon" VARCHAR(40) NOT NULL DEFAULT 'other',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_types" (
    "id" SERIAL NOT NULL,
    "category_id" INTEGER NOT NULL,
    "department_id" INTEGER,
    "code" VARCHAR(80) NOT NULL,
    "name_sq" VARCHAR(160) NOT NULL,
    "name_en" VARCHAR(160) NOT NULL,
    "kind" "RequestKind" NOT NULL DEFAULT 'PROBLEM',
    "sla_days" INTEGER NOT NULL DEFAULT 10,
    "default_priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "keywords" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "request_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neighbourhoods" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "neighbourhoods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_counters" (
    "year" INTEGER NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "case_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "case_number" VARCHAR(32) NOT NULL,
    "request_type_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,
    "department_id" INTEGER,
    "neighbourhood_id" INTEGER,
    "kind" "RequestKind" NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "channel" "Channel" NOT NULL DEFAULT 'WEB',
    "description" TEXT,
    "address" VARCHAR(300),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "contact_name" VARCHAR(160),
    "contact_email" VARCHAR(200),
    "contact_phone" VARCHAR(40),
    "wants_updates" BOOLEAN NOT NULL DEFAULT false,
    "assigned_to_id" UUID,
    "created_by_id" UUID,
    "ai_status" "AiStatus" NOT NULL DEFAULT 'PENDING',
    "ai_summary" VARCHAR(300),
    "ai_confidence" INTEGER,
    "ai_privacy_issue" BOOLEAN NOT NULL DEFAULT false,
    "ai_suggested_type_id" INTEGER,
    "ai_suggested_priority" "Priority",
    "ai_reason" TEXT,
    "rejection_reason" TEXT,
    "closing_note" TEXT,
    "closing_ai_fixed" BOOLEAN,
    "closing_ai_confidence" INTEGER,
    "citizen_token_hash" VARCHAR(128),
    "citizen_rating" INTEGER,
    "citizen_comment" TEXT,
    "supporters_count" INTEGER NOT NULL DEFAULT 0,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "due_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "is_test" BOOLEAN NOT NULL DEFAULT false,
    "client_ref" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'BEFORE',
    "storage_key" VARCHAR(300) NOT NULL,
    "storage_url" VARCHAR(600) NOT NULL,
    "mime" VARCHAR(60) NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_events" (
    "id" BIGSERIAL NOT NULL,
    "report_id" UUID NOT NULL,
    "type" "EventType" NOT NULL,
    "from_status" "ReportStatus",
    "to_status" "ReportStatus",
    "message" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "actor_id" UUID,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_followers" (
    "id" SERIAL NOT NULL,
    "report_id" UUID NOT NULL,
    "email" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_followers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_transfers" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "pending_report_id" UUID,
    "from_department_id" INTEGER NOT NULL,
    "suggested_department_id" INTEGER,
    "to_department_id" INTEGER,
    "reason" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID,
    "decided_by_id" UUID,
    "decision_note" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "department_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" BIGSERIAL NOT NULL,
    "to_address" VARCHAR(200) NOT NULL,
    "subject" VARCHAR(300) NOT NULL,
    "body_text" TEXT NOT NULL,
    "template" VARCHAR(60),
    "report_id" UUID,
    "status" "MailStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_results" (
    "id" BIGSERIAL NOT NULL,
    "cache_key" VARCHAR(128) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "model" VARCHAR(80),
    "output" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_active_idx" ON "users"("role", "active");

-- CreateIndex
CREATE INDEX "users_department_id_idx" ON "users"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE UNIQUE INDEX "categories_code_key" ON "categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "request_types_code_key" ON "request_types"("code");

-- CreateIndex
CREATE INDEX "request_types_category_id_idx" ON "request_types"("category_id");

-- CreateIndex
CREATE INDEX "request_types_department_id_idx" ON "request_types"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "neighbourhoods_name_key" ON "neighbourhoods"("name");

-- CreateIndex
CREATE UNIQUE INDEX "reports_case_number_key" ON "reports"("case_number");

-- CreateIndex
CREATE UNIQUE INDEX "reports_citizen_token_hash_key" ON "reports"("citizen_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "reports_client_ref_key" ON "reports"("client_ref");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_department_id_status_idx" ON "reports"("department_id", "status");

-- CreateIndex
CREATE INDEX "reports_priority_idx" ON "reports"("priority");

-- CreateIndex
CREATE INDEX "reports_category_id_idx" ON "reports"("category_id");

-- CreateIndex
CREATE INDEX "reports_created_at_idx" ON "reports"("created_at");

-- CreateIndex
CREATE INDEX "reports_resolved_at_idx" ON "reports"("resolved_at");

-- CreateIndex
CREATE INDEX "reports_latitude_longitude_idx" ON "reports"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "reports_is_test_idx" ON "reports"("is_test");

-- CreateIndex
CREATE INDEX "attachments_report_id_idx" ON "attachments"("report_id");

-- CreateIndex
CREATE INDEX "report_events_report_id_created_at_idx" ON "report_events"("report_id", "created_at");

-- CreateIndex
CREATE INDEX "report_followers_report_id_idx" ON "report_followers"("report_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_transfers_pending_report_id_key" ON "department_transfers"("pending_report_id");

-- CreateIndex
CREATE INDEX "department_transfers_status_created_at_idx" ON "department_transfers"("status", "created_at");

-- CreateIndex
CREATE INDEX "department_transfers_from_department_id_idx" ON "department_transfers"("from_department_id");

-- CreateIndex
CREATE INDEX "department_transfers_report_id_idx" ON "department_transfers"("report_id");

-- CreateIndex
CREATE INDEX "email_logs_created_at_idx" ON "email_logs"("created_at");

-- CreateIndex
CREATE INDEX "email_logs_report_id_idx" ON "email_logs"("report_id");

-- CreateIndex
CREATE INDEX "email_logs_status_idx" ON "email_logs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ai_results_cache_key_key" ON "ai_results"("cache_key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_request_type_id_fkey" FOREIGN KEY ("request_type_id") REFERENCES "request_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_neighbourhood_id_fkey" FOREIGN KEY ("neighbourhood_id") REFERENCES "neighbourhoods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_ai_suggested_type_id_fkey" FOREIGN KEY ("ai_suggested_type_id") REFERENCES "request_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_followers" ADD CONSTRAINT "report_followers_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_transfers" ADD CONSTRAINT "department_transfers_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_transfers" ADD CONSTRAINT "department_transfers_from_department_id_fkey" FOREIGN KEY ("from_department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_transfers" ADD CONSTRAINT "department_transfers_suggested_department_id_fkey" FOREIGN KEY ("suggested_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_transfers" ADD CONSTRAINT "department_transfers_to_department_id_fkey" FOREIGN KEY ("to_department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_transfers" ADD CONSTRAINT "department_transfers_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_transfers" ADD CONSTRAINT "department_transfers_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_logs" ADD CONSTRAINT "email_logs_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- CHECK constraints: rules that schema.prisma cannot express.
-- Prisma Migrate keeps them as they are in later migrations.
-- ─────────────────────────────────────────────────────────────────────────

-- A department head always belongs to exactly one department, and the other roles never do.
ALTER TABLE "users" ADD CONSTRAINT "users_department_matches_role"
  CHECK (("role" = 'MUNICIPALITY_STAFF') = ("department_id" IS NOT NULL));

-- Emails are stored in lower case, so the unique index is case-insensitive.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase" CHECK ("email" = lower("email"));

-- Only one open "not our department" request per report: pending_report_id is unique,
-- equals report_id while the request is open, and is empty once it is decided.
ALTER TABLE "department_transfers" ADD CONSTRAINT "department_transfers_pending_consistent" CHECK (
  (("status" = 'PENDING') = ("pending_report_id" IS NOT NULL))
  AND ("pending_report_id" IS NULL OR "pending_report_id" = "report_id")
  AND (("status" = 'PENDING') = ("decided_at" IS NULL))
);

-- A rejected report always tells the resident why.
ALTER TABLE "reports" ADD CONSTRAINT "reports_rejection_has_reason"
  CHECK ("status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL);

-- Values that can never be valid.
ALTER TABLE "reports" ADD CONSTRAINT "reports_values_in_range" CHECK (
  ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90)
  AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
  AND ("citizen_rating" IS NULL OR "citizen_rating" BETWEEN 1 AND 5)
  AND ("ai_confidence" IS NULL OR "ai_confidence" BETWEEN 0 AND 100)
  AND ("closing_ai_confidence" IS NULL OR "closing_ai_confidence" BETWEEN 0 AND 100)
  AND "supporters_count" >= 0 AND "reopen_count" >= 0
);
ALTER TABLE "request_types" ADD CONSTRAINT "request_types_sla_days_range" CHECK ("sla_days" BETWEEN 1 AND 365);
