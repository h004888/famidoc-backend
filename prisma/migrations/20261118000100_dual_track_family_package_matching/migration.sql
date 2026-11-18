-- Dual-Track Family Package Matching: Clinical Tier, Contract Hold TTL, Quota Proposals, Matching Sessions & Admin Queue

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DoctorClinicalTier') THEN
    CREATE TYPE "DoctorClinicalTier" AS ENUM ('JUNIOR', 'STANDARD', 'SENIOR');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuotaProposalStatus') THEN
    CREATE TYPE "QuotaProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MatchingSessionStatus') THEN
    CREATE TYPE "MatchingSessionStatus" AS ENUM ('MATCHED', 'QUEUED', 'CONFIRMED', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MatchingQueueStatus') THEN
    CREATE TYPE "MatchingQueueStatus" AS ENUM ('QUEUED', 'ASSIGNED', 'CONFIRMED', 'CANCELLED', 'EXPIRED');
  END IF;
END $$;

ALTER TABLE "doctors"
  ADD COLUMN IF NOT EXISTS "clinical_tier" "DoctorClinicalTier" NOT NULL DEFAULT 'STANDARD';

-- Backfill clinical_tier dựa trên experience_years và academic_title (idempotent)
UPDATE "doctors"
SET "clinical_tier" = CASE
  WHEN "experience_years" >= 12
    OR COALESCE("academic_title", '') ~* '(PGS|GS|TS|Tiến sĩ|CKII|CK2|Chuyên khoa II|Phó giáo sư|Giáo sư)'
    THEN 'SENIOR'::"DoctorClinicalTier"
  WHEN "experience_years" < 5
    AND NOT (COALESCE("academic_title", '') ~* '(ThS|Thạc sĩ|CKI|CK1|Chuyên khoa I|PGS|GS|TS|Tiến sĩ|CKII|CK2)')
    THEN 'JUNIOR'::"DoctorClinicalTier"
  ELSE 'STANDARD'::"DoctorClinicalTier"
END;

CREATE INDEX IF NOT EXISTS "idx_doctors_tier_status"
  ON "doctors" ("clinical_tier", "onboarding_status");

ALTER TABLE "medical_contracts"
  ADD COLUMN IF NOT EXISTS "hold_expires_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "idx_medical_contracts_doctor_quota"
  ON "medical_contracts" ("doctor_id", "contract_status", "hold_expires_at");

CREATE TABLE IF NOT EXISTS "doctor_quota_proposals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doctor_id" UUID NOT NULL,
  "facility_id" UUID NOT NULL,
  "requested_by_user_id" UUID NOT NULL,
  "current_max_panel" INTEGER NOT NULL,
  "requested_max_panel" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "QuotaProposalStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_user_id" UUID,
  "reviewed_at" TIMESTAMPTZ,
  "review_note" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "doctor_quota_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doctor_quota_proposals_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doctor_quota_proposals_facility_id_fkey"
    FOREIGN KEY ("facility_id") REFERENCES "healthcare_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "doctor_quota_proposals_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "doctor_quota_proposals_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_doctor_quota_proposals_doctor_status"
  ON "doctor_quota_proposals" ("doctor_id", "status");
CREATE INDEX IF NOT EXISTS "idx_doctor_quota_proposals_facility_status"
  ON "doctor_quota_proposals" ("facility_id", "status");
CREATE INDEX IF NOT EXISTS "idx_doctor_quota_proposals_status_created"
  ON "doctor_quota_proposals" ("status", "created_at");

CREATE TABLE IF NOT EXISTS "matching_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "family_id" UUID,
  "package_id" UUID NOT NULL,
  "member_count" INTEGER NOT NULL,
  "requested_tier" "DoctorClinicalTier",
  "age_groups" JSONB NOT NULL DEFAULT '[]',
  "care_categories" JSONB NOT NULL DEFAULT '[]',
  "district_area" VARCHAR(120),
  "sanitized_description" TEXT,
  "matched_doctor_id" UUID,
  "inferred_facility_id" UUID,
  "jev_model_version" VARCHAR(50),
  "jev_fit_score" DECIMAL(5, 4),
  "vacancy_score" DECIMAL(5, 4),
  "composite_score" DECIMAL(5, 4),
  "rationale" TEXT,
  "candidate_snapshots" JSONB,
  "status" "MatchingSessionStatus" NOT NULL DEFAULT 'MATCHED',
  "contract_id" UUID,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "matching_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "matching_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "matching_sessions_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "family_units"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "matching_sessions_package_id_fkey"
    FOREIGN KEY ("package_id") REFERENCES "service_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "matching_sessions_matched_doctor_id_fkey"
    FOREIGN KEY ("matched_doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "matching_sessions_inferred_facility_id_fkey"
    FOREIGN KEY ("inferred_facility_id") REFERENCES "healthcare_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "matching_sessions_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "matching_sessions_contract_id_key"
  ON "matching_sessions" ("contract_id") WHERE "contract_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_matching_sessions_user_created"
  ON "matching_sessions" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_matching_sessions_status_expires"
  ON "matching_sessions" ("status", "expires_at");

CREATE TABLE IF NOT EXISTS "matching_queue_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "matching_session_id" UUID,
  "user_id" UUID,
  "family_id" UUID,
  "package_id" UUID NOT NULL,
  "member_count" INTEGER NOT NULL,
  "requested_tier" "DoctorClinicalTier",
  "age_groups" JSONB NOT NULL DEFAULT '[]',
  "care_categories" JSONB NOT NULL DEFAULT '[]',
  "district_area" VARCHAR(120),
  "sanitized_description" TEXT,
  "fallback_reason" VARCHAR(100) NOT NULL,
  "status" "MatchingQueueStatus" NOT NULL DEFAULT 'QUEUED',
  "sla_expires_at" TIMESTAMPTZ NOT NULL,
  "assigned_doctor_id" UUID,
  "assigned_facility_id" UUID,
  "assigned_by_user_id" UUID,
  "assigned_at" TIMESTAMPTZ,
  "admin_note" TEXT,
  "contract_id" UUID,
  "cancelled_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "matching_queue_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "matching_queue_requests_matching_session_id_fkey"
    FOREIGN KEY ("matching_session_id") REFERENCES "matching_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "matching_queue_requests_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "matching_queue_requests_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "family_units"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "matching_queue_requests_package_id_fkey"
    FOREIGN KEY ("package_id") REFERENCES "service_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "matching_queue_requests_assigned_doctor_id_fkey"
    FOREIGN KEY ("assigned_doctor_id") REFERENCES "doctors"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "matching_queue_requests_assigned_facility_id_fkey"
    FOREIGN KEY ("assigned_facility_id") REFERENCES "healthcare_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "matching_queue_requests_assigned_by_user_id_fkey"
    FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "matching_queue_requests_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "matching_queue_requests_matching_session_id_key"
  ON "matching_queue_requests" ("matching_session_id") WHERE "matching_session_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "matching_queue_requests_contract_id_key"
  ON "matching_queue_requests" ("contract_id") WHERE "contract_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_matching_queue_status_sla"
  ON "matching_queue_requests" ("status", "sla_expires_at");
CREATE INDEX IF NOT EXISTS "idx_matching_queue_family_status"
  ON "matching_queue_requests" ("family_id", "status");
CREATE INDEX IF NOT EXISTS "idx_matching_queue_user_status"
  ON "matching_queue_requests" ("user_id", "status");
