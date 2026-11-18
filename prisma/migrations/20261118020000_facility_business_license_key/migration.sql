-- Synced from remote DB server migration: facility business license key
ALTER TABLE "healthcare_facilities"
  ADD COLUMN IF NOT EXISTS "business_license_key" TEXT;
