# Danh Mục Toàn Bộ API Backend (FamiDoc API Inventory)

> **Tổng số Endpoint:** 99 APIs
> **Số phân hệ (Tags):** 17 phân hệ
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

### Public Portal (11 APIs)

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
| `GET` | `/api/v1/public/doctors/{id}` | Xem chi tiết bác sĩ gia đình công khai theo ID (UC-08) |
| `POST` | `/api/v1/public/consultation-requests` | Gửi yêu cầu tư vấn gói dịch vụ chăm sóc gia đình (STT 12 - UC-09) |
| `POST` | `/api/v1/public/inquiries` | Gửi yêu cầu tư vấn gói dịch vụ chăm sóc gia đình (STT 12 - UC-09) |

### Doctors & Facilities Management (4 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/facilities/doctors` | Cơ sở y tế khởi tạo tài khoản Bác sĩ trực thuộc (STT 15 - UC-20) |
| `POST` | `/api/v1/facilities/doctors/{id}/doctors` | Cơ sở y tế khởi tạo tài khoản Bác sĩ trực thuộc (STT 15 - UC-20) |
| `POST` | `/api/v1/facilities` | Cơ sở y tế khởi tạo tài khoản Bác sĩ trực thuộc (STT 15 - UC-20) |
| `POST` | `/api/v1/facilities/{id}/doctors` | Cơ sở y tế khởi tạo tài khoản Bác sĩ trực thuộc (STT 15 - UC-20) |

### Doctors Management (6 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `PUT` | `/api/v1/doctors/me/credentials` | Bác sĩ tải lên hồ sơ văn bằng, chứng chỉ hành nghề của chính mình (UC-21 alias) |
| `PUT` | `/api/v1/doctors/{id}/credentials` | Bác sĩ tải lên hồ sơ văn bằng, chứng chỉ hành nghề (STT 16 - UC-21) |
| `PATCH` | `/api/v1/doctors/{id}/credentials/facility-approve` | Cơ sở y tế thẩm định hồ sơ bác sĩ - Cấp 1 (STT 17 - UC-22) |
| `PATCH` | `/api/v1/doctors/{id}/credentials/platform-approve` | Quản trị viên Nền tảng phê duyệt cấp chứng nhận - Cấp 2 (STT 18 - UC-22) |
| `POST` | `/api/v1/doctors/credentials/{id}/review` | Thẩm định hồ sơ chứng chỉ bác sĩ hợp nhất 2 cấp (UC-22) |
| `GET` | `/api/v1/doctors/{id}` | Xem chi tiết hồ sơ bác sĩ |

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

### Webhooks (2 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/webhooks/sepay/test` | Nhận và xử lý IPN Webhook tự động từ cổng thanh toán SePay |
| `POST` | `/api/v1/payments/webhook/vietqr` | Nhận và xử lý IPN Webhook tự động từ cổng thanh toán SePay |

### Contracts (23 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/contracts/four-party` | Khởi tạo hợp đồng dịch vụ y tế 4 bên ban đầu (STT 28 - UC-16, SD-16) |
| `POST` | `/api/v1/contracts/medical` | Khởi tạo hợp đồng dịch vụ y tế 4 bên ban đầu (STT 28 - UC-16, SD-16) |
| `GET` | `/api/v1/contracts/medical` | Xem danh sách hợp đồng dịch vụ y tế 4 bên theo vai trò |
| `PUT` | `/api/v1/contracts/four-party/{id}/sign` | Ký số điện tử hợp đồng y tế 4 bên ban đầu (STT 29 - UC-16, SD-16) |
| `PUT` | `/api/v1/contracts/medical/{id}/sign` | Ký số điện tử hợp đồng y tế 4 bên ban đầu (STT 29 - UC-16, SD-16) |
| `PUT` | `/api/v1/contracts/medical/{id}/signatures` | Ký số điện tử hợp đồng y tế 4 bên ban đầu (STT 29 - UC-16, SD-16) |
| `PATCH` | `/api/v1/contracts/{id}/assign-doctor` | Phân công / Điều chuyển bác sĩ gia đình phụ trách hợp đồng (STT 30 - UC-23, SD-23) |
| `GET` | `/api/v1/contracts/medical/{id}` | Xem chi tiết hợp đồng dịch vụ y tế 4 bên |
| `GET` | `/api/v1/contracts/medical/{id}/care-summary` | Tóm tắt nhu cầu chăm sóc sức khỏe của các thành viên trong hợp đồng |
| `GET` | `/api/v1/contracts/medical/{id}/document` | Kết xuất văn bản bản sao hợp đồng dịch vụ y tế điện tử 4 bên |
| `POST` | `/api/v1/contracts/staffing` | Thiết lập hợp đồng cung ứng nhân lực y tế B2B (STT 13 - UC-15) |
| `GET` | `/api/v1/contracts/staffing` | Xem danh sách hợp đồng cung ứng nhân lực B2B |
| `PUT` | `/api/v1/contracts/staffing/{id}/sign` | Ký số điện tử hợp đồng cung ứng nhân lực B2B (STT 14 - UC-15) |
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

### Finance (2 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `GET` | `/api/v1/finance/analytics` | Báo cáo phân tích doanh thu và tỷ lệ phân chia |
| `POST` | `/api/v1/finance/settlements/monthly` | Thực thi quyết toán doanh thu định kỳ hàng tháng cho cơ sở y tế |

### Reviews (1 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/reviews/doctors` | Người đại diện gia đình gửi đánh giá và nhận xét cho bác sĩ |

### Complaints (3 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/complaints` | Gửi khiếu nại sự cố liên quan đến dịch vụ hoặc bác sĩ |
| `GET` | `/api/v1/complaints/{id}` | Xem thông tin chi tiết của một khiếu nại |
| `PATCH` | `/api/v1/complaints/{id}/resolve` | Giải quyết / cập nhật kết quả xử lý khiếu nại |

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

### Patients (8 APIs)

| Method | Endpoint | Mô tả / Nghiệp vụ |
| :--- | :--- | :--- |
| `POST` | `/api/v1/patients` | Thêm hồ sơ thành viên gia đình (bệnh nhân) |
| `GET` | `/api/v1/patients` | Lấy danh sách thành viên trong hộ gia đình |
| `GET` | `/api/v1/patients/{id}` | Xem chi tiết hồ sơ bệnh nhân kèm tiền sử dị ứng và tài liệu |
| `PUT` | `/api/v1/patients/{id}` | Cập nhật thông tin hồ sơ bệnh nhân |
| `POST` | `/api/v1/patients/{id}/allergies` | Khai báo dị ứng thuốc, thực phẩm hoặc môi trường cho bệnh nhân |
| `GET` | `/api/v1/patients/{id}/allergies` | Lấy danh sách tiền sử dị ứng của bệnh nhân |
| `POST` | `/api/v1/patients/{id}/documents` | Đính kèm tài liệu y tế ban đầu (xét nghiệm, kết quả chẩn đoán hình ảnh...) |
| `GET` | `/api/v1/patients/{id}/documents` | Lấy danh sách tài liệu y tế của bệnh nhân |

