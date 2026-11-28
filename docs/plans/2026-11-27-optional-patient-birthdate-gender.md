# Ngày sinh & giới tính không bắt buộc khi đăng ký — Kế hoạch triển khai

**Mục tiêu:** Người đại diện gia đình đăng ký không cần nhập ngày sinh/giới tính; hệ thống lưu `null` thay vì giá trị giả, nhắc nhẹ bổ sung, cho bác sĩ bổ sung ngay trong buổi khám, và chỉ chặn cứng ở bước kê đơn khi thiếu ngày sinh.

**Cách tiếp cận:** Cho phép `Patient.dateOfBirth`/`Patient.gender` là nullable, bỏ giá trị giả `1990-01-01`/`OTHER`, chuyển dữ liệu cũ về `null`. API trả `profileCompleteness.missing` để frontend nhắc nhẹ (có nút "Để sau"). Bác sĩ có endpoint riêng bổ sung hồ sơ trong phạm vi buổi khám (tái dùng kiểm tra quyền `resolveDoctorVisitMember`). Bước kê đơn ném `BaseApiException` với `PATIENT_PROFILE_INCOMPLETE` khi thiếu ngày sinh; giới tính thiếu không chặn.

**Giả định đã chốt (từ phương án khuyến nghị):** dùng `null` (không dùng cờ `profileIncomplete`); bước đặt lịch chỉ nhắc nhẹ, không chặn; bác sĩ được bổ sung trong `MemberExamWizard`; chỉ chặn cứng ở bước kê đơn.

**Đã tra cứu codebase (codebase-memory-mcp):**
- `get_code_snippet` `AuthRepositoryImpl.createFamilyRepEntities` (`famidoc-backend/src/modules/auth/repositories/impl/auth.repository.impl.ts:58-108`): tạo patient SELF với `dateOfBirth: new Date('1990-01-01'), gender: 'OTHER'`.
- `get_code_snippet` `PrismaEncountersSession.ensureContractDefaultMembers` (`famidoc-backend/src/modules/encounters/repositories/impl/encounters.repository.impl.ts:55-91`): cùng giá trị giả (dòng 71-72); `trace_path` inbound = 0.
- `famidoc-backend/prisma/schema.prisma:628-648` model `Patient`: `dateOfBirth DateTime @map("date_of_birth") @db.Date`, `gender Gender` — đang bắt buộc.
- `get_code_snippet` `patientAgeMonths` (`famidoc-backend/src/modules/encounters/prescription-rules.ts:29-47`): trả `null` khi ngày không hợp lệ; `trace_path` inbound: chỉ `PrescriptionsService.createSharedPrescription` (hop 1), hop 2: `confirmVisitRecord`, `prescribeFamily`, `replace`, `share`.
- `get_code_snippet` `PrescriptionsService.createSharedPrescription` (`famidoc-backend/src/modules/encounters/services/prescriptions.service.ts:732-899`): `if (ageMonths === null) throw new BadRequestException('Ngày sinh người bệnh không hợp lệ. Vui lòng cập nhật hồ sơ.')`.
- `PrescriptionsService.resolveDoctorVisitMember` (`prescriptions.service.ts:437-496`): kiểm tra bác sĩ thuộc buổi khám (`doctorVisitScope`), buổi khám không bị khóa, patient cùng `familyId` của hợp đồng.
- `PatientsServiceImpl.assertPatientAccess` (`famidoc-backend/src/modules/patients/services/impl/patients.service.impl.ts:98-126`, 18 caller): chỉ cho `ADMIN`, `FAMILY_REP` → bác sĩ KHÔNG dùng được `PUT /api/v1/patients/:id`; không sửa hàm này để tránh ảnh hưởng 18 caller.
- `MedicalBooksController` (`famidoc-backend/src/modules/encounters/controllers/medical-books.controller.ts`, `@Controller('api/v1/medical-books')`): đã có `PUT visits/:id/draft`, `POST visits/:id/confirm` với `@Roles('DOCTOR')` gọi `this.prescriptions.*`.
- `BaseApiException` (`famidoc-backend/src/core/exceptions/api.exception.ts:24-99`): options `{errorCode, message, detail?, status?, title?, invalidParams?, conditions?}`.
- `famidoc-backend/src/core/constants/error-codes.constant.ts` (enum, 106 dòng): có `PATIENT_NOT_IN_FAMILY`, `PATIENT_REPRESENTATIVE_MISSING`; chưa có `PATIENT_PROFILE_INCOMPLETE`.
- `CreatePatientDto` (`famidoc-backend/src/modules/patients/dtos/create-patient.dto.ts:31,36`): `dateOfBirth!: string`, `gender!: Gender`; `UpdatePatientDto extends PartialType(CreatePatientDto)`.
- Frontend `patientAgeMonths` (`famidoc-frontend/src/lib/prescription-rules.ts`) inbound: `validatePrescriptionStep`, `PrescriptionContextFields`, `submit` (prescription-form) hop 1; `MemberExamWizard`, `handleNextFromStep3`, `PrescriptionForm` hop 2.
- `MemberExamWizard` (`famidoc-frontend/src/features/doctor-encounters/components/member-exam-wizard.tsx:105-979`, dòng 216 `dateOfBirth: member.dateOfBirth ?? ''`); `validatePrescriptionStep` (314-360).
- `family-members-view.tsx`: `mapGenderLabelToCode` (298-302, mặc định `MALE`), `formatBirthDisplay` (357-373, đã trả `'Chưa cập nhật'` khi rỗng), `mapPatientDtoToMemberProfile` (375-449), `handleUpdateMemberSubmit` (767-912), dòng 1219 hiển thị `{m.gender} • {ageDisplay}`.
- Frontend types: `PatientDto` (`famidoc-frontend/src/lib/api/patients.api.ts:72-89`) `dateOfBirth: string; gender: PatientGender;`; `BookMember` (`famidoc-frontend/src/lib/api/medical-books.api.ts:12-17`) `dateOfBirth: string`; `medicalBooksApi` (dòng 129) có hàm gọi `${path}/visits/${id}/draft`.
- Migration mới nhất: `famidoc-backend/prisma/migrations/20261127000100_care_package_rules_v2/`.

**Bổ sung sau phân tích tác động (`famidoc-backend/docs/plans/2026-11-27-optional-patient-birthdate-gender.impact.md`):**
- `patientAgeMonths` (backend `famidoc-backend/src/modules/encounters/prescription-rules.ts:29-47`, frontend `famidoc-frontend/src/lib/prescription-rules.ts:29-47`): thân hàm `const birth = new Date(dateOfBirth); if (!Number.isFinite(birth.getTime()) || ... || birth > at) return null;` — `new Date(null)` là epoch 1970 hợp lệ nên hàm trả ~670 tháng thay vì `null` → guard `ageMonths === null` (Task 4) và Task 7 sẽ KHÔNG kích hoạt nếu không sửa hàm này trước (→ Task 0 mới).
- `prescriptions.service.ts:833` `dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10)` — crash khi `null` (→ bổ sung vào Task 4).
- `PatientsRepositoryImpl.buildPatientCreateData` (`famidoc-backend/src/modules/patients/repositories/impl/patients.repository.impl.ts:104-122`): dòng 111 `dateOfBirth: new Date(data.dateOfBirth)` (undefined → Invalid Date), dòng 112 `gender: data.gender`; callers `create`, `createWithActiveContractLock`, `createAndAttachToContract`. `PatientsServiceImpl.validateDateOfBirth(rawDate: string)` (`patients.service.impl.ts:51-65`) gọi vô điều kiện từ `createPatient` (dòng 153) → ném "Ngày tháng năm sinh không hợp lệ" khi thiếu (→ bổ sung vào Task 3).
- `ContractsServiceImpl.getCareNeedsSummary` (`famidoc-backend/src/modules/contracts/services/impl/contracts.service.impl.ts:2565-2710`): dòng 2639-2641 `const dob = rawPatient.dateOfBirth ? new Date(rawPatient.dateOfBirth) : new Date();` → tuổi 0, `ageGroup = 'CHILD'` (2652-2661); dòng 2695 `gender: rawPatient.gender || 'OTHER'`. DTO `PatientCareSummaryDto` (`famidoc-backend/src/modules/contracts/dtos/care-needs-summary.dto.ts`): `dateOfBirth!: Date`, `age!: number`, `ageGroup!: 'CHILD' | 'ADOLESCENT' | 'ADULT' | 'ELDERLY'`, `gender!: string`. Test: `famidoc-backend/src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts` (describe `getCareNeedsSummary` dòng 265) (→ Task 8 mới).
- Frontend hiển thị sai khi `null`: `prescription-context-fields.tsx:135` `date.format(new Date(visit.patient.dateOfBirth))`; `famidoc-frontend/src/features/prescriptions/components/medical-book-view.tsx:76` `function dateLabel(date: string)`; `famidoc-frontend/src/features/prescriptions/components/family-prescriptions-view.tsx:24` `const dateLabel = (value: string) => ...`; `famidoc-frontend/src/features/family-dashboard/components/family-dashboard-view.tsx:40` `function calculateAge(dob?: string): number` (trả 45 khi thiếu, dùng ở dòng 112); `family-members-view.tsx:432` gender null → `'Nam'`; `famidoc-frontend/src/features/doctor-families/lib/family-format.ts:40` `export function ageFrom(value: string): number | null` (→ bổ sung vào Task 6).
- Kiểu frontend cần nullable: `doctors.api.ts:245`, `patients.api.ts:76,93`, `contracts.api.ts:47,181`, `encounters.api.ts:78`, `telehealth.api.ts:66`, `medical-books.api.ts:15`, `prescription-rules.ts:69`.

**Framework test & quy ước (đã xác nhận qua codebase-memory-mcp / package.json):**
- Backend: Jest (`famidoc-backend/jest.config.ts`), file `*.spec.ts` trong thư mục `__tests__/` cạnh module. Lệnh: `cd famidoc-backend && npm test -- <path>`.
- Frontend: Vitest (`famidoc-frontend/vitest.config.ts`), file `*.test.ts(x)` trong `__tests__/` cạnh component. Lệnh: `cd famidoc-frontend && npm test -- <path>`.
- Test hiện có sẽ mở rộng: `famidoc-backend/src/modules/auth/__tests__/auth.repository.impl.spec.ts`, `famidoc-backend/src/modules/patients/__tests__/create-patient.dto.spec.ts`, `famidoc-backend/src/modules/patients/__tests__/patients.service.spec.ts`, `famidoc-backend/src/modules/encounters/services/__tests__/prescription-safety.spec.ts`, `famidoc-frontend/src/features/doctor-encounters/components/__tests__/member-exam-wizard.test.tsx`, `famidoc-frontend/src/features/family-members/components/__tests__/family-members-api.test.tsx`.

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Lỗi mới tuân thủ `AGENTS.md`: dùng `BaseApiException` + `errorCode` khai báo trong `error-codes.constant.ts`, thông báo tiếng Việt, lỗi nghiệp vụ trả `conditions`, lỗi validation trả `invalidParams[].message` tiếng Việt. Không thêm `BadRequestException('...')` chuỗi trần mới.
- Không sửa `PatientsServiceImpl.assertPatientAccess` (18 caller).
- Không refactor các `BadRequestException` cũ khác trong `prescriptions.service.ts` ngoài dòng kiểm tra ngày sinh.
- Migration dữ liệu cũ chỉ chạm bản ghi khớp đồng thời `relationship_to_head = 'SELF'`, `date_of_birth = '1990-01-01'`, `gender = 'OTHER'`.
- Giới tính thiếu không bao giờ chặn luồng nào.
- Không thay `BadRequestException` cũ trong `PatientsServiceImpl.validateDateOfBirth`; chỉ đổi điều kiện gọi hàm.
- Không dùng giá trị thay thế (ngày hiện tại, `'OTHER'`, tuổi 45...) cho dữ liệu thiếu ở bất kỳ đâu; thiếu thì trả `null` / hiển thị "Chưa cập nhật".
- Làm sạch snapshot đơn thuốc cũ (`prescriptions.record_snapshot`, `prescriptions.clinical_context.ageMonths`) chỉ chạm đơn của patient đã được Task 1 đưa về `null` và snapshot đang chứa đúng cặp `dateOfBirth = '1990-01-01'` + `gender = 'OTHER'` (→ Task 9). Không chạm `billingSnapshot`, `termsSnapshot`, `contextSnapshot`, `candidateSnapshots`.
- Chỉ có nền tảng web dùng API (người dùng xác nhận 2026-11-27) → thêm `'UNKNOWN'` vào `ageGroup` (Task 8) không cần cập nhật client nào khác.

---

### Task 0: `patientAgeMonths` trả `null` khi thiếu ngày sinh (backend + frontend)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `patientAgeMonths` (`famidoc-backend/src/modules/encounters/prescription-rules.ts:29-47`) và bản sao `famidoc-frontend/src/lib/prescription-rules.ts:29-47`: chữ ký đổi thành `patientAgeMonths(dateOfBirth: string | Date | null | undefined, date: string | Date): number | null`; thêm dòng đầu `if (dateOfBirth === null || dateOfBirth === undefined || dateOfBirth === '') return null;`.
- Test tương ứng: `famidoc-backend/src/modules/encounters/services/__tests__/prescription-safety.spec.ts` (cạnh assertion dòng 190-192); tạo mới `famidoc-frontend/src/lib/__tests__/prescription-rules.test.ts`.
- Kiểm chứng bằng: `cd famidoc-backend && npm test -- src/modules/encounters/services/__tests__/prescription-safety.spec.ts` và `cd famidoc-frontend && npm test -- src/lib/__tests__/prescription-rules.test.ts`

**Ảnh hưởng liên quan (trace_path):**
- Backend được gọi bởi: `PrescriptionsService.createSharedPrescription` (hop 1); `share`, `prescribeFamily`, `replace`, `confirmVisitRecord` (hop 2).
- Frontend được gọi bởi: `validatePrescriptionStep`, `PrescriptionContextFields`, `submit` (prescription-form) (hop 1).
- Regression test cần chạy thêm: `cd famidoc-backend && npm test -- src/modules/encounters`; `cd famidoc-frontend && npm test -- src/features/doctor-encounters`.

**Giao diện/Kết nối với các task khác:**
- Cung cấp đầu ra cho: Task 4 (guard `ageMonths === null`), Task 7 (`validatePrescriptionStep`).

- [ ] **Bước 1 [RED]: Viết test `patientAgeMonths` với giá trị rỗng**
  Vị trí file test: `famidoc-backend/src/modules/encounters/services/__tests__/prescription-safety.spec.ts`, `famidoc-frontend/src/lib/__tests__/prescription-rules.test.ts`.
  Test case: `patientAgeMonths(null, '2026-11-21')` → `null`; `patientAgeMonths(undefined, '2026-11-21')` → `null`; `patientAgeMonths('', '2026-11-21')` → `null`; giữ nguyên `patientAgeMonths('2020-11-22', '2026-11-21')` → `71`.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/encounters/services/__tests__/prescription-safety.spec.ts` và `cd famidoc-frontend && npm test -- src/lib/__tests__/prescription-rules.test.ts` → FAIL vì `null` đang trả ~670 tháng, không fail vì lỗi cú pháp.
- [ ] **Bước 2 [GREEN]: Thêm guard đầu hàm ở cả hai file**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/encounters/services/__tests__/prescription-safety.spec.ts` và `cd famidoc-frontend && npm test -- src/lib/__tests__/prescription-rules.test.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Không cần refactor (thêm 1 dòng guard mỗi file).**
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `cd famidoc-backend && npm test -- src/modules/encounters` và `cd famidoc-frontend && npm test -- src/lib src/features/doctor-encounters`
  Kết quả mong đợi: tất cả PASS.

### Task 1: Schema Patient cho phép null + migration dữ liệu giả

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `famidoc-backend/prisma/schema.prisma` model `Patient` (628-648): `dateOfBirth DateTime? @map("date_of_birth") @db.Date`, `gender Gender?`.
- Tạo mới: `famidoc-backend/prisma/migrations/20261127120000_patient_optional_birthdate_gender/migration.sql`.
- Test tương ứng: `famidoc-backend/src/modules/patients/__tests__/patient-optional-profile-migration.spec.ts` (tạo mới).
- Kiểm chứng bằng: `cd famidoc-backend && npm test -- src/modules/patients/__tests__/patient-optional-profile-migration.spec.ts`

**Ảnh hưởng liên quan:**
- Mọi nơi đọc `patient.dateOfBirth`/`gender` (47 file) sẽ nhận kiểu `Date | null` / `Gender | null`; `npx tsc --noEmit` sẽ báo các chỗ cần xử lý — các chỗ đó được xử lý ở Task 2-6.
- Regression test cần chạy thêm: `npx tsc --noEmit -p tsconfig.json` (ghi lại danh sách lỗi để Task 2-6 xử lý hết).

**Giao diện/Kết nối với các task khác:**
- Cung cấp đầu ra cho: Task 2, 3, 4, 5, 6, 8, 9.

- [ ] **Bước 1 [RED]: Viết test đọc nội dung migration và schema**
  Vị trí file test: `famidoc-backend/src/modules/patients/__tests__/patient-optional-profile-migration.spec.ts`
  Test case: (a) đọc `prisma/schema.prisma`, khối `model Patient` chứa `dateOfBirth  DateTime?` và `gender  Gender?` (regex `/dateOfBirth\s+DateTime\?/`, `/gender\s+Gender\?/`); (b) file `migration.sql` tồn tại, chứa `ALTER COLUMN "date_of_birth" DROP NOT NULL`, `ALTER COLUMN "gender" DROP NOT NULL`, và câu `UPDATE "patients"` có đủ ba điều kiện `relationship_to_head = 'SELF'`, `date_of_birth = '1990-01-01'`, `gender = 'OTHER'`.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/patients/__tests__/patient-optional-profile-migration.spec.ts` → FAIL vì schema còn bắt buộc và file migration chưa tồn tại, không fail vì lỗi cú pháp.
- [ ] **Bước 2 [GREEN]: Sửa schema và viết migration**
  Sửa 2 dòng trong `model Patient`; tạo `migration.sql` gồm: `ALTER TABLE "patients" ALTER COLUMN "date_of_birth" DROP NOT NULL; ALTER TABLE "patients" ALTER COLUMN "gender" DROP NOT NULL; UPDATE "patients" SET "date_of_birth" = NULL, "gender" = NULL WHERE "relationship_to_head" = 'SELF' AND "date_of_birth" = '1990-01-01' AND "gender" = 'OTHER';` (tên bảng/cột lấy đúng từ `@@map`/`@map` của model Patient khi mở file). Chạy `npx prisma generate`.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/patients/__tests__/patient-optional-profile-migration.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Đưa ba điều kiện lọc dữ liệu giả thành hằng số trong test để dễ đọc**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/patients/__tests__/patient-optional-profile-migration.spec.ts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `cd famidoc-backend && npm test -- src/modules/patients/__tests__/patient-optional-profile-migration.spec.ts`
  Kết quả mong đợi: tất cả PASS.

### Task 2: Bỏ giá trị giả khi tạo patient SELF

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `AuthRepositoryImpl.createFamilyRepEntities` (`famidoc-backend/src/modules/auth/repositories/impl/auth.repository.impl.ts:58-108`); `PrismaEncountersSession.ensureContractDefaultMembers` (`famidoc-backend/src/modules/encounters/repositories/impl/encounters.repository.impl.ts:55-91`).
- Test tương ứng: `famidoc-backend/src/modules/auth/__tests__/auth.repository.impl.spec.ts`.
- Kiểm chứng bằng: `cd famidoc-backend && npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: luồng đăng ký người đại diện (service auth); `ensureContractDefaultMembers` inbound = 0.
- Regression test cần chạy thêm: `cd famidoc-backend && npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (cột nullable).

- [ ] **Bước 1 [RED]: Viết test patient SELF được tạo với ngày sinh/giới tính null**
  Vị trí file test: `famidoc-backend/src/modules/auth/__tests__/auth.repository.impl.spec.ts`
  Test case: gọi `createFamilyRepEntities(txMock, data)` với `data` không có ngày sinh; kiểm tra `txMock.patient.create` được gọi với `data.dateOfBirth === null`, `data.gender === null`, `relationshipToHead === 'SELF'`.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → FAIL vì đang nhận `1990-01-01`/`OTHER`, không fail vì lỗi cú pháp.
- [ ] **Bước 2 [GREEN]: Thay `new Date('1990-01-01')` → `null` và `'OTHER'` → `null` ở cả hai hàm**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Không cần refactor (thay đổi 4 dòng giá trị).**
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `cd famidoc-backend && npm test -- src/modules/auth`
  Kết quả mong đợi: tất cả PASS, gồm `auth.service.impl.spec.ts`.

### Task 3: DTO bệnh nhân cho phép thiếu ngày sinh/giới tính + `profileCompleteness`

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `CreatePatientDto` (`famidoc-backend/src/modules/patients/dtos/create-patient.dto.ts`, dòng 31 `dateOfBirth!: string`, dòng 36 `gender!: Gender`) → `@IsOptional()`, kiểu `?`; giữ `@IsDateString` với thông báo tiếng Việt "Ngày sinh không đúng định dạng YYYY-MM-DD." và kiểm tra không ở tương lai "Ngày sinh không được ở tương lai.".
- Tạo mới: `famidoc-backend/src/modules/patients/utils/profile-completeness.util.ts` — `export function computeProfileCompleteness(p: { dateOfBirth: Date | string | null; gender: Gender | null }): { isComplete: boolean; missing: Array<'dateOfBirth' | 'gender'> }`.
- Chỉnh sửa: `PatientsServiceImpl` các hàm trả chi tiết/danh sách patient (`getPatientById` và danh sách thành viên gia đình) — gắn thêm `profileCompleteness: computeProfileCompleteness(patient)`.
- Test tương ứng: `famidoc-backend/src/modules/patients/__tests__/create-patient.dto.spec.ts`, `famidoc-backend/src/modules/patients/__tests__/profile-completeness.util.spec.ts` (tạo mới), `famidoc-backend/src/modules/patients/__tests__/patients.service.spec.ts`.
- Kiểm chứng bằng: `cd famidoc-backend && npm test -- src/modules/patients`

**Ảnh hưởng liên quan:**
- `UpdatePatientDto extends PartialType(CreatePatientDto)` hưởng thay đổi tự động.
- `buildPatientCreateData` được gọi bởi `create`, `createWithActiveContractLock`, `createAndAttachToContract` — cả ba hưởng thay đổi null-safe.
- Regression test cần chạy thêm: `cd famidoc-backend && npm test -- src/modules/patients/__tests__/patients.controller.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1.
- Cung cấp đầu ra cho: Task 6 (frontend đọc `profileCompleteness`).

- [ ] **Bước 1 [RED]: Viết test DTO và hàm completeness**
  Vị trí file test: `create-patient.dto.spec.ts`, `profile-completeness.util.spec.ts`.
  Test case: (a) `validate(plainToInstance(CreatePatientDto, { fullName: 'Nguyễn Văn A', relationshipToHead: 'CHILD' }))` → 0 lỗi; (b) `dateOfBirth: '2099-01-01'` → 1 lỗi với message "Ngày sinh không được ở tương lai."; (c) `dateOfBirth: 'abc'` → message "Ngày sinh không đúng định dạng YYYY-MM-DD."; (d) `computeProfileCompleteness({dateOfBirth: null, gender: null})` → `{isComplete:false, missing:['dateOfBirth','gender']}`; (e) đủ cả hai → `{isComplete:true, missing:[]}`.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/patients/__tests__/create-patient.dto.spec.ts src/modules/patients/__tests__/profile-completeness.util.spec.ts` → FAIL vì DTO đang bắt buộc và util chưa tồn tại.
- [ ] **Bước 2 [GREEN]: Sửa DTO, tạo util**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/patients/__tests__/create-patient.dto.spec.ts src/modules/patients/__tests__/profile-completeness.util.spec.ts` → PASS.
- [ ] **Bước 3 [RED]: Viết test service trả `profileCompleteness`**
  Vị trí file test: `patients.service.spec.ts`.
  Test case: repository mock `findById` trả patient `{dateOfBirth: null, gender: 'FEMALE'}` → `getPatientById(adminUser, id)` trả `profileCompleteness.missing` = `['dateOfBirth']`.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/patients/__tests__/patients.service.spec.ts` → FAIL vì chưa có trường `profileCompleteness`.
- [ ] **Bước 4 [GREEN]: Gắn `profileCompleteness` vào kết quả `getPatientById` và danh sách thành viên**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/patients/__tests__/patients.service.spec.ts` → PASS.
- [ ] **Bước 5 [REFACTOR]: Gom việc gắn `profileCompleteness` vào một hàm private `withCompleteness(patient)` dùng chung**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/patients` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 6 [RED]: Viết test tạo thành viên không có ngày sinh/giới tính (repository + service)**
  Vị trí file test: `famidoc-backend/src/modules/patients/__tests__/patients.repository.impl.spec.ts`, `famidoc-backend/src/modules/patients/__tests__/patients.service.spec.ts`.
  Test case: (a) `PatientsRepositoryImpl.create({ familyId, fullName: 'Nguyễn Văn B', relationshipToHead: 'CHILD' })` → `prisma.patient.create` nhận `data.dateOfBirth === null`, `data.gender === null` (không phải Invalid Date/undefined); (b) có `dateOfBirth: '2022-05-01'` → nhận `new Date('2022-05-01')`; (c) `PatientsServiceImpl.createPatient(familyRepUser, dto không có dateOfBirth)` resolve thành công, không ném "Ngày tháng năm sinh không hợp lệ"; (d) `dateOfBirth: '2099-01-01'` vẫn ném "Ngày sinh không thể là ngày trong tương lai".
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/patients/__tests__/patients.repository.impl.spec.ts src/modules/patients/__tests__/patients.service.spec.ts` → FAIL vì `buildPatientCreateData` gọi `new Date(undefined)` và `validateDateOfBirth` chạy vô điều kiện.
- [ ] **Bước 7 [GREEN]: Sửa `buildPatientCreateData` và điều kiện gọi `validateDateOfBirth`**
  `PatientsRepositoryImpl.buildPatientCreateData` (`patients.repository.impl.ts:104-122`): dòng 111 → `dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null`, dòng 112 → `gender: data.gender ?? null`; kiểu input của hàm đổi `dateOfBirth?: string`, `gender?: Gender`. `PatientsServiceImpl.createPatient` (`patients.service.impl.ts:152-193`, dòng 153): `if (dto.dateOfBirth) this.validateDateOfBirth(dto.dateOfBirth);`.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/patients/__tests__/patients.repository.impl.spec.ts src/modules/patients/__tests__/patients.service.spec.ts` → PASS.
- [ ] **Bước 8: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `cd famidoc-backend && npm test -- src/modules/patients`
  Kết quả mong đợi: tất cả PASS, gồm `patients.controller.spec.ts`, `patients.repository.impl.spec.ts`.

### Task 4: Chặn cứng ở bước kê đơn khi thiếu ngày sinh (chuẩn AGENTS.md)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `famidoc-backend/src/core/constants/error-codes.constant.ts` — thêm `PATIENT_PROFILE_INCOMPLETE = 'PATIENT_PROFILE_INCOMPLETE'` cạnh `PATIENT_REPRESENTATIVE_MISSING` (dòng 66).
- Chỉnh sửa: `PrescriptionsService.createSharedPrescription` (`famidoc-backend/src/modules/encounters/services/prescriptions.service.ts:732-899`), thay dòng `throw new BadRequestException('Ngày sinh người bệnh không hợp lệ...')` bằng `throw new BaseApiException({ errorCode: ErrorCode.PATIENT_PROFILE_INCOMPLETE, status: HttpStatus.BAD_REQUEST, message: 'Chưa thể kê đơn vì thiếu ngày sinh người bệnh.', detail: 'Cần cập nhật ngày sinh của <fullName> để tính liều theo tuổi.', conditions: [{ code: 'DOB_REQUIRED', condition: 'Người bệnh phải có ngày sinh hợp lệ', message: 'Vui lòng bổ sung ngày sinh của <fullName> trước khi kê đơn.' }] })`.
- Test tương ứng: `famidoc-backend/src/modules/encounters/services/__tests__/prescription-safety.spec.ts`.
- Kiểm chứng bằng: `cd famidoc-backend && npm test -- src/modules/encounters/services/__tests__/prescription-safety.spec.ts`

**Ảnh hưởng liên quan (trace_path):**
- Được gọi bởi: `share`, `prescribeFamily`, `replace`, `confirmVisitRecord` (hop 2).
- Regression test cần chạy thêm: `cd famidoc-backend && npm test -- src/modules/encounters`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (`dateOfBirth` có thể `null`).
- Cung cấp đầu ra cho: Task 7 (frontend hiểu `PATIENT_PROFILE_INCOMPLETE`).

- [ ] **Bước 1 [RED]: Viết test kê đơn cho patient `dateOfBirth: null`**
  Vị trí file test: `prescription-safety.spec.ts` (dùng `setup()` hiện có, đặt `patient.dateOfBirth = null`).
  Test case: (a) `service.share(actor, 'visit-1', body)` reject với `BaseApiException`, `getResponse().errorCode === 'PATIENT_PROFILE_INCOMPLETE'`, `conditions[0].code === 'DOB_REQUIRED'`, không phải `TypeError` từ `toISOString` (dòng 833); (b) patient `gender: null`, `dateOfBirth` hợp lệ → kê đơn thành công (giới tính không chặn), snapshot ghi `gender: null`.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/encounters/services/__tests__/prescription-safety.spec.ts` → FAIL vì đang ném `BadRequestException` không có `errorCode`.
- [ ] **Bước 2 [GREEN]: Thêm enum và thay câu throw**
  Điều kiện guard đổi thành `if (!patient.dateOfBirth || ageMonths === null)` để TypeScript thu hẹp kiểu, nhờ đó dòng 833 `patient.dateOfBirth.toISOString().slice(0, 10)` an toàn không cần sửa thêm.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/encounters/services/__tests__/prescription-safety.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Tách hàm `incompleteProfileError(fullName: string): BaseApiException` ở đầu file để câu throw gọn**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/encounters` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `cd famidoc-backend && npm test -- src/modules/encounters`
  Kết quả mong đợi: tất cả PASS.

### Task 5: Endpoint bác sĩ bổ sung ngày sinh/giới tính trong buổi khám

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `famidoc-backend/src/modules/encounters/dtos/update-visit-patient-profile.dto.ts` — `UpdateVisitPatientProfileDto { patientId: string (@IsUUID, message "Mã thành viên không hợp lệ."); dateOfBirth?: string (@IsOptional @IsDateString, message "Ngày sinh không đúng định dạng YYYY-MM-DD."); gender?: Gender (@IsOptional @IsEnum, message "Giới tính không hợp lệ.") }`.
- Chỉnh sửa: `PrescriptionsService` (`prescriptions.service.ts`) thêm `async updateVisitPatientProfile(actor: AuthenticatedUser, id: string, dto: UpdateVisitPatientProfileDto)`: trong `prescriptionTransaction`, gọi `resolveDoctorVisitMember(tx, actor, id, dto.patientId, vietnamNow)` để kiểm tra quyền; cập nhật `tx.patient.update({ where: { id: dto.patientId }, data: { dateOfBirth, gender } })` chỉ với trường được gửi; trả `{ id, dateOfBirth, gender, profileCompleteness }` (dùng `computeProfileCompleteness` từ Task 3).
- Chỉnh sửa: `MedicalBooksController` thêm `@Patch('visits/:id/patient-profile') @Roles('DOCTOR') @Header('Cache-Control', 'private, no-store')` gọi `this.prescriptions.updateVisitPatientProfile(req.user, id, dto)`.
- Test tương ứng: `famidoc-backend/src/modules/encounters/services/__tests__/visit-patient-profile.spec.ts` (tạo mới).
- Kiểm chứng bằng: `cd famidoc-backend && npm test -- src/modules/encounters/services/__tests__/visit-patient-profile.spec.ts`

**Ảnh hưởng liên quan:**
- Gọi tới: `resolveDoctorVisitMember` (dùng lại, không sửa), `computeProfileCompleteness`.
- Regression test cần chạy thêm: `cd famidoc-backend && npm test -- src/modules/encounters`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1, Task 3.
- Cung cấp đầu ra cho: Task 7.

- [ ] **Bước 1 [RED]: Viết test service**
  Vị trí file test: `visit-patient-profile.spec.ts` (mock Prisma theo kiểu `prescription-safety.spec.ts`).
  Test case: (a) bác sĩ đúng buổi khám, `{patientId, dateOfBirth:'2022-05-01'}` → `tx.patient.update` gọi với `data: { dateOfBirth: new Date('2022-05-01') }` (không có `gender`), trả `profileCompleteness.missing` = `['gender']` khi gender còn null; (b) `encounter.findFirst` trả `null` → reject `NotFoundException`; (c) `dateOfBirth` ở tương lai → reject `BaseApiException` `errorCode: 'VALIDATION_FAILED'` với `invalidParams[0].field === 'dateOfBirth'`; (d) DTO `validate` với `gender: 'X'` → message "Giới tính không hợp lệ.".
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/encounters/services/__tests__/visit-patient-profile.spec.ts` → FAIL vì DTO và method chưa tồn tại.
- [ ] **Bước 2 [GREEN]: Tạo DTO, method service, route controller**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/encounters/services/__tests__/visit-patient-profile.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Dùng chung hàm kiểm tra "ngày sinh không ở tương lai" giữa `CreatePatientDto` (Task 3) và service này, đặt trong `famidoc-backend/src/modules/patients/utils/profile-completeness.util.ts`**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/encounters src/modules/patients` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `cd famidoc-backend && npm test -- src/modules/encounters src/modules/patients`
  Kết quả mong đợi: tất cả PASS.

### Task 6: Frontend — kiểu nullable, hiển thị "Chưa cập nhật", nhắc nhẹ có nút "Để sau"

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `PatientDto` (`famidoc-frontend/src/lib/api/patients.api.ts:72-89`): `dateOfBirth: string | null; gender: PatientGender | null; profileCompleteness?: { isComplete: boolean; missing: Array<'dateOfBirth' | 'gender'> }`; `CreatePatientDto` → `dateOfBirth?`, `gender?`.
- Chỉnh sửa: `BookMember` (`famidoc-frontend/src/lib/api/medical-books.api.ts:12-17`) `dateOfBirth: string | null`.
- Chỉnh sửa: `family-members-view.tsx`: `mapPatientDtoToMemberProfile` (375-449) — gender null → nhãn `'Chưa cập nhật'`; `mapGenderLabelToCode` (298-302) — nhãn `'Chưa cập nhật'` → `undefined` thay vì mặc định `MALE`; `FamilyMembersView` — banner nhắc nhẹ khi có thành viên `profileCompleteness.isComplete === false`, gồm nút "Bổ sung ngay" (mở form sửa thành viên đó) và "Để sau" (ẩn banner, lưu `localStorage` key `famidoc:profile-reminder-dismissed:<familyId>` trong try/catch, hết hạn sau 7 ngày).
- Test tương ứng: `famidoc-frontend/src/features/family-members/components/__tests__/family-members-api.test.tsx`; tạo mới `famidoc-frontend/src/features/family-members/components/__tests__/profile-reminder-banner.test.tsx`.
- Kiểm chứng bằng: `cd famidoc-frontend && npm test -- src/features/family-members`

**Ảnh hưởng liên quan:**
- `npx tsc --noEmit` ở frontend sẽ báo mọi nơi dùng `PatientDto.dateOfBirth` như `string` (member-profile.util.ts, member-hero-section.tsx, chronic-care-view, ...); mỗi chỗ thay bằng `?? ''` hoặc hiển thị "Chưa cập nhật".
- Regression test cần chạy thêm: `cd famidoc-frontend && npm test -- src/features/family-dashboard`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 3 (`profileCompleteness`).

- [ ] **Bước 1 [RED]: Viết test hiển thị và banner**
  Vị trí file test: `family-members-api.test.tsx`, `profile-reminder-banner.test.tsx`.
  Test case: (a) API mock trả thành viên `{dateOfBirth:null, gender:null, profileCompleteness:{isComplete:false, missing:['dateOfBirth','gender']}}` → thẻ thành viên hiển thị "Chưa cập nhật" (không hiện "Nam"); (b) banner "Bổ sung ngày sinh, giới tính" xuất hiện; bấm "Để sau" → banner biến mất; render lại (localStorage còn key, chưa quá 7 ngày) → banner không xuất hiện; (c) sửa thành viên mà không chọn giới tính → `patientsApi.updateFamilyMember` được gọi với `gender: undefined`.
  Kỳ vọng: chạy `cd famidoc-frontend && npm test -- src/features/family-members` → FAIL vì chưa có banner và gender đang mặc định `MALE`.
- [ ] **Bước 2 [GREEN]: Sửa types, mapper, thêm banner**
  Kỳ vọng: chạy `cd famidoc-frontend && npm test -- src/features/family-members` → PASS.
- [ ] **Bước 3 [REFACTOR]: Tách banner ra component `ProfileReminderBanner` trong `famidoc-frontend/src/features/family-members/components/profile-reminder-banner.tsx`**
  Kỳ vọng: chạy `cd famidoc-frontend && npm test -- src/features/family-members src/features/family-dashboard` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4 [RED]: Viết test hiển thị an toàn khi `dateOfBirth`/`gender` null ở các màn hình khác**
  Vị trí file test: `famidoc-frontend/src/features/family-dashboard/components/__tests__/family-dashboard-view.test.tsx`, `famidoc-frontend/src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx`, `famidoc-frontend/src/features/doctor-encounters/components/__tests__/prescription-safety.test.tsx`, tạo mới `famidoc-frontend/src/features/doctor-families/lib/__tests__/family-format.test.ts`.
  Test case: (a) dashboard với thành viên `dateOfBirth: null` → không hiển thị "45 tuổi", hiển thị "Chưa cập nhật"; (b) sổ khám (`medical-book-view.tsx`) và danh sách đơn gia đình (`family-prescriptions-view.tsx`) với `patient.dateOfBirth: null` → hiển thị "Chưa cập nhật", không hiển thị "01/01/1970" hay "Invalid Date"; (c) `PrescriptionContextFields` với `visit.patient.dateOfBirth: null` → hiển thị "Chưa cập nhật", không ném lỗi; (d) `ageFrom(null)` → `null`, `ageFrom('2000-01-01')` → số nguyên ≥ 26.
  Kỳ vọng: chạy `cd famidoc-frontend && npm test -- src/features/family-dashboard src/features/prescriptions src/features/doctor-encounters/components/__tests__/prescription-safety.test.tsx src/features/doctor-families` → FAIL vì `calculateAge` trả 45, `dateLabel` định dạng epoch 1970 và `ageFrom` chưa nhận `null`.
- [ ] **Bước 5 [GREEN]: Sửa các hàm hiển thị và kiểu nullable**
  `family-dashboard-view.tsx:40` `calculateAge(dob?: string | null): number | null` (thiếu → `null`, dòng 112 hiển thị "Chưa cập nhật"); `medical-book-view.tsx:76` `dateLabel(date: string | null)` và `family-prescriptions-view.tsx:24` `dateLabel(value: string | null)` trả "Chưa cập nhật" khi rỗng; `prescription-context-fields.tsx:135` kiểm tra rỗng trước khi `new Date(...)`; `family-format.ts:40` `ageFrom(value: string | null): number | null`; `family-members-view.tsx:432` gender null → `'Chưa cập nhật'`. Đổi kiểu nullable tại `doctors.api.ts:245`, `patients.api.ts:76,93`, `contracts.api.ts:47,181`, `encounters.api.ts:78`, `telehealth.api.ts:66`, `medical-books.api.ts:15`, `prescription-rules.ts:69`.
  Kỳ vọng: chạy `cd famidoc-frontend && npm test -- src/features/family-dashboard src/features/prescriptions src/features/doctor-encounters/components/__tests__/prescription-safety.test.tsx src/features/doctor-families` → PASS.
- [ ] **Bước 6: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `cd famidoc-frontend && npm test -- src/features/family-members src/features/family-dashboard src/features/prescriptions src/features/doctor-families src/features/doctor-encounters` và `npx tsc --noEmit`
  Kết quả mong đợi: tất cả PASS, tsc không lỗi.

### Task 7: Frontend — bác sĩ bổ sung hồ sơ trong `MemberExamWizard`

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `medicalBooksApi` (`famidoc-frontend/src/lib/api/medical-books.api.ts:129`) thêm `async updateVisitPatientProfile(id: string, body: { patientId: string; dateOfBirth?: string; gender?: PatientGender })` gọi `httpClient.patch(\`${path}/visits/${encodeURIComponent(id)}/patient-profile\`, body)`.
- Chỉnh sửa: `MemberExamWizard` (`member-exam-wizard.tsx:105-979`): khi `member.dateOfBirth` rỗng, hiển thị khối "Thiếu ngày sinh" ở bước kê đơn gồm ô ngày sinh + chọn giới tính (không bắt buộc) + nút "Lưu hồ sơ"; lưu thành công → cập nhật state `dateOfBirth` (dòng 216) để `patientAgeMonths` tính lại.
- Chỉnh sửa: `validatePrescriptionStep` (314-360): khi `ageMonths === null` trả lỗi "Cần bổ sung ngày sinh trước khi kê đơn." (hiện tại bỏ qua kiểm tra).
- Test tương ứng: `famidoc-frontend/src/features/doctor-encounters/components/__tests__/member-exam-wizard.test.tsx`.
- Kiểm chứng bằng: `cd famidoc-frontend && npm test -- src/features/doctor-encounters`

**Ảnh hưởng liên quan (trace_path):**
- `patientAgeMonths` được gọi bởi `validatePrescriptionStep`, `PrescriptionContextFields`, `submit` (prescription-form) — hàm đã được sửa ở Task 0 để trả `null` khi thiếu ngày sinh; Task 7 không sửa thêm.
- Regression test cần chạy thêm: `prescription-safety.test.tsx`, `prescription-replacement.test.tsx`, `doctor-visit-workspace.test.tsx` (cùng thư mục).

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 0 (`patientAgeMonths(null)` → `null`), Task 5 (endpoint), Task 4 (`PATIENT_PROFILE_INCOMPLETE`).

- [ ] **Bước 1 [RED]: Viết test wizard**
  Vị trí file test: `member-exam-wizard.test.tsx`.
  Test case: (a) member `dateOfBirth: null` → ở bước kê đơn thấy khối "Thiếu ngày sinh"; bấm tiếp mà chưa nhập → hiện "Cần bổ sung ngày sinh trước khi kê đơn."; (b) nhập `2022-05-01`, bấm "Lưu hồ sơ" → `medicalBooksApi.updateVisitPatientProfile` gọi với `('visit-1', { patientId, dateOfBirth: '2022-05-01' })`, khối biến mất, xuất hiện yêu cầu cân nặng/người đưa trẻ (trẻ < 72 tháng); (c) không chọn giới tính vẫn lưu được.
  Kỳ vọng: chạy `cd famidoc-frontend && npm test -- src/features/doctor-encounters/components/__tests__/member-exam-wizard.test.tsx` → FAIL vì chưa có khối bổ sung và hàm API.
- [ ] **Bước 2 [GREEN]: Thêm hàm API, khối bổ sung, sửa `validatePrescriptionStep`**
  Kỳ vọng: chạy `cd famidoc-frontend && npm test -- src/features/doctor-encounters/components/__tests__/member-exam-wizard.test.tsx` → PASS.
- [ ] **Bước 3 [REFACTOR]: Tách khối bổ sung thành component `MissingProfileFields` trong `famidoc-frontend/src/features/doctor-encounters/components/missing-profile-fields.tsx`**
  Kỳ vọng: chạy `cd famidoc-frontend && npm test -- src/features/doctor-encounters` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `cd famidoc-frontend && npm test -- src/features/doctor-encounters`
  Kết quả mong đợi: tất cả PASS, gồm các regression test đã liệt kê.

### Task 8: Tóm tắt nhu cầu chăm sóc (`getCareNeedsSummary`) không gán tuổi/giới tính giả

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `ContractsServiceImpl.getCareNeedsSummary` (`famidoc-backend/src/modules/contracts/services/impl/contracts.service.impl.ts:2565-2710`): dòng 2639-2641 bỏ fallback `new Date()` — thiếu ngày sinh thì `dob = null`, `age = null`, `ageGroup = 'UNKNOWN'`; dòng 2692 `dateOfBirth: dob` (có thể `null`); dòng 2695 `gender: rawPatient.gender ?? null` (bỏ `|| 'OTHER'`).
- Chỉnh sửa: `PatientCareSummaryDto` (`famidoc-backend/src/modules/contracts/dtos/care-needs-summary.dto.ts`): `dateOfBirth!: Date | null`, `age!: number | null`, `ageGroup!: 'CHILD' | 'ADOLESCENT' | 'ADULT' | 'ELDERLY' | 'UNKNOWN'` (cập nhật `description` thêm "UNKNOWN (chưa có ngày sinh)"), `gender!: string | null`; `@ApiProperty({ nullable: true })` cho các trường nullable.
- Chỉnh sửa frontend tương ứng: kiểu tại `famidoc-frontend/src/lib/api/contracts.api.ts:181` thêm `'UNKNOWN'` và `null`.
- Test tương ứng: `famidoc-backend/src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts` (describe `getCareNeedsSummary`, dòng 265).
- Kiểm chứng bằng: `cd famidoc-backend && npm test -- src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: route `GET /api/v1/contracts/medical/:id/care-summary` (ContractsController, test dòng 381).
- Regression test cần chạy thêm: `cd famidoc-backend && npm test -- src/modules/contracts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (cột nullable).

- [ ] **Bước 1 [RED]: Viết test tóm tắt cho thành viên thiếu ngày sinh/giới tính**
  Vị trí file test: `famidoc-backend/src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts`.
  Test case: mock patient `{ dateOfBirth: null, gender: null }` → phần tử tương ứng trong `summary` có `age === null`, `ageGroup === 'UNKNOWN'`, `dateOfBirth === null`, `gender === null`; patient `dateOfBirth: '2020-01-15'`, `gender: 'MALE'` vẫn cho `ageGroup === 'CHILD'`, `gender === 'MALE'`.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts` → FAIL vì đang trả `age = 0`, `ageGroup = 'CHILD'`, `gender = 'OTHER'`.
- [ ] **Bước 2 [GREEN]: Sửa `getCareNeedsSummary` và `PatientCareSummaryDto`**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/contracts/__tests__/contract-care-summary-and-document.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Tách tính tuổi/nhóm tuổi (dòng 2639-2661) ra hàm private `computeAgeGroup(dob: Date | null): { age: number | null; ageGroup: PatientCareSummaryDto['ageGroup'] }`**
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/contracts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `cd famidoc-backend && npm test -- src/modules/contracts`
  Kết quả mong đợi: tất cả PASS, gồm `contract-renewal.service`, `medical-contracts-query`, `package-upgrade-video-quota`.

### Task 9: Làm sạch ngày sinh/giới tính giả trong snapshot đơn thuốc cũ

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Dữ liệu: `Prescription.recordSnapshot` (`famidoc-backend/prisma/schema.prisma:1102`, cột `record_snapshot` JSONB, bảng `prescriptions`) — ghi tại `PrescriptionsService.createSharedPrescription` (`famidoc-backend/src/modules/encounters/services/prescriptions.service.ts:828-838`, khối `patient: { id, fullName, dateOfBirth, gender, ageMonths }`); `Prescription.clinicalContext` (`schema.prisma:1101`, cột `clinical_context`) chứa `ageMonths` (ghi ở `prescriptions.service.ts:856-860`). Liên kết patient qua `prescriptions.emr_id` → `clinical_emr.id`, `clinical_emr.patient_id` → `patients.id`.
- Tạo mới: `famidoc-backend/prisma/migrations/20261127120100_prescription_snapshot_clear_placeholder_dob/migration.sql` (timestamp sau migration Task 1 để chạy SAU khi patient đã về `null`).
- Chỉnh sửa kiểu: `PrescriptionSnapshot` backend (`famidoc-backend/src/modules/encounters/prescription-rules.ts:64-72`) và frontend (`famidoc-frontend/src/lib/prescription-rules.ts:64-72`): `patient.dateOfBirth: string | null`, `patient.gender: string | null`, `patient.ageMonths: number | null`.
- Chỉnh sửa hiển thị: `famidoc-frontend/src/features/prescriptions/components/family-prescriptions-view.tsx:343-352` (nhãn giới tính `null` → "Chưa cập nhật"; ngày sinh đã xử lý ở Task 6 qua `dateLabel`); `famidoc-frontend/src/features/prescriptions/components/medical-book-view.tsx:1192` `patient: { ...currentVisit.patient, ...snapshot.patient }` → chỉ ghi đè các trường snapshot khác `null` (để nếu hồ sơ đã được bổ sung sau đó thì hiển thị giá trị thật, còn không thì "Chưa cập nhật").
- Test tương ứng: tạo mới `famidoc-backend/src/modules/encounters/__tests__/prescription-snapshot-cleanup-migration.spec.ts`; `famidoc-frontend/src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx`.
- Kiểm chứng bằng: `cd famidoc-backend && npm test -- src/modules/encounters/__tests__/prescription-snapshot-cleanup-migration.spec.ts` và `cd famidoc-frontend && npm test -- src/features/prescriptions`

**Ảnh hưởng liên quan:**
- `recordSnapshot` được đọc bởi: `summary()` (`prescriptions.service.ts:143-160`, trả nguyên snapshot), `MedicalBooksService.visitDetail` (`medical-books.service.ts:705`), frontend `family-prescriptions-view.tsx:338-357`, `medical-book-view.tsx:1188-1215` (`patientDob`, `patientGender`, `ageMonths: ctx?.ageMonths` cho tài liệu đơn thuốc tải về).
- Đơn thuốc mới sau Task 4 luôn có `dateOfBirth` thật nên không bị ảnh hưởng.
- Regression test cần chạy thêm: `cd famidoc-backend && npm test -- src/modules/encounters`; `cd famidoc-frontend && npm test -- src/features/prescriptions/components/__tests__/download-book-document.test.tsx`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (patient giả đã về `null`), Task 6 (`dateLabel` nhận `null`).

- [ ] **Bước 1 [RED]: Viết test nội dung migration và test hiển thị snapshot rỗng**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/prescription-snapshot-cleanup-migration.spec.ts`, `famidoc-frontend/src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx`.
  Test case: (a) file `migration.sql` tồn tại, có `UPDATE "prescriptions"` dùng `jsonb_set` đặt `{patient,dateOfBirth}`, `{patient,gender}`, `{patient,ageMonths}` về `null`, xóa khóa `ageMonths` khỏi `clinical_context`, và `WHERE` có đủ: join `clinical_emr` → `patients`, `relationship_to_head = 'SELF'`, `date_of_birth IS NULL`, `record_snapshot->'patient'->>'dateOfBirth' = '1990-01-01'`, `record_snapshot->'patient'->>'gender' = 'OTHER'`; (b) tên thư mục migration xếp sau `20261127120000_patient_optional_birthdate_gender`; (c) frontend: đơn có `recordSnapshot.patient = { dateOfBirth: null, gender: null, ageMonths: null }` → hiển thị "Chưa cập nhật" cho Ngày sinh và Giới tính, không hiện "01/01/1990", "Khác" hay ô trống `undefined`; (d) sổ khám với snapshot `dateOfBirth: null` nhưng `currentVisit.patient.dateOfBirth = '2015-03-10'` → hiển thị `10/03/2015`.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/encounters/__tests__/prescription-snapshot-cleanup-migration.spec.ts` và `cd famidoc-frontend && npm test -- src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx` → FAIL vì chưa có file migration và nhãn giới tính `null` đang ra `undefined`.
- [ ] **Bước 2 [GREEN]: Tạo migration và sửa kiểu/hiển thị**
  `migration.sql`:
  `UPDATE "prescriptions" pr SET "record_snapshot" = jsonb_set(jsonb_set(jsonb_set(pr."record_snapshot", '{patient,dateOfBirth}', 'null'::jsonb), '{patient,gender}', 'null'::jsonb), '{patient,ageMonths}', 'null'::jsonb), "clinical_context" = CASE WHEN pr."clinical_context" IS NULL THEN NULL ELSE pr."clinical_context" - 'ageMonths' END FROM "clinical_emr" e JOIN "patients" p ON p."id" = e."patient_id" WHERE pr."emr_id" = e."id" AND p."relationship_to_head" = 'SELF' AND p."date_of_birth" IS NULL AND pr."record_snapshot"->'patient'->>'dateOfBirth' = '1990-01-01' AND pr."record_snapshot"->'patient'->>'gender' = 'OTHER';`
  (tên cột lấy đúng từ `@map` của `Prescription`, `ClinicalEmr`, `Patient` khi mở file). Đổi kiểu `PrescriptionSnapshot` hai phía; sửa `family-prescriptions-view.tsx:352` thêm `?? 'Chưa cập nhật'`; sửa `medical-book-view.tsx:1192` bỏ các khóa `null` của `snapshot.patient` trước khi gộp.
  Kỳ vọng: chạy `cd famidoc-backend && npm test -- src/modules/encounters/__tests__/prescription-snapshot-cleanup-migration.spec.ts` và `cd famidoc-frontend && npm test -- src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx` → PASS.
- [ ] **Bước 3 [REFACTOR]: Tách hàm `mergeSnapshotPatient(current, snapshot)` trong `medical-book-view.tsx` (gộp bỏ qua `null`)**
  Kỳ vọng: chạy `cd famidoc-frontend && npm test -- src/features/prescriptions` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: (1) backup DB rồi chạy trên DB dev `SELECT count(*) FROM "prescriptions" WHERE "record_snapshot"->'patient'->>'dateOfBirth' = '1990-01-01';` trước và sau `npx prisma migrate dev`; (2) chạy `cd famidoc-backend && npm test -- src/modules/encounters` và `cd famidoc-frontend && npm test -- src/features/prescriptions`.
  Kết quả mong đợi: số bản ghi khớp giảm về 0 với các đơn của patient SELF giả (đơn của người thật sinh 01/01/1990 có giới tính khác `OTHER` không đổi); tất cả test PASS.

### Task 10: Kiểm tra toàn cục cuối cùng

- [ ] **Bước 1: Chạy toàn bộ test và typecheck hai phía**
  Cách kiểm tra: `cd famidoc-backend && npm test && npx tsc --noEmit`; `cd famidoc-frontend && npm test && npx tsc --noEmit`.
  Kết quả mong đợi: tất cả PASS, không lỗi kiểu.
