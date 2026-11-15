-- AlterEnum
ALTER TYPE "EncounterType" ADD VALUE IF NOT EXISTS 'FACILITY_VISIT';

-- AlterTable
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "proposed_date" DATE;
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "proposed_time" TIME;
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "proposed_by" VARCHAR(50);
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "reschedule_reason" TEXT;
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "conflict_alert" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "encounters" ADD COLUMN IF NOT EXISTS "conflict_details" TEXT;
