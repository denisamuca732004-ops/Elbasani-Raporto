-- Sectors work only by e-mail: no sector accounts and no sector panel.
--  * Every sector with an e-mail address receives its reports by e-mail (automatically).
--  * The accounts of department heads stop working (deactivated, not deleted: the admin can
--    still see them at /admin/users) and their open sessions end.
--  * report_links.reminded_at: when the sector was last reminded of a report it has not
--    answered (a reminder every 48 hours until it accepts it or says it is not theirs).

UPDATE "departments" SET "works_by_email" = ("email" IS NOT NULL AND btrim("email") <> '');

UPDATE "users" SET "active" = false, "session_version" = "session_version" + 1
WHERE "role" = 'MUNICIPALITY_STAFF' AND "active" = true;

ALTER TABLE "report_links" ADD COLUMN "reminded_at" TIMESTAMPTZ(3);
