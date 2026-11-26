-- 1) Dedupe: giữ bản ghi mới nhất cho mỗi emr_id
DELETE FROM vital_signs v USING vital_signs d
WHERE v.emr_id IS NOT NULL AND v.emr_id = d.emr_id
  AND (v.recorded_at, v.id) < (d.recorded_at, d.id);
ALTER TABLE vital_signs ADD COLUMN weight_kg DECIMAL(5,1);
CREATE UNIQUE INDEX uq_vital_signs_emr_id ON vital_signs(emr_id);
ALTER TABLE encounter_participants ADD COLUMN absence_reason VARCHAR(255);
