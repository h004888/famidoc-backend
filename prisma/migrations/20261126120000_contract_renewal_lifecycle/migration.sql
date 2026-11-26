-- AlterEnum
ALTER TYPE "MedicalContractStatus" ADD VALUE IF NOT EXISTS 'PENDING_ACTIVATION';
ALTER TYPE "MedicalContractStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';

-- Recreate partial unique index one_open_upgrade_per_source to include PENDING_ACTIVATION
DROP INDEX IF EXISTS "one_open_upgrade_per_source";
CREATE UNIQUE INDEX "one_open_upgrade_per_source"
  ON "medical_contracts"("upgraded_from_id")
  WHERE "upgraded_from_id" IS NOT NULL
    AND "contract_status" IN ('PENDING_APPROVAL', 'PENDING_PAYMENT', 'PENDING_ACTIVATION', 'ACTIVE');

-- Partial unique index for 7-day contract expiry reminder notification
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_contract_expiry_7d_once"
  ON "notifications"("user_id", "reference_id")
  WHERE "type" = 'CONTRACT_EXPIRY_7D';

-- Recreate trigger trg_release_slots_on_contract_end to also release slots on CANCELLED
DROP TRIGGER IF EXISTS "trg_release_slots_on_contract_end" ON "medical_contracts";
CREATE TRIGGER "trg_release_slots_on_contract_end"
AFTER UPDATE OF "contract_status" ON "medical_contracts"
FOR EACH ROW
WHEN (NEW."contract_status" IN ('TERMINATED', 'EXPIRED', 'APPROVAL_REJECTED', 'APPROVAL_EXPIRED', 'CANCELLED')
      AND OLD."contract_status" IS DISTINCT FROM NEW."contract_status")
EXECUTE FUNCTION release_doctor_slots_on_contract_end();
