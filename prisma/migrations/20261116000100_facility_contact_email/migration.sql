-- Synced from remote DB server migration: facility contact email & user onboarding password flag
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "healthcare_facilities"
  ADD COLUMN IF NOT EXISTS "contact_email" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "representative_name" VARCHAR(100),
  ALTER COLUMN "verification_status" SET DEFAULT 'PENDING';
