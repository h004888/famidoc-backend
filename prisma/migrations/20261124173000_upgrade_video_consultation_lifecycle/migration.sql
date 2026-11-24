-- AlterEnum
ALTER TYPE "EncounterStatus" ADD VALUE IF NOT EXISTS 'WRAP_UP';
ALTER TYPE "EncounterStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';

-- AlterTable
ALTER TABLE "encounters"
  ADD COLUMN IF NOT EXISTS "confirmed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "grace_reschedule_used" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "quick_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "slot_window" VARCHAR(20);

-- AlterTable
ALTER TABLE "medical_contracts"
  ADD COLUMN IF NOT EXISTS "held_telehealth" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "telehealth_sessions"
  ADD COLUMN IF NOT EXISTS "closed_by_role" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "doctor_joined_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "family_joined_at" TIMESTAMPTZ;
