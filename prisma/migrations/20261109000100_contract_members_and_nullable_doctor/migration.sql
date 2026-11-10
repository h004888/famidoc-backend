-- AlterTable: Make doctor_id nullable in medical_contracts
ALTER TABLE "medical_contracts" ALTER COLUMN "doctor_id" DROP NOT NULL;

-- CreateTable: Recreate contract_members for 3NF relational integrity
CREATE TABLE IF NOT EXISTS "contract_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "added_by_addendum_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "idx_contract_members_contract_patient" ON "contract_members"("contract_id", "patient_id");

-- AddForeignKey
ALTER TABLE "contract_members" ADD CONSTRAINT "contract_members_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_members" ADD CONSTRAINT "contract_members_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
