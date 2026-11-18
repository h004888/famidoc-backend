# Danh Mục Toàn Bộ API Backend (FamiDoc API Inventory)

> **Tổng số Endpoint:** 171 APIs
> **Số phân hệ (Tags):** 25 phân hệ
> **Swagger UI:** `/docs` hoặc `/api/docs`
> **OpenAPI JSON Spec:** `openapi.json` (`/docs-json`)

### App (1 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/` | Kiểm tra trạng thái máy chủ ứng dụng |

### Health (1 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/health` | Kiểm tra trạng thái sẵn sàng của dịch vụ |

### Public Portal (13 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/api/v1/public/portal-overview` | Lấy thông tin tổng quan trang chủ Public Portal (STT 7 - UC-06) |
| `GET` | `/api/v1/public/overview` | Lấy thông tin tổng quan trang chủ Public Portal (STT 7 - UC-06) |
| `GET` | `/api/v1/public/packages` | Tìm kiếm và lọc danh mục gói chăm sóc sức khỏe công khai (STT 8 - UC-07) |
| `GET` | `/api/v1/public/packages/{id}` | Xem chi tiết gói chăm sóc sức khỏe công khai theo ID (STT 9 - UC-07) |
| `GET` | `/api/v1/public/facilities` | Tra cứu danh bạ cơ sở y tế đối tác công khai (STT 10 - UC-08) |
| `GET` | `/api/v1/public/directory` | Tra cứu danh bạ cơ sở y tế đối tác công khai (STT 10 - UC-08) |
| `GET` | `/api/v1/public/facilities/{id}` | Xem chi tiết cơ sở y tế công khai theo ID (UC-08) |
| `GET` | `/api/v1/public/doctors` | Tra cứu danh bạ bác sĩ gia đình công khai (STT 11 - UC-08) |
| `GET` | `/api/v1/public/care-model` | Lấy phạm vi chăm sóc chung của nền tảng (hình thức khám và cam kết) |
| `GET` | `/api/v1/public/doctors/{id}` | Xem chi tiết bác sĩ gia đình công khai theo ID (UC-08) |
| `GET` | `/api/v1/public/doctors/{id}/reviews` | Lấy danh sách đánh giá của bác sĩ có phân trang (UC-08) |
| `POST` | `/api/v1/public/consultation-requests` | Gửi yêu cầu tư vấn gói dịch vụ chăm sóc gia đình (STT 12 - UC-09) |
| `POST` | `/api/v1/public/inquiries` | Gửi yêu cầu tư vấn gói dịch vụ chăm sóc gia đình (STT 12 - UC-09) |

### Doctors & Facilities Management (8 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/facilities/doctors` | Cơ sở y tế khởi tạo tài khoản Bác sĩ trực thuộc (STT 15 - UC-20) |
| `GET` | `/api/v1/facilities/doctors` | Cơ sở y tế xem danh sách Bác sĩ trực thuộc đơn vị mình |
| `POST` | `/api/v1/facilities/doctors/{id}/doctors` | Cơ sở y tế khởi tạo tài khoản Bác sĩ trực thuộc (STT 15 - UC-20) |
| `GET` | `/api/v1/facilities/doctors/{id}/doctors` | Cơ sở y tế xem danh sách Bác sĩ trực thuộc đơn vị mình |
| `POST` | `/api/v1/facilities` | Cơ sở y tế khởi tạo tài khoản Bác sĩ trực thuộc (STT 15 - UC-20) |
| `GET` | `/api/v1/facilities` | Cơ sở y tế xem danh sách Bác sĩ trực thuộc đơn vị mình |
| `POST` | `/api/v1/facilities/{id}/doctors` | Cơ sở y tế khởi tạo tài khoản Bác sĩ trực thuộc (STT 15 - UC-20) |
| `GET` | `/api/v1/facilities/{id}/doctors` | Cơ sở y tế xem danh sách Bác sĩ trực thuộc đơn vị mình |

### Doctors Management (8 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `PUT` | `/api/v1/doctors/me/credentials` | Bác sĩ tải lên hồ sơ văn bằng, chứng chỉ hành nghề của chính mình (UC-21 alias) |
| `PUT` | `/api/v1/doctors/{id}/credentials` | Bác sĩ tải lên hồ sơ văn bằng, chứng chỉ hành nghề (STT 16 - UC-21) |
| `PATCH` | `/api/v1/doctors/{id}/credentials/facility-approve` | Cơ sở y tế thẩm định hồ sơ bác sĩ - Cấp 1 (STT 17 - UC-22) |
| `PATCH` | `/api/v1/doctors/{id}/credentials/platform-approve` | Quản trị viên Nền tảng phê duyệt cấp chứng nhận - Cấp 2 (STT 18 - UC-22) |
| `POST` | `/api/v1/doctors/credentials/{id}/review` | Thẩm định hồ sơ chứng chỉ bác sĩ hợp nhất 2 cấp (UC-22) |
| `GET` | `/api/v1/doctors/me` | Bác sĩ xem thông tin hồ sơ của chính mình |
| `GET` | `/api/v1/doctors` | Xem danh sách Bác sĩ trên hệ thống (Lọc theo trạng thái thẩm định) |
| `GET` | `/api/v1/doctors/{id}` | Xem chi tiết hồ sơ bác sĩ |

### Healthcare Facilities Management (3 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/facilities/register` | Cơ sở y tế gửi đăng ký thông tin cơ bản ban đầu (Public) |
| `GET` | `/api/v1/facilities/me` | Cơ sở y tế xem thông tin hồ sơ của chính mình |
| `PUT` | `/api/v1/facilities/me/legal-profile` | Cơ sở y tế nộp hồ sơ pháp lý chuyên sâu & tài khoản ngân hàng (Sau khi đăng nhập) |

### Healthcare Facilities Management (Admin) (5 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/api/v1/admin/facilities` | Quản trị viên xem danh sách các cơ sở y tế trên hệ thống |
| `GET` | `/api/v1/admin/facilities/{id}` | Quản trị viên xem chi tiết một cơ sở y tế theo ID |
| `GET` | `/api/v1/admin/facilities/{id}/legal-document` | Tải bản scan hồ sơ pháp lý của CSYT |
| `PATCH` | `/api/v1/admin/facilities/{id}/approve-account` | Quản trị viên DUYỆT LẦN 1 - Cấp tài khoản cho Cơ sở y tế |
| `PATCH` | `/api/v1/admin/facilities/{id}/verify-legal` | Quản trị viên DUYỆT LẦN 2 - Hậu kiểm pháp lý & Kích hoạt đối tác |

### Doctor Quota Governance (5 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/facilities/doctors/{id}/quota-proposals` | CSYT gửi đề xuất điều chỉnh hạn mức hộ gia đình (maxPanelCapacity) cho bác sĩ |
| `GET` | `/api/v1/facilities/doctors/{id}/quota-proposals` | CSYT xem lịch sử đề xuất điều chỉnh quota của một bác sĩ trực thuộc |
| `GET` | `/api/v1/facilities/quota-proposals` | CSYT xem toàn bộ đề xuất điều chỉnh quota của đơn vị mình |
| `GET` | `/api/v1/admin/quota-proposals` | Quản trị viên xem danh sách đề xuất điều chỉnh quota từ các CSYT |
| `PATCH` | `/api/v1/admin/quota-proposals/{id}` | Quản trị viên phê duyệt hoặc từ chối đề xuất điều chỉnh quota |

### Auth (8 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/auth/register-representative` | Đăng ký tài khoản Người đại diện gia đình (Family Representative) |
| `POST` | `/api/v1/auth/verify-email-otp` | Xác thực OTP đăng ký tài khoản qua email |
| `POST` | `/api/v1/auth/resend-email-otp` | Gửi lại OTP qua email (có cooldown 60s) |
| `POST` | `/api/v1/auth/login` | Đăng nhập hệ thống (Email và mật khẩu) |
| `POST` | `/api/v1/auth/logout` | Đăng xuất và thu hồi Access Token |
| `POST` | `/api/v1/auth/forgot-password` | Yêu cầu OTP đặt lại mật khẩu |
| `POST` | `/api/v1/auth/reset-password` | Đặt lại mật khẩu mới bằng OTP |
| `PATCH` | `/api/v1/auth/change-password` | Đổi mật khẩu cho người dùng hiện tại |

### Care Packages (Public) (3 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/api/v1/care-packages` | Lấy danh mục các gói chăm sóc sức khỏe đang hoạt động (ACTIVE) |
| `GET` | `/api/v1/care-packages/{id}` | Xem chi tiết phiên bản gói chăm sóc theo ID |
| `POST` | `/api/v1/care-packages/{id}/quote` | Tính báo giá gói chăm sóc theo số lượng thành viên |

### Care Packages (Admin) (7 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/api/v1/admin/care-packages` | Quản trị viên xem danh sách các gói chăm sóc (mọi trạng thái) |
| `POST` | `/api/v1/admin/care-packages` | Tạo gói chăm sóc mới ở trạng thái DRAFT |
| `GET` | `/api/v1/admin/care-packages/{id}` | Xem chi tiết gói chăm sóc (bao gồm bản nháp/ngừng bán) |
| `PATCH` | `/api/v1/admin/care-packages/{id}` | Chỉnh sửa thông tin gói chăm sóc bản nháp |
| `POST` | `/api/v1/admin/care-packages/{id}/versions` | Tạo phiên bản kế tiếp (next version) từ gói hiện tại |
| `POST` | `/api/v1/admin/care-packages/{id}/publish` | Xuất bản gói chăm sóc ra công khai (chuyển sang ACTIVE) |
| `POST` | `/api/v1/admin/care-packages/{id}/retire` | Ngừng cung cấp gói chăm sóc (chuyển sang RETIRED) |

### Payments (7 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/payments/vietqr` | Tạo mã QR thanh toán VietQR cho hợp đồng hoặc phụ lục |
| `POST` | `/api/v1/payments/requests` | Tạo mã QR thanh toán VietQR cho hợp đồng hoặc phụ lục |
| `GET` | `/api/v1/payments/{paymentId}/status` | Kiểm tra trạng thái thanh toán của hóa đơn/yêu cầu |
| `GET` | `/api/v1/payments/requests/{paymentId}` | Kiểm tra trạng thái thanh toán của hóa đơn/yêu cầu |
| `POST` | `/api/v1/payments/requests/{id}/cancel` | Hủy yêu cầu thanh toán |
| `POST` | `/api/v1/payments/requests/{id}/recheck-activation` | Admin kích hoạt bù hợp đồng/phụ lục nếu webhook bị sót |
| `GET` | `/api/v1/payments/transactions` | Admin tra cứu danh sách các giao dịch thanh toán |

### Webhooks (3 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/webhooks/sepay/test` | Nhận và xử lý IPN Webhook tự động từ cổng thanh toán SePay |
| `POST` | `/api/v1/payments/webhook/vietqr` | Nhận và xử lý IPN Webhook tự động từ cổng thanh toán SePay |
| `POST` | `/api/v1/webhooks/documenso` | Nhận webhook ký kết hợp đồng 4 bên từ self-hosted Documenso |

### Contracts (29 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/contracts/four-party` | Khởi tạo hợp đồng dịch vụ y tế 4 bên ban đầu (STT 28 - UC-16, SD-16) |
| `POST` | `/api/v1/contracts/medical` | Khởi tạo hợp đồng dịch vụ y tế 4 bên ban đầu (STT 28 - UC-16, SD-16) |
| `GET` | `/api/v1/contracts/medical` | Xem danh sách hợp đồng dịch vụ y tế 4 bên theo vai trò |
| `POST` | `/api/v1/contracts/medical/{id}/cancel-draft` | Hủy bản nháp hợp đồng y tế 4 bên chưa thanh toán (tránh bản nháp trùng lặp) |
| `PUT` | `/api/v1/contracts/four-party/{id}/sign` | Ký số điện tử hợp đồng y tế 4 bên ban đầu (STT 29 - UC-16, SD-16) |
| `PUT` | `/api/v1/contracts/medical/{id}/sign` | Ký số điện tử hợp đồng y tế 4 bên ban đầu (STT 29 - UC-16, SD-16) |
| `PUT` | `/api/v1/contracts/medical/{id}/signatures` | Ký số điện tử hợp đồng y tế 4 bên ban đầu (STT 29 - UC-16, SD-16) |
| `GET` | `/api/v1/contracts/family/gate-status` | Kiểm tra trạng thái gói ACTIVE và hợp đồng đang chờ của hộ gia đình |
| `GET` | `/api/v1/contracts/medical/{id}/signing-session` | Lấy phiên ký Documenso nhúng theo vai trò của người dùng hiện tại |
| `POST` | `/api/v1/contracts/four-party/{id}/sync-documenso` | Đồng bộ trạng thái chữ ký trực tiếp từ Documenso sau khi ký trên giao diện nhúng |
| `GET` | `/api/v1/contracts/medical/{id}/signed-pdf` | Tải hoặc xem tệp PDF hợp đồng đã ký qua proxy Documenso (bảo mật API key) |
| `PATCH` | `/api/v1/contracts/{id}/assign-doctor` | Phân công / Điều chuyển bác sĩ gia đình phụ trách hợp đồng (STT 30 - UC-23, SD-23) |
| `GET` | `/api/v1/contracts/medical/{id}` | Xem chi tiết hợp đồng dịch vụ y tế 4 bên |
| `GET` | `/api/v1/contracts/medical/{id}/care-summary` | Tóm tắt nhu cầu chăm sóc sức khỏe của các thành viên trong hợp đồng |
| `GET` | `/api/v1/contracts/medical/{id}/document` | Kết xuất văn bản bản sao hợp đồng dịch vụ y tế điện tử 4 bên |
| `POST` | `/api/v1/contracts/staffing` | Thiết lập hợp đồng cung ứng nhân lực y tế B2B (STT 13 - UC-15) |
| `GET` | `/api/v1/contracts/staffing` | Xem danh sách hợp đồng cung ứng nhân lực B2B |
| `PUT` | `/api/v1/contracts/staffing/{id}/sign` | Ký số điện tử hợp đồng cung ứng nhân lực B2B (STT 14 - UC-15) |
| `PATCH` | `/api/v1/contracts/staffing/{id}/reject` | Từ chối dự thảo hợp đồng cung ứng nhân lực B2B (Yêu cầu đàm phán / sửa đổi) |
| `GET` | `/api/v1/contracts/staffing/{id}` | Xem chi tiết hợp đồng cung ứng nhân lực B2B |
| `POST` | `/api/v1/contracts/{id}/addendums` | Tạo phụ lục hợp đồng (thay đổi thành viên hoặc dịch vụ) |
| `POST` | `/api/v1/contracts/{id}/upgrade` | Tạo yêu cầu nâng cấp gói chăm sóc cho hợp đồng |
| `PATCH` | `/api/v1/contracts/{id}/terminate` | Chấm dứt/hủy hợp đồng chăm sóc sức khỏe |
| `POST` | `/api/v1/contracts/{id}/termination` | Gửi yêu cầu chấm dứt hợp đồng (UC-19 alias) |
| `POST` | `/api/v1/contracts/terminations/{id}/decision` | Phê duyệt/từ chối hoặc đồng thuận chấm dứt hợp đồng (UC-19 alias) |
| `GET` | `/api/v1/contracts/{id}/terms` | Xem các điều khoản thay đổi của hợp đồng nâng cấp |
| `GET` | `/api/v1/contracts/{id}/addendums/{addendumId}/terms` | Xem điều khoản chi tiết của phụ lục hợp đồng |
| `PUT` | `/api/v1/contracts/{id}/addendums/{addendumId}/sign` | Ký xác nhận phụ lục hợp đồng |
| `PUT` | `/api/v1/contracts/{id}/sign-upgrade` | Ký xác nhận hợp đồng nâng cấp gói chăm sóc |

### Finance (7 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/api/v1/finance/analytics` | Báo cáo phân tích doanh thu và tỷ lệ phân chia |
| `POST` | `/api/v1/finance/settlements/monthly` | Thực thi quyết toán doanh thu định kỳ hàng tháng cho cơ sở y tế |
| `PATCH` | `/api/v1/finance/settlements/{id}/review` | CSYT xác nhận bảng quyết toán của mình hoặc báo sai lệch |
| `POST` | `/api/v1/finance/settlements/{id}/evidence` | Tải chứng từ ngân hàng cho bảng quyết toán |
| `POST` | `/api/v1/finance/reconciliation/sepay` | Đối soát giao dịch với SePay API v2 và tự bù webhook bị bỏ lỡ |
| `GET` | `/api/v1/finance/reconciliation/sepay` | Xem lịch sử các lượt đối soát SePay |
| `GET` | `/api/v1/finance/reconciliation/sepay/status` | Xem trạng thái và số giao dịch chưa đối soát |

### Reviews (1 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/reviews/doctors` | Người đại diện gia đình gửi đánh giá và nhận xét cho bác sĩ |

### Complaints (4 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/complaints` | Gửi khiếu nại sự cố liên quan đến dịch vụ hoặc bác sĩ |
| `GET` | `/api/v1/complaints/{id}` | Xem thông tin chi tiết của một khiếu nại |
| `PATCH` | `/api/v1/complaints/{id}/resolve` | Giải quyết / cập nhật kết quả xử lý khiếu nại |
| `GET` | `/api/v1/facilities/me/complaints` | Danh sách khiếu nại thuộc CSYT đang đăng nhập |

### Users (6 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/api/v1/users/profile` | Lấy thông tin hồ sơ của người dùng hiện tại |
| `PATCH` | `/api/v1/users/profile` | - |
| `PUT` | `/api/v1/users/profile` | Cập nhật thông tin hồ sơ cá nhân |
| `GET` | `/api/v1/me/profile` | Lấy thông tin hồ sơ của người dùng hiện tại |
| `PATCH` | `/api/v1/me/profile` | - |
| `PUT` | `/api/v1/me/profile` | Cập nhật thông tin hồ sơ cá nhân |

### Notifications (6 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/notifications/reminders/run` | Admin chạy nhắc hết hạn trước 15 ngày; không tạo thông báo trùng |
| `POST` | `/api/v1/me/notifications/reminders/run` | Admin chạy nhắc hết hạn trước 15 ngày; không tạo thông báo trùng |
| `GET` | `/api/v1/notifications` | Lấy danh sách thông báo của người dùng hiện tại |
| `GET` | `/api/v1/me/notifications` | Lấy danh sách thông báo của người dùng hiện tại |
| `PATCH` | `/api/v1/notifications/{id}/read` | Đánh dấu thông báo đã đọc theo ID |
| `PATCH` | `/api/v1/me/notifications/{id}/read` | Đánh dấu thông báo đã đọc theo ID |

### Patients (9 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/patients` | Thêm hồ sơ thành viên gia đình (bệnh nhân) |
| `GET` | `/api/v1/patients` | Lấy danh sách thành viên trong hộ gia đình |
| `GET` | `/api/v1/patients/{id}` | Xem chi tiết hồ sơ bệnh nhân kèm tiền sử dị ứng và tài liệu |
| `PUT` | `/api/v1/patients/{id}` | Cập nhật thông tin hồ sơ bệnh nhân |
| `DELETE` | `/api/v1/patients/{id}` | Tách thành viên khỏi danh sách hoạt động của hộ gia đình (soft-deactivate) |
| `POST` | `/api/v1/patients/{id}/allergies` | Khai báo dị ứng thuốc, thực phẩm hoặc môi trường cho bệnh nhân |
| `GET` | `/api/v1/patients/{id}/allergies` | Lấy danh sách tiền sử dị ứng của bệnh nhân |
| `POST` | `/api/v1/patients/{id}/documents` | Đính kèm tài liệu y tế ban đầu (xét nghiệm, kết quả chẩn đoán hình ảnh...) |
| `GET` | `/api/v1/patients/{id}/documents` | Lấy danh sách tài liệu y tế của bệnh nhân |

### Doctor Treated Cases (Admin) (5 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/api/v1/admin/doctors/{doctorId}/treated-cases` | Quản trị viên xem mọi ca bệnh tiêu biểu của bác sĩ |
| `POST` | `/api/v1/admin/doctors/{doctorId}/treated-cases` | Quản trị viên nhập ca bệnh tiêu biểu mới (chờ duyệt) |
| `PATCH` | `/api/v1/admin/doctors/{doctorId}/treated-cases/{id}` | Cập nhật nội dung ca bệnh (quay lại chờ duyệt nếu nội dung đổi) |
| `POST` | `/api/v1/admin/doctors/{doctorId}/treated-cases/{id}/approve` | Duyệt công khai ca bệnh tiêu biểu |
| `POST` | `/api/v1/admin/doctors/{doctorId}/treated-cases/{id}/reject` | Từ chối công khai ca bệnh tiêu biểu kèm lý do |

### Platform Care Content (Admin) (4 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/api/v1/admin/platform-care-items` | Quản trị viên xem toàn bộ nội dung chăm sóc nền tảng |
| `POST` | `/api/v1/admin/platform-care-items` | Tạo mục nội dung chăm sóc mới |
| `PATCH` | `/api/v1/admin/platform-care-items/{id}` | Cập nhật nội dung chăm sóc |
| `DELETE` | `/api/v1/admin/platform-care-items/{id}` | Ngừng công khai nội dung chăm sóc (xóa mềm) |

### Encounters & Examination Scheduling (11 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/encounters/periodic` | Bác sĩ phụ trách lên lộ trình khám định kỳ dựa trên gói dịch vụ và hồ sơ sức khỏe |
| `POST` | `/api/v1/encounters/ad-hoc` | Đại diện gia đình gửi yêu cầu khám đột xuất (Ad-hoc) tới bác sĩ phụ trách |
| `PATCH` | `/api/v1/encounters/{id}/finalize` | Bác sĩ rà soát và chốt lịch khám cùng hình thức khám gửi gia đình duyệt |
| `PATCH` | `/api/v1/encounters/{id}/confirm` | Gia đình xác nhận đồng ý lịch khám & đối chiếu ca trực CSYT để đồng bộ lịch |
| `POST` | `/api/v1/encounters/{id}/reschedule` | Gia đình đề xuất đổi lịch khám sang khung giờ thay thế (Kiểm tra điều kiện trước >= 4 giờ) |
| `PATCH` | `/api/v1/encounters/{id}/reschedule-review` | Bác sĩ phản hồi yêu cầu dời lịch: Đồng ý hoặc Đề xuất khung giờ thay thế |
| `POST` | `/api/v1/encounters/shifts` | Cơ sở Y tế phân bổ ca trực nội viện cho bác sĩ (phục vụ cân bằng tải) |
| `GET` | `/api/v1/encounters/timetable/doctor` | Lấy thời khóa biểu lịch khám của bác sĩ |
| `GET` | `/api/v1/encounters/timetable/family` | Lấy thời khóa biểu lịch khám của hộ gia đình |
| `GET` | `/api/v1/encounters/facility/schedule-board` | CSYT giám sát bảng điều phối ca trực nội viện và lịch khám ngoại viện của bác sĩ |
| `GET` | `/api/v1/encounters/{id}` | Xem thông tin chi tiết một buổi khám |

### Admin (6 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/api/v1/admin/overview` | Tổng quan doanh thu, lượt khám và khiếu nại của nền tảng |
| `GET` | `/api/v1/admin/users` | Danh sách tài khoản và vai trò |
| `PATCH` | `/api/v1/admin/users/{id}/status` | Tạm khóa hoặc khôi phục quyền truy cập của tài khoản |
| `GET` | `/api/v1/admin/audit-logs` | Tra cứu nhật ký vận hành và bảo mật |
| `GET` | `/api/v1/admin/complaints` | Danh sách khiếu nại để quản trị viên xử lý |
| `POST` | `/api/v1/admin/facilities/{id}/resend-invite` | Gửi mã thiết lập lại mật khẩu cho CSYT đang hoàn thiện hồ sơ |

### Doctor Matching & Coordination Queue (11 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/matching/doctors` | Track B — Gợi ý bác sĩ gia đình bằng TypeSafe Jev System One kết hợp cân bằng tải đối tác (hoặc chuyển vào Hàng chờ Admin) |
| `GET` | `/api/v1/matching/sessions/{id}` | Lấy chi tiết phiên gợi ý bác sĩ (Track B) để preview trước khi tạo hợp đồng |
| `GET` | `/api/v1/matching-queue/my` | Đại diện hộ gia đình xem danh sách yêu cầu đang trong hàng chờ điều phối |
| `GET` | `/api/v1/matching-queue/{id}` | Xem chi tiết yêu cầu hàng chờ điều phối (bao gồm bác sĩ & CSYT đã được gán) |
| `PATCH` | `/api/v1/matching-queue/{id}/cancel` | Đại diện hộ gia đình hủy yêu cầu đang ở trạng thái QUEUED |
| `GET` | `/api/v1/admin/matching-queue` | Quản trị viên xem danh sách hàng chờ điều phối bác sĩ |
| `PATCH` | `/api/v1/admin/matching-queue/{id}/assign` | Quản trị viên phân công bác sĩ còn slot cho yêu cầu hàng chờ (tự suy ra CSYT & thông báo gia đình) |
| `GET` | `/api/v1/admin/matching-config` | Quản trị viên xem cấu hình runtime của model decision chuẩn System One (/v1/systemone) |
| `PATCH` | `/api/v1/admin/matching-config` | Quản trị viên cập nhật endpoint, model, kiểu câu hỏi và ngưỡng matching System One tại runtime |
| `POST` | `/api/v1/admin/matching-config/test` | Quản trị viên kiểm tra kết nối & test thử payload chuẩn /v1/systemone trước khi lưu |
| `GET` | `/api/v1/admin/matching-config/models` | Quản trị viên quét danh sách model sẵn có từ máy chủ Ollama (/api/tags) theo Endpoint URL |

