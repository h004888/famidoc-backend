-- Add separate Business Registration Certificate (DKKD) object storage key for HealthcareFacility
ALTER TABLE "healthcare_facilities"
  ADD COLUMN IF NOT EXISTS "business_license_key" TEXT;
