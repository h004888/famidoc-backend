import re
import os

from parse_schema import parse_prisma

def parse_fields_and_relations(lines):
    columns = []
    relations = []
    indexes = []

    for line in lines:
        line = line.strip()
        if not line or line.startswith('//'):
            continue
        if line.startswith('@@'):
            indexes.append(line)
            continue
        
        parts = line.split()
        if len(parts) < 2:
            continue
        
        field_name = parts[0]
        field_type_raw = parts[1]
        
        if '@relation' in line and 'fields:' not in line:
            relations.append(line)
            continue
        if field_type_raw.endswith('[]'):
            relations.append(line)
            continue
        if '@relation' in line and 'fields:' in line:
            relations.append(line)
            continue

        known_scalars = ['String', 'Int', 'BigInt', 'Boolean', 'Float', 'Decimal', 'DateTime', 'Json', 'Bytes']
        is_known_scalar = any(field_type_raw.startswith(s) for s in known_scalars)
        
        if not is_known_scalar:
            if '@map' not in line and '@db' not in line and '@id' not in line and '@default' not in line:
                enums = [
                    'UserRole', 'UserStatus', 'FacilityVerificationStatus', 'DoctorOnboardingStatus',
                    'DoctorCredentialType', 'ServicePackageStatus', 'B2bContractStatus', 'FamilyUnitStatus',
                    'Gender', 'PatientStatus', 'AllergenType', 'AllergySeverity', 'PatientDocumentType',
                    'MedicalContractStatus', 'SignerRole', 'AddendumType', 'AddendumStatus',
                    'EncounterType', 'EncounterCategory', 'EncounterStatus', 'PrescriptionStatus',
                    'PaymentStatus', 'DisbursementStatus', 'ComplaintStatus'
                ]
                clean_type = field_type_raw.rstrip('?')
                if clean_type not in enums:
                    relations.append(line)
                    continue

        columns.append({
            'name': field_name,
            'type_raw': field_type_raw,
            'raw_line': line
        })

    return columns, relations, indexes

def get_field_notes(col_name, clean_type, is_optional, model_name):
    # Specialized domain notes mapping
    notes_dict = {
        # users
        ("users", "id"): "Khóa chính định danh người dùng (UUID v4 sinh tự động)",
        ("users", "phone"): "Số điện thoại đăng nhập & nhận OTP (chuẩn E.164, duy nhất)",
        ("users", "email"): "Địa chỉ email định danh & nhận thông báo giao dịch (duy nhất)",
        ("users", "password_hash"): "Mã băm mật khẩu bảo mật (Argon2id/BCrypt), tuyệt đối không lưu plaintext",
        ("users", "role"): "Vai trò người dùng trong hệ thống (ADMIN, HEALTHCARE_FACILITY, DOCTOR, FAMILY_REP)",
        ("users", "full_name"): "Họ và tên đầy đủ của người dùng",
        ("users", "avatar_url"): "Đường dẫn tải ảnh đại diện người dùng từ Cloud Storage",
        ("users", "status"): "Trạng thái tài khoản (PENDING, ACTIVE, SUSPENDED, LOCKED)",
        ("users", "failed_login_attempts"): "Số lần đăng nhập sai liên tiếp (tự động khóa tạm thời khi ≥ 5)",
        ("users", "locked_until"): "Thời điểm hết hạn khóa tài khoản tạm thời do nhập sai mật khẩu",
        
        # notifications
        ("notifications", "title"): "Tiêu đề ngắn gọn của thông báo",
        ("notifications", "content"): "Nội dung chi tiết thông báo hiển thị cho người dùng",
        ("notifications", "type"): "Phân loại thông báo (APPOINTMENT, CONTRACT, PAYMENT, SYSTEM)",
        ("notifications", "reference_id"): "ID tham chiếu đến thực thể liên quan (hợp đồng, buổi khám, hóa đơn)",
        ("notifications", "is_read"): "Cờ đánh dấu người dùng đã đọc thông báo hay chưa (true/false)",

        # healthcare_facilities
        ("healthcare_facilities", "facility_name"): "Tên pháp nhân chính thức của cơ sở y tế đối tác",
        ("healthcare_facilities", "license_number"): "Số giấy phép hoạt động khám chữa bệnh do Bộ/Sở Y tế cấp",
        ("healthcare_facilities", "tax_code"): "Mã số thuế doanh nghiệp của cơ sở y tế (duy nhất)",
        ("healthcare_facilities", "address"): "Địa chỉ trụ sở hoạt động của cơ sở y tế",
        ("healthcare_facilities", "hotline"): "Số điện thoại đường dây nóng hỗ trợ khẩn cấp",
        ("healthcare_facilities", "bank_name"): "Tên ngân hàng thụ hưởng giải ngân quyết toán",
        ("healthcare_facilities", "bank_account_number"): "Số tài khoản ngân hàng thụ hưởng của cơ sở",
        ("healthcare_facilities", "bank_account_holder"): "Tên chủ tài khoản thụ hưởng theo đăng ký kinh doanh",
        ("healthcare_facilities", "verification_status"): "Trạng thái xác thực hồ sơ pháp lý CSYT (PENDING, ACTIVE, SUSPENDED)",

        # doctors
        ("doctors", "doctor_name"): "Họ và tên bác sĩ gia đình",
        ("doctors", "specialty"): "Chuyên khoa đào tạo (Y học gia đình, Nội tổng quát, Nhi khoa...)",
        ("doctors", "academic_title"): "Học hàm, học vị chuyên môn (ThS.BS, BSCK1, PGS.TS)",
        ("doctors", "experience_years"): "Số năm kinh nghiệm hành nghề lâm sàng thực tế",
        ("doctors", "bio"): "Tóm tắt tiểu sử nghề nghiệp, thế mạnh điều trị và giới thiệu bác sĩ",
        ("doctors", "active_panel_count"): "Số lượng gia đình hiện đang quản lý chăm sóc chủ động",
        ("doctors", "max_panel_capacity"): "Hạn mức tối đa số gia đình quản lý đồng thời (mặc định 30 hộ)",
        ("doctors", "rating_avg"): "Điểm đánh giá trung bình từ các hộ gia đình (thang điểm 1.00 - 5.00)",
        ("doctors", "total_reviews"): "Tổng số lượt đánh giá hợp lệ từ bệnh nhân/hộ gia đình",
        ("doctors", "onboarding_status"): "Trạng thái phê duyệt onboarding bác sĩ (PENDING_SUBMISSION, ACTIVE...)",

        # doctor_credentials
        ("doctor_credentials", "credential_type"): "Loại văn bằng, chứng chỉ (PRACTICE_LICENSE_CCHN, FAMILY_MEDICINE_CERT, DEGREE)",
        ("doctor_credentials", "certificate_number"): "Số hiệu văn bằng/chứng chỉ hành nghề y tế",
        ("doctor_credentials", "issue_date"): "Ngày cấp văn bằng/chứng chỉ hành nghề",
        ("doctor_credentials", "issuing_authority"): "Cơ quan/Trường đại học có thẩm quyền cấp chứng chỉ",
        ("doctor_credentials", "file_url"): "Đường dẫn file scan văn bằng chứng chỉ được mã hóa lưu trữ",
        ("doctor_credentials", "facility_verified"): "Xác nhận tính xác thực từ CSYT trực tiếp quản lý",
        ("doctor_credentials", "platform_approved"): "Xác nhận thẩm định độc lập từ Admin nền tảng",
        ("doctor_credentials", "rejection_reason"): "Lý do từ chối phê duyệt chứng chỉ (nếu có)",

        # doctor_shifts
        ("doctor_shifts", "shift_date"): "Ngày làm việc theo lịch phân công",
        ("doctor_shifts", "start_time"): "Giờ bắt đầu ca trực/khám",
        ("doctor_shifts", "end_time"): "Giờ kết thúc ca trực/khám",
        ("doctor_shifts", "shift_type"): "Loại ca trực (HOME_VISIT, TELEHEALTH, CLINIC_DUTY)",
        ("doctor_shifts", "notes"): "Ghi chú điều phối ca làm việc",

        # service_packages
        ("service_packages", "package_code"): "Mã định danh gói dịch vụ y tế gia đình (duy nhất)",
        ("service_packages", "package_name"): "Tên thương mại của gói chăm sóc sức khỏe",
        ("service_packages", "duration_months"): "Thời hạn hiệu lực của gói (thường là 3, 6, 12 tháng)",
        ("service_packages", "base_price"): "Giá niêm yết cơ bản của gói dịch vụ (VNĐ)",
        ("service_packages", "periodic_visits_quota"): "Định ngạch số lần bác sĩ đến khám định kỳ tại nhà",
        ("service_packages", "telehealth_quota"): "Định ngạch số lượt tư vấn khám bệnh từ xa qua video",
        ("service_packages", "max_members"): "Số lượng thành viên tối đa trong hộ gia đình được bảo trợ",
        ("service_packages", "included_members"): "Số thành viên mặc định đi kèm trong giá cơ bản",
        ("service_packages", "additional_member_monthly_price"): "Đơn giá phụ thu hàng tháng cho mỗi thành viên bổ sung",
        ("service_packages", "status"): "Trạng thái phát hành gói dịch vụ (DRAFT, ACTIVE, DEPRECATED)",

        # b2b_staffing_contracts
        ("b2b_staffing_contracts", "contract_code"): "Mã hợp đồng khung hợp tác cung ứng nhân sự y tế",
        ("b2b_staffing_contracts", "platform_commission_rate"): "Tỷ lệ hoa hồng nền tảng khấu trừ (% doanh thu)",
        ("b2b_staffing_contracts", "facility_revenue_rate"): "Tỷ lệ doanh thu cơ sở y tế được hưởng (% doanh thu)",
        ("b2b_staffing_contracts", "start_date"): "Ngày bắt đầu có hiệu lực pháp lý của hợp đồng B2B",
        ("b2b_staffing_contracts", "end_date"): "Ngày kết thúc hiệu lực hợp đồng hợp tác B2B",
        ("b2b_staffing_contracts", "signed_pdf_url"): "Đường dẫn file PDF hợp đồng đã ký số 2 bên",
        ("b2b_staffing_contracts", "status"): "Trạng thái hợp đồng B2B (PENDING_SIGNATURE, ACTIVE, EXPIRED, TERMINATED)",

        # family_units
        ("family_units", "home_address"): "Địa chỉ cư trú cố định của hộ gia đình (phục vụ bác sĩ đến khám tại nhà)",
        ("family_units", "emergency_phone"): "Số điện thoại liên hệ khẩn cấp 24/7 của gia đình",
        ("family_units", "status"): "Trạng thái hồ sơ hộ gia đình (ACTIVE, SUSPENDED)",

        # patients
        ("patients", "full_name"): "Họ và tên bệnh nhân (thành viên gia đình)",
        ("patients", "date_of_birth"): "Ngày tháng năm sinh của bệnh nhân",
        ("patients", "gender"): "Giới tính sinh học (MALE, FEMALE, OTHER)",
        ("patients", "relationship_to_head"): "Mối quan hệ nhân thân với chủ hộ (Bố, Mẹ, Con, Vợ, Chồng...)",
        ("patients", "citizen_id"): "Số CCCD/Định danh cá nhân của bệnh nhân",
        ("patients", "health_insurance_number"): "Mã số thẻ bảo hiểm y tế quốc gia (BHYT)",
        ("patients", "status"): "Trạng thái theo dõi y tế của bệnh nhân (ACTIVE, INACTIVE)",

        # patient_allergies
        ("patient_allergies", "allergen_type"): "Nhóm dị nguyên gây dị ứng (DRUG, FOOD, ENVIRONMENTAL)",
        ("patient_allergies", "allergen_name"): "Tên hoạt chất thuốc/thực phẩm/dị nguyên gây kích ứng",
        ("patient_allergies", "severity"): "Mức độ nghiêm trọng (MILD, MODERATE, LIFE_THREATENING_ANAPHYLAXIS)",
        ("patient_allergies", "clinical_manifestation"): "Triệu chứng lâm sàng khi phơi nhiễm (mẩn ngứa, phù nề, khó thở...)",

        # patient_documents
        ("patient_documents", "document_name"): "Tên hồ sơ y tế / kết quả xét nghiệm / chẩn đoán hình ảnh",
        ("patient_documents", "document_type"): "Loại tài liệu (LAB_RESULT, IMAGING_XRAY_CT, DISCHARGE_SUMMARY)",
        ("patient_documents", "file_url"): "Đường dẫn tải tài liệu y bạ lưu trữ an toàn",
        ("patient_documents", "file_size_kb"): "Dung lượng tệp tính bằng Kilobytes (KB)",
        ("patient_documents", "recorded_date"): "Ngày thực hiện cận lâm sàng hoặc ngày ban hành hồ sơ",

        # medical_contracts
        ("medical_contracts", "contract_number"): "Số hợp đồng dịch vụ y tế 4 bên duy nhất (Mã HĐ điện tử)",
        ("medical_contracts", "total_amount"): "Tổng giá trị hợp đồng bao gồm các phụ lục và thành viên bổ sung (VNĐ)",
        ("medical_contracts", "remaining_home_visits"): "Số lượt khám tại nhà còn lại trong kỳ hợp đồng",
        ("medical_contracts", "remaining_telehealth"): "Số lượt khám từ xa (Telehealth) còn lại",
        ("medical_contracts", "start_date"): "Ngày bắt đầu có hiệu lực dịch vụ y tế",
        ("medical_contracts", "end_date"): "Ngày đáo hạn hợp đồng chăm sóc y tế gia đình",
        ("medical_contracts", "contract_status"): "Trạng thái hợp đồng (PENDING_APPROVAL, PENDING_PAYMENT, ACTIVE...)",
        ("medical_contracts", "member_count"): "Số thành viên gia đình được đăng ký bảo trợ trong hợp đồng",
        ("medical_contracts", "billing_snapshot"): "Bản chụp snapshot cấu trúc tính giá và quyền lợi tại thời điểm ký kết",

        # contract_signatures
        ("contract_signatures", "signer_role"): "Vai trò chủ thể ký hợp đồng (FAMILY_REP, ADMIN, HEALTHCARE_FACILITY, ASSIGNED_DOCTOR)",
        ("contract_signatures", "signature_hash"): "Mã băm chữ ký số điện tử của đương sự (chống chối bỏ)",
        ("contract_signatures", "terms_hash"): "Mã băm nội dung điều khoản hợp đồng tại thời điểm ký (SHA-256)",
        ("contract_signatures", "signed_at"): "Thời điểm ghi nhận chữ ký điện tử",
        ("contract_signatures", "ip_address"): "Địa chỉ IP mạng của thiết bị thực hiện ký kết",

        # contract_addenda
        ("contract_addenda", "addendum_number"): "Số phụ lục hợp đồng mở rộng / bổ sung",
        ("contract_addenda", "addendum_type"): "Loại phụ lục (QUOTA_EXPANSION, TERM_EXTENSION, MEMBER_EXTENSION)",
        ("contract_addenda", "additional_amount"): "Số tiền phụ thu bổ sung của phụ lục (VNĐ)",
        ("contract_addenda", "extra_home_visits"): "Số lượt khám tại nhà được cấp thêm qua phụ lục",
        ("contract_addenda", "extra_telehealth"): "Số lượt khám từ xa được cấp thêm qua phụ lục",
        ("contract_addenda", "status"): "Trạng thái phụ lục (PENDING_PAYMENT, ACTIVE, CANCELLED)",

        # encounters
        ("encounters", "encounter_type"): "Hình thức khám bệnh (HOME_VISIT: tại nhà, TELEHEALTH: trực tuyến)",
        ("encounters", "category"): "Phân loại buổi khám (PERIODIC_ROUTINE: định kỳ, AD_HOC_ON_DEMAND: đột xuất)",
        ("encounters", "scheduled_date"): "Ngày hẹn bác sĩ thực hiện buổi khám",
        ("encounters", "scheduled_time"): "Khung giờ bắt đầu buổi thăm khám",
        ("encounters", "reschedule_count"): "Số lần đã yêu cầu dời lịch hẹn",
        ("encounters", "encounter_status"): "Tiến độ thực hiện (REQUESTED, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED)",
        ("encounters", "cancel_reason"): "Lý do hủy buổi khám bệnh",

        # telehealth_sessions
        ("telehealth_sessions", "room_sid"): "Định danh duy nhất phòng họp video trực tuyến (WebRTC room SID)",
        ("telehealth_sessions", "started_at"): "Thời điểm bắt đầu kết nối cuộc gọi video",
        ("telehealth_sessions", "ended_at"): "Thời điểm kết thúc cuộc gọi video",
        ("telehealth_sessions", "duration_seconds"): "Tổng thời lượng cuộc gọi tư vấn tính bằng giây",
        ("telehealth_sessions", "network_quality_score"): "Điểm chất lượng đường truyền mạng trong buổi gọi",
        ("telehealth_sessions", "is_fallback_chat"): "Cờ kích hoạt kênh chat dự phòng khi mạng yếu/mất kết nối video",

        # clinical_emr
        ("clinical_emr", "chief_complaint"): "Lý do vào khám / Triệu chứng khởi phát chính (Chữ S trong SOAP)",
        ("clinical_emr", "anamnesis"): "Tiền sử bệnh bản thân và bệnh sử gia đình liên quan",
        ("clinical_emr", "clinical_findings"): "Khám lâm sàng khách quan và dấu hiệu thực thể (Chữ O trong SOAP)",
        ("clinical_emr", "icd10_code"): "Mã phân loại bệnh tật quốc tế tiêu chuẩn ICD-10",
        ("clinical_emr", "icd10_diagnosis"): "Chẩn đoán xác định bệnh theo chuẩn y khoa (Chữ A trong SOAP)",
        ("clinical_emr", "treatment_plan"): "Kế hoạch điều trị, lời dặn và hướng dẫn chăm sóc (Chữ P trong SOAP)",
        ("clinical_emr", "is_finalized"): "Cờ khóa bệnh án điện tử sau khi bác sĩ ký số (bất biến)",
        ("clinical_emr", "doctor_signature_hash"): "Mã băm chữ ký số bác sĩ xác nhận hoàn thành bệnh án",

        # vital_signs
        ("vital_signs", "systolic_bp"): "Huyết áp tâm thu (mmHg)",
        ("vital_signs", "diastolic_bp"): "Huyết áp tâm trương (mmHg)",
        ("vital_signs", "heart_rate"): "Nhịp tim đo được (nhịp/phút)",
        ("vital_signs", "temperature"): "Nhiệt độ cơ thể (độ C, chính xác 1 chữ số thập phân)",
        ("vital_signs", "spo2"): "Độ bão hòa oxy trong máu (%)",
        ("vital_signs", "respiratory_rate"): "Nhịp thở (lần/phút)",
        ("vital_signs", "blood_glucose"): "Đường huyết mao mạch (mmol/L)",
        ("vital_signs", "is_abnormal_alert"): "Cờ cảnh báo chỉ số sinh hiệu vượt ngưỡng an toàn",

        # prescriptions
        ("prescriptions", "prescription_code"): "Mã đơn thuốc điện tử quốc gia duy nhất",
        ("prescriptions", "doctor_signature"): "Chữ ký số xác nhận kê đơn của bác sĩ phụ trách",
        ("prescriptions", "prescribed_date"): "Ngày phát hành đơn thuốc",
        ("prescriptions", "valid_until"): "Hạn chót mua thuốc theo quy định dược phẩm",
        ("prescriptions", "instructions"): "Lời dặn chung của bác sĩ về chế độ dùng thuốc và kiêng cữ",
        ("prescriptions", "status"): "Trạng thái đơn thuốc (ISSUED, EXPIRED, CANCELLED)",

        # prescription_details
        ("prescription_details", "medication_name"): "Tên biệt dược hoặc tên hoạt chất thuốc kê đơn",
        ("prescription_details", "dosage"): "Hàm lượng và nồng độ thuốc (ví dụ: 500mg, 10ml)",
        ("prescription_details", "quantity"): "Tổng số lượng thuốc được cấp phát",
        ("prescription_details", "unit"): "Đơn vị tính thuốc (viên, gói, chai, ống)",
        ("prescription_details", "frequency"): "Liều dùng và số lần uống trong ngày (ví dụ: Ngày 2 lần, mỗi lần 1 viên sau ăn)",
        ("prescription_details", "duration_days"): "Số ngày chỉ định dùng thuốc liên tục",

        # referral_orders
        ("referral_orders", "referral_code"): "Mã số giấy chuyển tuyến khám chữa bệnh",
        ("referral_orders", "target_facility_name"): "Tên bệnh viện / cơ sở y tế tuyến trên tiếp nhận điều trị",
        ("referral_orders", "reason_for_referral"): "Lý do chuyên môn cần chuyển viện vượt tuyến",
        ("referral_orders", "clinical_summary"): "Tóm tắt tình trạng lâm sàng và các xử trí ban đầu",
        ("referral_orders", "transportation_method"): "Phương tiện vận chuyển người bệnh (Xe cấp cứu 115, tự túc)",

        # invoices
        ("invoices", "invoice_code"): "Mã hóa đơn / Yêu cầu thanh toán duy nhất",
        ("invoices", "transfer_content"): "Nội dung chuyển khoản VietQR chốt cố định phục vụ đối soát tự động",
        ("invoices", "gross_amount"): "Số tiền trước thuế (VNĐ)",
        ("invoices", "vat_amount"): "Tiền thuế GTGT VAT (VNĐ)",
        ("invoices", "total_payable"): "Tổng số tiền thực tế khách hàng phải thanh toán (VNĐ)",
        ("invoices", "payment_gateway"): "Kênh cổng thanh toán (VIETQR, VNPAY, MOMO)",
        ("invoices", "payment_status"): "Trạng thái thanh toán (PENDING, PAID, EXPIRED, CANCELLED)",
        ("invoices", "expired_at"): "Thời hạn hết hiệu lực của mã thanh toán QR",

        # payment_transactions
        ("payment_transactions", "gateway_transaction_id"): "Mã giao dịch từ cổng thanh toán / ngân hàng đối tác",
        ("payment_transactions", "amount_received"): "Số tiền ngân hàng thực nhận vào tài khoản (VNĐ)",
        ("payment_transactions", "payment_time"): "Thời điểm giao dịch thành công ghi nhận tại ngân hàng",
        ("payment_transactions", "signature_verified"): "Xác nhận chữ ký bảo mật webhook hợp lệ từ ngân hàng",
        ("payment_transactions", "webhook_payload"): "Toàn bộ dữ liệu JSON nhận từ webhook phục vụ tra soát",
        ("payment_transactions", "outcome"): "Kết quả xử lý đối soát giao dịch (SUCCESS, MISMATCH, UNMATCHED)",

        # facility_settlements
        ("facility_settlements", "settlement_code"): "Mã đợt quyết toán kinh phí định kỳ cho CSYT",
        ("facility_settlements", "month"): "Tháng quyết toán tài chính",
        ("facility_settlements", "year"): "Năm quyết toán tài chính",
        ("facility_settlements", "total_realized_revenue"): "Tổng doanh thu thực tế phát sinh trong kỳ của CSYT (VNĐ)",
        ("facility_settlements", "platform_fee_amount"): "Phí dịch vụ nền tảng khấu trừ theo hợp đồng B2B (VNĐ)",
        ("facility_settlements", "facility_payout_amount"): "Số tiền thực chuyển khoản thanh toán cho cơ sở y tế (VNĐ)",
        ("facility_settlements", "disbursement_status"): "Trạng thái giải ngân ngân hàng (PENDING, CONFIRMED, SETTLED, FAILED)",

        # facility_settlement_items
        ("facility_settlement_items", "gross_amount"): "Doanh thu hóa đơn trước chiết khấu phân bổ (VNĐ)",
        ("facility_settlement_items", "vat_amount"): "Thuế GTGT phân bổ theo hóa đơn (VNĐ)",
        ("facility_settlement_items", "net_amount"): "Doanh thu thuần sau thuế phân bổ (VNĐ)",
        ("facility_settlement_items", "platform_fee_amount"): "Phần phí nền tảng hưởng trên hóa đơn (VNĐ)",
        ("facility_settlement_items", "facility_share_amount"): "Phần doanh thu cơ sở y tế được hưởng (VNĐ)",

        # doctor_reviews
        ("doctor_reviews", "rating_stars"): "Điểm đánh giá số sao dịch vụ (từ 1 đến 5 sao)",
        ("doctor_reviews", "review_comment"): "Ý kiến nhận xét phản hồi chi tiết của người đại diện gia đình",

        # complaints
        ("complaints", "complaint_code"): "Mã ticket khiếu nại dịch vụ khách hàng duy nhất",
        ("complaints", "complaint_category"): "Phân loại nội dung khiếu nại (ATTITUDE, MEDICAL_QUALITY, SCHEDULE_DELAY)",
        ("complaints", "description"): "Mô tả chi tiết sự việc phản ánh của khách hàng",
        ("complaints", "facility_response"): "Nội dung giải trình chính thức từ cơ sở y tế và bác sĩ",
        ("complaints", "resolution_outcome"): "Kết luận phân xử cuối cùng từ Hội đồng chuyên môn / Admin",
        ("complaints", "status"): "Trạng thái giải quyết (SUBMITTED, INVESTIGATING, RESOLVED, CLOSED)",

        # system_configurations
        ("system_configurations", "config_key"): "Khóa định danh tham số cấu hình hệ thống (Primary Key)",
        ("system_configurations", "config_value"): "Giá trị thiết lập của tham số cấu hình",
        ("system_configurations", "description"): "Mô tả ý nghĩa và phạm vi tác động của tham số",

        # audit_logs
        ("audit_logs", "id"): "Khóa chính nhật ký tự tăng (BIGSERIAL sequence)",
        ("audit_logs", "action"): "Hành động nghiệp vụ được thực hiện (CREATE, UPDATE, DELETE, ACCESS, LOGIN)",
        ("audit_logs", "resource_name"): "Tên bảng/thực thể tài nguyên bị tác động",
        ("audit_logs", "resource_id"): "Khóa ID của bản ghi tài nguyên bị tác động",
        ("audit_logs", "client_ip"): "Địa chỉ IP client thực hiện yêu cầu gọi API",
        ("audit_logs", "user_agent"): "Thông tin trình duyệt / hệ điều hành của client",
        ("audit_logs", "timestamp"): "Thời điểm phát sinh hành động kiểm toán (chống chỉnh sửa)"
    }

    # Check direct match
    if (model_name, col_name) in notes_dict:
        return notes_dict[(model_name, col_name)]
        
    # Heuristics
    if col_name == 'id':
        return "Khóa chính định danh duy nhất (UUID v4 sinh tự động)"
    if col_name == 'created_at':
        return "Thời điểm khởi tạo bản ghi hệ thống"
    if col_name == 'updated_at':
        return "Thời điểm cập nhật bản ghi gần nhất"
    if col_name == 'deleted_at':
        return "Thời điểm xóa mềm bản ghi (Soft delete)"
    if clean_type in ['UserRole', 'UserStatus', 'FacilityVerificationStatus', 'DoctorOnboardingStatus',
                      'DoctorCredentialType', 'ServicePackageStatus', 'B2bContractStatus', 'FamilyUnitStatus',
                      'Gender', 'PatientStatus', 'AllergenType', 'AllergySeverity', 'PatientDocumentType',
                      'MedicalContractStatus', 'SignerRole', 'AddendumType', 'AddendumStatus',
                      'EncounterType', 'EncounterCategory', 'EncounterStatus', 'PrescriptionStatus',
                      'PaymentStatus', 'DisbursementStatus', 'ComplaintStatus']:
        return f"Giá trị phân loại chuẩn Enum `{clean_type}`"
    if col_name.endswith('_id'):
        ref_entity = col_name[:-3]
        return f"Khóa ngoại liên kết tới bảng {ref_entity}"
    if 'hash' in col_name:
        return "Chuỗi mã băm bảo mật kiểm tra tính toàn vẹn"
    if 'url' in col_name:
        return "Đường dẫn lưu trữ tập tin trên Cloud Storage"
        
    return "Thuộc tính nghiệp vụ"

def extract_column_details(col, model_lines, table_name_map, table_name):
    line = col['raw_line']
    field_name = col['name']
    type_raw = col['type_raw']
    is_optional = type_raw.endswith('?')
    clean_type = type_raw.rstrip('?')
    
    # 1. DB Column Name
    map_match = re.search(r'@map\("([^"]+)"\)', line)
    if map_match:
        col_name = map_match.group(1)
    else:
        col_name = re.sub(r'(?<!^)(?=[A-Z])', '_', field_name).lower()
        
    # 2. SQL Type
    sql_type = ""
    if '@db.Uuid' in line or (clean_type == 'String' and '@id' in line and 'uuid' in line.lower()):
        sql_type = "UUID"
    elif '@db.VarChar' in line:
        vc_match = re.search(r'@db\.VarChar\((\d+)\)', line)
        sql_type = f"VARCHAR({vc_match.group(1)})" if vc_match else "VARCHAR"
    elif '@db.Text' in line:
        sql_type = "TEXT"
    elif '@db.Timestamptz' in line:
        sql_type = "TIMESTAMPTZ"
    elif '@db.Date' in line:
        sql_type = "DATE"
    elif '@db.Time' in line:
        sql_type = "TIME"
    elif '@db.Decimal' in line:
        dec_match = re.search(r'@db\.Decimal\((\d+),\s*(\d+)\)', line)
        sql_type = f"DECIMAL({dec_match.group(1)}, {dec_match.group(2)})" if dec_match else "DECIMAL"
    elif '@db.JsonB' in line or clean_type == 'Json':
        sql_type = "JSONB"
    elif clean_type == 'String':
        sql_type = "VARCHAR(255)"
    elif clean_type == 'Int':
        sql_type = "INTEGER"
    elif clean_type == 'BigInt':
        sql_type = "BIGSERIAL" if '@id' in line else "BIGINT"
    elif clean_type == 'Boolean':
        sql_type = "BOOLEAN"
    elif clean_type == 'DateTime':
        sql_type = "TIMESTAMPTZ"
    elif clean_type == 'Decimal':
        sql_type = "DECIMAL(12, 2)"
    else:
        # Enum
        sql_type = f"VARCHAR(50)"
        
    # 3. Constraints
    constraints = []
    if '@id' in line:
        constraints.append("PRIMARY KEY")
    if not is_optional:
        constraints.append("NOT NULL")
    if '@unique' in line:
        constraints.append("UNIQUE")
    
    # Defaults
    if 'gen_random_uuid()' in line:
        constraints.append("DEFAULT gen_random_uuid()")
    elif 'now()' in line:
        constraints.append("DEFAULT NOW()")
    elif '@default(' in line:
        # Match inside outermost @default(...)
        def_match = re.search(r'@default\((.*?)\)(?:\s+|$)', line)
        if def_match:
            d_val = def_match.group(1).strip()
            if d_val.startswith('"') and d_val.endswith('"'):
                constraints.append(f"DEFAULT '{d_val.strip('\"')}'")
            else:
                constraints.append(f"DEFAULT {d_val}")
            
    # Foreign key check from relations inside the same model
    # MUST only check fields: [field_name], NOT references: [field_name]
    for rel in model_lines:
        if '@relation' in rel:
            fields_match = re.search(r'fields:\s*\[([^\]]+)\]', rel)
            if fields_match:
                fk_fields = [f.strip() for f in fields_match.group(1).split(',')]
                if field_name in fk_fields:
                    ref_match = re.search(r'references:\s*\[([^\]]+)\]', rel)
                    target_cols = [c.strip() for c in ref_match.group(1).split(',')] if ref_match else ["id"]
                    
                    target_model = rel.split()[1].rstrip('?')
                    target_table = table_name_map.get(target_model, target_model.lower())
                    
                    # Target column matching index
                    field_idx = fk_fields.index(field_name)
                    target_col = target_cols[field_idx] if field_idx < len(target_cols) else target_cols[0]
                    
                    db_target_col = 'id' if target_col == 'id' else re.sub(r'(?<!^)(?=[A-Z])', '_', target_col).lower()
                        
                    on_del_match = re.search(r'onDelete:\s*(\w+)', rel)
                    on_del = f", ON DELETE {on_del_match.group(1).upper()}" if on_del_match else ""
                    constraints.append(f"FK -> {target_table}({db_target_col}){on_del}")
                    break

    notes = get_field_notes(col_name, clean_type, is_optional, table_name)

    return {
        "column": col_name,
        "type": sql_type,
        "constraints": ", ".join(constraints),
        "notes": notes
    }

def main():
    models = parse_prisma('prisma/schema.prisma')
    table_name_map = {m['name']: m['table_name'] for m in models}
    
    doc_lines = []
    doc_lines.append("# 3. Database Design\n")
    
    for idx, m in enumerate(models, 1):
        table_name = m['table_name']
        model_name = m['name']
        columns, relations, indexes = parse_fields_and_relations(m['lines'])
        
        doc_lines.append(f"### 3.{idx} {table_name}")
        doc_lines.append(f"*Model thực thể: `{model_name}`*\n")
        doc_lines.append("| Column | Type | Constraints | Notes |")
        doc_lines.append("| :--- | :--- | :--- | :--- |")
        
        for col in columns:
            detail = extract_column_details(col, m['lines'], table_name_map, table_name)
            doc_lines.append(f"| {detail['column']} | {detail['type']} | {detail['constraints']} | {detail['notes']} |")
            
        doc_lines.append("\n")

    full_md = "\n".join(doc_lines)
    
    out_dir = r"c:\Users\ADMIN\Downloads\famidoc\famidoc-backend\docs"
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, "database_design_specification.md")
    
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(full_md)
        
    print(f"Generated successfully: {out_file} ({len(doc_lines)} lines)")

if __name__ == '__main__':
    main()
