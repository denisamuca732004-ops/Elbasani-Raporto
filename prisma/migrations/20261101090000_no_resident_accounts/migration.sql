-- Residents have no accounts and leave no e-mail any more: the public site is only
-- for reporting (anonymous, or a name and phone number). The starting answers of
-- the search guide that spoke of accounts or e-mails are reworded. Only the starting
-- text is replaced: an answer the admin has edited stays as it is.
-- No schema change and no data deleted (old resident accounts stay, but cannot sign in).

UPDATE "guide_entries" SET "answer_sq" = $g$Jo. Emri dhe numri i telefonit nuk publikohen kurrë; i sheh vetëm stafi i Bashkisë që trajton raportimin. Fotoja publikohet pa të dhënat e fshehura (GPS, pajisja), dhe fotot me fytyra ose targa fshihen nga publiku.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'privacy' AND "answer_sq" = $g$Jo. Emri, emaili dhe telefoni juaj nuk publikohen kurrë; i sheh vetëm stafi i Bashkisë që trajton raportimin. Fotoja publikohet pa të dhënat e fshehura (GPS, pajisja), dhe fotot me fytyra ose targa fshihen nga publiku.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$No. Your name and phone number are never published; only the municipal staff handling the report see them. The photo is published without its hidden data (GPS, device), and photos showing faces or number plates are hidden from the public.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'privacy' AND "answer_en" = $g$No. Your name, email and phone are never published; only the municipal staff handling the report see them. The photo is published without its hidden data (GPS, device), and photos showing faces or number plates are hidden from the public.$g$;

UPDATE "guide_entries" SET "answer_sq" = $g$Jo. Raportoni pa llogari, pa email, pa fjalëkalim dhe falas. Ruani numrin e raportimit që merrni në fund: me të e ndiqni raportimin në çdo kohë.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'account' AND "answer_sq" = $g$Jo. Raportoni pa llogari, pa fjalëkalim dhe falas. Ruani numrin e raportimit që merrni në fund: me të e ndiqni raportimin në çdo kohë.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$No. You report without an account, email or password, free of charge. Keep the report number you get at the end: with it you can follow the report at any time.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'account' AND "answer_en" = $g$No. You report without an account or password, free of charge. Keep the report number you get at the end: with it you can follow the report at any time.$g$;

UPDATE "guide_entries" SET "answer_sq" = $g$Shkruani numrin e raportimit (p.sh. EL-2026-00042) në kutinë e kërkimit, lart në menu. Hapet raportimi me statusin, sektorin dhe historikun.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'track' AND "answer_sq" = $g$Shkruani numrin e raportimit (p.sh. EL-2026-00042) në kutinë e kërkimit, lart në menu. Hapet raportimi me statusin, sektorin dhe historikun. Nëse keni lënë email, ju njoftojmë në çdo hap.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$Type the report number (e.g. EL-2026-00042) in the search box at the top of the menu. The report opens with its status, the department and the history.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'track' AND "answer_en" = $g$Type the report number (e.g. EL-2026-00042) in the search box at the top of the menu. The report opens with its status, the department and the history. If you left an email, we notify you at every step.$g$;

UPDATE "guide_entries" SET "answer_sq" = $g$Marrë: raportimi u regjistrua dhe po kontrollohet.
Hapur: u verifikua dhe e ka marrë sektori përgjegjës.
Në punë: ekipi po punon për zgjidhjen.
Zgjidhur: Bashkia thotë se u rregullua; nëse nuk është, raportojeni përsëri.
Mbyllur: përfundoi.
Refuzuar: nuk mund të trajtohet; arsyeja shkruhet te raportimi.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'statuses' AND "answer_sq" = $g$Marrë: raportimi u regjistrua dhe po kontrollohet.
Hapur: u verifikua dhe e ka marrë sektori përgjegjës.
Në punë: ekipi po punon për zgjidhjen.
Zgjidhur: Bashkia thotë se u rregullua; mund ta konfirmoni ose ta rihapni.
Mbyllur: përfundoi.
Refuzuar: nuk mund të trajtohet; arsyeja shkruhet te raportimi.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$Received: the report was registered and is being checked.
Open: verified and taken by the responsible department.
In progress: the team is working on it.
Resolved: the Municipality says it is fixed; if it is not, report it again.
Closed: finished.
Rejected: it cannot be handled; the reason is written on the report.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'statuses' AND "answer_en" = $g$Received: the report was registered and is being checked.
Open: verified and taken by the responsible department.
In progress: the team is working on it.
Resolved: the Municipality says it is fixed; you can confirm or reopen it.
Closed: finished.
Rejected: it cannot be handled; the reason is written on the report.$g$;

UPDATE "guide_entries" SET "answer_sq" = $g$Po. Te hapi “Kontakti” zgjidhni “Anonim”. Atëherë Bashkia nuk mund t’ju telefonojë nëse i duhen më shumë të dhëna, prandaj përshkruajeni problemin qartë dhe ruajeni numrin e raportimit për ta ndjekur.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'anonymous' AND "answer_sq" = $g$Po. Te hapi “Kontakti” zgjidhni “Anonim”. Atëherë nuk mund t’ju njoftojmë, prandaj ruajeni numrin e raportimit për ta ndjekur vetë.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$Yes. At the “Contact” step choose “Anonymous”. The Municipality then cannot call you if it needs more details, so describe the problem clearly and keep the report number to follow it.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'anonymous' AND "answer_en" = $g$Yes. At the “Contact” step choose “Anonymous”. We then cannot notify you, so keep the report number to follow it yourself.$g$;

UPDATE "guide_entries" SET "answer_sq" = $g$Shkruani rrugën në këtë kuti ose kërkojeni në hartë: raportimet e verifikuara shfaqen aty me numrin e tyre. Herën tjetër kopjojeni numrin ose bëni një screenshot të ekranit të fundit.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'lost_number' AND "answer_sq" = $g$Nëse keni lënë email, numri është te emaili që ju dërguam kur raportuat. Përndryshe shkruani rrugën në këtë kuti ose kërkojeni në hartë: raportimet e verifikuara shfaqen aty me numrin e tyre.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$Type the street in this box or look on the map: verified reports are shown there with their number. Next time, copy the number or take a screenshot of the last screen.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'lost_number' AND "answer_en" = $g$If you left an email, the number is in the email we sent when you reported. Otherwise type the street in this box or look on the map: verified reports are shown there with their number.$g$;

UPDATE "guide_entries" SET "answer_sq" = $g$Bëni një raportim të ri dhe shkruani numrin e të vjetrit te përshkrimi: sektori e sheh që problemi mbeti.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'reopen' AND "answer_sq" = $g$Nëse keni lënë email, hapni lidhjen te emaili që ju dërguam kur u zgjidh dhe zgjidhni “Jo, nuk është rregulluar”: raportimi rihapet dhe sektori njoftohet. Pa email, bëni një raportim të ri dhe shkruani numrin e të vjetrit te përshkrimi.$g$;

UPDATE "guide_entries" SET "answer_en" = $g$Make a new report and write the old number in the description: the department sees that the problem is still there.$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'reopen' AND "answer_en" = $g$If you left an email, open the link in the email we sent when it was resolved and choose “No, it is not fixed”: the report is reopened and the department is notified. Without an email, make a new report and write the old number in the description.$g$;

UPDATE "guide_entries" SET "keywords" = $g$llogari, regjistrim, regjistrohem, fjalëkalim, profil, email, emaili, hyr, falas, paguaj, pagesë, kushton, account, register, sign up, sign in, password, login, free, pay, cost$g$, "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'account' AND "keywords" = $g$llogari, regjistrim, regjistrohem, fjalëkalim, profil, falas, paguaj, pagesë, kushton, account, register, sign up, password, login, free, pay, cost$g$;
