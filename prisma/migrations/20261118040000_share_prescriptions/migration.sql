ALTER TABLE "prescriptions"
  ALTER COLUMN "doctor_signature" DROP NOT NULL,
  ALTER COLUMN "valid_until" DROP NOT NULL,
  ADD COLUMN "recipient_user_id" UUID;

ALTER TABLE "prescriptions"
  ADD CONSTRAINT "prescriptions_recipient_user_id_fkey"
  FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "prescriptions_recipient_user_id_created_at_idx"
  ON "prescriptions" ("recipient_user_id", "created_at" DESC);

ALTER TABLE "prescription_details"
  ADD COLUMN "strength" VARCHAR(50),
  ADD COLUMN "administration_route" VARCHAR(50),
  ADD COLUMN "line_number" INTEGER NOT NULL DEFAULT 0;
