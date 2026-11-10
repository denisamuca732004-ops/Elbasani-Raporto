-- The AI's comparison of the photos of a report held as a possible duplicate and of the earlier report.
ALTER TABLE "reports" ADD COLUMN "dup_photo_same" BOOLEAN;
ALTER TABLE "reports" ADD COLUMN "dup_photo_confidence" INTEGER;
ALTER TABLE "reports" ADD COLUMN "dup_photo_reason" VARCHAR(200);
