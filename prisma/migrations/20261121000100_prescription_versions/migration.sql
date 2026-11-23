BEGIN;
ALTER TABLE "prescriptions"
  ADD COLUMN "record_snapshot" JSONB,
  ADD COLUMN "replaces_prescription_id" UUID,
  ADD COLUMN "replacement_reason" TEXT,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ;
ALTER TABLE "prescription_details" ADD COLUMN "medication_type" VARCHAR(30) NOT NULL DEFAULT 'SINGLE_INGREDIENT';
CREATE UNIQUE INDEX "prescriptions_replaces_prescription_id_key" ON "prescriptions"("replaces_prescription_id");
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_replaces_prescription_id_fkey"
  FOREIGN KEY ("replaces_prescription_id") REFERENCES "prescriptions"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Giữ nội dung gốc. Việc thay thế chỉ cập nhật trạng thái/thời điểm hủy bản cũ.
CREATE FUNCTION protect_prescription_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Prescription records cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - 'status' - 'cancelled_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'cancelled_at') THEN
    RAISE EXCEPTION 'Prescription content is immutable; create a replacement';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER prescriptions_preserve_original BEFORE UPDATE OR DELETE ON "prescriptions"
  FOR EACH ROW EXECUTE FUNCTION protect_prescription_record();
CREATE FUNCTION protect_prescription_detail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Prescription details are immutable; create a replacement';
END; $$;
CREATE TRIGGER prescription_details_preserve_original BEFORE UPDATE OR DELETE ON "prescription_details"
  FOR EACH ROW EXECUTE FUNCTION protect_prescription_detail();
COMMIT;
