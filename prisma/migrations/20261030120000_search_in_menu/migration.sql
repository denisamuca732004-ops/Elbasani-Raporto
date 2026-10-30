-- "Ndiq raportimin" and "Ndihmë" left the menu: a report number or a question is
-- typed in the search box at the top of the menu. The starting guide entries no
-- longer show a "Ndiq raportimin" button. Only the starting text is replaced: an
-- answer the admin has edited stays as it is. No schema change.

UPDATE "guide_entries" SET "action" = 'NONE', "updated_at" = CURRENT_TIMESTAMP
WHERE "code" IN ('how_long', 'track', 'statuses') AND "action" = 'TRACK';

UPDATE "guide_entries"
SET "answer_sq" = 'Shkruani numrin e raportimit (p.sh. EL-2026-00042) në kutinë e kërkimit, lart në menu. Hapet raportimi me statusin, sektorin dhe historikun. Nëse keni lënë email, ju njoftojmë në çdo hap.',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'track'
  AND "answer_sq" = 'Shkruani numrin e raportimit (p.sh. EL-2026-00042) në këtë kuti ose te “Ndiq raportimin”. Aty shihni statusin, sektorin dhe historikun. Nëse keni lënë email, ju njoftojmë në çdo hap.';

UPDATE "guide_entries"
SET "answer_en" = 'Type the report number (e.g. EL-2026-00042) in the search box at the top of the menu. The report opens with its status, the department and the history. If you left an email, we notify you at every step.',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'track'
  AND "answer_en" = 'Type the report number (e.g. EL-2026-00042) in this box or under “Track a report”. There you see the status, the department and the history. If you left an email, we notify you at every step.';
