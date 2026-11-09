# Triển khai Quản lý Thành viên Gia đình & Hợp đồng Dịch vụ Y tế 4 bên — Kế hoạch triển khai

**Mục tiêu:** Bổ sung trọn vẹn Module quản lý thành viên & tiền sử bệnh lý gia đình (`patients`), tái lập quan hệ thành viên được bảo trợ (`contract_members`), khắc phục mâu thuẫn bắt buộc chọn bác sĩ quá sớm và hoàn thiện bộ API tra cứu, tóm tắt nhu cầu chăm sóc và bản sao hợp đồng 4 bên theo chuẩn Activity Diagram.

**Cách tiếp cận:** Áp dụng Phương án 1 (Clean Domain Separation & Relational Normalization) bằng việc tách biệt module `patients`, cập nhật cơ sở dữ liệu Prisma cho phép `medical_contracts.doctor_id` nullable và tái thiết lập bảng quan hệ `contract_members`, chuẩn hóa luồng phân công bác sĩ qua endpoint `assign-doctor` trước khi ký số, đồng thời bổ sung các query endpoint trong `contracts`.

**Đã tra cứu codebase (codebase-memory-mcp):**
- Đã xác nhận qua `get_architecture`: Dự án NestJS 12 layered architecture, dùng Prisma ORM (`prisma/schema.prisma`), module nghiệp vụ nằm tại `src/modules/`.
- Đã xác nhận qua `search_graph`: Chưa có module `patients` trong `src/modules/`; `ContractsController` tại `src/modules/contracts/controllers/contracts.controller.ts` chỉ có GET cho staffing (`/contracts/staffing`), hoàn toàn thiếu GET cho `MedicalContract`.
- Đã xác nhận qua `get_code_snippet`:
  - `ContractsServiceImpl.createInitialMedicalContract` tại `src/modules/contracts/services/impl/contracts.service.impl.ts:76-237` đang ép buộc `dto.doctorId` và gọi `session.findDoctorById`.
  - `ContractsServiceImpl.assignDoctorToPackage` tại `src/modules/contracts/services/impl/contracts.service.impl.ts:319-397` đã hỗ trợ cơ sở y tế cập nhật bác sĩ cho hợp đồng.
  - `getContractSignerRole` tại `src/core/business/business-helpers.ts:13-31` định danh 4 vai trò ký: `FAMILY_REP`, `ADMIN`, `HEALTHCARE_FACILITY`, `ASSIGNED_DOCTOR`.
- Đã xác nhận qua migration `20261031000400_consolidate_contract_workflows`: Bảng `contract_members` trước đây bị drop và gộp vào `member_count` + `legacy_member_ids` JSONB, khiến tầng domain mất liên kết quan hệ 3NF giữa hợp đồng và bệnh nhân.

**Framework test & quy ước (đã xác nhận qua codebase-memory-mcp):**
- Framework: Jest (`node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit`)
- Vị trí đặt file test: Thư mục `__tests__` nằm bên trong từng module (ví dụ: `src/modules/contracts/__tests__/*.spec.ts`, `src/modules/patients/__tests__/*.spec.ts`).
- Lệnh chạy test: `npm test -- <đường-dẫn-file-test>`

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Mọi model, relation trong `schema.prisma` phải tương thích với PostgreSQL 16 và quy chuẩn đặt tên snake_case cho DB maps (`@map("...")`).
- Giữ nguyên cấu trúc xác thực JWT và phân quyền `RolesGuard` (`Roles('FAMILY_REP', 'HEALTHCARE_FACILITY', 'DOCTOR', 'ADMIN')`).

---

### Task 1: Tái lập bảng `contract_members` và cho phép `doctor_id NULL` trong Prisma Schema

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `prisma/schema.prisma` (model `MedicalContract` tại dòng 456-503, model `Patient` tại dòng 398-419)
- Tạo mới: `prisma/migrations/20261109000100_contract_members_and_nullable_doctor/migration.sql`
- Test tương ứng: `src/modules/contracts/__tests__/contract-members-schema.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/contracts/__tests__/contract-members-schema.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `src/modules/contracts/services/impl/contracts.service.impl.ts`
- Gọi tới: `@prisma/client`
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/contracts/__tests__/initial-medical-contracts.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Schema PostgreSQL hiện tại
- Cung cấp đầu ra cho: Task 2, Task 4 (tương tác quan hệ hợp đồng - bệnh nhân)

- [ ] **Bước 1 [RED]: Viết test cho schema contract_members và doctor_id nullable**
  Vị trí file test: `src/modules/contracts/__tests__/contract-members-schema.spec.ts`
  Test case: Kiểm tra Prisma Client metadata có chứa model `ContractMember` và trường `doctorId` trong `MedicalContract` cho phép giá trị `null`.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/contract-members-schema.spec.ts` → FAIL với lý do model `contractMember` chưa tồn tại trong Prisma Client.
- [ ] **Bước 2 [GREEN]: Viết code tối thiểu tại prisma/schema.prisma và tạo migration để test ở Bước 1 PASS**
  Chỉnh sửa `prisma/schema.prisma`:
  - Trong `MedicalContract`: đổi `doctorId String` thành `doctorId String? @map("doctor_id") @db.Uuid`, `doctor Doctor? @relation(...)`, thêm `members ContractMember[]`.
  - Trong `Patient`: thêm `contractMembers ContractMember[]`.
  - Thêm model `ContractMember`:
    ```prisma
    model ContractMember {
      id                String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
      contractId        String           @map("contract_id") @db.Uuid
      patientId         String           @map("patient_id") @db.Uuid
      addedByAddendumId String?          @map("added_by_addendum_id") @db.Uuid
      createdAt         DateTime         @default(now()) @map("created_at") @db.Timestamptz()
      contract          MedicalContract  @relation(fields: [contractId], references: [id], onDelete: Restrict)
      patient           Patient          @relation(fields: [patientId], references: [id], onDelete: Restrict)
      @@unique([contractId, patientId], map: "idx_contract_members_contract_patient")
      @@map("contract_members")
    }
    ```
  - Chạy `npx prisma generate` và tạo file migration `prisma/migrations/20261109000100_contract_members_and_nullable_doctor/migration.sql`.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/contract-members-schema.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR] (nếu cần): Tinh chỉnh index và naming constraints**
  Kiểm tra cú pháp `@map` và khóa ngoại `onDelete: Restrict` bảo đảm không phát sinh cascade ngoài ý muốn.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/contract-members-schema.spec.ts` → vẫn PASS.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/contracts/__tests__/contract-members-schema.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 2: Xây dựng Module Patients — DTOs, Repository & Service Layer

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới:
  - `src/modules/patients/dtos/create-patient.dto.ts`
  - `src/modules/patients/dtos/update-patient.dto.ts`
  - `src/modules/patients/dtos/create-allergy.dto.ts`
  - `src/modules/patients/dtos/create-patient-document.dto.ts`
  - `src/modules/patients/repositories/interfaces/patients.repository.interface.ts`
  - `src/modules/patients/repositories/impl/patients.repository.impl.ts`
  - `src/modules/patients/services/interfaces/patients.service.interface.ts`
  - `src/modules/patients/services/impl/patients.service.impl.ts`
- Test tương ứng: `src/modules/patients/__tests__/patients.service.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/patients/__tests__/patients.service.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `PatientsController` (Task 3)
- Gọi tới: `PrismaService`, model `Patient`, `PatientAllergy`, `PatientDocument`
- Regression test cần chạy thêm do có inbound calls: không có, xác nhận qua trace_path inbound=0 cho module mới

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Schema Prisma tại Task 1
- Cung cấp đầu ra cho: Task 3 (Controller tiếp nhận HTTP request) và Task 4 (kiểm tra `patientIds` thuộc hộ gia đình)

- [x] **Bước 1 [RED]: Viết test cho nghiệp vụ PatientsService**
  Vị trí file test: `src/modules/patients/__tests__/patients.service.spec.ts`
  Test case:
  - `createPatient`: Thêm thành viên mới vào hộ gia đình của `FAMILY_REP`, xác thực dữ liệu quan hệ thân nhân (`relationshipToRepresentative`).
  - `listFamilyMembers`: Trả về danh sách bệnh nhân thuộc `familyUnitId` của tài khoản đại diện.
  - `addAllergy`: Thêm thông tin dị ứng cho bệnh nhân chỉ định.
  - `addDocument`: Thêm hồ sơ bệnh án hoặc kết quả cận lâm sàng ban đầu cho bệnh nhân.
  Kỳ vọng: chạy `npm test -- src/modules/patients/__tests__/patients.service.spec.ts` → FAIL với lý do `PatientsServiceImpl` chưa được định nghĩa.
- [x] **Bước 2 [GREEN]: Viết code tối thiểu DTO, Repository và Service để test ở Bước 1 PASS**
  Triển khai:
  - Tạo các DTO với validation `class-validator` (`IsNotEmpty`, `IsString`, `IsEnum`, `IsDateString`, `IsOptional`).
  - Tạo interface `IPatientsRepository` và `IPatientsService`.
  - Triển khai `PatientsRepositoryImpl` thao tác CRUD qua `PrismaService`.
  - Triển khai `PatientsServiceImpl` kiểm soát quyền sở hữu: `FAMILY_REP` chỉ được quản lý bệnh nhân trong `familyUnitId` của mình; `ADMIN` được quản lý toàn bộ.
  Kỳ vọng: chạy `npm test -- src/modules/patients/__tests__/patients.service.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Tinh chỉnh mapping Entity response**
  Tách riêng các mapper chuyển đổi dữ liệu Prisma sang DTO response sạch, loại bỏ các trường nội bộ không cần thiết.
  Kỳ vọng: chạy `npm test -- src/modules/patients/__tests__/patients.service.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/patients/__tests__/patients.service.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 3: Xây dựng PatientsController và Đăng ký PatientsModule vào AppModule

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới:
  - `src/modules/patients/controllers/patients.controller.ts`
  - `src/modules/patients/patients.module.ts`
- Chỉnh sửa: `src/app.module.ts` (AppModule Class tại dòng 19-38)
- Test tương ứng: `src/modules/patients/__tests__/patients.controller.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/patients/__tests__/patients.controller.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: HTTP Clients (Web/Mobile App)
- Gọi tới: `PatientsService`
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/core/__tests__/entrypoint-contract.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `PatientsService` (Task 2)
- Cung cấp đầu ra cho: Đại diện gia đình khai báo hồ sơ y tế trước khi chọn gói hợp đồng

- [x] **Bước 1 [RED]: Viết test cho HTTP Endpoints của PatientsController**
  Vị trí file test: `src/modules/patients/__tests__/patients.controller.spec.ts`
  Test case:
  - `POST /api/v1/patients`: Tạo hồ sơ thành viên mới với vai trò `FAMILY_REP`.
  - `GET /api/v1/patients`: Lấy danh sách thành viên trong gia đình.
  - `GET /api/v1/patients/:id`: Lấy chi tiết hồ sơ thành viên.
  - `PUT /api/v1/patients/:id`: Cập nhật thông tin thành viên.
  - `POST /api/v1/patients/:id/allergies`: Khai báo dị ứng thuốc/thức ăn.
  - `GET /api/v1/patients/:id/allergies`: Xem danh sách dị ứng.
  - `POST /api/v1/patients/:id/documents`: Đính kèm tài liệu y tế ban đầu.
  - `GET /api/v1/patients/:id/documents`: Xem danh sách tài liệu y tế.
  Kỳ vọng: chạy `npm test -- src/modules/patients/__tests__/patients.controller.spec.ts` → FAIL với lý do `PatientsController` chưa tồn tại.
- [x] **Bước 2 [GREEN]: Viết code tối thiểu PatientsController và đăng ký module để test ở Bước 1 PASS**
  Triển khai:
  - Tạo `PatientsController` tại `src/modules/patients/controllers/patients.controller.ts` đính kèm `@UseGuards(RolesGuard)`, `@Roles('FAMILY_REP', 'ADMIN')` và Swagger annotations.
  - Tạo `PatientsModule` tại `src/modules/patients/patients.module.ts` cung cấp repository và service token.
  - Thêm `PatientsModule` vào mảng `imports` của `AppModule` trong `src/app.module.ts`.
  Kỳ vọng: chạy `npm test -- src/modules/patients/__tests__/patients.controller.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Chuẩn hóa Swagger DTO documentation**
  Bổ sung đầy đủ `@ApiOperation`, `@ApiResponse`, `@ApiParam` cho 8 endpoints của PatientsController.
  Kỳ vọng: chạy `npm test -- src/modules/patients/__tests__/patients.controller.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/patients/__tests__/patients.controller.spec.ts`
  Kết quả mong đợi: tất cả PASS, kiểm tra regression test `npm test -- src/core/__tests__/entrypoint-contract.spec.ts` PASS.

---

### Task 4: Nâng cấp Khởi tạo Hợp đồng 4 bên với `patientIds` và Bác sĩ Tùy chọn

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa:
  - `src/modules/contracts/dtos/create-medical-contract.dto.ts` (Class CreateMedicalContractDto tại dòng 11-74)
  - `src/modules/contracts/services/impl/contracts.service.impl.ts` (Method `createInitialMedicalContract` tại dòng 76-237, Method `signInitialMedicalContract` tại dòng 239-301, Method `assignDoctorToPackage` tại dòng 319-397)
  - `src/modules/contracts/repositories/impl/contracts.repository.impl.ts`
- Test tương ứng: `src/modules/contracts/__tests__/initial-medical-contracts.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/contracts/__tests__/initial-medical-contracts.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `ContractsController.initiateFourPartyContract`
- Gọi tới: `PrismaContractsSession.createMedicalContract`, bảng `contract_members`
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/contracts/__tests__/four-party-and-assign-doctor.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Schema Prisma Task 1, danh sách bệnh nhân từ Task 2/3
- Cung cấp đầu ra cho: Luồng ký số 4 bên và tra cứu hợp đồng ở Task 5

- [ ] **Bước 1 [RED]: Cập nhật test case khởi tạo hợp đồng cho phép doctorId optional và bắt buộc patientIds**
  Vị trí file test: `src/modules/contracts/__tests__/initial-medical-contracts.spec.ts`
  Test case:
  - Khởi tạo hợp đồng thành công khi không truyền `doctorId` (giá tính theo `DoctorTier.STANDARD`, trạng thái `PENDING_APPROVAL`, `contract.doctorId` là null).
  - Khởi tạo hợp đồng thất bại với 400 Bad Request nếu truyền `patientIds` rỗng hoặc có bệnh nhân không thuộc hộ gia đình.
  - Khởi tạo hợp đồng thành công lưu đủ các bản ghi vào bảng `contract_members`.
  - Cơ sở y tế hoặc Bác sĩ không thể ký nếu `doctorId` chưa được gán.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/initial-medical-contracts.spec.ts` → FAIL vì DTO hiện tại vẫn bắt buộc `doctorId` và chưa hỗ trợ `patientIds`.
- [ ] **Bước 2 [GREEN]: Viết code cập nhật CreateMedicalContractDto, Repository và ContractsServiceImpl để test ở Bước 1 PASS**
  Triển khai:
  - Tại `src/modules/contracts/dtos/create-medical-contract.dto.ts`:
    - Đổi `doctorId` thành `@IsOptional() @IsUUID('4') doctorId?: string`.
    - Thêm `@ApiProperty({ type: [String], description: 'Danh sách ID thành viên gia đình được bảo trợ trong hợp đồng' })`, `@IsArray()`, `@ArrayNotEmpty()`, `@IsUUID('4', { each: true })`, `patientIds!: string[]`.
  - Tại `src/modules/contracts/services/impl/contracts.service.impl.ts`:
    - `createInitialMedicalContract`:
      - Xác thực toàn bộ `dto.patientIds` thuộc `targetFamilyId`.
      - Ép `memberCount = dto.patientIds.length`.
      - Nếu `dto.doctorId` có giá trị: kiểm tra bác sĩ thuộc cơ sở y tế và `activePanelCount < maxCap`. Nếu không có: `doctorId = null`, `doctorTier = DoctorTier.STANDARD`.
      - Lưu danh sách vào `contract_members` qua transaction.
    - `signInitialMedicalContract`:
      - Thêm kiểm tra: Khi role ký là `HEALTHCARE_FACILITY` hoặc `ASSIGNED_DOCTOR`, hợp đồng bắt buộc phải có `doctorId !== null`. Nếu `doctorId === null`, ném `BadRequestException('Cơ sở y tế phải phân công bác sĩ trước khi ký tiếp nhận')`.
    - `assignDoctorToPackage`:
      - Cho phép gán bác sĩ khi `contract.doctorId` đang null hoặc thay đổi bác sĩ khi đang `PENDING_APPROVAL`.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/initial-medical-contracts.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR] (nếu cần): Tối ưu truy vấn kiểm tra danh sách bệnh nhân**
  Dùng một truy vấn `findMany` duy nhất với `where: { id: { in: dto.patientIds }, familyUnitId: targetFamilyId }` để kiểm tra toàn bộ thành viên trong 1 round-trip database.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/initial-medical-contracts.spec.ts` → vẫn PASS.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/contracts/__tests__/initial-medical-contracts.spec.ts` và `npm test -- src/modules/contracts/__tests__/four-party-and-assign-doctor.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 5: Triển khai API Danh sách & Chi tiết Hợp đồng y tế 4 bên theo Vai trò

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa:
  - `src/modules/contracts/repositories/interfaces/contracts.repository.interface.ts`
  - `src/modules/contracts/repositories/impl/contracts.repository.impl.ts`
  - `src/modules/contracts/services/interfaces/contracts.service.interface.ts`
  - `src/modules/contracts/services/impl/contracts.service.impl.ts`
  - `src/modules/contracts/controllers/contracts.controller.ts`
- Tạo mới: `src/modules/contracts/dtos/list-medical-contracts-query.dto.ts`
- Test tương ứng: `src/modules/contracts/__tests__/medical-contracts-query.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/contracts/__tests__/medical-contracts-query.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Frontend Dashboard của Đại diện gia đình, Bác sĩ, Cơ sở y tế, Admin
- Gọi tới: `PrismaService`, model `MedicalContract`, `ContractMember`, `ContractSignature`
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/contracts/__tests__/staffing-contracts.controller.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Dữ liệu hợp đồng đã tạo từ Task 4
- Cung cấp đầu ra cho: Giao diện người dùng theo dõi tiến độ ký số và thanh toán hợp đồng

- [ ] **Bước 1 [RED]: Viết test cho API tra cứu danh sách và chi tiết hợp đồng y tế**
  Vị trí file test: `src/modules/contracts/__tests__/medical-contracts-query.spec.ts`
  Test case:
  - `GET /api/v1/contracts/medical`:
    - `FAMILY_REP`: Chỉ thấy hợp đồng thuộc hộ gia đình của mình.
    - `HEALTHCARE_FACILITY`: Chỉ thấy hợp đồng thuộc cơ sở y tế của mình.
    - `DOCTOR`: Chỉ thấy hợp đồng được phân công cho mình.
    - `ADMIN`: Thấy toàn bộ hợp đồng, lọc được theo trạng thái (`PENDING_APPROVAL`, `PENDING_PAYMENT`, `ACTIVE`).
  - `GET /api/v1/contracts/medical/:id`:
    - Trả về chi tiết hợp đồng gồm: gói dịch vụ, cơ sở y tế, bác sĩ, danh sách `members` (bệnh nhân kèm họ tên, ngày sinh), trạng thái 4 chữ ký và hóa đơn thanh toán.
    - Ném `ForbiddenException` nếu người gọi không thuộc các bên tham gia hợp đồng.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/medical-contracts-query.spec.ts` → FAIL với lý do route `GET /contracts/medical` chưa được khai báo.
- [ ] **Bước 2 [GREEN]: Viết code triển khai Query Repository, Service và Controller để test ở Bước 1 PASS**
  Triển khai:
  - Thêm DTO `ListMedicalContractsQueryDto` hỗ trợ `page`, `limit`, `status`, `facilityId`.
  - Bổ sung phương thức `listMedicalContracts` và `findMedicalContractById` vào `IContractsRepository` và triển khai trong `ContractsRepositoryImpl`.
  - Triển khai logic phân quyền chặt chẽ trong `ContractsServiceImpl`:
    - Lấy thông tin user hiện tại (`actor.role`, `actor.familyUnitId`, `actor.id`).
    - Query Prisma với điều kiện `where` tương ứng với từng role.
    - Include relations: `familyUnit`, `facility`, `doctor`, `servicePackage`, `members.patient`, `signatures`, `invoices`.
  - Khai báo routes trong `ContractsController`:
    - `@Get('medical')`: Lấy danh sách hợp đồng y tế.
    - `@Get('medical/:id')`: Lấy chi tiết hợp đồng y tế.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/medical-contracts-query.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR] (nếu cần): Tinh chỉnh pagination response format**
  Đồng bộ định dạng phân trang chuẩn `{ items: [...], total: number, page: number, limit: number }` thống nhất toàn dự án.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/medical-contracts-query.spec.ts` → vẫn PASS.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/contracts/__tests__/medical-contracts-query.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 6: Triển khai Tóm tắt Nhu cầu Chăm sóc (Care Needs Summary) và Bản sao Hợp đồng (Document API)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa:
  - `src/modules/contracts/services/interfaces/contracts.service.interface.ts`
  - `src/modules/contracts/services/impl/contracts.service.impl.ts`
  - `src/modules/contracts/controllers/contracts.controller.ts`
- Tạo mới:
  - `src/modules/contracts/dtos/care-needs-summary.dto.ts`
  - `src/modules/contracts/services/contract-document-renderer.service.ts`
- Test tương ứng: `src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Bác sĩ thẩm định trước khi ký số, các bên tải bản sao hợp đồng điện tử
- Gọi tới: `MedicalContract`, `PatientAllergy`, `PatientDocument`, `ContractSignature`
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/contracts/__tests__/contract-terms-hash.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Dữ liệu bệnh nhân (Task 2), Hợp đồng và Chữ ký số (Task 4/5)
- Cung cấp đầu ra cho: Bác sĩ ký số nhận trách nhiệm chuyên môn và 4 bên lưu trữ văn bản hợp đồng

- [ ] **Bước 1 [RED]: Viết test cho API Care Needs Summary và Contract Document Export**
  Vị trí file test: `src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts`
  Test case:
  - `GET /api/v1/contracts/medical/:id/care-summary`:
    - Bác sĩ được chỉ định gọi API lấy báo cáo tổng hợp: họ tên các thành viên được bảo trợ, nhóm tuổi, danh sách tiền sử dị ứng (`allergies`), danh sách tài liệu y tế đã nộp (`documents`).
    - Trả về 403 Forbidden nếu bác sĩ khác không được gán cho hợp đồng cố tình truy cập.
  - `GET /api/v1/contracts/medical/:id/document`:
    - Trả về bản sao hợp đồng định dạng văn bản chuẩn (HTML / formatted text view) chứa: tiêu đề, thông tin 4 bên, điều khoản gói dịch vụ (snapshot), danh sách thành viên áp dụng, và chi tiết 4 chữ ký số kèm mã hash (`termsHash`, `signatureHash`, `signedAt`, `ipAddress`).
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts` → FAIL với lý do method `getCareNeedsSummary` và `getContractDocument` chưa tồn tại.
- [ ] **Bước 2 [GREEN]: Viết code triển khai Care Needs Summary và Contract Document Renderer để test ở Bước 1 PASS**
  Triển khai:
  - Tạo `ContractDocumentRendererService` tại `src/modules/contracts/services/contract-document-renderer.service.ts` sinh tài liệu hợp đồng điện tử chuẩn hóa tích hợp chữ ký số và snapshot.
  - Trong `ContractsServiceImpl`:
    - Triển khai `getCareNeedsSummary`: Lấy toàn bộ bệnh nhân từ `contract.members`, truy vấn kèm `allergies` và `documents`, định dạng cấu trúc báo cáo y tế cho bác sĩ.
    - Triển khai `getContractDocument`: Lấy chi tiết hợp đồng và 4 chữ ký số từ `contract_signatures`, gọi `ContractDocumentRendererService` kết xuất văn bản hợp đồng.
  - Khai báo routes trong `ContractsController`:
    - `@Get('medical/:id/care-summary')`: Tóm tắt nhu cầu chăm sóc sức khỏe.
    - `@Get('medical/:id/document')`: Xuất tài liệu hợp đồng điện tử có chữ ký số.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR] (nếu cần): Tinh chỉnh template hiển thị chữ ký số**
  Cấu trúc template định dạng bảng chữ ký số bảo đảm rõ ràng mã hash SHA-256 rút gọn và thời gian ký múi giờ Việt Nam (+07:00).
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts` → vẫn PASS.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts` và `npm test -- src/modules/contracts/__tests__/contract-terms-hash.spec.ts`
  Kết quả mong đợi: tất cả PASS.
