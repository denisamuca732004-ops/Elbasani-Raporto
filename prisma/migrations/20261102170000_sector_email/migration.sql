-- Sectors that work by e-mail instead of the panel (for a Municipality without a
-- department head on the platform): each report is e-mailed to the sector with a link
-- where it marks "Po merremi" / "U zgjidh" or asks for a review ("Nuk është për ne").

ALTER TABLE "departments" ADD COLUMN "works_by_email" BOOLEAN NOT NULL DEFAULT false;
-- A sector that works by e-mail must have the address to send to.
ALTER TABLE "departments" ADD CONSTRAINT "departments_email_mode_has_email" CHECK (NOT "works_by_email" OR "email" IS NOT NULL);

ALTER TABLE "department_transfers" ADD COLUMN "requested_by_email" VARCHAR(200);

CREATE TABLE "report_links" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "department_id" INTEGER NOT NULL,
    "email" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    CONSTRAINT "report_links_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "report_links_report_id_idx" ON "report_links"("report_id");
CREATE INDEX "report_links_department_id_idx" ON "report_links"("department_id");
ALTER TABLE "report_links" ADD CONSTRAINT "report_links_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "report_links" ADD CONSTRAINT "report_links_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
