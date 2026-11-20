-- Thêm các trường thông tin y tế cơ bản cho hồ sơ bệnh nhân / thành viên hộ gia đình
ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "blood_type" VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "registered_hospital" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "chronic_diseases" TEXT;
