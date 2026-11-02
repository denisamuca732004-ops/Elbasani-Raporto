-- The contact step is now a "Përfshi kontaktin" switch (off = anonymous), as on BOS:311.
-- The starting answer about anonymous reports says so. Only the starting text is
-- replaced: an answer the admin has edited stays as it is. No schema change.

UPDATE "guide_entries" SET "answer_sq" = $g$Po. Te hapi “Të dhënat e kontaktit” lëreni të fikur “Përfshi kontaktin”: raportimi dërgohet pa emër dhe pa telefon. Atëherë Bashkia nuk mund t’ju telefonojë nëse i duhen më shumë të dhëna, prandaj përshkruajeni problemin qartë dhe ruajeni numrin e raportimit për ta ndjekur.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'anonymous' AND "answer_sq" = $g$Po. Te hapi “Kontakti” zgjidhni “Anonim”. Atëherë Bashkia nuk mund t’ju telefonojë nëse i duhen më shumë të dhëna, prandaj përshkruajeni problemin qartë dhe ruajeni numrin e raportimit për ta ndjekur.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$Yes. At the “Contact information” step leave “Include contact” off: the report is sent without a name or phone. The Municipality then cannot call you if it needs more details, so describe the problem clearly and keep the report number to follow it.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'anonymous' AND "answer_en" = $g$Yes. At the “Contact” step choose “Anonymous”. The Municipality then cannot call you if it needs more details, so describe the problem clearly and keep the report number to follow it.$g$;
