-- AlterEnum
ALTER TYPE "MedicalContractStatus" ADD VALUE IF NOT EXISTS 'PAID_PENDING_APPROVAL';
ALTER TYPE "MedicalContractStatus" ADD VALUE IF NOT EXISTS 'APPROVAL_REJECTED';
ALTER TYPE "MedicalContractStatus" ADD VALUE IF NOT EXISTS 'APPROVAL_EXPIRED';

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ContractRefundRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "medical_contracts"
  ADD COLUMN IF NOT EXISTS "home_visit_address" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "approval_deadline_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "credit_source_contract_id" UUID,
  ADD COLUMN IF NOT EXISTS "platform_sign_retry_pending" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "medical_contracts_credit_source_contract_id_key" ON "medical_contracts"("credit_source_contract_id");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "medical_contracts"
      ADD CONSTRAINT "medical_contracts_credit_source_contract_id_fkey"
      FOREIGN KEY ("credit_source_contract_id") REFERENCES "medical_contracts"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "contract_refund_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "refund_code" VARCHAR(50) NOT NULL,
    "contract_id" UUID NOT NULL,
    "amount_vnd" DECIMAL(12,2) NOT NULL,
    "bank_name" VARCHAR(120) NOT NULL,
    "account_number" VARCHAR(50) NOT NULL,
    "account_holder" VARCHAR(150) NOT NULL,
    "status" "ContractRefundRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "contract_refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "contract_refund_requests_refund_code_key" ON "contract_refund_requests"("refund_code");
CREATE UNIQUE INDEX IF NOT EXISTS "contract_refund_requests_contract_id_key" ON "contract_refund_requests"("contract_id");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "contract_refund_requests"
      ADD CONSTRAINT "contract_refund_requests_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
