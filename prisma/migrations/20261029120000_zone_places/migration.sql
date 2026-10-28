-- Zones get a code that links them to their border, and their lagje (city) and villages.

-- AlterTable
ALTER TABLE "neighbourhoods" ADD COLUMN "code" VARCHAR(60);

-- CreateTable
CREATE TABLE "localities" (
    "id" SERIAL NOT NULL,
    "neighbourhood_id" INTEGER NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "localities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "neighbourhoods_code_key" ON "neighbourhoods"("code");

-- CreateIndex
CREATE UNIQUE INDEX "localities_neighbourhood_id_name_key" ON "localities"("neighbourhood_id", "name");

-- AddForeignKey
ALTER TABLE "localities" ADD CONSTRAINT "localities_neighbourhood_id_fkey" FOREIGN KEY ("neighbourhood_id") REFERENCES "neighbourhoods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The zones that already exist get their border code (the seed adds their lagje and villages).
UPDATE "neighbourhoods" AS n SET "code" = v.code
FROM (VALUES
  ('Elbasan (qyteti)', 'elbasan'), ('Bradashesh', 'bradashesh'), ('Funarë', 'funare'), ('Gjergjan', 'gjergjan'),
  ('Gjinar', 'gjinar'), ('Gracen', 'gracen'), ('Labinot-Fushë', 'labinot_fushe'), ('Labinot-Mal', 'labinot_mal'),
  ('Papër', 'paper'), ('Shirgjan', 'shirgjan'), ('Shushicë', 'shushice'), ('Tregan', 'tregan'), ('Zavalinë', 'zavaline')
) AS v(name, code)
WHERE n."name" = v.name AND n."code" IS NULL;

-- Mollas is an administrative unit of the Municipality of Cërrik, not of Elbasan:
-- hidden from residents (reports that already name it keep it).
UPDATE "neighbourhoods" SET "active" = false WHERE "name" = 'Mollas' AND "code" IS NULL;

-- Names are never empty.
ALTER TABLE "localities" ADD CONSTRAINT "localities_name_not_blank" CHECK (char_length(btrim("name")) >= 2);
