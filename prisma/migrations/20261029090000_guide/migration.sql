-- "Ask or search": the questions and answers of the home search box and the Help page.

-- CreateEnum
CREATE TYPE "GuideAction" AS ENUM ('NONE', 'REPORT', 'TRACK', 'MAP', 'STATS', 'PRIVACY', 'CALL_112');

-- CreateTable
CREATE TABLE "guide_entries" (
    "id" SERIAL NOT NULL,
    "code" VARCHAR(60),
    "question_sq" VARCHAR(200) NOT NULL,
    "question_en" VARCHAR(200) NOT NULL,
    "answer_sq" TEXT NOT NULL,
    "answer_en" TEXT NOT NULL,
    "keywords" TEXT,
    "action" "GuideAction" NOT NULL DEFAULT 'NONE',
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "guide_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guide_entries_code_key" ON "guide_entries"("code");

-- CreateIndex
CREATE INDEX "guide_entries_active_sort_order_idx" ON "guide_entries"("active", "sort_order");

-- The same limits as the admin form (lib/validation/admin.ts), so no other path can store an empty or huge answer.
ALTER TABLE "guide_entries" ADD CONSTRAINT "guide_entries_lengths" CHECK (
  char_length("question_sq") >= 5 AND char_length("question_en") >= 5
  AND char_length("answer_sq") BETWEEN 10 AND 1500
  AND char_length("answer_en") BETWEEN 10 AND 1500
  AND ("keywords" IS NULL OR char_length("keywords") <= 500)
  AND "sort_order" BETWEEN 0 AND 9999
);
