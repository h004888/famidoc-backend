# 3. Database Design

### 3.1 users
*Model thực thể: `User`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh người dùng (UUID v4 sinh tự động) |
| phone | VARCHAR(15) | NOT NULL, UNIQUE | Số điện thoại đăng nhập & nhận OTP (chuẩn E.164, duy nhất) |
| email | VARCHAR(150) | NOT NULL, UNIQUE | Địa chỉ email định danh & nhận thông báo giao dịch (duy nhất) |
| password_hash | VARCHAR(255) | NOT NULL | Mã băm mật khẩu bảo mật (Argon2id/BCrypt), tuyệt đối không lưu plaintext |
| role | VARCHAR(50) | NOT NULL | Vai trò người dùng trong hệ thống (ADMIN, HEALTHCARE_FACILITY, DOCTOR, FAMILY_REP) |
| full_name | VARCHAR(100) | NOT NULL | Họ và tên đầy đủ của người dùng |
| avatar_url | VARCHAR(255) |  | Đường dẫn tải ảnh đại diện người dùng từ Cloud Storage |
| status | VARCHAR(50) | NOT NULL, DEFAULT PENDING | Trạng thái tài khoản (PENDING, ACTIVE, SUSPENDED, LOCKED) |
| failed_login_attempts | INTEGER | NOT NULL, DEFAULT 0 | Số lần đăng nhập sai liên tiếp (tự động khóa tạm thời khi ≥ 5) |
| locked_until | TIMESTAMPTZ |  | Thời điểm hết hạn khóa tài khoản tạm thời do nhập sai mật khẩu |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |


### 3.2 notifications
*Model thực thể: `Notification`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| user_id | UUID | NOT NULL, FK -> users(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng user |
| title | VARCHAR(200) | NOT NULL | Tiêu đề ngắn gọn của thông báo |
| content | TEXT | NOT NULL | Nội dung chi tiết thông báo hiển thị cho người dùng |
| type | VARCHAR(50) | NOT NULL | Phân loại thông báo (APPOINTMENT, CONTRACT, PAYMENT, SYSTEM) |
| reference_id | UUID |  | ID tham chiếu đến thực thể liên quan (hợp đồng, buổi khám, hóa đơn) |
| is_read | BOOLEAN | NOT NULL, DEFAULT false | Cờ đánh dấu người dùng đã đọc thông báo hay chưa (true/false) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |


### 3.3 healthcare_facilities
*Model thực thể: `HealthcareFacility`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| user_id | UUID | NOT NULL, UNIQUE, FK -> users(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng user |
| facility_name | VARCHAR(255) | NOT NULL | Tên pháp nhân chính thức của cơ sở y tế đối tác |
| license_number | VARCHAR(50) | NOT NULL, UNIQUE | Số giấy phép hoạt động khám chữa bệnh do Bộ/Sở Y tế cấp |
| tax_code | VARCHAR(20) | NOT NULL, UNIQUE | Mã số thuế doanh nghiệp của cơ sở y tế (duy nhất) |
| address | TEXT | NOT NULL | Địa chỉ trụ sở hoạt động của cơ sở y tế |
| hotline | VARCHAR(15) | NOT NULL | Số điện thoại đường dây nóng hỗ trợ khẩn cấp |
| bank_name | VARCHAR(100) | NOT NULL | Tên ngân hàng thụ hưởng giải ngân quyết toán |
| bank_account_number | VARCHAR(50) | NOT NULL | Số tài khoản ngân hàng thụ hưởng của cơ sở |
| bank_account_holder | VARCHAR(100) | NOT NULL | Tên chủ tài khoản thụ hưởng theo đăng ký kinh doanh |
| verification_status | VARCHAR(50) | NOT NULL, DEFAULT ACTIVE | Trạng thái xác thực hồ sơ pháp lý CSYT (PENDING, ACTIVE, SUSPENDED) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |


### 3.4 doctors
*Model thực thể: `Doctor`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| user_id | UUID | NOT NULL, UNIQUE, FK -> users(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng user |
| facility_id | UUID | NOT NULL, FK -> healthcare_facilities(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng facility |
| doctor_name | VARCHAR(100) | NOT NULL | Họ và tên bác sĩ gia đình |
| specialty | VARCHAR(100) | NOT NULL | Chuyên khoa đào tạo (Y học gia đình, Nội tổng quát, Nhi khoa...) |
| academic_title | VARCHAR(50) |  | Học hàm, học vị chuyên môn (ThS.BS, BSCK1, PGS.TS) |
| experience_years | INTEGER | NOT NULL | Số năm kinh nghiệm hành nghề lâm sàng thực tế |
| bio | TEXT |  | Tóm tắt tiểu sử nghề nghiệp, thế mạnh điều trị và giới thiệu bác sĩ |
| active_panel_count | INTEGER | NOT NULL, DEFAULT 0 | Số lượng gia đình hiện đang quản lý chăm sóc chủ động |
| max_panel_capacity | INTEGER | NOT NULL, DEFAULT 30 | Hạn mức tối đa số gia đình quản lý đồng thời (mặc định 30 hộ) |
| rating_avg | DECIMAL(3, 2) | NOT NULL, DEFAULT 5.00 | Điểm đánh giá trung bình từ các hộ gia đình (thang điểm 1.00 - 5.00) |
| total_reviews | INTEGER | NOT NULL, DEFAULT 0 | Tổng số lượt đánh giá hợp lệ từ bệnh nhân/hộ gia đình |
| onboarding_status | VARCHAR(50) | NOT NULL, DEFAULT PENDING_SUBMISSION | Trạng thái phê duyệt onboarding bác sĩ (PENDING_SUBMISSION, ACTIVE...) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |


### 3.5 doctor_credentials
*Model thực thể: `DoctorCredential`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| doctor_id | UUID | NOT NULL, FK -> doctors(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng doctor |
| credential_type | VARCHAR(50) | NOT NULL | Loại văn bằng, chứng chỉ (PRACTICE_LICENSE_CCHN, FAMILY_MEDICINE_CERT, DEGREE) |
| certificate_number | VARCHAR(100) | NOT NULL | Số hiệu văn bằng/chứng chỉ hành nghề y tế |
| issue_date | DATE | NOT NULL | Ngày cấp văn bằng/chứng chỉ hành nghề |
| issuing_authority | VARCHAR(200) | NOT NULL | Cơ quan/Trường đại học có thẩm quyền cấp chứng chỉ |
| file_url | VARCHAR(255) | NOT NULL | Đường dẫn file scan văn bằng chứng chỉ được mã hóa lưu trữ |
| facility_verified | BOOLEAN | NOT NULL, DEFAULT false | Xác nhận tính xác thực từ CSYT trực tiếp quản lý |
| facility_verified_by | UUID | FK -> users(id) | Thuộc tính nghiệp vụ |
| facility_verified_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |
| platform_approved | BOOLEAN | NOT NULL, DEFAULT false | Xác nhận thẩm định độc lập từ Admin nền tảng |
| platform_approved_by | UUID | FK -> users(id) | Thuộc tính nghiệp vụ |
| platform_approved_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |
| rejection_reason | TEXT |  | Lý do từ chối phê duyệt chứng chỉ (nếu có) |


### 3.6 doctor_shifts
*Model thực thể: `DoctorShift`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| doctor_id | UUID | NOT NULL, FK -> doctors(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng doctor |
| facility_id | UUID | NOT NULL, FK -> healthcare_facilities(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng facility |
| shift_date | DATE | NOT NULL | Ngày làm việc theo lịch phân công |
| start_time | TIME | NOT NULL | Giờ bắt đầu ca trực/khám |
| end_time | TIME | NOT NULL | Giờ kết thúc ca trực/khám |
| shift_type | VARCHAR(50) | NOT NULL | Loại ca trực (HOME_VISIT, TELEHEALTH, CLINIC_DUTY) |
| notes | TEXT |  | Ghi chú điều phối ca làm việc |


### 3.7 service_packages
*Model thực thể: `ServicePackage`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| package_code | VARCHAR(50) | NOT NULL, UNIQUE | Mã định danh gói dịch vụ y tế gia đình (duy nhất) |
| package_name | VARCHAR(150) | NOT NULL | Tên thương mại của gói chăm sóc sức khỏe |
| duration_months | INTEGER | NOT NULL | Thời hạn hiệu lực của gói (thường là 3, 6, 12 tháng) |
| base_price | DECIMAL(12, 2) | NOT NULL | Giá niêm yết cơ bản của gói dịch vụ (VNĐ) |
| periodic_visits_quota | INTEGER | NOT NULL | Định ngạch số lần bác sĩ đến khám định kỳ tại nhà |
| telehealth_quota | INTEGER | NOT NULL | Định ngạch số lượt tư vấn khám bệnh từ xa qua video |
| max_members | INTEGER | NOT NULL, DEFAULT 6 | Số lượng thành viên tối đa trong hộ gia đình được bảo trợ |
| status | VARCHAR(50) | NOT NULL, DEFAULT ACTIVE | Trạng thái phát hành gói dịch vụ (DRAFT, ACTIVE, DEPRECATED) |
| deleted_at | TIMESTAMPTZ |  | Thời điểm xóa mềm bản ghi (Soft delete) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |
| lineage_code | VARCHAR(50) | NOT NULL | Thuộc tính nghiệp vụ |
| version | INTEGER | NOT NULL, DEFAULT 1 | Thuộc tính nghiệp vụ |
| description | TEXT | NOT NULL, DEFAULT '' | Thuộc tính nghiệp vụ |
| included_members | INTEGER | NOT NULL, DEFAULT 1 | Số thành viên mặc định đi kèm trong giá cơ bản |
| additional_member_monthly_price | DECIMAL(12, 2) | NOT NULL, DEFAULT 0 | Đơn giá phụ thu hàng tháng cho mỗi thành viên bổ sung |
| quota_period | VARCHAR(20) | NOT NULL, DEFAULT 'PER_TERM' | Thuộc tính nghiệp vụ |
| published_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |
| retired_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |


### 3.8 b2b_staffing_contracts
*Model thực thể: `B2bStaffingContract`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| contract_code | VARCHAR(50) | NOT NULL, UNIQUE | Mã hợp đồng khung hợp tác cung ứng nhân sự y tế |
| facility_id | UUID | NOT NULL, FK -> healthcare_facilities(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng facility |
| platform_commission_rate | DECIMAL(5, 2) | NOT NULL, DEFAULT 15.00 | Tỷ lệ hoa hồng nền tảng khấu trừ (% doanh thu) |
| facility_revenue_rate | DECIMAL(5, 2) | NOT NULL, DEFAULT 85.00 | Tỷ lệ doanh thu cơ sở y tế được hưởng (% doanh thu) |
| start_date | DATE | NOT NULL | Ngày bắt đầu có hiệu lực pháp lý của hợp đồng B2B |
| end_date | DATE | NOT NULL | Ngày kết thúc hiệu lực hợp đồng hợp tác B2B |
| signed_pdf_url | VARCHAR(255) |  | Đường dẫn file PDF hợp đồng đã ký số 2 bên |
| status | VARCHAR(50) | NOT NULL, DEFAULT PENDING_SIGNATURE | Trạng thái hợp đồng B2B (PENDING_SIGNATURE, ACTIVE, EXPIRED, TERMINATED) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |


### 3.9 family_units
*Model thực thể: `FamilyUnit`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| representative_user_id | UUID | NOT NULL, UNIQUE, FK -> users(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng representative_user |
| home_address | TEXT | NOT NULL | Địa chỉ cư trú cố định của hộ gia đình (phục vụ bác sĩ đến khám tại nhà) |
| emergency_phone | VARCHAR(15) | NOT NULL | Số điện thoại liên hệ khẩn cấp 24/7 của gia đình |
| status | VARCHAR(50) | NOT NULL, DEFAULT ACTIVE | Trạng thái hồ sơ hộ gia đình (ACTIVE, SUSPENDED) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |


### 3.10 patients
*Model thực thể: `Patient`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| family_id | UUID | NOT NULL, FK -> family_units(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng family |
| full_name | VARCHAR(100) | NOT NULL | Họ và tên bệnh nhân (thành viên gia đình) |
| date_of_birth | DATE | NOT NULL | Ngày tháng năm sinh của bệnh nhân |
| gender | VARCHAR(50) | NOT NULL | Giới tính sinh học (MALE, FEMALE, OTHER) |
| relationship_to_head | VARCHAR(50) | NOT NULL | Mối quan hệ nhân thân với chủ hộ (Bố, Mẹ, Con, Vợ, Chồng...) |
| citizen_id | VARCHAR(20) |  | Số CCCD/Định danh cá nhân của bệnh nhân |
| health_insurance_number | VARCHAR(30) |  | Mã số thẻ bảo hiểm y tế quốc gia (BHYT) |
| status | VARCHAR(50) | NOT NULL, DEFAULT ACTIVE | Trạng thái theo dõi y tế của bệnh nhân (ACTIVE, INACTIVE) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |


### 3.11 patient_allergies
*Model thực thể: `PatientAllergy`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| patient_id | UUID | NOT NULL, FK -> patients(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng patient |
| allergen_type | VARCHAR(50) | NOT NULL | Nhóm dị nguyên gây dị ứng (DRUG, FOOD, ENVIRONMENTAL) |
| allergen_name | VARCHAR(150) | NOT NULL | Tên hoạt chất thuốc/thực phẩm/dị nguyên gây kích ứng |
| severity | VARCHAR(50) | NOT NULL | Mức độ nghiêm trọng (MILD, MODERATE, LIFE_THREATENING_ANAPHYLAXIS) |
| clinical_manifestation | TEXT |  | Triệu chứng lâm sàng khi phơi nhiễm (mẩn ngứa, phù nề, khó thở...) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |


### 3.12 patient_documents
*Model thực thể: `PatientDocument`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| patient_id | UUID | NOT NULL, FK -> patients(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng patient |
| document_name | VARCHAR(200) | NOT NULL | Tên hồ sơ y tế / kết quả xét nghiệm / chẩn đoán hình ảnh |
| document_type | VARCHAR(50) | NOT NULL | Loại tài liệu (LAB_RESULT, IMAGING_XRAY_CT, DISCHARGE_SUMMARY) |
| file_url | VARCHAR(255) | NOT NULL | Đường dẫn tải tài liệu y bạ lưu trữ an toàn |
| file_size_kb | INTEGER | NOT NULL | Dung lượng tệp tính bằng Kilobytes (KB) |
| recorded_date | DATE | NOT NULL | Ngày thực hiện cận lâm sàng hoặc ngày ban hành hồ sơ |
| uploaded_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thuộc tính nghiệp vụ |


### 3.13 medical_contracts
*Model thực thể: `MedicalContract`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| contract_number | VARCHAR(50) | NOT NULL, UNIQUE | Số hợp đồng dịch vụ y tế 4 bên duy nhất (Mã HĐ điện tử) |
| family_id | UUID | NOT NULL, FK -> family_units(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng family |
| facility_id | UUID | NOT NULL, FK -> healthcare_facilities(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng facility |
| doctor_id | UUID | NOT NULL, FK -> doctors(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng doctor |
| package_id | UUID | NOT NULL, FK -> service_packages(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng package |
| total_amount | DECIMAL(12, 2) | NOT NULL | Tổng giá trị hợp đồng bao gồm các phụ lục và thành viên bổ sung (VNĐ) |
| remaining_home_visits | INTEGER | NOT NULL | Số lượt khám tại nhà còn lại trong kỳ hợp đồng |
| remaining_telehealth | INTEGER | NOT NULL | Số lượt khám từ xa (Telehealth) còn lại |
| start_date | DATE | NOT NULL | Ngày bắt đầu có hiệu lực dịch vụ y tế |
| end_date | DATE | NOT NULL | Ngày đáo hạn hợp đồng chăm sóc y tế gia đình |
| contract_status | VARCHAR(50) | NOT NULL, DEFAULT PENDING_APPROVAL | Trạng thái hợp đồng (PENDING_APPROVAL, PENDING_PAYMENT, ACTIVE...) |
| termination_reason | TEXT |  | Thuộc tính nghiệp vụ |
| terminated_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |
| billing_snapshot | JSONB |  | Bản chụp snapshot cấu trúc tính giá và quyền lợi tại thời điểm ký kết |
| is_demo | BOOLEAN | NOT NULL, DEFAULT false | Thuộc tính nghiệp vụ |
| upgraded_from_id | UUID | FK -> medical_contracts(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng upgraded_from |
| member_count | INTEGER | NOT NULL, DEFAULT 1 | Số thành viên gia đình được đăng ký bảo trợ trong hợp đồng |
| legacy_member_ids | JSONB |  | Thuộc tính nghiệp vụ |
| termination_requests | JSONB | NOT NULL, DEFAULT '[]' | Thuộc tính nghiệp vụ |


### 3.14 contract_signatures
*Model thực thể: `ContractSignature`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| contract_id | UUID | NOT NULL, FK -> medical_contracts(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng contract |
| addendum_id | UUID | FK -> contract_addenda(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng addendum |
| signer_role | VARCHAR(50) | NOT NULL | Vai trò chủ thể ký hợp đồng (FAMILY_REP, ADMIN, HEALTHCARE_FACILITY, ASSIGNED_DOCTOR) |
| signer_user_id | UUID | NOT NULL, FK -> users(id) | Khóa ngoại liên kết tới bảng signer_user |
| signature_hash | TEXT | NOT NULL | Mã băm chữ ký số điện tử của đương sự (chống chối bỏ) |
| terms_hash | VARCHAR(64) |  | Mã băm nội dung điều khoản hợp đồng tại thời điểm ký (SHA-256) |
| signed_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm ghi nhận chữ ký điện tử |
| ip_address | VARCHAR(45) | NOT NULL | Địa chỉ IP mạng của thiết bị thực hiện ký kết |


### 3.15 contract_addenda
*Model thực thể: `ContractAddendum`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| contract_id | UUID | NOT NULL, FK -> medical_contracts(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng contract |
| addendum_number | VARCHAR(50) | NOT NULL, UNIQUE | Số phụ lục hợp đồng mở rộng / bổ sung |
| addendum_type | VARCHAR(50) | NOT NULL | Loại phụ lục (QUOTA_EXPANSION, TERM_EXTENSION, MEMBER_EXTENSION) |
| additional_amount | DECIMAL(12, 2) | NOT NULL | Số tiền phụ thu bổ sung của phụ lục (VNĐ) |
| extra_home_visits | INTEGER | NOT NULL, DEFAULT 0 | Số lượt khám tại nhà được cấp thêm qua phụ lục |
| extra_telehealth | INTEGER | NOT NULL, DEFAULT 0 | Số lượt khám từ xa được cấp thêm qua phụ lục |
| extended_end_date | DATE |  | Thuộc tính nghiệp vụ |
| status | VARCHAR(50) | NOT NULL, DEFAULT PENDING_PAYMENT | Trạng thái phụ lục (PENDING_PAYMENT, ACTIVE, CANCELLED) |
| terms_snapshot | JSONB | NOT NULL, DEFAULT '{}' | Thuộc tính nghiệp vụ |
| terms_hash | VARCHAR(64) | NOT NULL, DEFAULT '' | Chuỗi mã băm bảo mật kiểm tra tính toàn vẹn |
| request_key | VARCHAR(100) | UNIQUE | Thuộc tính nghiệp vụ |
| activated_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |


### 3.16 encounters
*Model thực thể: `Encounter`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| contract_id | UUID | NOT NULL, FK -> medical_contracts(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng contract |
| patient_id | UUID | NOT NULL, FK -> patients(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng patient |
| doctor_id | UUID | NOT NULL, FK -> doctors(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng doctor |
| encounter_type | VARCHAR(50) | NOT NULL | Hình thức khám bệnh (HOME_VISIT: tại nhà, TELEHEALTH: trực tuyến) |
| category | VARCHAR(50) | NOT NULL | Phân loại buổi khám (PERIODIC_ROUTINE: định kỳ, AD_HOC_ON_DEMAND: đột xuất) |
| scheduled_date | DATE | NOT NULL | Ngày hẹn bác sĩ thực hiện buổi khám |
| scheduled_time | TIME | NOT NULL | Khung giờ bắt đầu buổi thăm khám |
| reschedule_count | INTEGER | NOT NULL, DEFAULT 0 | Số lần đã yêu cầu dời lịch hẹn |
| encounter_status | VARCHAR(50) | NOT NULL, DEFAULT REQUESTED | Tiến độ thực hiện (REQUESTED, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED) |
| cancel_reason | TEXT |  | Lý do hủy buổi khám bệnh |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |


### 3.17 telehealth_sessions
*Model thực thể: `TelehealthSession`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| encounter_id | UUID | NOT NULL, UNIQUE, FK -> encounters(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng encounter |
| room_sid | VARCHAR(100) | NOT NULL, UNIQUE | Định danh duy nhất phòng họp video trực tuyến (WebRTC room SID) |
| started_at | TIMESTAMPTZ |  | Thời điểm bắt đầu kết nối cuộc gọi video |
| ended_at | TIMESTAMPTZ |  | Thời điểm kết thúc cuộc gọi video |
| duration_seconds | INTEGER | NOT NULL, DEFAULT 0 | Tổng thời lượng cuộc gọi tư vấn tính bằng giây |
| network_quality_score | VARCHAR(20) |  | Điểm chất lượng đường truyền mạng trong buổi gọi |
| is_fallback_chat | BOOLEAN | NOT NULL, DEFAULT false | Cờ kích hoạt kênh chat dự phòng khi mạng yếu/mất kết nối video |


### 3.18 clinical_emr
*Model thực thể: `ClinicalEmr`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| encounter_id | UUID | NOT NULL, UNIQUE, FK -> encounters(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng encounter |
| chief_complaint | TEXT | NOT NULL | Lý do vào khám / Triệu chứng khởi phát chính (Chữ S trong SOAP) |
| anamnesis | TEXT |  | Tiền sử bệnh bản thân và bệnh sử gia đình liên quan |
| clinical_findings | TEXT | NOT NULL | Khám lâm sàng khách quan và dấu hiệu thực thể (Chữ O trong SOAP) |
| icd10_code | VARCHAR(10) | NOT NULL | Mã phân loại bệnh tật quốc tế tiêu chuẩn ICD-10 |
| icd10_diagnosis | VARCHAR(255) | NOT NULL | Chẩn đoán xác định bệnh theo chuẩn y khoa (Chữ A trong SOAP) |
| treatment_plan | TEXT | NOT NULL | Kế hoạch điều trị, lời dặn và hướng dẫn chăm sóc (Chữ P trong SOAP) |
| is_finalized | BOOLEAN | NOT NULL, DEFAULT false | Cờ khóa bệnh án điện tử sau khi bác sĩ ký số (bất biến) |
| finalized_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |
| doctor_signature_hash | TEXT |  | Mã băm chữ ký số bác sĩ xác nhận hoàn thành bệnh án |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |


### 3.19 vital_signs
*Model thực thể: `VitalSign`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| emr_id | UUID | FK -> clinical_emr(id), ON DELETE SETNULL | Khóa ngoại liên kết tới bảng emr |
| patient_id | UUID | NOT NULL, FK -> patients(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng patient |
| systolic_bp | INTEGER |  | Huyết áp tâm thu (mmHg) |
| diastolic_bp | INTEGER |  | Huyết áp tâm trương (mmHg) |
| heart_rate | INTEGER |  | Nhịp tim đo được (nhịp/phút) |
| temperature | DECIMAL(4, 1) |  | Nhiệt độ cơ thể (độ C, chính xác 1 chữ số thập phân) |
| spo2 | INTEGER |  | Độ bão hòa oxy trong máu (%) |
| respiratory_rate | INTEGER |  | Nhịp thở (lần/phút) |
| blood_glucose | DECIMAL(5, 2) |  | Đường huyết mao mạch (mmol/L) |
| is_abnormal_alert | BOOLEAN | NOT NULL, DEFAULT false | Cờ cảnh báo chỉ số sinh hiệu vượt ngưỡng an toàn |
| recorded_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thuộc tính nghiệp vụ |


### 3.20 prescriptions
*Model thực thể: `Prescription`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| emr_id | UUID | NOT NULL, FK -> clinical_emr(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng emr |
| prescription_code | VARCHAR(50) | NOT NULL, UNIQUE | Mã đơn thuốc điện tử quốc gia duy nhất |
| doctor_signature | TEXT | NOT NULL | Chữ ký số xác nhận kê đơn của bác sĩ phụ trách |
| prescribed_date | DATE | NOT NULL | Ngày phát hành đơn thuốc |
| valid_until | DATE | NOT NULL | Hạn chót mua thuốc theo quy định dược phẩm |
| instructions | TEXT |  | Lời dặn chung của bác sĩ về chế độ dùng thuốc và kiêng cữ |
| status | VARCHAR(50) | NOT NULL, DEFAULT ISSUED | Trạng thái đơn thuốc (ISSUED, EXPIRED, CANCELLED) |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |


### 3.21 prescription_details
*Model thực thể: `PrescriptionDetail`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| prescription_id | UUID | NOT NULL, FK -> prescriptions(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng prescription |
| medication_name | VARCHAR(150) | NOT NULL | Tên biệt dược hoặc tên hoạt chất thuốc kê đơn |
| dosage | VARCHAR(50) | NOT NULL | Hàm lượng và nồng độ thuốc (ví dụ: 500mg, 10ml) |
| quantity | INTEGER | NOT NULL | Tổng số lượng thuốc được cấp phát |
| unit | VARCHAR(30) | NOT NULL | Đơn vị tính thuốc (viên, gói, chai, ống) |
| frequency | VARCHAR(100) | NOT NULL | Liều dùng và số lần uống trong ngày (ví dụ: Ngày 2 lần, mỗi lần 1 viên sau ăn) |
| duration_days | INTEGER | NOT NULL | Số ngày chỉ định dùng thuốc liên tục |


### 3.22 referral_orders
*Model thực thể: `ReferralOrder`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| emr_id | UUID | NOT NULL, UNIQUE, FK -> clinical_emr(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng emr |
| referral_code | VARCHAR(50) | NOT NULL, UNIQUE | Mã số giấy chuyển tuyến khám chữa bệnh |
| target_facility_name | VARCHAR(255) | NOT NULL | Tên bệnh viện / cơ sở y tế tuyến trên tiếp nhận điều trị |
| reason_for_referral | TEXT | NOT NULL | Lý do chuyên môn cần chuyển viện vượt tuyến |
| clinical_summary | TEXT | NOT NULL | Tóm tắt tình trạng lâm sàng và các xử trí ban đầu |
| transportation_method | VARCHAR(100) |  | Phương tiện vận chuyển người bệnh (Xe cấp cứu 115, tự túc) |
| issued_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thuộc tính nghiệp vụ |


### 3.23 invoices
*Model thực thể: `Invoice`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| invoice_code | VARCHAR(50) | NOT NULL, UNIQUE | Mã hóa đơn / Yêu cầu thanh toán duy nhất |
| transfer_content | VARCHAR(140) |  | Nội dung chuyển khoản VietQR chốt cố định phục vụ đối soát tự động |
| contract_id | UUID | FK -> medical_contracts(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng contract |
| addendum_id | UUID | FK -> contract_addenda(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng addendum |
| encounter_id | UUID | FK -> encounters(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng encounter |
| gross_amount | DECIMAL(12, 2) | NOT NULL | Số tiền trước thuế (VNĐ) |
| vat_amount | DECIMAL(12, 2) | NOT NULL, DEFAULT 0.00 | Tiền thuế GTGT VAT (VNĐ) |
| total_payable | DECIMAL(12, 2) | NOT NULL | Tổng số tiền thực tế khách hàng phải thanh toán (VNĐ) |
| payment_gateway | VARCHAR(50) | NOT NULL, DEFAULT 'VIETQR' | Kênh cổng thanh toán (VIETQR, VNPAY, MOMO) |
| payment_status | VARCHAR(50) | NOT NULL, DEFAULT PENDING | Trạng thái thanh toán (PENDING, PAID, EXPIRED, CANCELLED) |
| expired_at | TIMESTAMPTZ | NOT NULL | Thời hạn hết hiệu lực của mã thanh toán QR |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |
| environment | VARCHAR(10) | NOT NULL, DEFAULT 'TEST' | Thuộc tính nghiệp vụ |
| attempt | INTEGER | NOT NULL, DEFAULT 1 | Thuộc tính nghiệp vụ |
| expected_account_number | VARCHAR(50) |  | Thuộc tính nghiệp vụ |
| expected_gateway | VARCHAR(50) |  | Thuộc tính nghiệp vụ |
| paid_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |
| accepted_transaction_id | UUID | UNIQUE, FK -> payment_transactions(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng accepted_transaction |


### 3.24 payment_transactions
*Model thực thể: `PaymentTransaction`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| invoice_id | UUID | FK -> invoices(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng invoice |
| gateway_transaction_id | VARCHAR(100) | NOT NULL | Mã giao dịch từ cổng thanh toán / ngân hàng đối tác |
| amount_received | DECIMAL(12, 2) | NOT NULL | Số tiền ngân hàng thực nhận vào tài khoản (VNĐ) |
| payment_time | TIMESTAMPTZ | NOT NULL | Thời điểm giao dịch thành công ghi nhận tại ngân hàng |
| signature_verified | BOOLEAN | NOT NULL | Xác nhận chữ ký bảo mật webhook hợp lệ từ ngân hàng |
| webhook_payload | JSONB | NOT NULL | Toàn bộ dữ liệu JSON nhận từ webhook phục vụ tra soát |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| environment | VARCHAR(10) | NOT NULL, DEFAULT 'TEST' | Thuộc tính nghiệp vụ |
| fingerprint | VARCHAR(64) | NOT NULL | Thuộc tính nghiệp vụ |
| bank_reference_key | TEXT |  | Thuộc tính nghiệp vụ |
| gateway | VARCHAR(100) | NOT NULL | Thuộc tính nghiệp vụ |
| account_number | VARCHAR(50) | NOT NULL | Thuộc tính nghiệp vụ |
| transfer_type | VARCHAR(10) | NOT NULL | Thuộc tính nghiệp vụ |
| payment_code | VARCHAR(50) |  | Thuộc tính nghiệp vụ |
| reference_code | VARCHAR(150) | NOT NULL, DEFAULT '' | Thuộc tính nghiệp vụ |
| outcome | VARCHAR(30) | NOT NULL | Kết quả xử lý đối soát giao dịch (SUCCESS, MISMATCH, UNMATCHED) |
| reason | VARCHAR(50) |  | Thuộc tính nghiệp vụ |


### 3.25 facility_settlements
*Model thực thể: `FacilitySettlement`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| settlement_code | VARCHAR(50) | NOT NULL, UNIQUE | Mã đợt quyết toán kinh phí định kỳ cho CSYT |
| facility_id | UUID | NOT NULL, FK -> healthcare_facilities(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng facility |
| month | INTEGER | NOT NULL | Tháng quyết toán tài chính |
| year | INTEGER | NOT NULL | Năm quyết toán tài chính |
| total_realized_revenue | DECIMAL(14, 2) | NOT NULL | Tổng doanh thu thực tế phát sinh trong kỳ của CSYT (VNĐ) |
| platform_fee_amount | DECIMAL(14, 2) | NOT NULL | Phí dịch vụ nền tảng khấu trừ theo hợp đồng B2B (VNĐ) |
| facility_payout_amount | DECIMAL(14, 2) | NOT NULL | Số tiền thực chuyển khoản thanh toán cho cơ sở y tế (VNĐ) |
| disbursement_status | VARCHAR(50) | NOT NULL, DEFAULT PENDING | Trạng thái giải ngân ngân hàng (PENDING, CONFIRMED, SETTLED, FAILED) |
| bank_transfer_order_id | VARCHAR(100) |  | Khóa ngoại liên kết tới bảng bank_transfer_order |
| settled_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| environment | VARCHAR(10) | NOT NULL, DEFAULT 'LIVE' | Thuộc tính nghiệp vụ |
| bank_destination | JSONB | NOT NULL, DEFAULT '{}' | Thuộc tính nghiệp vụ |
| failure_reason | TEXT |  | Thuộc tính nghiệp vụ |
| transfer_evidence_key | TEXT |  | Thuộc tính nghiệp vụ |
| confirmed_by_user_id | UUID | FK -> users(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng confirmed_by_user |


### 3.26 doctor_reviews
*Model thực thể: `DoctorReview`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| encounter_id | UUID | NOT NULL, UNIQUE, FK -> encounters(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng encounter |
| family_id | UUID | NOT NULL, FK -> family_units(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng family |
| doctor_id | UUID | NOT NULL, FK -> doctors(id), ON DELETE CASCADE | Khóa ngoại liên kết tới bảng doctor |
| rating_stars | INTEGER | NOT NULL | Điểm đánh giá số sao dịch vụ (từ 1 đến 5 sao) |
| review_comment | TEXT |  | Ý kiến nhận xét phản hồi chi tiết của người đại diện gia đình |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |


### 3.27 complaints
*Model thực thể: `Complaint`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| complaint_code | VARCHAR(50) | NOT NULL, UNIQUE | Mã ticket khiếu nại dịch vụ khách hàng duy nhất |
| contract_id | UUID | NOT NULL, FK -> medical_contracts(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng contract |
| encounter_id | UUID | FK -> encounters(id), ON DELETE SETNULL | Khóa ngoại liên kết tới bảng encounter |
| complainant_user_id | UUID | NOT NULL, FK -> users(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng complainant_user |
| target_user_id | UUID | NOT NULL, FK -> users(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng target_user |
| complaint_category | VARCHAR(50) | NOT NULL | Phân loại nội dung khiếu nại (ATTITUDE, MEDICAL_QUALITY, SCHEDULE_DELAY) |
| description | TEXT | NOT NULL | Mô tả chi tiết sự việc phản ánh của khách hàng |
| evidence_attachments | JSONB |  | Thuộc tính nghiệp vụ |
| resolution_outcome | VARCHAR(50) |  | Kết luận phân xử cuối cùng từ Hội đồng chuyên môn / Admin |
| resolution_notes | TEXT |  | Thuộc tính nghiệp vụ |
| facility_response | TEXT |  | Nội dung giải trình chính thức từ cơ sở y tế và bác sĩ |
| facility_reviewed_by_id | UUID | FK -> users(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng facility_reviewed_by |
| facility_reviewed_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |
| resolved_by_user_id | UUID | FK -> users(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng resolved_by_user |
| status | VARCHAR(50) | NOT NULL, DEFAULT SUBMITTED | Trạng thái giải quyết (SUBMITTED, INVESTIGATING, RESOLVED, CLOSED) |
| resolved_at | TIMESTAMPTZ |  | Thuộc tính nghiệp vụ |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm khởi tạo bản ghi hệ thống |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |


### 3.28 system_configurations
*Model thực thể: `SystemConfiguration`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| config_key | VARCHAR(50) | PRIMARY KEY, NOT NULL | Khóa định danh tham số cấu hình hệ thống (Primary Key) |
| config_value | VARCHAR(255) | NOT NULL | Giá trị thiết lập của tham số cấu hình |
| description | VARCHAR(255) | NOT NULL | Mô tả ý nghĩa và phạm vi tác động của tham số |
| updated_by | UUID | NOT NULL, FK -> users(id) | Thuộc tính nghiệp vụ |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm cập nhật bản ghi gần nhất |


### 3.29 audit_logs
*Model thực thể: `AuditLog`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | BIGSERIAL | PRIMARY KEY, NOT NULL, DEFAULT autoincrement() | Khóa chính nhật ký tự tăng (BIGSERIAL sequence) |
| actor_user_id | UUID | FK -> users(id), ON DELETE SETNULL | Khóa ngoại liên kết tới bảng actor_user |
| action | VARCHAR(50) | NOT NULL | Hành động nghiệp vụ được thực hiện (CREATE, UPDATE, DELETE, ACCESS, LOGIN) |
| resource_name | VARCHAR(50) | NOT NULL | Tên bảng/thực thể tài nguyên bị tác động |
| resource_id | VARCHAR(100) | NOT NULL | Khóa ID của bản ghi tài nguyên bị tác động |
| client_ip | VARCHAR(45) | NOT NULL | Địa chỉ IP client thực hiện yêu cầu gọi API |
| user_agent | VARCHAR(255) |  | Thông tin trình duyệt / hệ điều hành của client |
| timestamp | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Thời điểm phát sinh hành động kiểm toán (chống chỉnh sửa) |


### 3.30 facility_settlement_items
*Model thực thể: `FacilitySettlementItem`*

| Column | Type | Constraints | Notes |
| :--- | :--- | :--- | :--- |
| id | UUID | PRIMARY KEY, NOT NULL, DEFAULT gen_random_uuid() | Khóa chính định danh duy nhất (UUID v4 sinh tự động) |
| settlement_id | UUID | NOT NULL, FK -> facility_settlements(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng settlement |
| invoice_id | UUID | NOT NULL, UNIQUE, FK -> invoices(id), ON DELETE RESTRICT | Khóa ngoại liên kết tới bảng invoice |
| gross_amount | DECIMAL(12, 2) | NOT NULL | Doanh thu hóa đơn trước chiết khấu phân bổ (VNĐ) |
| vat_amount | DECIMAL(12, 2) | NOT NULL | Thuế GTGT phân bổ theo hóa đơn (VNĐ) |
| net_amount | DECIMAL(12, 2) | NOT NULL | Doanh thu thuần sau thuế phân bổ (VNĐ) |
| platform_fee_amount | DECIMAL(12, 2) | NOT NULL | Phần phí nền tảng hưởng trên hóa đơn (VNĐ) |
| facility_share_amount | DECIMAL(12, 2) | NOT NULL | Phần doanh thu cơ sở y tế được hưởng (VNĐ) |

