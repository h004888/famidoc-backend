BEGIN;

-- Kho ca bệnh tiêu biểu do quản trị viên nhập và duyệt trước khi công khai.
CREATE TYPE "DoctorTreatedCaseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE doctor_treated_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id UUID NOT NULL,
  summary TEXT NOT NULL,
  status "DoctorTreatedCaseStatus" NOT NULL DEFAULT 'PENDING',
  rejection_reason TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT doctor_treated_cases_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT doctor_treated_cases_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX idx_doctor_treated_cases_lookup ON doctor_treated_cases(doctor_id, status);

-- Nội dung phạm vi chăm sóc chung của nền tảng, quản trị bởi ADMIN.
CREATE TYPE "PlatformCareCategory" AS ENUM ('SERVICE_MODE', 'COMMITMENT');

CREATE TABLE platform_care_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category "PlatformCareCategory" NOT NULL,
  title VARCHAR(150) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon VARCHAR(50),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_care_items_order ON platform_care_items(category, is_active, sort_order);

-- Nội dung khởi tạo lấy từ phần hardcode trước đây của trang chi tiết bác sĩ.
INSERT INTO platform_care_items (category, title, description, icon, sort_order) VALUES
  ('SERVICE_MODE', 'Khám tận nhà', 'Khám lâm sàng tại nhà, đo điện tim ECG và theo dõi định kỳ.', 'home', 1),
  ('SERVICE_MODE', 'Telehealth 24/7', 'Tư vấn video trực tiếp với bác sĩ phụ trách khi có triệu chứng bất thường.', 'videocam', 2),
  ('SERVICE_MODE', 'Khám tại cơ sở y tế', 'Thăm khám tại cơ sở y tế đối tác, ưu tiên đặt lịch cùng bác sĩ phụ trách.', 'local_hospital', 3),
  ('COMMITMENT', 'Hồ sơ bệnh án điện tử trọn đời', 'Toàn bộ kết quả khám, xét nghiệm và phác đồ được lưu trữ điện tử.', 'folder_shared', 1),
  ('COMMITMENT', 'Bác sĩ phụ trách lập phác đồ gia đình', 'Một bác sĩ theo dõi xuyên suốt và điều chỉnh phác đồ cho từng thành viên.', 'clinical_notes', 2),
  ('COMMITMENT', 'Điều phối chuyển tuyến', 'Bảo lãnh viện phí và phối hợp chuyển tuyến khi cần thiết.', 'verified_user', 3);

COMMIT;
