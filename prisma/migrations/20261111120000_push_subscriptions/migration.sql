-- "Më njoftoni në këtë telefon": browser push subscriptions of residents, one per report and device.
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "report_id" UUID NOT NULL,
    "endpoint" VARCHAR(1000) NOT NULL,
    "p256dh" VARCHAR(200) NOT NULL,
    "auth" VARCHAR(100) NOT NULL,
    "lang" VARCHAR(2) NOT NULL DEFAULT 'sq',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "push_subscriptions_report_id_idx" ON "push_subscriptions"("report_id");
CREATE UNIQUE INDEX "push_subscriptions_report_id_endpoint_key" ON "push_subscriptions"("report_id", "endpoint");

ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
