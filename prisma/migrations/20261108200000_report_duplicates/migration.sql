-- The same problem reported by several people: a new report that is probably a duplicate of an
-- open one nearby waits for the admin; merged reports point to the report they joined.
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'DUPLICATE_SUSPECTED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'DUPLICATE_MERGED';
ALTER TYPE "EventType" ADD VALUE IF NOT EXISTS 'DUPLICATE_DISMISSED';

ALTER TABLE "reports" ADD COLUMN "possible_duplicate_of_id" UUID;
ALTER TABLE "reports" ADD COLUMN "merged_into_id" UUID;

CREATE INDEX "reports_possible_duplicate_of_id_idx" ON "reports"("possible_duplicate_of_id");
CREATE INDEX "reports_merged_into_id_idx" ON "reports"("merged_into_id");

ALTER TABLE "reports" ADD CONSTRAINT "reports_possible_duplicate_of_id_fkey" FOREIGN KEY ("possible_duplicate_of_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
