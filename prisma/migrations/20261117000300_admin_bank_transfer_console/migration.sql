ALTER TABLE "invoices" ADD COLUMN "admin_transfer_description" VARCHAR(100);
ALTER TABLE "facility_settlements" ADD COLUMN "transfer_memo" VARCHAR(140);

CREATE TABLE "sepay_webhook_events" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "environment" VARCHAR(10) NOT NULL CHECK ("environment" IN ('TEST', 'LIVE')),
    "status" VARCHAR(10) NOT NULL CHECK ("status" IN ('SUCCESS', 'ERROR')),
    "http_status" INTEGER NOT NULL,
    "result_code" VARCHAR(50) NOT NULL,
    "provider_transaction_id" VARCHAR(100),
    "transaction_id" UUID,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "sepay_webhook_events_env_received_idx"
  ON "sepay_webhook_events" ("environment", "received_at" DESC, "id");
CREATE INDEX "sepay_webhook_events_env_status_received_idx"
  ON "sepay_webhook_events" ("environment", "status", "received_at" DESC, "id");
