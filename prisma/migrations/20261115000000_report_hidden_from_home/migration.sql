-- Admin: a report left out of "Rregulluar së fundmi" on the home page.
ALTER TABLE "reports" ADD COLUMN "hidden_from_home" BOOLEAN NOT NULL DEFAULT false;
