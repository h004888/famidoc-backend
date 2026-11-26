-- Sổ cái ca bác sĩ: mỗi (bác sĩ, ngày, ca) chỉ thuộc tối đa 1 hợp đồng.
CREATE TABLE "doctor_slot_bookings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "doctor_id" UUID NOT NULL,
  "slot_date" DATE NOT NULL,
  "slot_window" VARCHAR(20) NOT NULL,
  "contract_id" UUID NOT NULL,
  "encounter_id" UUID,
  "visit_type" VARCHAR(20) NOT NULL,
  "status" VARCHAR(10) NOT NULL,
  "hold_expires_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "doctor_slot_bookings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "doctor_slot_bookings_window_check" CHECK ("slot_window" IN ('MORNING','AFTERNOON')),
  CONSTRAINT "doctor_slot_bookings_visit_type_check" CHECK ("visit_type" IN ('HOME_VISIT','VIDEO')),
  CONSTRAINT "doctor_slot_bookings_status_check" CHECK ("status" IN ('HELD','BOOKED')),
  CONSTRAINT "doctor_slot_bookings_hold_check" CHECK ("status" <> 'HELD' OR "hold_expires_at" IS NOT NULL)
);

CREATE UNIQUE INDEX "doctor_slot_bookings_encounter_id_key" ON "doctor_slot_bookings"("encounter_id");
CREATE UNIQUE INDEX "doctor_slot_bookings_doctor_id_slot_date_slot_window_key" ON "doctor_slot_bookings"("doctor_id", "slot_date", "slot_window");
CREATE UNIQUE INDEX "doctor_slot_bookings_contract_id_slot_date_key" ON "doctor_slot_bookings"("contract_id", "slot_date");
CREATE INDEX "doctor_slot_bookings_contract_id_idx" ON "doctor_slot_bookings"("contract_id");

ALTER TABLE "doctor_slot_bookings" ADD CONSTRAINT "doctor_slot_bookings_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_slot_bookings" ADD CONSTRAINT "doctor_slot_bookings_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "doctor_slot_bookings" ADD CONSTRAINT "doctor_slot_bookings_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hợp đồng kết thúc/bị hủy → nhả ngay các ca từ hôm nay trở đi (mọi đường đổi trạng thái đều áp dụng).
CREATE OR REPLACE FUNCTION release_doctor_slots_on_contract_end() RETURNS trigger AS $$
BEGIN
  DELETE FROM "doctor_slot_bookings"
  WHERE "contract_id" = NEW."id" AND "slot_date" >= CURRENT_DATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_release_slots_on_contract_end"
AFTER UPDATE OF "contract_status" ON "medical_contracts"
FOR EACH ROW
WHEN (NEW."contract_status" IN ('TERMINATED','EXPIRED','APPROVAL_REJECTED','APPROVAL_EXPIRED')
      AND OLD."contract_status" IS DISTINCT FROM NEW."contract_status")
EXECUTE FUNCTION release_doctor_slots_on_contract_end();
