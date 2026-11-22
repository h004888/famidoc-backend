ALTER TABLE "prescriptions" ADD COLUMN IF NOT EXISTS "clinical_context" JSONB;
ALTER TABLE "prescription_details"
  ADD COLUMN IF NOT EXISTS "medication_code" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "active_ingredient" VARCHAR(255);
