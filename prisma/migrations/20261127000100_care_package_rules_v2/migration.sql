-- Đưa toàn bộ gói cũ về trạng thái ngừng bán (DEPRECATED) để giữ nguyên lịch sử hợp đồng và buổi khám đã có.
UPDATE "service_packages"
SET
  "status" = 'DEPRECATED',
  "retired_at" = COALESCE("retired_at", NOW())
WHERE "status" <> 'DEPRECATED';

-- Cập nhật chốt chặn DB: bỏ check đơn giá 500.000đ - 2.000.000đ và bỏ nhánh CONTRACT;
-- bắt buộc duration_months >= 1, periodic_visits_quota >= 1, telehealth_quota >= 1, tổng <= 7 * duration_months.
ALTER TABLE "service_packages"
  DROP CONSTRAINT IF EXISTS "service_packages_schedule_cap_chk";

ALTER TABLE "service_packages"
  ADD CONSTRAINT "service_packages_schedule_cap_chk" CHECK (
    "status" = 'DEPRECATED'
    OR "deleted_at" IS NOT NULL
    OR (
      "duration_months" >= 1
      AND "periodic_visits_quota" >= 1
      AND "telehealth_quota" >= 1
      AND "periodic_visits_quota" + "telehealth_quota" <= 7 * "duration_months"
    )
  );
