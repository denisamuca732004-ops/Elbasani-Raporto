-- The search box of the menu became the help chat (bottom right), and "Ndiq raportimin"
-- now also finds a report by date, zone, category, or name and phone. The starting answers
-- that spoke of the search box say so, and the two about following a report get the
-- "Ndiq raportimin" button again. A report now starts only from a category (no "Raporto një
-- problem" button), so the answer about reporting says so. Only unedited starting values are
-- changed. No schema change.

UPDATE "guide_entries" SET "answer_sq" = $g$Shtypni “Ndiq raportimin” në faqen kryesore dhe shkruani numrin e raportimit (p.sh. EL-2026-00042), ose shkruajeni këtu në chat. Hapet raportimi me statusin, sektorin dhe historikun.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'track' AND "answer_sq" = $g$Shkruani numrin e raportimit (p.sh. EL-2026-00042) në kutinë e kërkimit, lart në menu. Hapet raportimi me statusin, sektorin dhe historikun.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$Press “Track a report” on the home page and type the report number (e.g. EL-2026-00042), or type it here in the chat. The report opens with its status, the department and the history.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'track' AND "answer_en" = $g$Type the report number (e.g. EL-2026-00042) in the search box at the top of the menu. The report opens with its status, the department and the history.$g$;

UPDATE "guide_entries" SET "answer_sq" = $g$Shkruani rrugën këtu në chat ose shikoni hartën. Nëse e gjeni problemin, nuk ka nevojë ta raportoni përsëri: hapeni dhe ndiqni ecurinë e tij.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'already_reported' AND "answer_sq" = $g$Shkruani rrugën në këtë kuti ose shikoni hartën. Nëse e gjeni problemin, nuk ka nevojë ta raportoni përsëri: hapeni dhe ndiqni ecurinë e tij.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$Type the street here in the chat or look at the map. If you find the problem, there is no need to report it again: open it and follow its progress.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'already_reported' AND "answer_en" = $g$Type the street in this box or look at the map. If you find the problem, there is no need to report it again: open it and follow its progress.$g$;

UPDATE "guide_entries" SET "answer_sq" = $g$Te “Ndiq raportimin” kërkojeni sipas datës kur e raportuat, zonës ose kategorisë, ose me emrin dhe numrin e telefonit që keni lënë. Herën tjetër kopjojeni numrin ose bëni një screenshot të ekranit të fundit.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'lost_number' AND "answer_sq" = $g$Shkruani rrugën në këtë kuti ose kërkojeni në hartë: raportimet e verifikuara shfaqen aty me numrin e tyre. Herën tjetër kopjojeni numrin ose bëni një screenshot të ekranit të fundit.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$Under “Track a report”, look for it by the date you reported it, the area or the category, or with the name and phone number you left. Next time, copy the number or take a screenshot of the last screen.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'lost_number' AND "answer_en" = $g$Type the street in this box or look on the map: verified reports are shown there with their number. Next time, copy the number or take a screenshot of the last screen.$g$;

UPDATE "guide_entries" SET "action" = 'TRACK', "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'track' AND "action" = 'NONE';

UPDATE "guide_entries" SET "action" = 'TRACK', "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'lost_number' AND "action" = 'MAP';

UPDATE "guide_entries" SET "answer_sq" = $g$Zgjidhni kategorinë e problemit në faqen kryesore dhe ndiqni 6 hapat: lloji i problemit, vendi në hartë, fotoja, përshkrimi, kontakti (ose anonim) dhe kontrolli. Në fund merrni një numër raportimi, p.sh. EL-2026-00042, me të cilin e ndiqni.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'how_to_report' AND "answer_sq" = $g$Shtypni “Raporto një problem” dhe ndiqni 6 hapat: lloji i problemit, vendi në hartë, fotoja, përshkrimi, kontakti (ose anonim) dhe kontrolli. Në fund merrni një numër raportimi, p.sh. EL-2026-00042, me të cilin e ndiqni.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$Choose the category of the problem on the home page and follow the 6 steps: type of problem, place on the map, photo, description, contact (or anonymous) and review. At the end you get a report number, e.g. EL-2026-00042, to follow it.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'how_to_report' AND "answer_en" = $g$Press “Report a problem” and follow the 6 steps: type of problem, place on the map, photo, description, contact (or anonymous) and review. At the end you get a report number, e.g. EL-2026-00042, to follow it.$g$;
