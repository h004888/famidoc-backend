BEGIN;
ALTER TABLE invoices DROP CONSTRAINT invoice_paid_transaction;
ALTER TABLE invoices ADD CONSTRAINT invoice_paid_transaction CHECK (
 (payment_status = 'PAID' AND accepted_transaction_id IS NOT NULL AND paid_at IS NOT NULL)
 OR (payment_status <> 'PAID' AND accepted_transaction_id IS NULL AND paid_at IS NULL));
COMMIT;
