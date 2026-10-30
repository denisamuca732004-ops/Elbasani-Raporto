-- Reports typed by hand also get a point on the map: the lagje / village, else the middle of the zone.

-- AlterTable
ALTER TABLE "localities" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "location_approximate" BOOLEAN NOT NULL DEFAULT false;

-- A lagje / village has both coordinates or neither, and they are real coordinates.
ALTER TABLE "localities" ADD CONSTRAINT "localities_point_complete" CHECK (
  ("latitude" IS NULL) = ("longitude" IS NULL)
  AND ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90)
  AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
);
