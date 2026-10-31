BEGIN;
-- DropIndex
DROP INDEX "invoices_contract_id_attempt_key";

-- DropIndex
DROP INDEX "payment_transactions_gateway_transaction_id_key";

-- AlterTable
ALTER TABLE "medical_contracts" ADD COLUMN     "upgraded_from_id" UUID;

-- AlterTable
ALTER TABLE "contract_addenda" ADD COLUMN     "activated_at" TIMESTAMPTZ,
ADD COLUMN     "request_key" VARCHAR(100),
ADD COLUMN     "terms_hash" VARCHAR(64) NOT NULL DEFAULT '',
ADD COLUMN     "terms_snapshot" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "environment" VARCHAR(10) NOT NULL DEFAULT 'TEST';

-- AlterTable
ALTER TABLE "facility_settlements" ADD COLUMN     "bank_destination" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "confirmed_by_user_id" UUID,
ADD COLUMN     "environment" VARCHAR(10) NOT NULL DEFAULT 'LIVE',
ADD COLUMN     "transfer_evidence_key" TEXT;

-- AlterTable
ALTER TABLE "complaints" ADD COLUMN     "facility_response" TEXT,
ADD COLUMN     "facility_reviewed_at" TIMESTAMPTZ,
ADD COLUMN     "facility_reviewed_by_id" UUID,
ADD COLUMN     "resolved_by_user_id" UUID;

-- CreateTable
CREATE TABLE "contract_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "added_by_addendum_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_addendum_signatures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "addendum_id" UUID NOT NULL,
    "signer_role" "SignerRole" NOT NULL,
    "signer_user_id" UUID NOT NULL,
    "terms_hash" VARCHAR(64) NOT NULL,
    "signature_hash" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(45) NOT NULL,

    CONSTRAINT "contract_addendum_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_termination_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "terms_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "consents" JSONB NOT NULL DEFAULT '[]',
    "decision_notes" TEXT,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_termination_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_settlement_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "settlement_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL,
    "net_amount" DECIMAL(12,2) NOT NULL,
    "platform_fee_amount" DECIMAL(12,2) NOT NULL,
    "facility_share_amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "facility_settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_members_contract_id_patient_id_key" ON "contract_members"("contract_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_addendum_signatures_addendum_id_signer_role_key" ON "contract_addendum_signatures"("addendum_id", "signer_role");

-- CreateIndex
CREATE INDEX "contract_termination_requests_contract_id_status_idx" ON "contract_termination_requests"("contract_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "facility_settlement_items_invoice_id_key" ON "facility_settlement_items"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_addenda_request_key_key" ON "contract_addenda"("request_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_environment_gateway_transaction_id_key" ON "payment_transactions"("environment", "gateway_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "facility_settlements_facility_id_month_year_environment_key" ON "facility_settlements"("facility_id", "month", "year", "environment");

-- AddForeignKey
ALTER TABLE "medical_contracts" ADD CONSTRAINT "medical_contracts_upgraded_from_id_fkey" FOREIGN KEY ("upgraded_from_id") REFERENCES "medical_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_members" ADD CONSTRAINT "contract_members_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_members" ADD CONSTRAINT "contract_members_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_members" ADD CONSTRAINT "contract_members_added_by_addendum_id_fkey" FOREIGN KEY ("added_by_addendum_id") REFERENCES "contract_addenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_addendum_signatures" ADD CONSTRAINT "contract_addendum_signatures_addendum_id_fkey" FOREIGN KEY ("addendum_id") REFERENCES "contract_addenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_addendum_signatures" ADD CONSTRAINT "contract_addendum_signatures_signer_user_id_fkey" FOREIGN KEY ("signer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_termination_requests" ADD CONSTRAINT "contract_termination_requests_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_termination_requests" ADD CONSTRAINT "contract_termination_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_settlement_items" ADD CONSTRAINT "facility_settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "facility_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_settlement_items" ADD CONSTRAINT "facility_settlement_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Khóa duy nhất có điều kiện cho từng loại nghĩa vụ, không gộp hóa đơn phụ lục với hóa đơn gói gốc.
CREATE UNIQUE INDEX invoice_contract_attempt ON invoices(contract_id,attempt) WHERE addendum_id IS NULL AND encounter_id IS NULL;
CREATE UNIQUE INDEX invoice_addendum_attempt ON invoices(addendum_id,attempt) WHERE addendum_id IS NOT NULL;
CREATE UNIQUE INDEX invoice_one_pending_addendum ON invoices(addendum_id) WHERE addendum_id IS NOT NULL AND payment_status='PENDING';
CREATE UNIQUE INDEX invoice_one_paid_addendum ON invoices(addendum_id) WHERE addendum_id IS NOT NULL AND payment_status='PAID';
CREATE UNIQUE INDEX one_open_upgrade_per_source ON medical_contracts(upgraded_from_id) WHERE upgraded_from_id IS NOT NULL AND contract_status IN ('PENDING_APPROVAL','PENDING_PAYMENT','ACTIVE');
CREATE UNIQUE INDEX one_pending_termination ON contract_termination_requests(contract_id) WHERE status='PENDING';
CREATE UNIQUE INDEX one_pending_member_addendum ON contract_addenda(contract_id) WHERE addendum_type='MEMBER_EXTENSION' AND status='PENDING_PAYMENT';
DROP INDEX payment_transactions_one_bank_match;
CREATE UNIQUE INDEX payment_transactions_one_bank_match ON payment_transactions(environment,bank_reference_key) WHERE outcome='MATCHED' AND bank_reference_key IS NOT NULL;
CREATE UNIQUE INDEX settlement_bank_reference_unique ON facility_settlements(environment,bank_transfer_order_id) WHERE bank_transfer_order_id IS NOT NULL;
ALTER TABLE contract_termination_requests ADD CONSTRAINT termination_status_valid CHECK (status IN ('PENDING','APPROVED','REJECTED'));
ALTER TABLE facility_settlement_items ADD CONSTRAINT settlement_item_amounts_valid CHECK (gross_amount=net_amount+vat_amount AND net_amount=platform_fee_amount+facility_share_amount AND net_amount>=0 AND vat_amount>=0 AND platform_fee_amount>=0 AND facility_share_amount>=0);
ALTER TABLE invoices ADD CONSTRAINT invoice_environment_valid CHECK (environment IN ('TEST','LIVE'));
ALTER TABLE contract_addenda ADD CONSTRAINT addendum_values_valid CHECK (additional_amount>=0 AND extra_home_visits>=0 AND extra_telehealth>=0);
COMMIT;
