-- Chặn ở tầng DB các gói đang bán/nháp làm vỡ lịch hoặc sai giá (quy tắc S1, P1, P3).
-- Gói DEPRECATED hoặc đã xóa mềm được bỏ qua để giữ nguyên lịch sử.
-- Yêu cầu: gói DONG_HANH_V2 (124) phải được ngừng bán trước khi chạy migration này.
ALTER TABLE "service_packages"
  ADD CONSTRAINT "service_packages_schedule_cap_chk" CHECK (
    "status" = 'DEPRECATED'
    OR "deleted_at" IS NOT NULL
    OR (
      "periodic_visits_quota" >= 1
      AND "periodic_visits_quota"
        + CASE WHEN "video_quota_policy" = 'CONTRACT' THEN 0 ELSE "telehealth_quota" END
        <= 7 * "duration_months"
      AND COALESCE(
        "home_visit_unit_price",
        "base_price" / NULLIF("periodic_visits_quota", 0)
      ) BETWEEN 500000 AND 2000000
    )
  );
