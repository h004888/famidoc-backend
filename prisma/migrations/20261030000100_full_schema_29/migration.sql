-- Chỉ áp dụng cho baseline 4 bảng chưa có dữ liệu; không tự xóa hay chuyển dữ liệu thật.
-- Khóa cả bốn bảng trong suốt migration để không có bản ghi phát sinh sau kiểm tra.
BEGIN;
LOCK TABLE users, family_units, patients, audit_logs IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM users) OR EXISTS(SELECT 1 FROM family_units)
     OR EXISTS(SELECT 1 FROM patients) OR EXISTS(SELECT 1 FROM audit_logs) THEN
    RAISE EXCEPTION 'Baseline contains data: stop and prepare an explicit data-preserving backfill';
  END IF;
END $$;
-- CreateEnum
CREATE TYPE "FacilityVerificationStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DoctorOnboardingStatus" AS ENUM ('PENDING_SUBMISSION', 'FACILITY_VERIFIED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DoctorCredentialType" AS ENUM ('PRACTICE_LICENSE_CCHN', 'FAMILY_MEDICINE_CERT', 'DEGREE');

-- CreateEnum
CREATE TYPE "ServicePackageStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "B2bContractStatus" AS ENUM ('PENDING_SIGNATURE', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "FamilyUnitStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AllergenType" AS ENUM ('DRUG', 'FOOD', 'ENVIRONMENTAL');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'LIFE_THREATENING_ANAPHYLAXIS');

-- CreateEnum
CREATE TYPE "PatientDocumentType" AS ENUM ('LAB_RESULT', 'IMAGING_XRAY_CT', 'DISCHARGE_SUMMARY');

-- CreateEnum
CREATE TYPE "MedicalContractStatus" AS ENUM ('PENDING_APPROVAL', 'PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('FAMILY_REP', 'ADMIN', 'HEALTHCARE_FACILITY', 'ASSIGNED_DOCTOR');

-- CreateEnum
CREATE TYPE "AddendumType" AS ENUM ('QUOTA_EXPANSION', 'TERM_EXTENSION', 'MEMBER_EXTENSION');

-- CreateEnum
CREATE TYPE "AddendumStatus" AS ENUM ('PENDING_PAYMENT', 'ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EncounterType" AS ENUM ('HOME_VISIT', 'TELEHEALTH');

-- CreateEnum
CREATE TYPE "EncounterCategory" AS ENUM ('PERIODIC_ROUTINE', 'AD_HOC_ON_DEMAND');

-- CreateEnum
CREATE TYPE "EncounterStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('ISSUED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SETTLED', 'FAILED');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('SUBMITTED', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

-- AlterEnum
CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'HEALTHCARE_FACILITY', 'DOCTOR', 'FAMILY_REP');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING ("role"::text::"UserRole_new");
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";

-- AlterEnum
CREATE TYPE "UserStatus_new" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'LOCKED');
ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "status" TYPE "UserStatus_new" USING ("status"::text::"UserStatus_new");
ALTER TYPE "UserStatus" RENAME TO "UserStatus_old";
ALTER TYPE "UserStatus_new" RENAME TO "UserStatus";
DROP TYPE "UserStatus_old";
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_familyUnitId_fkey";

-- DropForeignKey
ALTER TABLE "patients" DROP CONSTRAINT "patients_familyUnitId_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_userId_fkey";

-- DropIndex
DROP INDEX "family_units_headOfFamilyPatientId_key";

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "familyUnitId",
DROP COLUMN "fullName",
DROP COLUMN "passwordHash",
DROP COLUMN "tokenVersion",
DROP COLUMN "updatedAt",
ADD COLUMN     "avatar_url" VARCHAR(255),
ADD COLUMN     "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "full_name" VARCHAR(100) NOT NULL,
ADD COLUMN     "locked_until" TIMESTAMPTZ,
ADD COLUMN     "password_hash" VARCHAR(255) NOT NULL,
ADD COLUMN     "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ALTER COLUMN "email" SET DATA TYPE VARCHAR(150),
ALTER COLUMN "phone" SET DATA TYPE VARCHAR(15),
ALTER COLUMN "role" DROP DEFAULT,
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "family_units" DROP CONSTRAINT "family_units_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "emergencyPhone",
DROP COLUMN "headOfFamilyPatientId",
DROP COLUMN "homeAddress",
DROP COLUMN "updatedAt",
ADD COLUMN     "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "emergency_phone" VARCHAR(15) NOT NULL,
ADD COLUMN     "home_address" TEXT NOT NULL,
ADD COLUMN     "representative_user_id" UUID NOT NULL,
ADD COLUMN     "status" "FamilyUnitStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
ADD CONSTRAINT "family_units_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "patients" DROP CONSTRAINT "patients_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "dob",
DROP COLUMN "familyUnitId",
DROP COLUMN "fullName",
DROP COLUMN "relationshipToHead",
DROP COLUMN "updatedAt",
ADD COLUMN     "citizen_id" VARCHAR(20),
ADD COLUMN     "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "date_of_birth" DATE NOT NULL,
ADD COLUMN     "family_id" UUID NOT NULL,
ADD COLUMN     "full_name" VARCHAR(100) NOT NULL,
ADD COLUMN     "health_insurance_number" VARCHAR(30),
ADD COLUMN     "relationship_to_head" VARCHAR(50) NOT NULL,
ADD COLUMN     "status" "PatientStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL DEFAULT gen_random_uuid(),
DROP COLUMN "gender",
ADD COLUMN     "gender" "Gender" NOT NULL,
ADD CONSTRAINT "patients_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_pkey",
DROP COLUMN "createdAt",
DROP COLUMN "details",
DROP COLUMN "ipAddress",
DROP COLUMN "userId",
ADD COLUMN     "actor_user_id" UUID,
ADD COLUMN     "client_ip" VARCHAR(45) NOT NULL,
ADD COLUMN     "resource_id" VARCHAR(100) NOT NULL,
ADD COLUMN     "resource_name" VARCHAR(50) NOT NULL,
ADD COLUMN     "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "user_agent" VARCHAR(255),
DROP COLUMN "id",
ADD COLUMN     "id" BIGSERIAL NOT NULL,
ALTER COLUMN "action" SET DATA TYPE VARCHAR(50),
ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "reference_id" UUID,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "healthcare_facilities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "facility_name" VARCHAR(255) NOT NULL,
    "license_number" VARCHAR(50) NOT NULL,
    "tax_code" VARCHAR(20) NOT NULL,
    "address" TEXT NOT NULL,
    "hotline" VARCHAR(15) NOT NULL,
    "bank_name" VARCHAR(100) NOT NULL,
    "bank_account_number" VARCHAR(50) NOT NULL,
    "bank_account_holder" VARCHAR(100) NOT NULL,
    "verification_status" "FacilityVerificationStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "healthcare_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "doctor_name" VARCHAR(100) NOT NULL,
    "specialty" VARCHAR(100) NOT NULL,
    "academic_title" VARCHAR(50),
    "experience_years" INTEGER NOT NULL,
    "bio" TEXT,
    "active_panel_count" INTEGER NOT NULL DEFAULT 0,
    "max_panel_capacity" INTEGER NOT NULL DEFAULT 30,
    "rating_avg" DECIMAL(3,2) NOT NULL DEFAULT 5.00,
    "total_reviews" INTEGER NOT NULL DEFAULT 0,
    "onboarding_status" "DoctorOnboardingStatus" NOT NULL DEFAULT 'PENDING_SUBMISSION',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "credential_type" "DoctorCredentialType" NOT NULL,
    "certificate_number" VARCHAR(100) NOT NULL,
    "issue_date" DATE NOT NULL,
    "issuing_authority" VARCHAR(200) NOT NULL,
    "file_url" VARCHAR(255) NOT NULL,
    "facility_verified" BOOLEAN NOT NULL DEFAULT false,
    "facility_verified_by" UUID,
    "facility_verified_at" TIMESTAMPTZ,
    "platform_approved" BOOLEAN NOT NULL DEFAULT false,
    "platform_approved_by" UUID,
    "platform_approved_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,

    CONSTRAINT "doctor_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_shifts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "doctor_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "shift_date" DATE NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "shift_type" VARCHAR(50) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "doctor_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_packages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "package_code" VARCHAR(50) NOT NULL,
    "package_name" VARCHAR(150) NOT NULL,
    "duration_months" INTEGER NOT NULL,
    "base_price" DECIMAL(12,2) NOT NULL,
    "periodic_visits_quota" INTEGER NOT NULL,
    "telehealth_quota" INTEGER NOT NULL,
    "max_members" INTEGER NOT NULL DEFAULT 6,
    "status" "ServicePackageStatus" NOT NULL DEFAULT 'ACTIVE',
    "deleted_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineage_code" VARCHAR(50) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL DEFAULT '',
    "included_members" INTEGER NOT NULL DEFAULT 1,
    "additional_member_monthly_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "quota_period" VARCHAR(20) NOT NULL DEFAULT 'PER_TERM',
    "published_at" TIMESTAMPTZ,
    "retired_at" TIMESTAMPTZ,

    CONSTRAINT "service_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "b2b_staffing_contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_code" VARCHAR(50) NOT NULL,
    "facility_id" UUID NOT NULL,
    "platform_commission_rate" DECIMAL(5,2) NOT NULL DEFAULT 15.00,
    "facility_revenue_rate" DECIMAL(5,2) NOT NULL DEFAULT 85.00,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "signed_pdf_url" VARCHAR(255),
    "status" "B2bContractStatus" NOT NULL DEFAULT 'PENDING_SIGNATURE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "b2b_staffing_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_allergies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "allergen_type" "AllergenType" NOT NULL,
    "allergen_name" VARCHAR(150) NOT NULL,
    "severity" "AllergySeverity" NOT NULL,
    "clinical_manifestation" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "document_name" VARCHAR(200) NOT NULL,
    "document_type" "PatientDocumentType" NOT NULL,
    "file_url" VARCHAR(255) NOT NULL,
    "file_size_kb" INTEGER NOT NULL,
    "recorded_date" DATE NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_contracts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_number" VARCHAR(50) NOT NULL,
    "family_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "remaining_home_visits" INTEGER NOT NULL,
    "remaining_telehealth" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "contract_status" "MedicalContractStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "termination_reason" TEXT,
    "terminated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billing_snapshot" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "medical_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_signatures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_id" UUID NOT NULL,
    "signer_role" "SignerRole" NOT NULL,
    "signer_user_id" UUID NOT NULL,
    "signature_hash" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" VARCHAR(45) NOT NULL,

    CONSTRAINT "contract_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_addenda" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_id" UUID NOT NULL,
    "addendum_number" VARCHAR(50) NOT NULL,
    "addendum_type" "AddendumType" NOT NULL,
    "additional_amount" DECIMAL(12,2) NOT NULL,
    "extra_home_visits" INTEGER NOT NULL DEFAULT 0,
    "extra_telehealth" INTEGER NOT NULL DEFAULT 0,
    "extended_end_date" DATE,
    "status" "AddendumStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_addenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contract_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "encounter_type" "EncounterType" NOT NULL,
    "category" "EncounterCategory" NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "scheduled_time" TIME NOT NULL,
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "encounter_status" "EncounterStatus" NOT NULL DEFAULT 'REQUESTED',
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telehealth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encounter_id" UUID NOT NULL,
    "room_sid" VARCHAR(100) NOT NULL,
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,
    "duration_seconds" INTEGER NOT NULL DEFAULT 0,
    "network_quality_score" VARCHAR(20),
    "is_fallback_chat" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "telehealth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinical_emr" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encounter_id" UUID NOT NULL,
    "chief_complaint" TEXT NOT NULL,
    "anamnesis" TEXT,
    "clinical_findings" TEXT NOT NULL,
    "icd10_code" VARCHAR(10) NOT NULL,
    "icd10_diagnosis" VARCHAR(255) NOT NULL,
    "treatment_plan" TEXT NOT NULL,
    "is_finalized" BOOLEAN NOT NULL DEFAULT false,
    "finalized_at" TIMESTAMPTZ,
    "doctor_signature_hash" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_emr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vital_signs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "emr_id" UUID,
    "patient_id" UUID NOT NULL,
    "systolic_bp" INTEGER,
    "diastolic_bp" INTEGER,
    "heart_rate" INTEGER,
    "temperature" DECIMAL(4,1),
    "spo2" INTEGER,
    "respiratory_rate" INTEGER,
    "blood_glucose" DECIMAL(5,2),
    "is_abnormal_alert" BOOLEAN NOT NULL DEFAULT false,
    "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vital_signs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "emr_id" UUID NOT NULL,
    "prescription_code" VARCHAR(50) NOT NULL,
    "doctor_signature" TEXT NOT NULL,
    "prescribed_date" DATE NOT NULL,
    "valid_until" DATE NOT NULL,
    "instructions" TEXT,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'ISSUED',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_details" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prescription_id" UUID NOT NULL,
    "medication_name" VARCHAR(150) NOT NULL,
    "dosage" VARCHAR(50) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" VARCHAR(30) NOT NULL,
    "frequency" VARCHAR(100) NOT NULL,
    "duration_days" INTEGER NOT NULL,

    CONSTRAINT "prescription_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "emr_id" UUID NOT NULL,
    "referral_code" VARCHAR(50) NOT NULL,
    "target_facility_name" VARCHAR(255) NOT NULL,
    "reason_for_referral" TEXT NOT NULL,
    "clinical_summary" TEXT NOT NULL,
    "transportation_method" VARCHAR(100),
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_code" VARCHAR(50) NOT NULL,
    "contract_id" UUID,
    "addendum_id" UUID,
    "encounter_id" UUID,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "total_payable" DECIMAL(12,2) NOT NULL,
    "payment_gateway" VARCHAR(50) NOT NULL DEFAULT 'VIETQR',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "expired_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "expected_account_number" VARCHAR(50),
    "expected_gateway" VARCHAR(50),
    "paid_at" TIMESTAMPTZ,
    "accepted_transaction_id" UUID,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID,
    "gateway_transaction_id" VARCHAR(100) NOT NULL,
    "amount_received" DECIMAL(12,2) NOT NULL,
    "payment_time" TIMESTAMPTZ NOT NULL,
    "signature_verified" BOOLEAN NOT NULL,
    "webhook_payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "environment" VARCHAR(10) NOT NULL DEFAULT 'TEST',
    "fingerprint" VARCHAR(64) NOT NULL,
    "bank_reference_key" TEXT,
    "gateway" VARCHAR(100) NOT NULL,
    "account_number" VARCHAR(50) NOT NULL,
    "transfer_type" VARCHAR(10) NOT NULL,
    "payment_code" VARCHAR(50),
    "reference_code" VARCHAR(150) NOT NULL DEFAULT '',
    "outcome" VARCHAR(30) NOT NULL,
    "reason" VARCHAR(50),

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "settlement_code" VARCHAR(50) NOT NULL,
    "facility_id" UUID NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "total_realized_revenue" DECIMAL(14,2) NOT NULL,
    "platform_fee_amount" DECIMAL(14,2) NOT NULL,
    "facility_payout_amount" DECIMAL(14,2) NOT NULL,
    "disbursement_status" "DisbursementStatus" NOT NULL DEFAULT 'PENDING',
    "bank_transfer_order_id" VARCHAR(100),
    "settled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "encounter_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "doctor_id" UUID NOT NULL,
    "rating_stars" INTEGER NOT NULL,
    "review_comment" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "complaints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "complaint_code" VARCHAR(50) NOT NULL,
    "contract_id" UUID NOT NULL,
    "encounter_id" UUID,
    "complainant_user_id" UUID NOT NULL,
    "target_user_id" UUID NOT NULL,
    "complaint_category" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "evidence_attachments" JSONB,
    "resolution_outcome" VARCHAR(50),
    "resolution_notes" TEXT,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'SUBMITTED',
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configurations" (
    "config_key" VARCHAR(50) NOT NULL,
    "config_value" VARCHAR(255) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_configurations_pkey" PRIMARY KEY ("config_key")
);

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_facilities_user_id_key" ON "healthcare_facilities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_facilities_license_number_key" ON "healthcare_facilities"("license_number");

-- CreateIndex
CREATE UNIQUE INDEX "healthcare_facilities_tax_code_key" ON "healthcare_facilities"("tax_code");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_user_id_key" ON "doctors"("user_id");

-- CreateIndex
CREATE INDEX "idx_doctor_shifts_lookup" ON "doctor_shifts"("doctor_id", "shift_date");

-- CreateIndex
CREATE UNIQUE INDEX "service_packages_package_code_key" ON "service_packages"("package_code");

-- CreateIndex
CREATE UNIQUE INDEX "service_packages_lineage_code_version_key" ON "service_packages"("lineage_code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "b2b_staffing_contracts_contract_code_key" ON "b2b_staffing_contracts"("contract_code");

-- CreateIndex
CREATE UNIQUE INDEX "medical_contracts_contract_number_key" ON "medical_contracts"("contract_number");

-- CreateIndex
CREATE INDEX "idx_medical_contracts_family_id" ON "medical_contracts"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_signatures_contract_id_signer_role_key" ON "contract_signatures"("contract_id", "signer_role");

-- CreateIndex
CREATE UNIQUE INDEX "contract_addenda_addendum_number_key" ON "contract_addenda"("addendum_number");

-- CreateIndex
CREATE INDEX "idx_encounters_patient_timeline" ON "encounters"("patient_id", "scheduled_date" DESC, "scheduled_time" DESC);

-- CreateIndex
CREATE INDEX "idx_encounters_doctor_schedule" ON "encounters"("doctor_id", "scheduled_date", "scheduled_time");

-- CreateIndex
CREATE UNIQUE INDEX "telehealth_sessions_encounter_id_key" ON "telehealth_sessions"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "telehealth_sessions_room_sid_key" ON "telehealth_sessions"("room_sid");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_emr_encounter_id_key" ON "clinical_emr"("encounter_id");

-- CreateIndex
CREATE INDEX "idx_abnormal_vital_signs" ON "vital_signs"("patient_id", "recorded_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_prescription_code_key" ON "prescriptions"("prescription_code");

-- CreateIndex
CREATE UNIQUE INDEX "referral_orders_emr_id_key" ON "referral_orders"("emr_id");

-- CreateIndex
CREATE UNIQUE INDEX "referral_orders_referral_code_key" ON "referral_orders"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_code_key" ON "invoices"("invoice_code");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_accepted_transaction_id_key" ON "invoices"("accepted_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_contract_id_attempt_key" ON "invoices"("contract_id", "attempt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_gateway_transaction_id_key" ON "payment_transactions"("gateway_transaction_id");

-- CreateIndex
CREATE INDEX "payment_transactions_bank_reference_key_idx" ON "payment_transactions"("bank_reference_key");

-- CreateIndex
CREATE INDEX "payment_transactions_outcome_created_at_idx" ON "payment_transactions"("outcome", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "facility_settlements_settlement_code_key" ON "facility_settlements"("settlement_code");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_reviews_encounter_id_key" ON "doctor_reviews"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "complaints_complaint_code_key" ON "complaints"("complaint_code");

-- CreateIndex
CREATE UNIQUE INDEX "family_units_representative_user_id_key" ON "family_units"("representative_user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "healthcare_facilities" ADD CONSTRAINT "healthcare_facilities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "healthcare_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_credentials" ADD CONSTRAINT "doctor_credentials_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_credentials" ADD CONSTRAINT "doctor_credentials_facility_verified_by_fkey" FOREIGN KEY ("facility_verified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_credentials" ADD CONSTRAINT "doctor_credentials_platform_approved_by_fkey" FOREIGN KEY ("platform_approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_shifts" ADD CONSTRAINT "doctor_shifts_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_shifts" ADD CONSTRAINT "doctor_shifts_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "healthcare_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "b2b_staffing_contracts" ADD CONSTRAINT "b2b_staffing_contracts_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "healthcare_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_units" ADD CONSTRAINT "family_units_representative_user_id_fkey" FOREIGN KEY ("representative_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "family_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_documents" ADD CONSTRAINT "patient_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_contracts" ADD CONSTRAINT "medical_contracts_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "family_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_contracts" ADD CONSTRAINT "medical_contracts_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "healthcare_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_contracts" ADD CONSTRAINT "medical_contracts_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_contracts" ADD CONSTRAINT "medical_contracts_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "service_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_signer_user_id_fkey" FOREIGN KEY ("signer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_addenda" ADD CONSTRAINT "contract_addenda_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telehealth_sessions" ADD CONSTRAINT "telehealth_sessions_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_emr" ADD CONSTRAINT "clinical_emr_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_emr_id_fkey" FOREIGN KEY ("emr_id") REFERENCES "clinical_emr"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_signs" ADD CONSTRAINT "vital_signs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_emr_id_fkey" FOREIGN KEY ("emr_id") REFERENCES "clinical_emr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_details" ADD CONSTRAINT "prescription_details_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_orders" ADD CONSTRAINT "referral_orders_emr_id_fkey" FOREIGN KEY ("emr_id") REFERENCES "clinical_emr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_addendum_id_fkey" FOREIGN KEY ("addendum_id") REFERENCES "contract_addenda"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_accepted_transaction_id_fkey" FOREIGN KEY ("accepted_transaction_id") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_settlements" ADD CONSTRAINT "facility_settlements_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "healthcare_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_reviews" ADD CONSTRAINT "doctor_reviews_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_reviews" ADD CONSTRAINT "doctor_reviews_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "family_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_reviews" ADD CONSTRAINT "doctor_reviews_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_complainant_user_id_fkey" FOREIGN KEY ("complainant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_configurations" ADD CONSTRAINT "system_configurations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Các ràng buộc nghiệp vụ mà Prisma không biểu diễn được bằng @@unique có điều kiện.
CREATE UNIQUE INDEX service_packages_one_active ON service_packages(lineage_code) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX service_packages_one_draft ON service_packages(lineage_code) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX medical_contracts_one_active_family ON medical_contracts(family_id) WHERE contract_status = 'ACTIVE';
CREATE UNIQUE INDEX invoices_one_pending_contract ON invoices(contract_id) WHERE payment_status = 'PENDING' AND addendum_id IS NULL AND encounter_id IS NULL;
CREATE UNIQUE INDEX invoices_one_paid_contract ON invoices(contract_id) WHERE payment_status = 'PAID' AND addendum_id IS NULL AND encounter_id IS NULL;
CREATE UNIQUE INDEX payment_transactions_one_match ON payment_transactions(invoice_id) WHERE outcome = 'MATCHED';
CREATE UNIQUE INDEX payment_transactions_one_bank_match ON payment_transactions(bank_reference_key) WHERE outcome = 'MATCHED' AND bank_reference_key IS NOT NULL;
ALTER TABLE service_packages ADD CONSTRAINT package_terms_valid CHECK (
 duration_months IN (1,3,12) AND base_price > 0 AND base_price = trunc(base_price) AND
 included_members > 0 AND max_members BETWEEN included_members AND 6 AND
 additional_member_monthly_price >= 0 AND additional_member_monthly_price = trunc(additional_member_monthly_price) AND
 periodic_visits_quota >= 0 AND telehealth_quota >= 0 AND periodic_visits_quota + telehealth_quota > 0 AND quota_period IN ('PER_TERM','PER_MONTH'));
ALTER TABLE medical_contracts ADD CONSTRAINT medical_contract_terms_valid CHECK (end_date > start_date AND total_amount > 0 AND remaining_home_visits >= 0 AND remaining_telehealth >= 0);
ALTER TABLE doctors ADD CONSTRAINT doctor_panel_valid CHECK (max_panel_capacity > 0 AND active_panel_count BETWEEN 0 AND max_panel_capacity);
ALTER TABLE b2b_staffing_contracts ADD CONSTRAINT b2b_rates_valid CHECK (platform_commission_rate >= 0 AND facility_revenue_rate >= 0 AND platform_commission_rate + facility_revenue_rate = 100 AND end_date > start_date);
ALTER TABLE invoices ADD CONSTRAINT invoice_amounts_valid CHECK (gross_amount > 0 AND vat_amount >= 0 AND total_payable = gross_amount + vat_amount AND expired_at > created_at AND attempt > 0);
ALTER TABLE invoices ADD CONSTRAINT invoice_paid_transaction CHECK ((payment_status = 'PAID') = (accepted_transaction_id IS NOT NULL AND paid_at IS NOT NULL));
ALTER TABLE invoices ADD CONSTRAINT invoice_has_subject CHECK (num_nonnulls(contract_id, addendum_id, encounter_id) >= 1);
ALTER TABLE payment_transactions ADD CONSTRAINT payment_ledger_valid CHECK (amount_received >= 0 AND environment IN ('TEST','LIVE') AND transfer_type IN ('in','out') AND outcome IN ('MATCHED','IGNORED','REVIEW_REQUIRED') AND (outcome <> 'MATCHED' OR (invoice_id IS NOT NULL AND signature_verified AND transfer_type = 'in')));
ALTER TABLE doctor_reviews ADD CONSTRAINT review_stars_valid CHECK (rating_stars BETWEEN 1 AND 5);
ALTER TABLE facility_settlements ADD CONSTRAINT settlement_amounts_valid CHECK (month BETWEEN 1 AND 12 AND year BETWEEN 2000 AND 2200 AND total_realized_revenue >= 0 AND platform_fee_amount >= 0 AND facility_payout_amount >= 0 AND total_realized_revenue = platform_fee_amount + facility_payout_amount);
COMMIT;
