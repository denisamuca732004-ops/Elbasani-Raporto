-- The report page no longer has the "Edhe unë e kam këtë problem" button.
-- The starting answer that told residents to press it now says to open the
-- report and follow it. Only the starting text is replaced: an answer the
-- admin has edited stays as it is. No schema change.

UPDATE "guide_entries" SET "answer_sq" = 'Shkruani rrugën në këtë kuti ose shikoni hartën. Nëse e gjeni problemin, nuk ka nevojë ta raportoni përsëri: hapeni dhe ndiqni ecurinë e tij.', "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'already_reported' AND "answer_sq" = 'Shkruani rrugën në këtë kuti ose shikoni hartën. Nëse e gjeni problemin, hapeni dhe shtypni “Edhe unë e kam këtë problem”. Kështu Bashkia sheh sa qytetarë prek, pa raportime të dyfishta.';

UPDATE "guide_entries" SET "answer_en" = 'Type the street in this box or look at the map. If you find the problem, there is no need to report it again: open it and follow its progress.', "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'already_reported' AND "answer_en" = 'Type the street in this box or look at the map. If you find the problem, open it and press “I have this problem too”. This way the Municipality sees how many residents it affects, without duplicate reports.';
