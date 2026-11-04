# Sửa đổi các điểm lệch và bổ sung các đặc tả còn thiếu của hệ thống API — Kế hoạch triển khai

**Mục tiêu:** Khắc phục triệt để 11 điểm sai lệch và thiếu sót giữa mã nguồn API và tài liệu đặc tả (SRS Report-3, SDS Report-4), đảm bảo 100% khớp quy chuẩn kỹ thuật và kiểm thử tự động pass.

**Cách tiếp cận:** Áp dụng nghiêm ngặt quy trình TDD (Red -> Green -> Refactor) theo từng cụm chức năng (Public Portal, Bác sĩ & CSYT, Hợp đồng y tế 4 bên, Xác thực & Người dùng), bổ sung các route aliases tương thích ngược và hoàn thiện các ràng buộc nghiệp vụ theo đúng sơ đồ tuần tự trong Report-4.

**Đã tra cứu codebase (codebase-memory-mcp):**
- `get_architecture`: Dự án sử dụng kiến trúc phân tầng NestJS (Controllers -> Services -> Repositories), tích hợp Prisma ORM và Redis. Đã xác nhận 16 Controller và 81 Route hiện diện trong codebase.
- `search_graph`: Đã xác định chính xác các controllers trọng tâm:
  - `PublicController` tại `src/modules/public/controllers/public.controller.ts`
  - `FacilitiesDoctorsController` tại `src/modules/doctors/controllers/facilities-doctors.controller.ts`
  - `DoctorsController` tại `src/modules/doctors/controllers/doctors.controller.ts`
  - `ContractsController` tại `src/modules/contracts/controllers/contracts.controller.ts`
  - `AuthController` tại `src/modules/auth/controllers/auth.controller.ts`
  - `UsersController` tại `src/modules/users/controllers/users.controller.ts`
  - `NotificationsController` tại `src/modules/notifications/controllers/notifications.controller.ts`
- `get_code_snippet`: Đã kiểm tra hàm `signUpgradedContract` và `terminateContract` trong `src/modules/contracts/services/impl/contracts.service.impl.ts`, xác nhận hệ thống có logic băm `termsHash` SHA-256 nhưng chưa nối endpoint khởi tạo hợp đồng y tế ban đầu (`UC-16`).

**Framework test & quy ước (đã xác nhận qua codebase-memory-mcp):**
- Framework: Jest với Node.js ESM (`node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit`)
- Vị trí đặt file test: Thư mục `__tests__` nằm trong từng module tương ứng (ví dụ: `src/modules/contracts/__tests__/`)
- Lệnh chạy test: `npm test -- <path-to-test-file>`

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Mọi thay đổi về route phải hỗ trợ route alias để giữ tính tương thích ngược, không làm gãy các client hoặc test e2e hiện hành.
- Tuyệt đối không được chỉnh sửa trực tiếp các file tài liệu Word gốc trong thư mục `docs/reports/`.

---

### Task 1: Bổ sung Route Aliases và Endpoints chi tiết cho Cổng thông tin công khai (UC-06, UC-08, UC-09)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: Không có
- Chỉnh sửa:
  - `src/modules/public/controllers/public.controller.ts` (`PublicController`)
  - `src/modules/public/services/interfaces/public.service.interface.ts` (`IPublicService`)
  - `src/modules/public/services/impl/public.service.impl.ts` (`PublicServiceImpl`)
- Test tương ứng:
  - `src/modules/public/__tests__/public.controller.spec.ts`
  - `src/modules/public/__tests__/public.service.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/public`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Khách vãng lai, trang chủ portal Frontend (Next.js), tài liệu Swagger
- Gọi tới: `PrismaService`, `RedisClient`, `AuditLog`
- Regression test cần chạy thêm: `npm test -- src/modules/public`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Dữ liệu công khai của Bác sĩ và Cơ sở y tế từ Task 2 & Task 3
- Cung cấp đầu ra cho: Giao diện tra cứu danh bạ và biểu mẫu tư vấn

- [x] **Bước 1 [RED]: Viết test cho các route alias và endpoint chi tiết của Public Portal**
  Vị trí file test: `src/modules/public/__tests__/public.controller.spec.ts`
  Test case:
  - Test case 1: Gọi `GET /api/v1/public/overview` phải trả về đúng dữ liệu như `GET /api/v1/public/portal-overview`.
  - Test case 2: Gọi `POST /api/v1/public/inquiries` phải tiếp nhận yêu cầu tư vấn như `POST /api/v1/public/consultation-requests`.
  - Test case 3: Gọi `GET /api/v1/public/facilities/:id` phải trả về chi tiết cơ sở y tế (404 nếu không tìm thấy hoặc chưa ACTIVE).
  - Test case 4: Gọi `GET /api/v1/public/doctors/:id` phải trả về chi tiết hồ sơ công khai của bác sĩ (404 nếu không tìm thấy hoặc chưa ACTIVE).
  Kỳ vọng: chạy `npm test -- src/modules/public/__tests__/public.controller.spec.ts` → FAIL với lý do các phương thức getPublicFacilityDetail, getPublicDoctorDetail và các alias chưa tồn tại trong PublicController.
- [x] **Bước 2 [GREEN]: Viết code triển khai PublicController và PublicServiceImpl để test ở Bước 1 PASS**
  Chỉnh sửa:
  - Thêm decorator `@Get(['portal-overview', 'overview'])` vào `getPublicPortalOverview`.
  - Thêm decorator `@Post(['consultation-requests', 'inquiries'])` vào `submitConsultationRequest`.
  - Cập nhật `IPublicService` và triển khai phương thức `getPublicFacilityDetail(id: string)` và `getPublicDoctorDetail(id: string)` trong `PublicServiceImpl`.
  - Thêm 2 endpoints `@Get('facilities/:id')` và `@Get('doctors/:id')` vào `PublicController`.
  Kỳ vọng: chạy `npm test -- src/modules/public/__tests__/public.controller.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Tối ưu hóa truy vấn chi tiết bác sĩ và CSYT**
  Tối ưu hóa phép select Prisma để không trả về các trường nhạy cảm (`userId`, `taxCode`, `bankAccountNumber`) khi truy vấn công khai.
  Kỳ vọng: chạy `npm test -- src/modules/public` → vẫn PASS, bảo toàn định dạng dữ liệu đầu ra.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test module public: `npm test -- src/modules/public`
  Kết quả mong đợi: tất cả 8+ test suites liên quan đến public đều PASS.

---

### Task 2: Kiểm tra Hợp đồng B2B nhân lực khi tạo Bác sĩ & Gửi email mời kích hoạt (UC-20)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: Không có
- Chỉnh sửa:
  - `src/modules/doctors/controllers/facilities-doctors.controller.ts` (`FacilitiesDoctorsController`)
  - `src/modules/doctors/services/impl/doctors.service.impl.ts` (`DoctorsServiceImpl.provisionDoctorAccount`)
- Test tương ứng:
  - `src/modules/doctors/__tests__/doctors.service.spec.ts`
  - `src/modules/doctors/__tests__/doctors.controller.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/doctors`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `FacilitiesDoctorsController.provisionDoctorAccount`
- Gọi tới: `PrismaService.b2bStaffingContract`, `PrismaService.doctor`, `MailerService`
- Regression test cần chạy thêm: `npm test -- src/modules/doctors`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Hợp đồng B2B đã được ký từ module contracts (Task 5)
- Cung cấp đầu ra cho: Hồ sơ bác sĩ chờ nộp chứng chỉ tại Task 3

- [x] **Bước 1 [RED]: Viết test kiểm tra hợp đồng B2B bắt buộc và gửi email khi tạo bác sĩ**
  Vị trí file test: `src/modules/doctors/__tests__/doctors.service.spec.ts`
  Test case:
  - Test case 1: Ném `BadRequestException('Cơ sở y tế chưa có hợp đồng nhân lực B2B đang có hiệu lực')` nếu CSYT không có hợp đồng B2B ở trạng thái ACTIVE hoặc đã hết hạn.
  - Test case 2: CSYT có hợp đồng B2B ACTIVE -> Khởi tạo tài khoản thành công và gọi `mailerService.sendMail` gửi thông tin mời kích hoạt.
  - Test case 3: `FacilitiesDoctorsController` hỗ trợ cả route `@Post()` và alias `@Post(':id/doctors')`.
  Kỳ vọng: chạy `npm test -- src/modules/doctors/__tests__/doctors.service.spec.ts` → FAIL vì hiện tại chưa có kiểm tra `b2bStaffingContract` và mock `mailerService` chưa được gọi trong `provisionDoctorAccount`.
- [x] **Bước 2 [GREEN]: Bổ sung kiểm tra B2B contract và gửi email trong DoctorsServiceImpl**
  Chỉnh sửa `src/modules/doctors/services/impl/doctors.service.impl.ts`:
  - Trước khi tạo tài khoản, truy vấn `tx.b2bStaffingContract.findFirst({ where: { facilityId: targetFacilityId, status: 'ACTIVE', endDate: { gte: new Date() } } })`. Nếu không có, throw `BadRequestException`.
  - Gọi `this.mailerService.sendMail(...)` gửi email chào mừng và thông báo kích hoạt tới email bác sĩ.
  - Thêm decorator `@Post(['', ':id/doctors'])` trong `FacilitiesDoctorsController`.
  Kỳ vọng: chạy `npm test -- src/modules/doctors/__tests__/doctors.service.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Tách helper kiểm tra hợp đồng B2B**
  Tách hàm kiểm tra điều kiện hiệu lực B2B thành phương thức private `assertFacilityHasActiveB2bContract` để tái sử dụng và giữ code clean.
  Kỳ vọng: chạy `npm test -- src/modules/doctors` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ unit tests của doctors module: `npm test -- src/modules/doctors`
  Kết quả mong đợi: tất cả test suites PASS.

---

### Task 3: Bổ sung Thông báo tự động và Route Aliases cho Thẩm định chứng chỉ Bác sĩ 2 cấp (UC-21, UC-22)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: Không có
- Chỉnh sửa:
  - `src/modules/doctors/controllers/doctors.controller.ts` (`DoctorsController`)
  - `src/modules/doctors/services/impl/doctors.service.impl.ts` (`DoctorsServiceImpl`)
- Test tương ứng:
  - `src/modules/doctors/__tests__/doctors.controller.spec.ts`
  - `src/modules/doctors/__tests__/doctors.service.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/doctors`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Bác sĩ nộp hồ sơ, CSYT duyệt Cấp 1, Admin duyệt Cấp 2
- Gọi tới: `PrismaService.doctorCredential`, `PrismaService.notification`, `MailerService`
- Regression test cần chạy thêm: `npm test -- src/modules/doctors`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Tài khoản bác sĩ được tạo ở Task 2
- Cung cấp đầu ra cho: Bác sĩ trạng thái ACTIVE sẵn sàng nhận hợp đồng ở Task 4

- [x] **Bước 1 [RED]: Viết test kiểm tra thông báo in-app và route aliases review chứng chỉ**
  Vị trí file test: `src/modules/doctors/__tests__/doctors.service.spec.ts`
  Test case:
  - Test case 1: Bác sĩ nộp chứng chỉ qua `PUT :id/credentials` hoặc alias `POST me/credentials` -> Tạo bản ghi `Notification` gửi cho người dùng của Cơ sở y tế.
  - Test case 2: CSYT duyệt Cấp 1 (`facility-approve`) -> Tạo bản ghi `Notification` gửi cho Quản trị viên (`ADMIN`).
  - Test case 3: Admin duyệt Cấp 2 (`platform-approve`) -> Tạo bản ghi `Notification` và gửi email chúc mừng cho Bác sĩ.
  - Test case 4: Gọi `POST /api/v1/doctors/credentials/:id/review` với body `{ tier: 1 }` hoặc `{ tier: 2 }` điều phối đúng phương thức thẩm định tương ứng.
  Kỳ vọng: chạy `npm test -- src/modules/doctors/__tests__/doctors.service.spec.ts` → FAIL với lý do Notification chưa được tạo và route `POST credentials/:id/review` chưa được định nghĩa.
- [x] **Bước 2 [GREEN]: Viết code tạo Notification và endpoint review chứng chỉ hợp nhất**
  Chỉnh sửa `src/modules/doctors/services/impl/doctors.service.impl.ts` và `src/modules/doctors/controllers/doctors.controller.ts`:
  - Trong `submitDoctorCredentials`: Tạo thông báo cho `doctor.facility.userId`.
  - Trong `approveDoctorCredentialsByFacility`: Tìm các tài khoản role `ADMIN` và tạo thông báo hồ sơ chờ phê duyệt Cấp 2.
  - Trong `approveDoctorCredentialsByPlatform`: Tạo thông báo kích hoạt cho `doctor.userId` và gửi email.
  - Trong `DoctorsController`: Thêm route `@Put([':id/credentials', 'me/credentials'])` và thêm method `@Post('credentials/:id/review')`.
  Kỳ vọng: chạy `npm test -- src/modules/doctors/__tests__/doctors.service.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Tinh chỉnh template nội dung thông báo**
  Chuẩn hóa nội dung title và content của thông báo theo danh mục sự kiện định sẵn (`DOCTOR_CREDENTIALS_SUBMITTED`, `DOCTOR_FACILITY_VERIFIED`, `DOCTOR_PLATFORM_APPROVED`).
  Kỳ vọng: chạy `npm test -- src/modules/doctors` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/doctors`
  Kết quả mong đợi: tất cả test suites PASS.

---

### Task 4: Triển khai API Hợp đồng dịch vụ y tế 4 bên ban đầu và Ký số lần đầu (UC-16)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới:
  - `src/modules/contracts/dtos/create-medical-contract.dto.ts`
  - `src/modules/contracts/__tests__/initial-medical-contracts.spec.ts`
- Chỉnh sửa:
  - `src/modules/contracts/controllers/contracts.controller.ts` (`ContractsController`)
  - `src/modules/contracts/services/interfaces/contracts.service.interface.ts` (`IContractsService`)
  - `src/modules/contracts/services/impl/contracts.service.impl.ts` (`ContractsServiceImpl`)
  - `src/modules/contracts/repositories/interfaces/contracts.repository.interface.ts`
  - `src/modules/contracts/repositories/impl/contracts.repository.impl.ts`
- Test tương ứng:
  - `src/modules/contracts/__tests__/initial-medical-contracts.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/contracts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Đại diện gia đình (mua gói ban đầu), Admin, CSYT, Bác sĩ
- Gọi tới: `PrismaService.medicalContract`, `PrismaService.contractSignature`, `calculateContractTermsHash`, `PaymentsService`
- Regression test cần chạy thêm: `npm test -- src/modules/contracts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Gói dịch vụ từ CarePackages (Task 1) và Bác sĩ đã kích hoạt (Task 3)
- Cung cấp đầu ra cho: Cổng thanh toán VietQR (UC-33) khi hợp đồng đạt trạng thái `PENDING_PAYMENT`

- [x] **Bước 1 [RED]: Viết test cho tạo bản nháp hợp đồng y tế 4 bên và luồng ký số ban đầu**
  Vị trí file test: `src/modules/contracts/__tests__/initial-medical-contracts.spec.ts`
  Test case:
  - Test case 1: `POST /api/v1/contracts/medical` với `packageId`, `memberCount`, `facilityId`, `doctorId` -> Tạo hợp đồng mới ở trạng thái `PENDING_APPROVAL`, snapshot giá và quyền lợi vào `billingSnapshot`.
  - Test case 2: `PUT /api/v1/contracts/medical/:id/sign` (hỗ trợ alias `POST .../sign`) cho phép 4 bên ký theo thứ tự: `FAMILY_REP` -> `ADMIN` -> `HEALTHCARE_FACILITY` -> `ASSIGNED_DOCTOR`.
  - Test case 3: Khi bên thứ 4 hoàn tất ký số -> Tự động chuyển trạng thái hợp đồng sang `PENDING_PAYMENT` để tiếp nối sang thanh toán VietQR.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/initial-medical-contracts.spec.ts` → FAIL với lý do endpoint `POST /api/v1/contracts/medical` và `signInitialContract` chưa được định nghĩa.
- [x] **Bước 2 [GREEN]: Viết code triển khai tạo và ký hợp đồng y tế 4 bên ban đầu**
  Triển khai:
  - Tạo DTO `CreateMedicalContractDto` với validation `packageId`, `memberCount`, `facilityId`, `doctorId`.
  - Bổ sung `createInitialMedicalContract` và `signInitialMedicalContract` vào `IContractsService` và triển khai trong `ContractsServiceImpl`.
  - Sử dụng `calculateContractTermsHash` để tính hash hợp đồng chống chối bỏ.
  - Mở 2 endpoints `@Post('medical')` và `@Put(['medical/:id/sign', 'medical/:id/signatures'])` trong `ContractsController`.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/initial-medical-contracts.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Tối ưu hóa kiểm tra thứ tự ký số 4 bên**
  Tái sử dụng hàm `assertSigningOrder` đã có trong `contracts.service.impl.ts` cho cả hợp đồng ban đầu và hợp đồng nâng cấp.
  Kỳ vọng: chạy `npm test -- src/modules/contracts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/contracts`
  Kết quả mong đợi: tất cả các test suites của module contracts đều PASS.

---

### Task 5: Chuẩn hóa Route Aliases và Method cho Hợp đồng B2B & Chấm dứt hợp đồng (UC-15, UC-19)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: Không có
- Chỉnh sửa:
  - `src/modules/contracts/controllers/contracts.controller.ts` (`ContractsController`)
- Test tương ứng:
  - `src/modules/contracts/__tests__/staffing-contracts.controller.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/contracts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Admin, CSYT, Đại diện gia đình
- Gọi tới: `ContractsServiceImpl.signStaffingContract`, `ContractsServiceImpl.terminateContract`
- Regression test cần chạy thêm: `npm test -- src/modules/contracts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Hợp đồng B2B và Hợp đồng y tế hiện hữu
- Cung cấp đầu ra cho: Cập nhật trạng thái hợp đồng sang ACTIVE hoặc TERMINATED

- [x] **Bước 1 [RED]: Viết test cho route alias ký B2B bằng POST và các endpoint chấm dứt hợp đồng**
  Vị trí file test: `src/modules/contracts/__tests__/staffing-contracts.controller.spec.ts`
  Test case:
  - Test case 1: Gọi `POST /api/v1/contracts/staffing/:id/sign` phải thực hiện ký hợp đồng B2B giống như `PUT /api/v1/contracts/staffing/:id/sign`.
  - Test case 2: Gọi `POST /api/v1/contracts/:id/termination` tương đương với gọi `PATCH :id/terminate` với `action = REQUEST`.
  - Test case 3: Gọi `POST /api/v1/contracts/terminations/:id/decision` tương đương với `PATCH :id/terminate` với `action = APPROVE` hoặc `action = REJECT`.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/staffing-contracts.controller.spec.ts` → FAIL với lý do các route POST này chưa được khai báo trên controller.
- [x] **Bước 2 [GREEN]: Bổ sung route aliases trong ContractsController**
  Chỉnh sửa `src/modules/contracts/controllers/contracts.controller.ts`:
  - Thêm decorator `@Post('staffing/:id/sign')` chuyển hướng gọi tới `signStaffingContract`.
  - Thêm endpoint `@Post(':id/termination')` chuyển hướng gọi tới `terminateContract` với `dto.action = 'REQUEST'`.
  - Thêm endpoint `@Post('terminations/:id/decision')` chuyển hướng gọi tới `terminateContract` với action tương ứng trong body.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/staffing-contracts.controller.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Tinh chỉnh DTO mapping cho các route alias**
  không cần refactor vì controller chỉ map request body sang DTO hiện có mà không làm thay đổi hành vi nghiệp vụ.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/contracts`
  Kết quả mong đợi: tất cả test suites PASS.

---

### Task 6: Chuẩn hóa Route Aliases và HTTP Status cho Auth, Users & Notifications (UC-03, UC-10, UC-11)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: Không có
- Chỉnh sửa:
  - `src/modules/auth/controllers/auth.controller.ts` (`AuthController`)
  - `src/modules/users/controllers/users.controller.ts` (`UsersController`)
  - `src/modules/notifications/controllers/notifications.controller.ts` (`NotificationsController`)
- Test tương ứng:
  - `src/modules/auth/__tests__/auth.controller.spec.ts`
  - `src/modules/users/__tests__/users.controller.spec.ts`
  - `src/modules/notifications/__tests__/notifications.controller.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/auth src/modules/users src/modules/notifications`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Mọi người dùng đã đăng nhập hệ thống
- Gọi tới: `AuthService`, `UsersService`, `NotificationsService`
- Regression test cần chạy thêm: `npm test -- src/core/__tests__/jwt-auth-guard.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Token xác thực JWT
- Cung cấp đầu ra cho: Hồ sơ cá nhân và danh sách thông báo

- [x] **Bước 1 [RED]: Viết test cho các alias route /me và HTTP status của logout**
  Vị trí file test: `src/modules/auth/__tests__/auth.controller.spec.ts`
  Test case:
  - Test case 1: Endpoint `POST /api/v1/auth/logout` trả về mã 200 OK (hoặc 204 No Content nếu có header `prefer-no-content`).
  - Test case 2: Gọi `GET /api/v1/me/profile` và `PATCH /api/v1/me/profile` (hoặc `PUT`) trả về và cập nhật hồ sơ người dùng hiện tại tương đương `/api/v1/users/profile`.
  - Test case 3: Gọi `GET /api/v1/me/notifications` và `PATCH /api/v1/me/notifications/:id/read` trả về và đánh dấu đã đọc thông báo tương đương `/api/v1/notifications`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.controller.spec.ts` → FAIL với lý do các alias route `/api/v1/me/...` chưa được cấu hình.
- [x] **Bước 2 [GREEN]: Thêm route alias /me cho UsersController và NotificationsController**
  Chỉnh sửa:
  - Trong `UsersController`: Thêm route prefix `@Controller(['api/v1/users', 'api/v1/me'])` và hỗ trợ cả `@Patch('profile')` lẫn `@Put('profile')`.
  - Trong `NotificationsController`: Thêm route prefix `@Controller(['api/v1/notifications', 'api/v1/me/notifications'])`.
  - Trong `AuthController`: Giữ nguyên mã 200 OK và thêm Swagger documentation giải thích mã 204.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.controller.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Tinh giản Swagger tags cho các route aliases**
  Đảm bảo các route alias mới không làm trùng lặp tag hiển thị trên Swagger UI (`@ApiTags('Users')`, `@ApiTags('Notifications')`).
  Kỳ vọng: chạy `npm test -- src/modules/auth src/modules/users src/modules/notifications` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/auth src/modules/users src/modules/notifications`
  Kết quả mong đợi: tất cả test suites PASS.

---

### Task 7: Chạy kiểm thử hồi quy toàn bộ hệ thống (Regression Test Suite Verification)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: Không có
- Chỉnh sửa: Không có
- Test tương ứng: Toàn bộ các file `*.spec.ts` trong `src/`
- Kiểm chứng bằng: `npm test`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Toàn bộ hệ thống backend
- Gọi tới: PostgreSQL, Redis (mock/in-memory), Mailer (mock)
- Regression test cần chạy thêm: `npm test`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Kết quả hoàn thành của Task 1 đến Task 6
- Cung cấp đầu ra cho: Hệ thống backend sẵn sàng bàn giao cho người dùng

- [x] **Bước 1 [RED]: Viết test kiểm tra tính toàn vẹn tích hợp giữa các module đã sửa đổi**
  Vị trí file test: `src/core/__tests__/nam-sequence-alignment.spec.ts`
  Test case: Kiểm tra chuỗi tuần tự từ Public Portal -> Đăng ký -> CSYT tạo bác sĩ -> Thẩm định 2 cấp -> Tạo hợp đồng y tế 4 bên ban đầu -> Ký số -> Chuyển sang chờ thanh toán VietQR.
  Kỳ vọng: chạy `npm test -- src/core/__tests__/nam-sequence-alignment.spec.ts` → FAIL nếu luồng hợp đồng 4 bên ban đầu chưa được nối thông sang trạng thái PENDING_PAYMENT.
- [x] **Bước 2 [GREEN]: Xác nhận toàn bộ chuỗi tích hợp đã thông suốt và pass test**
  Chạy lại bộ test kiểm tra chuỗi tích hợp sau khi hoàn thành Task 4.
  Kỳ vọng: chạy `npm test -- src/core/__tests__/nam-sequence-alignment.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Dọn dẹp các import và định dạng code**
  Chạy `npm run format` để chuẩn hóa toàn bộ các file mã nguồn đã chỉnh sửa.
  Kỳ vọng: chạy `npm test` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: Chạy lệnh `npm test` cho toàn bộ dự án.
  Kết quả mong đợi: 100% test suites (15+ suites, 220+ tests) đều PASS.

