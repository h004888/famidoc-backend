-- CreateEnum
CREATE TYPE "SupportCaseType" AS ENUM ('COMPLAINT_APPEAL', 'COMPLAINT_QUESTION', 'PAYMENT_ISSUE');

-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'NEED_MORE_INFO', 'RESOLVED', 'CLOSED');

-- CreateTable
CREATE TABLE "support_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_code" VARCHAR(50) NOT NULL,
    "case_type" "SupportCaseType" NOT NULL,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "family_user_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "complaint_id" UUID,
    "invoice_id" UUID,
    "transaction_id" UUID,
    "context_snapshot" JSONB NOT NULL DEFAULT '{}',
    "resolution_summary" TEXT,
    "resolved_by_user_id" UUID,
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "sender_role" VARCHAR(30) NOT NULL,
    "body" TEXT NOT NULL,
    "attachment_keys" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_cases_case_code_key" ON "support_cases"("case_code");

-- CreateIndex
CREATE INDEX "idx_support_cases_type_status_updated" ON "support_cases"("case_type", "status", "updated_at");

-- CreateIndex
CREATE INDEX "idx_support_cases_family_created" ON "support_cases"("family_user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_support_cases_complaint_id" ON "support_cases"("complaint_id");

-- CreateIndex
CREATE INDEX "idx_support_cases_invoice_id" ON "support_cases"("invoice_id");

-- CreateIndex
CREATE INDEX "idx_support_messages_case_created" ON "support_messages"("case_id", "created_at");

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_family_user_id_fkey" FOREIGN KEY ("family_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_complaint_id_fkey" FOREIGN KEY ("complaint_id") REFERENCES "complaints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "payment_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
