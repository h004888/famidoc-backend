-- Add VietQR bankBin and bankCode identification fields to HealthcareFacility
ALTER TABLE "healthcare_facilities"
  ADD COLUMN IF NOT EXISTS "bank_bin" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "bank_code" VARCHAR(20);
