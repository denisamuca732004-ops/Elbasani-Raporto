-- The sector description in English (the panel and the site in English).
ALTER TABLE "departments" ADD COLUMN "description_en" TEXT;

-- The sectors created with the platform get their English text (an edited description is left alone).
UPDATE "departments" SET "description_en" = 'Waste, street cleaning, green spaces and parks.' WHERE "code" = 'public_services' AND "description" = 'Mbetjet, pastrimi, gjelbërimi dhe parqet.';
UPDATE "departments" SET "description_en" = 'Roads, sidewalks, signs and street lighting.' WHERE "code" = 'infrastructure' AND "description" = 'Rrugët, trotuaret, sinjalistika dhe ndriçimi publik.';
UPDATE "departments" SET "description_en" = 'The water network, sewers and manholes.' WHERE "code" = 'water' AND "description" = 'Rrjeti i ujit, kanalizimet dhe pusetat.';
UPDATE "departments" SET "description_en" = 'Building without a permit, construction sites and construction waste.' WHERE "code" = 'urban_control' AND "description" = 'Ndërtimet pa leje, kantieret dhe mbetjet inerte.';
UPDATE "departments" SET "description_en" = 'Animals, pest control and public health.' WHERE "code" = 'public_health' AND "description" = 'Kafshët, dezinsektimi dhe shëndeti publik.';
UPDATE "departments" SET "description_en" = 'Noise, occupation of public space and abandoned vehicles.' WHERE "code" = 'municipal_police' AND "description" = 'Zhurmat, zënia e hapësirës publike dhe automjetet e braktisura.';
UPDATE "departments" SET "description_en" = 'Other requests that do not belong to a specific sector.' WHERE "code" = 'citizen_service' AND "description" = 'Kërkesat e tjera që nuk i përkasin një sektori të caktuar.';
