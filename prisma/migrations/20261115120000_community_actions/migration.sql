-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('REVIEW', 'PUBLISHED', 'REJECTED', 'CLOSING', 'VERIFIED', 'NOT_VERIFIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrizeChoice" AS ENUM ('COFFEE', 'MARKET');

-- CreateTable
CREATE TABLE "community_actions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'REVIEW',
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "bring" VARCHAR(200),
    "place" VARCHAR(200) NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "minutes" INTEGER NOT NULL,
    "people_needed" INTEGER NOT NULL,
    "organizer_name" VARCHAR(40),
    "organizer_phone" VARCHAR(30) NOT NULL,
    "organizer_token_hash" VARCHAR(64) NOT NULL,
    "organizer_device" VARCHAR(64) NOT NULL,
    "join_secret" VARCHAR(64) NOT NULL,
    "lang" VARCHAR(2) NOT NULL DEFAULT 'sq',
    "push_endpoint" VARCHAR(600),
    "push_p256dh" VARCHAR(200),
    "push_auth" VARCHAR(100),
    "ai_safe" BOOLEAN,
    "ai_confidence" INTEGER,
    "ai_reason" VARCHAR(400),
    "ai_fixed" BOOLEAN,
    "ai_fixed_confidence" INTEGER,
    "review_reason" VARCHAR(400),
    "reject_reason" VARCHAR(500),
    "prize_amount" INTEGER,
    "prize_choice" "PrizeChoice",
    "prize_partner" VARCHAR(80),
    "prize_code" VARCHAR(16),
    "prize_held" BOOLEAN NOT NULL DEFAULT false,
    "prize_redeemed_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "community_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_participants" (
    "id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "device_ref" VARCHAR(64) NOT NULL,
    "name" VARCHAR(40),
    "meters" INTEGER NOT NULL,
    "lang" VARCHAR(2) NOT NULL DEFAULT 'sq',
    "push_endpoint" VARCHAR(600),
    "push_p256dh" VARCHAR(200),
    "push_auth" VARCHAR(100),
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_photos" (
    "id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'BEFORE',
    "storage_key" VARCHAR(300) NOT NULL,
    "storage_url" VARCHAR(600) NOT NULL,
    "mime" VARCHAR(60) NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_votes" (
    "id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "device_ref" VARCHAR(64) NOT NULL,
    "done" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_actions_code_key" ON "community_actions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "community_actions_prize_code_key" ON "community_actions"("prize_code");

-- CreateIndex
CREATE INDEX "community_actions_status_starts_at_idx" ON "community_actions"("status", "starts_at");

-- CreateIndex
CREATE INDEX "community_actions_organizer_phone_idx" ON "community_actions"("organizer_phone");

-- CreateIndex
CREATE INDEX "action_participants_device_ref_joined_at_idx" ON "action_participants"("device_ref", "joined_at");

-- CreateIndex
CREATE UNIQUE INDEX "action_participants_action_id_device_ref_key" ON "action_participants"("action_id", "device_ref");

-- CreateIndex
CREATE INDEX "action_photos_action_id_idx" ON "action_photos"("action_id");

-- CreateIndex
CREATE UNIQUE INDEX "action_votes_action_id_device_ref_key" ON "action_votes"("action_id", "device_ref");

-- AddForeignKey
ALTER TABLE "action_participants" ADD CONSTRAINT "action_participants_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "community_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_photos" ADD CONSTRAINT "action_photos_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "community_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_votes" ADD CONSTRAINT "action_votes_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "community_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
