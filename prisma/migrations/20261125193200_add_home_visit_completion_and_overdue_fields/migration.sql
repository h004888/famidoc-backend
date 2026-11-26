-- CreateEnum
CREATE TYPE "EncounterParticipantAttendance" AS ENUM ('PLANNED', 'EXAMINED', 'ABSENT');

-- AlterTable
ALTER TABLE "encounters"
ADD COLUMN "doctor_completed_at" TIMESTAMPTZ,
ADD COLUMN "record_overdue_at" TIMESTAMPTZ,
ADD COLUMN "late_completion_reason" TEXT,
ADD COLUMN "reminder_21h_sent_at" TIMESTAMPTZ,
ADD COLUMN "overdue_escalated_at" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "encounter_participants"
ADD COLUMN "attendance_status" "EncounterParticipantAttendance" NOT NULL DEFAULT 'PLANNED';
