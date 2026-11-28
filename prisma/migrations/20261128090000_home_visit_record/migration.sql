-- CreateEnum
CREATE TYPE "Icd10DaggerAsterisk" AS ENUM ('NONE', 'DAGGER', 'ASTERISK');

-- CreateEnum
CREATE TYPE "DiseaseProgression" AS ENUM ('STABLE', 'IMPROVED', 'WORSENED');

-- CreateEnum
CREATE TYPE "HomeMedicationSource" AS ENUM ('FAMIDOC_PRESCRIPTION', 'OTHER_FACILITY', 'SELF_PURCHASED', 'SUPPLEMENT');

-- CreateEnum
CREATE TYPE "HomeMedicationAssessment" AS ENUM ('CONTINUE', 'ADJUST', 'STOP', 'CHECK');

-- CreateEnum
CREATE TYPE "PrescriptionLineChange" AS ENUM ('NEW', 'KEEP', 'DOSE_CHANGED');

-- AlterTable
ALTER TABLE "clinical_emr"
ADD COLUMN "family_history" TEXT,
ADD COLUMN "follow_up_date" DATE,
ADD COLUMN "general_exam" TEXT,
ADD COLUMN "informant_name" VARCHAR(150),
ADD COLUMN "informant_relation" VARCHAR(50),
ADD COLUMN "medication_adherence" TEXT,
ADD COLUMN "personal_history" TEXT,
ADD COLUMN "progression" "DiseaseProgression",
ADD COLUMN "self_care_notes" TEXT;

-- AlterTable
ALTER TABLE "prescription_details" ADD COLUMN "change_type" "PrescriptionLineChange" NOT NULL DEFAULT 'NEW';

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN "discontinued_medications" JSONB;

-- AlterTable
ALTER TABLE "vital_signs" ADD COLUMN "height_cm" DECIMAL(4,1);

-- CreateTable
CREATE TABLE "icd10_codes" (
    "code" VARCHAR(10) NOT NULL,
    "name_vi" VARCHAR(500) NOT NULL,
    "name_en" VARCHAR(500),
    "chapter" VARCHAR(10) NOT NULL,
    "dagger_asterisk" "Icd10DaggerAsterisk" NOT NULL DEFAULT 'NONE',
    "allowed_as_primary" BOOLEAN NOT NULL DEFAULT true,
    "long_term_eligible" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "icd10_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "clinical_emr_diagnoses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "emr_id" UUID NOT NULL,
    "icd10_code" VARCHAR(10) NOT NULL,
    "name_snapshot" VARCHAR(500) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "line_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "clinical_emr_diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "home_medications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "emr_id" UUID NOT NULL,
    "medication_name" VARCHAR(150) NOT NULL,
    "source" "HomeMedicationSource" NOT NULL,
    "assessment" "HomeMedicationAssessment" NOT NULL,
    "notes" VARCHAR(500),
    "line_number" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "home_medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_home_environments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encounter_id" UUID NOT NULL,
    "visit_address" VARCHAR(500),
    "primary_informant_name" VARCHAR(150),
    "housing_notes" TEXT,
    "fall_risk" BOOLEAN,
    "water_source" VARCHAR(100),
    "smoking_in_house" BOOLEAN,
    "pets" VARCHAR(200),
    "notes" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_home_environments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "icd10_codes_name_vi_idx" ON "icd10_codes"("name_vi");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_emr_diagnoses_emr_id_icd10_code_key" ON "clinical_emr_diagnoses"("emr_id", "icd10_code");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_home_environments_encounter_id_key" ON "encounter_home_environments"("encounter_id");

-- AddForeignKey
ALTER TABLE "clinical_emr_diagnoses" ADD CONSTRAINT "clinical_emr_diagnoses_emr_id_fkey" FOREIGN KEY ("emr_id") REFERENCES "clinical_emr"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_emr_diagnoses" ADD CONSTRAINT "clinical_emr_diagnoses_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "home_medications" ADD CONSTRAINT "home_medications_emr_id_fkey" FOREIGN KEY ("emr_id") REFERENCES "clinical_emr"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_home_environments" ADD CONSTRAINT "encounter_home_environments_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
