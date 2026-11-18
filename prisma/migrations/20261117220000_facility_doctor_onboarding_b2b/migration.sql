-- Synced from remote DB server migration: facility & doctor onboarding B2B workflow
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DoctorOnboardingStatus') THEN
    ALTER TYPE "DoctorOnboardingStatus" ADD VALUE IF NOT EXISTS 'PENDING_FACILITY_REVIEW';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'B2bContractStatus') THEN
    ALTER TYPE "B2bContractStatus" ADD VALUE IF NOT EXISTS 'PENDING_FACILITY_SIGNATURE';
    ALTER TYPE "B2bContractStatus" ADD VALUE IF NOT EXISTS 'REVISION_REQUESTED';
    ALTER TYPE "B2bContractStatus" ADD VALUE IF NOT EXISTS 'PENDING_ADMIN_SIGNATURE';
  END IF;
END $$;

ALTER TABLE "doctors"
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "credentials_submitted_at" TIMESTAMPTZ(6);

ALTER TABLE "doctor_credentials"
  ADD COLUMN IF NOT EXISTS "file_key" TEXT;

ALTER TABLE "b2b_staffing_contracts"
  ADD COLUMN IF NOT EXISTS "signed_pdf_key" TEXT,
  ADD COLUMN IF NOT EXISTS "contract_terms" TEXT,
  ADD COLUMN IF NOT EXISTS "revision_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "documenso_envelope_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "documenso_item_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "facility_documenso_recipient_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "facility_signing_url" TEXT,
  ADD COLUMN IF NOT EXISTS "facility_signing_token" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "admin_documenso_recipient_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "admin_signing_url" TEXT,
  ADD COLUMN IF NOT EXISTS "admin_signing_token" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "facility_signed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "admin_signed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "termination_request_status" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "termination_request_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "termination_requested_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "terminated_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "terminated_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "terminated_by_user_id" UUID;
