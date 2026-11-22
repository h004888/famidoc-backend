-- CreateEnum
CREATE TYPE "RescheduleDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RescheduleRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "doctor_shifts" DROP CONSTRAINT IF EXISTS "doctor_shifts_doctor_id_fkey";

-- DropForeignKey
ALTER TABLE "doctor_shifts" DROP CONSTRAINT IF EXISTS "doctor_shifts_facility_id_fkey";

-- DropTable
DROP TABLE IF EXISTS "doctor_shifts";

-- AlterTable: doctors default max_panel_capacity = 5
ALTER TABLE "doctors" ALTER COLUMN "max_panel_capacity" SET DEFAULT 5;
UPDATE "doctors" SET "max_panel_capacity" = 5 WHERE "max_panel_capacity" = 30 AND "active_panel_count" <= 5;

-- AlterTable: encounters
ALTER TABLE "encounters"
  ADD COLUMN IF NOT EXISTS "reminder_24h_sent_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "reminder_2h_sent_at" TIMESTAMPTZ,
  DROP COLUMN IF EXISTS "proposed_date",
  DROP COLUMN IF EXISTS "proposed_time",
  DROP COLUMN IF EXISTS "proposed_by",
  DROP COLUMN IF EXISTS "reschedule_reason",
  DROP COLUMN IF EXISTS "conflict_alert",
  DROP COLUMN IF EXISTS "conflict_details";

-- CreateTable
CREATE TABLE "encounter_reschedule_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encounter_id" UUID NOT NULL,
    "requested_by_role" VARCHAR(30) NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "proposed_date" DATE NOT NULL,
    "proposed_time" TIME NOT NULL,
    "reason" TEXT NOT NULL,
    "family_decision" "RescheduleDecision" NOT NULL DEFAULT 'PENDING',
    "family_decided_by" UUID,
    "family_decided_at" TIMESTAMPTZ,
    "family_note" TEXT,
    "doctor_decision" "RescheduleDecision" NOT NULL DEFAULT 'PENDING',
    "doctor_decided_by" UUID,
    "doctor_decided_at" TIMESTAMPTZ,
    "doctor_note" TEXT,
    "facility_decision" "RescheduleDecision" NOT NULL DEFAULT 'PENDING',
    "facility_decided_by" UUID,
    "facility_decided_at" TIMESTAMPTZ,
    "facility_note" TEXT,
    "status" "RescheduleRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_reschedule_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_encounter_reschedule_requests_lookup" ON "encounter_reschedule_requests"("encounter_id", "status");

-- Partial unique index: tối đa 1 yêu cầu PENDING trên mỗi buổi khám
CREATE UNIQUE INDEX "idx_unique_pending_reschedule_per_encounter"
  ON "encounter_reschedule_requests"("encounter_id")
  WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "encounter_reschedule_requests"
  ADD CONSTRAINT "encounter_reschedule_requests_encounter_id_fkey"
  FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
