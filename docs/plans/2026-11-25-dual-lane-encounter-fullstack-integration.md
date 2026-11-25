# Kết nối Full-Stack Luồng Ca Khám 2 Làn Song Song (Backend + Frontend) — Kế hoạch triển khai (v2 — Đã tích hợp Change Impact Analysis)

**Mục tiêu:** Đồng bộ hoàn chỉnh `famidoc-backend` và `famidoc-frontend` cho luồng Ca khám 2 làn song song (tự động Active theo lịch, không check-in/di chuyển, Gia đình xác nhận & đánh giá/báo không đến, Bác sĩ chốt EHR & đơn thuốc/đơn thay thế, tự động đối soát 24h/48h), đồng thời cập nhật đầy đủ các module phụ thuộc phát sinh (`contracts`, `doctors`, `telehealth`, `medical-books`) và gỡ mọi điểm lệch contract giữa FE và BE.

**Cách tiếp cận:** Bắt đầu từ Prisma enum (`PENDING_RECORD`, `DISPUTED`) kèm migration; cập nhật các service lõi của `famidoc-backend` (`EncountersServiceImpl.confirmArrival` giới hạn đúng cho `HOME_VISIT` để không ảnh hưởng `TelehealthService`, `PrescriptionsService.confirmVisitRecord` kiểm soát chặt trạng thái `DISPUTED`/`PENDING_RECORD` mà không phá vỡ 19 callers của `doctorVisitScope`, `ComplaintsServiceImpl.submitIncidentComplaint`, `EncounterRemindersService.runReminders`); bổ sung task chuyên biệt cập nhật các điểm đọc `IN_PROGRESS` ở `contracts.repository.impl.ts` và `doctors.service.impl.ts`; cuối cùng nối Frontend D4 sang `prescriptionsApi.replace`, đồng bộ OpenAPI và chạy toàn bộ test trên cả 2 repo.

**Đã tra cứu codebase (`codebase-memory-mcp`):**
- `get_architecture` & `get_graph_schema` (`C-Users-ADMIN-Downloads-famidoc-famidoc-backend` — 4.933 nodes/16.123 edges; `C-Users-ADMIN-Downloads-famidoc-famidoc-frontend` — 5.447 nodes/16.353 edges).
- `read_file` & `get_code_snippet` (`famidoc-backend`):
  - `prisma/schema.prisma` (lines 170–180): `enum EncounterStatus` hiện thiếu `PENDING_RECORD` và `DISPUTED`.
  - `src/modules/encounters/services/impl/encounters.service.impl.ts` (`EncountersServiceImpl.confirmArrival`, lines 756–790): hiện gán cứng `IN_PROGRESS`, chưa kiểm tra giờ hẹn VN (`+07:00`) và chưa đối soát với `clinicalEmrs`.
  - `src/modules/telehealth/services/telehealth.service.ts` (`ALLOWED_ACTIVE_STATUSES`, lines 26–29): chỉ cho phép `[CONFIRMED, IN_PROGRESS]` — do đó `confirmArrival` cần giữ nguyên luồng `TELEHEALTH` để không chặn phòng Video.
  - `src/modules/encounters/services/prescriptions.service.ts` (`PrescriptionsService.confirmVisitRecord`, lines 296–389; `PrescriptionsService.replace`, line 699; `doctorVisitScope` có **19 callers** xác nhận qua `trace_path` depth=3 bao gồm toàn bộ `MedicalBooksService`).
  - `src/modules/complaints/services/impl/complaints.service.impl.ts` (`ComplaintsServiceImpl.submitIncidentComplaint`, lines 105–170): chưa cập nhật `encounterStatus = 'DISPUTED'` khi `category === 'DOCTOR_ABSENT'`.
  - `src/modules/encounters/services/impl/encounter-reminders.service.ts` (`EncounterRemindersService.runReminders`, lines 37–172): mới có nhắc trước khám T-24h / T-2h.
  - `src/modules/contracts/repositories/impl/contracts.repository.impl.ts` (`PrismaContractsSession.hasEncounterInProgress`, lines 198–203 & `getStaffingTerminationImpact`, lines 812–817): chỉ lọc `IN_PROGRESS`, sẽ bỏ lọt `PENDING_RECORD` và `DISPUTED`.
  - `src/modules/doctors/services/impl/doctors.service.impl.ts` (lines 2326–2331): thống kê `inProgress` chỉ đếm `row.encounterStatus === 'IN_PROGRESS'`, sẽ thiếu `PENDING_RECORD`.
- `read_file` (`famidoc-frontend`):
  - `src/lib/api/prescriptions.api.ts` (lines 155–172): đã có `prescriptionsApi.replace(id, body)` gọi `POST /api/v1/prescriptions/:id/replacements`, nhưng `src/features/doctor-encounters/components/prescription-form.tsx` (D4) đang gọi nhầm `prescriptionsApi.share`.

**Framework test & quy ước (đã xác nhận qua `package.json` và `search_graph`):**
- Backend (`famidoc-backend`): Jest `^30.0.0`, file test đặt tại `src/modules/<module>/__tests__/*.spec.ts`. Lệnh chạy test (trong thư mục `famidoc-backend`): `npm test -- <path>`.
- Frontend (`famidoc-frontend`): Vitest `^5.0.5` + Testing Library, file test đặt tại `src/**/__tests__/*.test.{ts,tsx}`. Lệnh chạy test (trong thư mục `famidoc-frontend`): `npm test -- <path>`.

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Luồng `TELEHEALTH` giữ nguyên `ALLOWED_ACTIVE_STATUSES` (`CONFIRMED`, `IN_PROGRESS`), không bị đẩy sang `PENDING_RECORD` từ `confirmArrival`.
- Khi sửa `doctorVisitScope` (19 callers), tuyệt đối không làm mất quyền xem hồ sơ cũ của `MedicalBooksService`; chỉ kiểm soát quyền chốt/kê đơn mới trong `confirmVisitRecord` (chặn `DISPUTED`/`CANCELLED`).
- Toàn bộ thông báo lỗi và notification gửi Gia đình dùng tiếng Việt đời thường, không lộ mã kỹ thuật.

---

### Task 1: Mở rộng `EncounterStatus` (`PENDING_RECORD`, `DISPUTED`) trong Prisma Schema & sinh Client

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: `famidoc-backend/prisma/migrations/20261125000100_dual_lane_encounter_statuses/migration.sql`
- Chỉnh sửa: `famidoc-backend/prisma/schema.prisma` (`enum EncounterStatus`, lines 170–180)
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/encounters.service.spec.ts`
- Kiểm chứng bằng: `npm run prisma:validate && npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` (chạy tại `famidoc-backend`)

**Ảnh hưởng liên quan (từ `trace_path` / `search_code`):**
- Được gọi bởi: `ListEncountersQueryDto` (`@IsEnum(EncounterStatus)` tự động nhận giá trị mới), `encounters`, `complaints`, `contracts`, `doctors`, `telehealth`.
- Gọi tới: `@prisma/client`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: yêu cầu trạng thái 2 làn (`PENDING_RECORD`, `DISPUTED`).
- Cung cấp đầu ra cho: Task 2, Task 3, Task 4, Task 5, Task 6.

- [ ] **Bước 1 [RED]: Viết test kiểm tra `EncounterStatus` có đủ giá trị `PENDING_RECORD` và `DISPUTED`**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/encounters.service.spec.ts`
  Test case: assert `EncounterStatus.PENDING_RECORD === 'PENDING_RECORD'` và `EncounterStatus.DISPUTED === 'DISPUTED'`.
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` → FAIL với lỗi property `PENDING_RECORD` / `DISPUTED` chưa tồn tại trên `EncounterStatus`.

- [ ] **Bước 2 [GREEN]: Thêm `PENDING_RECORD`, `DISPUTED` vào `prisma/schema.prisma`, tạo migration SQL (`ALTER TYPE "EncounterStatus" ADD VALUE IF NOT EXISTS ...`) và chạy `npm run prisma:generate`**
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Không cần refactor (chỉ bổ sung enum schema).**

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm run prisma:validate && npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts`
  Kết quả mong đợi: schema hợp lệ và toàn bộ test PASS.

---

### Task 2: Cập nhật `EncountersServiceImpl.confirmArrival` cho `HOME_VISIT` theo luồng 2 làn (kiểm tra giờ hẹn, tự đối soát `PENDING_RECORD` / `COMPLETED`, bảo vệ luồng `TELEHEALTH`)

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/services/impl/encounters.service.impl.ts` (`EncountersServiceImpl.confirmArrival`, lines 756–790)
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/encounters.service.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts`

**Ảnh hưởng liên quan (từ `trace_path` / `search_code`):**
- Được gọi bởi: `EncountersController.confirmArrival` (`PATCH /api/v1/encounters/:id/confirm-arrival`).
- Gọi tới: `session.findEncounter`, `session.updateEncounter`, `session.createAuditLog`, `session.createNotification`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/encounters/__tests__/encounters.controller.spec.ts` và `npm test -- src/modules/telehealth/__tests__/telehealth-session.service.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `EncounterStatus.PENDING_RECORD` (Task 1) và `FamilyVisitConfirmModal` (F3a).
- Cung cấp đầu ra cho: Task 3 (`confirmVisitRecord`), Task 5 (`EncounterRemindersService`), Task 6 (`contracts` & `doctors` status checks).

- [ ] **Bước 1 [RED]: Viết unit test cho `confirmArrival` theo quy tắc 2 làn & bảo vệ `TELEHEALTH`**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/encounters.service.spec.ts`
  Test case:
  1. Nếu `encounterType !== 'HOME_VISIT'` (VD: `TELEHEALTH`) → ném `BadRequestException` ("Chỉ áp dụng xác nhận bác sĩ đến khám cho lịch khám tại nhà.") để không phá vỡ `TelehealthService.ALLOWED_ACTIVE_STATUSES`.
  2. Nếu `FAMILY_REP` bấm xác nhận **trước** giờ hẹn (`scheduledDate + scheduledTime` theo giờ VN `+07:00`) → ném `BadRequestException` ("Chưa đến giờ hẹn khám, chưa thể xác nhận.").
  3. Nếu ca khám đang `NO_SHOW`, `DISPUTED`, hoặc `CANCELLED` → ném `BadRequestException`.
  4. Nếu ca `HOME_VISIT` đang `CONFIRMED`, đã đến giờ hẹn, bác sĩ **chưa** chốt `clinicalEmrs` → cập nhật `familyConfirmedArrivalAt` và `encounterStatus: 'PENDING_RECORD'`.
  5. Nếu ca `HOME_VISIT` đang `CONFIRMED`, đã đến giờ hẹn, bác sĩ **đã** chốt >= 1 `clinicalEmrs` (`isFinalized: true`) → cập nhật `familyConfirmedArrivalAt` và `encounterStatus: 'COMPLETED'`.
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` → FAIL vì `confirmArrival` hiện không kiểm tra `HOME_VISIT`/giờ hẹn và luôn đặt `IN_PROGRESS`.

- [ ] **Bước 2 [GREEN]: Cập nhật `EncountersServiceImpl.confirmArrival` tại `famidoc-backend/src/modules/encounters/services/impl/encounters.service.impl.ts`**
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Tách helper `hasReachedScheduledStart(scheduledDate, scheduledTime, now)` trong `encounters.service.impl.ts` xử lý chuẩn múi giờ VN `+07:00`**
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` → vẫn PASS.

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts src/modules/encounters/__tests__/encounters.controller.spec.ts src/modules/telehealth/__tests__/telehealth-session.service.spec.ts`
  Kết quả mong đợi: tất cả test PASS.

---

### Task 3: Cập nhật `PrescriptionsService.confirmVisitRecord` & kiểm soát an toàn 19 callers của `doctorVisitScope`

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa:
  - `famidoc-backend/src/modules/encounters/services/prescriptions.service.ts` (`PrescriptionsService.confirmVisitRecord`, `doctorVisitScope`)
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/prescriptions-multi-member.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/encounters/__tests__/prescriptions-multi-member.spec.ts`

**Ảnh hưởng liên quan (từ `trace_path`):**
- Được gọi bởi: `MedicalBooksController.confirm` (`POST /api/v1/medical-books/visits/:id/confirm`); riêng `doctorVisitScope` có **19 callers** gồm `MedicalBooksService` (`families`, `patientVisits`, `visitDetail`, `patientDocuments`, `uploadDocument`, `downloadDocument`, `familyScope`, `rosterScope`, `visitScope`, `documentScope`) và `PrescriptionsService` (`doctorVisits`, `share`, `confirmVisitRecord`).
- Gọi tới: `tx.encounter.update`, `this.createSharedPrescription`.
- Regression test cần chạy thêm do có inbound calls: toàn bộ spec trong `src/modules/encounters/__tests__/`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `EncounterStatus.PENDING_RECORD`, `DISPUTED` (Task 1), `confirmArrival` (Task 2), và `DoctorVisitWorkspace` (D3).
- Cung cấp đầu ra cho: trạng thái `COMPLETED` khi cả 2 làn hoàn tất; bảo toàn quyền đọc cho toàn bộ `MedicalBooksService`.

- [ ] **Bước 1 [RED]: Viết test cho `confirmVisitRecord` với `PENDING_RECORD`, `CONFIRMED`, và chặn `DISPUTED`**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/prescriptions-multi-member.spec.ts`
  Test case:
  1. Ca ở trạng thái `PENDING_RECORD` (`familyConfirmedArrivalAt != null`) nằm trong `doctorVisitScope` và khi bác sĩ gọi `confirmVisitRecord` → tự động cập nhật `encounterStatus` sang `COMPLETED`.
  2. Ca ở trạng thái `CONFIRMED` với `familyConfirmedArrivalAt == null` → khi bác sĩ gọi `confirmVisitRecord`, giữ nguyên `CONFIRMED` (chờ gia đình xác nhận hoặc job 48h).
  3. Ca ở trạng thái `DISPUTED` hoặc `NO_SHOW` → vẫn giữ trong `doctorVisitScope` để xem lịch sử, nhưng `confirmVisitRecord` **KHÔNG** tự chuyển sang `COMPLETED` (khóa tự đóng ca theo quy tắc đối soát).
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/prescriptions-multi-member.spec.ts` → FAIL vì `confirmVisitRecord` chưa tự chuyển `COMPLETED` cho `PENDING_RECORD` và chưa khóa tự đóng khi `DISPUTED`.

- [ ] **Bước 2 [GREEN]: Cập nhật `PrescriptionsService.confirmVisitRecord` (và giữ nguyên quyền đọc của `doctorVisitScope` cho 19 callers) tại `famidoc-backend/src/modules/encounters/services/prescriptions.service.ts`**
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/prescriptions-multi-member.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Không cần refactor bổ sung.**

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/encounters/__tests__/`
  Kết quả mong đợi: tất cả test trong module `encounters` PASS.

---

### Task 4: Khóa ca khám sang `DISPUTED` khi Gia đình báo sự cố `DOCTOR_ABSENT` (`ComplaintsServiceImpl`)

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: `famidoc-backend/src/modules/complaints/__tests__/complaints-no-show.spec.ts`
- Chỉnh sửa:
  - `famidoc-backend/src/modules/complaints/services/impl/complaints.service.impl.ts` (`ComplaintsServiceImpl.submitIncidentComplaint`, lines 105–170)
  - `famidoc-backend/src/modules/complaints/repositories/impl/complaints.repository.impl.ts` (thêm `markEncounterDisputed(encounterId)`)
  - `famidoc-backend/src/modules/complaints/repositories/interfaces/complaints.repository.interface.ts` (khai báo `markEncounterDisputed`)
- Test tương ứng: `famidoc-backend/src/modules/complaints/__tests__/complaints-no-show.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/complaints/__tests__/complaints-no-show.spec.ts`

**Ảnh hưởng liên quan (từ `trace_path`):**
- Được gọi bởi: `ComplaintsController.submitIncidentComplaint` (`POST /api/v1/complaints`).
- Gọi tới: `session.createComplaint`, `session.markEncounterDisputed`, `session.recordComplaintEvent`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/encounters/__tests__/encounter-reminders.service.spec.ts` (xác nhận ca `DISPUTED` bị khóa tự đóng) và `npm test -- src/modules/contracts/__tests__/contracts.repository.spec.ts` (Task 6).

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `FamilyVisitConfirmModal` F3b (`category: 'DOCTOR_ABSENT'`, `encounterId`) và `EncounterStatus.DISPUTED` (Task 1).
- Cung cấp đầu ra cho: `DualLaneReconciliationTable` (O1), khóa tự đóng ca ở Task 3 & Task 5, và chặn hủy hợp đồng ở Task 6.

- [ ] **Bước 1 [RED]: Viết test cho `ComplaintsServiceImpl.submitIncidentComplaint` khi `category === 'DOCTOR_ABSENT'`**
  Vị trí file test: `famidoc-backend/src/modules/complaints/__tests__/complaints-no-show.spec.ts`
  Test case:
  1. `FAMILY_REP` gửi complaint với `category: 'DOCTOR_ABSENT'` và `encounterId: 'enc-1'` → gọi `session.markEncounterDisputed('enc-1')` cập nhật `encounterStatus = 'DISPUTED'` trong cùng transaction.
  2. Gửi complaint với `category: 'OTHER'` hoặc không có `encounterId`, hoặc `actor.role === 'DOCTOR'` → KHÔNG gọi `markEncounterDisputed`.
  Kỳ vọng: chạy `npm test -- src/modules/complaints/__tests__/complaints-no-show.spec.ts` → FAIL vì `markEncounterDisputed` chưa tồn tại.

- [ ] **Bước 2 [GREEN]: Thêm `markEncounterDisputed` vào interface/repository của `complaints` và gọi trong `ComplaintsServiceImpl.submitIncidentComplaint`**
  Kỳ vọng: chạy `npm test -- src/modules/complaints/__tests__/complaints-no-show.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Không cần refactor bổ sung.**

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/complaints/__tests__/complaints-no-show.spec.ts`
  Kết quả mong đợi: tất cả test PASS.

---

### Task 5: Tự động đối soát 24h (nhắc bác sĩ `PENDING_RECORD`) & 48h (tự đóng `COMPLETED`) trong `EncounterRemindersService`

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/services/impl/encounter-reminders.service.ts` (`EncounterRemindersService.runReminders`, lines 37–172)
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/encounter-reminders.service.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/encounters/__tests__/encounter-reminders.service.spec.ts`

**Ảnh hưởng liên quan (từ `trace_path`):**
- Được gọi bởi: `EncounterRemindersService` interval.
- Gọi tới: `this.prisma.encounter.findMany`, `this.prisma.encounter.update`, `this.prisma.notification.createMany`.
- Regression test cần chạy thêm do có inbound calls: giữ nguyên toàn bộ test T-24h / T-2h trong `encounter-reminders.service.spec.ts` PASS.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `EncounterStatus.PENDING_RECORD`, `DISPUTED` (Task 1), `familyConfirmedArrivalAt` (Task 2), `clinicalEmrs` (Task 3).
- Cung cấp đầu ra cho: thông báo nhắc quá hạn 24h và tự đóng `COMPLETED` sau 48h.

- [ ] **Bước 1 [RED]: Viết test cho 2 quy tắc đối soát tự động (24h & 48h) và quy tắc khóa `DISPUTED`**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/encounter-reminders.service.spec.ts`
  Test case:
  1. Ca `PENDING_RECORD` quá 24h sau giờ kết thúc ca mà chưa có `clinicalEmrs` (`isFinalized: true`) → tạo notification `ENCOUNTER_RECORD_OVERDUE` gửi bác sĩ.
  2. Ca `CONFIRMED` với `familyConfirmedArrivalAt == null`, quá 48h sau giờ kết thúc ca, đã có >= 1 `clinicalEmrs` (`isFinalized: true`) → tự động update `encounterStatus: 'COMPLETED'`.
  3. Ca `DISPUTED` / `NO_SHOW` quá 48h dù có hay không có `clinicalEmrs` → tuyệt đối KHÔNG gọi update sang `COMPLETED`.
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounter-reminders.service.spec.ts` → FAIL vì `runReminders` chưa có logic đối soát sau ca khám.

- [ ] **Bước 2 [GREEN]: Bổ sung logic đối soát 24h & 48h vào `EncounterRemindersService.runReminders`**
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounter-reminders.service.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Tách method private `reconcilePostVisitEncounters(now)` trong `EncounterRemindersService` để tách rõ nhắc trước khám và đối soát sau khám**
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounter-reminders.service.spec.ts` → vẫn PASS.

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/encounters/__tests__/encounter-reminders.service.spec.ts`
  Kết quả mong đợi: tất cả test PASS.

---

### Task 6: Đồng bộ các điểm phụ thuộc phát sinh từ Change Impact Analysis (`contracts.repository.impl.ts`, `doctors.service.impl.ts`)

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa:
  - `famidoc-backend/src/modules/contracts/repositories/impl/contracts.repository.impl.ts` (`PrismaContractsSession.hasEncounterInProgress`, lines 198–203 & `getStaffingTerminationImpact`, lines 812–817)
  - `famidoc-backend/src/modules/doctors/services/impl/doctors.service.impl.ts` (thống kê ca đang xử lý, line 2327)
- Test tương ứng: `famidoc-backend/src/modules/contracts/__tests__/contracts.repository.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/contracts/__tests__/contracts.repository.spec.ts`

**Ảnh hưởng liên quan (từ Change Impact Analysis):**
- Được gọi bởi: luồng chấm dứt/hủy hợp đồng y tế & hợp đồng B2B CSYT (`contracts`), và dashboard thống kê bác sĩ (`doctors`).
- Gọi tới: `this.tx.encounter.findFirst`, `this.tx.encounter.count`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/contracts/__tests__/contracts.repository.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `EncounterStatus.PENDING_RECORD`, `DISPUTED` (Task 1) và `confirmArrival` (Task 2).
- Cung cấp đầu ra cho: bảo vệ tính toàn vẹn hợp đồng (không cho hủy khi còn ca `PENDING_RECORD` hoặc `DISPUTED`) và số liệu dashboard bác sĩ chính xác.

- [ ] **Bước 1 [RED]: Viết test cho `hasEncounterInProgress` và `getStaffingTerminationImpact` với `PENDING_RECORD` và `DISPUTED`**
  Vị trí file test: `famidoc-backend/src/modules/contracts/__tests__/contracts.repository.spec.ts`
  Test case:
  1. `hasEncounterInProgress(contractId)` truy vấn `encounterStatus: { in: ['IN_PROGRESS', 'PENDING_RECORD', 'DISPUTED'] }` (chặn hủy hợp đồng khi còn ca chờ chốt hồ sơ hoặc đang tranh chấp).
  2. `getStaffingTerminationImpact(facilityId)` đếm `openEncounters` bao gồm `['REQUESTED', 'CONFIRMED', 'IN_PROGRESS', 'PENDING_RECORD', 'DISPUTED']`.
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/contracts.repository.spec.ts` → FAIL vì 2 hàm hiện chỉ lọc `'IN_PROGRESS'`.

- [ ] **Bước 2 [GREEN]: Cập nhật `hasEncounterInProgress`, `getStaffingTerminationImpact` tại `contracts.repository.impl.ts` và bộ đếm `inProgress` tại `doctors.service.impl.ts:L2327` (cộng thêm `PENDING_RECORD`)**
  Kỳ vọng: chạy `npm test -- src/modules/contracts/__tests__/contracts.repository.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Không cần refactor bổ sung.**

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/contracts/__tests__/contracts.repository.spec.ts`
  Kết quả mong đợi: tất cả test PASS.

---

### Task 7: Nối Frontend D4 (`PrescriptionForm`) sang `prescriptionsApi.replace`, cập nhật E2E / OpenAPI & kiểm chứng toàn bộ Full-Stack

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa:
  - `famidoc-frontend/src/features/doctor-encounters/components/prescription-form.tsx` (`PrescriptionForm`)
  - `famidoc-frontend/src/features/doctor-encounters/components/__tests__/prescription-replacement.test.tsx`
  - `famidoc-backend/test/business-workflows.e2e-spec.ts` (cập nhật kỳ vọng nếu bị ảnh hưởng bởi `PENDING_RECORD`)
- Test tương ứng: `famidoc-frontend/src/features/doctor-encounters/components/__tests__/prescription-replacement.test.tsx`
- Kiểm chứng bằng: `npm test -- src/features/doctor-encounters/components/__tests__/prescription-replacement.test.tsx`

**Ảnh hưởng liên quan (từ `trace_path`):**
- Được gọi bởi: `VisitPage`, `VisitPages`, `DoctorBookVisitView` (`medical-book-view.tsx`) và `DoctorVisitWorkspace`.
- Gọi tới: `prescriptionsApi.replace(visit.prescription.id, ...)` (`POST /api/v1/prescriptions/:id/replacements`).
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1–6 trên `famidoc-backend` và `PrescriptionsController.replace`.
- Cung cấp đầu ra cho: hệ thống Full-Stack đồng bộ 100% FE ↔ BE.

- [ ] **Bước 1 [RED]: Cập nhật test `prescription-replacement.test.tsx` để assert D4 gọi `prescriptionsApi.replace` đúng contract `ReplacePrescriptionDto`**
  Vị trí file test: `famidoc-frontend/src/features/doctor-encounters/components/__tests__/prescription-replacement.test.tsx`
  Test case: bấm `✓ Xác nhận Hủy đơn cũ & Phát hành đơn thay thế` → gọi `prescriptionsApi.replace('rx-old-1', expect.objectContaining({ replacementReason: ..., details: ... }))`, KHÔNG gọi `prescriptionsApi.share`.
  Kỳ vọng: chạy `npm test -- src/features/doctor-encounters/components/__tests__/prescription-replacement.test.tsx` → FAIL vì `prescription-form.tsx` đang gọi `prescriptionsApi.share`.

- [ ] **Bước 2 [GREEN]: Sửa `handleConfirmReplacement` trong `famidoc-frontend/src/features/doctor-encounters/components/prescription-form.tsx` gọi `prescriptionsApi.replace(visit.prescription.id, ...)`**
  Kỳ vọng: chạy `npm test -- src/features/doctor-encounters/components/__tests__/prescription-replacement.test.tsx` → PASS.

- [ ] **Bước 3 [REFACTOR]: Không cần refactor bổ sung.**

- [ ] **Bước 4: Xác nhận hoàn tất toàn bộ kế hoạch Full-Stack**
  Cách kiểm tra:
  1. Tại `famidoc-backend`: chạy `npm test` và `npm run export:openapi` (cập nhật `openapi.json` với `PENDING_RECORD`, `DISPUTED`).
  2. Tại `famidoc-frontend`: chạy `./node_modules/.bin/tsc --noEmit` và `npm test`.
  Kết quả mong đợi: 100% test ở cả `famidoc-backend` và `famidoc-frontend` PASS, 0 lỗi TypeScript, OpenAPI đồng bộ.
