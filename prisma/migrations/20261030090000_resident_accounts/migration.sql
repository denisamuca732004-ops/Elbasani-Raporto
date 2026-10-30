-- Resident accounts: sign up / sign in with Google or with email + password.

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL,
ADD COLUMN     "email_verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "google_id" VARCHAR(64);

-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "citizen_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE INDEX "reports_citizen_id_created_at_idx" ON "reports"("citizen_id", "created_at");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_citizen_id_fkey" FOREIGN KEY ("citizen_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Staff always sign in with a password; only residents (role USER) may have Google alone.
ALTER TABLE "users" ADD CONSTRAINT "users_staff_have_password" CHECK ("role" = 'USER' OR "password_hash" IS NOT NULL);

-- Every account can sign in somehow: a password, Google, or both.
ALTER TABLE "users" ADD CONSTRAINT "users_can_sign_in" CHECK ("password_hash" IS NOT NULL OR "google_id" IS NOT NULL);
