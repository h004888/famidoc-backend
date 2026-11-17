BEGIN;

ALTER TABLE payment_transactions
  ADD COLUMN sepay_webhook_transaction_id VARCHAR(100),
  ADD COLUMN sepay_api_transaction_id UUID,
  ADD COLUMN ingestion_source VARCHAR(20) NOT NULL DEFAULT 'WEBHOOK',
  ADD COLUMN reconciled_at TIMESTAMPTZ,
  ADD COLUMN reconciliation_run_id UUID;

-- Các bản ghi hiện có đều đến từ webhook v1; giữ ID cũ làm khóa liên kết webhook.
UPDATE payment_transactions
SET sepay_webhook_transaction_id = gateway_transaction_id
WHERE gateway_transaction_id ~ '^[0-9]+$';

CREATE TABLE sepay_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment VARCHAR(10) NOT NULL,
  trigger VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  requested_by_user_id UUID,
  range_from TIMESTAMPTZ,
  range_to TIMESTAMPTZ,
  cursor_before UUID,
  cursor_after UUID,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  backfilled_count INTEGER NOT NULL DEFAULT 0,
  linked_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  review_required_count INTEGER NOT NULL DEFAULT 0,
  ignored_count INTEGER NOT NULL DEFAULT 0,
  local_only_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT sepay_reconciliation_environment CHECK (environment IN ('TEST','LIVE')),
  CONSTRAINT sepay_reconciliation_trigger CHECK (trigger IN ('MANUAL','SCHEDULED')),
  CONSTRAINT sepay_reconciliation_status CHECK (status IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED')),
  CONSTRAINT sepay_reconciliation_counts CHECK (
    fetched_count >= 0 AND backfilled_count >= 0 AND linked_count >= 0 AND
    matched_count >= 0 AND review_required_count >= 0 AND ignored_count >= 0 AND
    local_only_count >= 0
  )
);

CREATE TABLE sepay_reconciliation_state (
  environment VARCHAR(10) PRIMARY KEY,
  cursor UUID,
  last_successful_at TIMESTAMPTZ,
  last_run_id UUID,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sepay_reconciliation_state_environment CHECK (environment IN ('TEST','LIVE'))
);

ALTER TABLE payment_transactions
  ADD CONSTRAINT payment_transactions_reconciliation_run_fkey
  FOREIGN KEY (reconciliation_run_id) REFERENCES sepay_reconciliation_runs(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX payment_transactions_environment_webhook_id_key
  ON payment_transactions(environment, sepay_webhook_transaction_id);
CREATE UNIQUE INDEX payment_transactions_environment_api_id_key
  ON payment_transactions(environment, sepay_api_transaction_id);
CREATE INDEX payment_transactions_environment_payment_time_idx
  ON payment_transactions(environment, payment_time);
CREATE INDEX sepay_reconciliation_runs_environment_started_at_idx
  ON sepay_reconciliation_runs(environment, started_at DESC);

ALTER TABLE payment_transactions
  ADD CONSTRAINT payment_transactions_ingestion_source_check
  CHECK (ingestion_source IN ('WEBHOOK','SEPAY_API'));

COMMIT;
