-- The name, phone and e-mail a resident left are deleted automatically
-- CONTACT_RETENTION_DAYS (90) after the report is closed or rejected (daily job).
-- This column records when that happened, so the panel can say so.
ALTER TABLE "reports" ADD COLUMN "contact_erased_at" TIMESTAMPTZ(3);
