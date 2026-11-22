-- CreateEnum
CREATE TYPE "EncounterVisitScope" AS ENUM ('FAMILY', 'INDIVIDUAL');

-- AlterTable: add visit_scope to encounters
ALTER TABLE "encounters" ADD COLUMN "visit_scope" "EncounterVisitScope" NOT NULL DEFAULT 'INDIVIDUAL';

-- CreateTable: encounter_participants
CREATE TABLE "encounter_participants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encounter_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "idx_encounter_participants_unique" ON "encounter_participants"("encounter_id", "patient_id");

-- CreateIndex
CREATE INDEX "idx_encounter_participants_patient" ON "encounter_participants"("patient_id");

-- AddForeignKey
ALTER TABLE "encounter_participants" ADD CONSTRAINT "encounter_participants_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_participants" ADD CONSTRAINT "encounter_participants_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill encounter_participants from legacy encounters.patient_id
INSERT INTO "encounter_participants" ("encounter_id", "patient_id")
SELECT "id", "patient_id"
FROM "encounters"
WHERE "patient_id" IS NOT NULL
ON CONFLICT ("encounter_id", "patient_id") DO NOTHING;

-- AlterTable: clinical_emr add patient_id and backfill
ALTER TABLE "clinical_emr" ADD COLUMN "patient_id" UUID;

UPDATE "clinical_emr" AS "emr"
SET "patient_id" = "enc"."patient_id"
FROM "encounters" AS "enc"
WHERE "emr"."encounter_id" = "enc"."id"
  AND "emr"."patient_id" IS NULL;

ALTER TABLE "clinical_emr" ALTER COLUMN "patient_id" SET NOT NULL;

ALTER TABLE "clinical_emr" ADD CONSTRAINT "clinical_emr_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Replace unique index on clinical_emr
DROP INDEX IF EXISTS "clinical_emr_encounter_id_key";
CREATE UNIQUE INDEX "idx_clinical_emr_encounter_patient" ON "clinical_emr"("encounter_id", "patient_id");

-- Drop legacy patient_id from encounters and add contract timeline index
DROP INDEX IF EXISTS "idx_encounters_patient_timeline";
ALTER TABLE "encounters" DROP COLUMN "patient_id";
CREATE INDEX "idx_encounters_contract_timeline" ON "encounters"("contract_id", "scheduled_date" DESC, "scheduled_time" DESC);
