-- CreateEnum
CREATE TYPE "ChronicClinicalStatus" AS ENUM ('ACTIVE', 'CONTROLLED', 'REMISSION');

-- AlterTable
ALTER TABLE "patients"
ADD COLUMN "height_cm" DECIMAL(5,1),
ADD COLUMN "weight_kg" DECIMAL(5,1);

-- CreateTable
CREATE TABLE "patient_chronic_conditions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "condition_name" VARCHAR(150) NOT NULL,
    "icd10_code" VARCHAR(20),
    "clinical_status" "ChronicClinicalStatus" NOT NULL DEFAULT 'ACTIVE',
    "diagnosed_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_chronic_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_patient_chronic_conditions_patient_id" ON "patient_chronic_conditions"("patient_id");

-- AddForeignKey
ALTER TABLE "patient_chronic_conditions" ADD CONSTRAINT "patient_chronic_conditions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing comma/semicolon-separated chronic_diseases into patient_chronic_conditions
INSERT INTO "patient_chronic_conditions" ("patient_id", "condition_name", "clinical_status")
SELECT DISTINCT
    p."id",
    LEFT(TRIM(part), 150),
    'ACTIVE'::"ChronicClinicalStatus"
FROM "patients" p
CROSS JOIN LATERAL regexp_split_to_table(COALESCE(p."chronic_diseases", ''), '[,;]+') AS part
WHERE TRIM(part) <> '';
