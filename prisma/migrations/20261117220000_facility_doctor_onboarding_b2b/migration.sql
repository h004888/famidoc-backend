-- Align Facility Onboarding, B2B Staffing Documenso Lifecycle, and Doctor 3-Credential Onboarding

BEGIN;

-- 1. User.must_change_password
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- 2. HealthcareFacility default verification status -> PENDING
ALTER TABLE "healthcare_facilities"
  ALTER COLUMN "verification_status" SET DEFAULT 'PENDING';

-- 3. DoctorOnboardingStatus enum update (add PENDING_FACILITY_REVIEW) & Doctor fields
CREATE TYPE "DoctorOnboardingStatus_new" AS ENUM (
  'PENDING_SUBMISSION',
  'PENDING_FACILITY_REVIEW',
  'FACILITY_VERIFIED',
  'ACTIVE',
  'SUSPENDED'
);

ALTER TABLE "doctors"
  ALTER COLUMN "onboarding_status" DROP DEFAULT,
  ALTER COLUMN "onboarding_status" TYPE "DoctorOnboardingStatus_new"
    USING ("onboarding_status"::text::"DoctorOnboardingStatus_new"),
  ALTER COLUMN "onboarding_status" SET DEFAULT 'PENDING_SUBMISSION';

DROP TYPE "DoctorOnboardingStatus";
ALTER TYPE "DoctorOnboardingStatus_new" RENAME TO "DoctorOnboardingStatus";

ALTER TABLE "doctors"
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "credentials_submitted_at" TIMESTAMPTZ;

ALTER TABLE "doctor_credentials"
  ADD COLUMN IF NOT EXISTS "file_key" TEXT;

-- Backfill doctors that already uploaded credentials while still PENDING_SUBMISSION
UPDATE "doctors" d
SET "onboarding_status" = 'PENDING_FACILITY_REVIEW',
    "credentials_submitted_at" = COALESCE(d."credentials_submitted_at", NOW())
WHERE d."onboarding_status" = 'PENDING_SUBMISSION'
  AND EXISTS (SELECT 1 FROM "doctor_credentials" c WHERE c."doctor_id" = d."id");

-- 4. B2bContractStatus enum update & B2bStaffingContract columns
CREATE TYPE "B2bContractStatus_new" AS ENUM (
  'PENDING_FACILITY_SIGNATURE',
  'REVISION_REQUESTED',
  'PENDING_ADMIN_SIGNATURE',
  'ACTIVE',
  'EXPIRED',
  'TERMINATED'
);

ALTER TABLE "b2b_staffing_contracts"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "B2bContractStatus_new"
    USING (
      CASE
        WHEN "status"::text = 'PENDING_SIGNATURE' THEN 'PENDING_FACILITY_SIGNATURE'::"B2bContractStatus_new"
        ELSE "status"::text::"B2bContractStatus_new"
      END
    ),
  ALTER COLUMN "status" SET DEFAULT 'PENDING_FACILITY_SIGNATURE';

DROP TYPE "B2bContractStatus";
ALTER TYPE "B2bContractStatus_new" RENAME TO "B2bContractStatus";

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
  ADD COLUMN IF NOT EXISTS "facility_signed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "admin_signed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "termination_request_status" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "termination_request_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "termination_requested_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "terminated_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "terminated_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "terminated_by_user_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "b2b_staffing_contracts_documenso_envelope_id_key"
  ON "b2b_staffing_contracts" ("documenso_envelope_id")
  WHERE "documenso_envelope_id" IS NOT NULL;

COMMIT;
