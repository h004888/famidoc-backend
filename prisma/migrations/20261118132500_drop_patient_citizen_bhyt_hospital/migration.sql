ALTER TABLE "patients"
  DROP COLUMN IF EXISTS "citizen_id",
  DROP COLUMN IF EXISTS "health_insurance_number",
  DROP COLUMN IF EXISTS "registered_hospital";
