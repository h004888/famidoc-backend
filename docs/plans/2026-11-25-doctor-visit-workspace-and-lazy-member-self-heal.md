# Giao diện Không gian làm việc Bác sĩ 2 Cột Tối giản & Lazy Self-Heal Thành viên Chủ hộ — Kế hoạch triển khai (v2 — Đã tích hợp Change Impact Analysis)

**Mục tiêu:** Tự động tự phục hồi thành viên mặc định (Chủ hộ) một cách an toàn khi đọc chi tiết ca khám (`getEncounterDetail`) đối với các hợp đồng thiếu `contract_members` (Phương án C — Lazy Self-Heal, không gây lỗi cho 4 màn hình FE dùng chung `GET /api/v1/encounters/:id`), đồng thời tái cấu trúc `DoctorVisitWorkspace` sang bố cục 2 cột tối giản theo đúng ASCII Mockup đã duyệt.

**Cách tiếp cận:** Thực hiện theo Phương án C có gia cố từ Change Impact Analysis: khai báo `ensureContractDefaultMembers?` dạng optional trên `EncountersSession` để không làm vỡ bất kỳ mock test nào; bọc bước lazy self-heal trong `EncountersServiceImpl.getEncounterDetail` với cơ chế chống xung đột `Serializable` (`P2034`/`P2002`) để 4 caller FE phát sinh (`DoctorEncounterWrapUpPage`, `DoctorReschedulePage`, `FamilyReschedulePage`, `telehealth.api.getEncounterDetail`) không bao giờ bị lỗi khi gọi đồng thời; sau đó bổ sung `resolveWorkspaceMembers` (fallback `participants`) và xây lại giao diện 2 cột tối giản tại `DoctorVisitWorkspace`. Mọi task triển khai code đều tuân thủ chu trình TDD Red → Green → Refactor.

**Đã tra cứu codebase (`codebase-memory-mcp` — đã re-index 2026-11-25):**
- `index_repository` & `get_architecture`: `C-Users-ADMIN-Downloads-famidoc-famidoc-backend` (**5.616 nodes / 19.319 edges**); `C-Users-ADMIN-Downloads-famidoc-famidoc-frontend` (**7.963 nodes / 24.745 edges**).
- `get_code_snippet` (`famidoc-backend`):
  - `AuthRepositoryImpl.createFamilyRepEntities` (`src/modules/auth/repositories/impl/auth.repository.impl.ts`, lines 58–108): đã tự tạo `Patient` Chủ hộ (`relationshipToHead: 'SELF'`, `status: 'ACTIVE'`) khi đăng ký `FAMILY_REP`.
  - `ContractsServiceImpl` (`src/modules/contracts/services/impl/contracts.service.impl.ts`, lines 709–734 & 901–903): bỏ qua `createContractMembers` khi `patientIds.length === 0`, dẫn đến 7/17 hợp đồng `ACTIVE` trong DB hiện có 0 bản ghi `contract_members`.
- `trace_path` & `query_graph` & `search_code` (`famidoc-backend`):
  - `EncountersServiceImpl.getEncounterDetail` (`src/modules/encounters/services/impl/encounters.service.impl.ts`, lines 1460–1484): chạy trong `EncountersRepositoryImpl.transaction` (`serializable(this.prisma, ...)`), gọi `enrichEncounterWithScheduleMeta` → `parseEncounterScheduleMeta`.
  - `EncountersSession` (`src/modules/encounters/repositories/interfaces/encounters.repository.interface.ts`, lines 50–105): được `PrismaEncountersSession` implement và được mock tại `encounters.service.spec.ts`.
- `trace_path` & `query_graph` & `search_code` (`famidoc-frontend`):
  - `DoctorVisitWorkspace` (`src/features/doctor-encounters/components/doctor-visit-workspace.tsx`, lines 124–858): chỉ có 1 caller duy nhất là `DoctorEncountersView` (`doctor-encounters-view.tsx:L6-15`), gọi 21 callees gồm `DoctorBookVisitView`, `deriveDualLaneState`, `formatEncounterTime`, `formatRemainingRecordDeadline`, `loadVisitDraft`, `saveVisitDraft`, `clearVisitDraft`.
  - 4 caller FE bổ sung gọi `GET /api/v1/encounters/:id`: `DoctorEncounterWrapUpPage` (`wrap-up/page.tsx:L29`), `DoctorReschedulePage` (`doctor/timetable/[id]/reschedule/page.tsx:L35`), `FamilyReschedulePage` (`family/appointments/[id]/reschedule/page.tsx:L35`), `telehealth.api.getEncounterDetail` (`telehealth.api.ts:L396-405`).

**Framework test & quy ước (đã xác nhận qua `package.json` và `search_graph`):**
- Backend (`famidoc-backend`): Jest `^30.0.0`, file test đặt tại `src/modules/<module>/__tests__/*.spec.ts`. Lệnh chạy test (tại `famidoc-backend`): `npm test -- <path>`.
- Frontend (`famidoc-frontend`): Vitest `^5.0.5` + Testing Library, file test đặt tại `src/**/__tests__/*.test.{ts,tsx}`. Lệnh chạy test (tại `famidoc-frontend`): `npm test -- <path>`.

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- `ensureContractDefaultMembers?` khai báo optional trên `EncountersSession` để giữ tương thích 100% với mọi mock test hiện có.
- `getEncounterDetail` phải xử lý an toàn xung đột đồng thời (`P2034` / `P2002` trên `Serializable` transaction): nếu bước self-heal gặp lỗi xung đột đồng thời hoặc không có `ensureContractDefaultMembers`, tuyệt đối không làm lỗi request `GET` của 4 màn hình FE khác (`wrap-up`, `doctor reschedule`, `family reschedule`, `telehealth`).
- Giữ nguyên toàn bộ kiểm tra phân quyền trong `getEncounterDetail` (`FAMILY_REP`, `DOCTOR`, `HEALTHCARE_FACILITY`, `ADMIN`), giữ nguyên các export `loadVisitDraft`, `saveVisitDraft`, `clearVisitDraft` và toàn bộ chức năng nghiệp vụ của `DoctorVisitWorkspace`.

---

### Task 1: Bổ sung `ensureContractDefaultMembers?` (optional, idempotent) vào Repository của module `encounters`

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa:
  - `famidoc-backend/src/modules/encounters/repositories/interfaces/encounters.repository.interface.ts` (`EncountersSession`)
  - `famidoc-backend/src/modules/encounters/repositories/impl/encounters.repository.impl.ts` (`PrismaEncountersSession`)
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/encounters.service.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` (chạy tại `famidoc-backend`)

**Ảnh hưởng liên quan (từ `query_graph` / `search_code`):**
- Được gọi bởi: Task 2 (`EncountersServiceImpl.getEncounterDetail`).
- Gọi tới: `this.tx.patient.findMany`, `this.tx.patient.create`, `this.tx.contractMember.createMany`, `this.tx.contractMember.findMany`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/encounters/__tests__/encounters.controller.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `contractId`, `familyId`, `representativeFullName` từ `encounter.contract` trong `getEncounterDetail`.
- Cung cấp đầu ra cho: Task 2 (`getEncounterDetail` lazy self-heal).

- [ ] **Bước 1 [RED]: Viết unit test kiểm tra `PrismaEncountersSession.ensureContractDefaultMembers` cho 2 trường hợp (hộ đã có `Patient` ACTIVE và hộ chưa có `Patient` nào)**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/encounters.service.spec.ts`
  Test case:
  1. Khi `tx.patient.findMany` trả về 1 `Patient` Chủ hộ đang `ACTIVE` → gọi `tx.contractMember.createMany({ data: [{ contractId, patientId }], skipDuplicates: true })` (KHÔNG gọi `tx.patient.create`) và trả về danh sách từ `tx.contractMember.findMany`.
  2. Khi `tx.patient.findMany` trả về `[]` → tự động tạo 1 `Patient` Chủ hộ mặc định (`relationshipToHead: 'SELF'`, `status: 'ACTIVE'`, `fullName: representativeFullName`), sau đó gọi `tx.contractMember.createMany({ skipDuplicates: true })` và trả về danh sách thành viên vừa gắn.
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` → FAIL với lỗi `ensureContractDefaultMembers` chưa tồn tại trên `PrismaEncountersSession`.

- [ ] **Bước 2 [GREEN]: Export `PrismaEncountersSession`, khai báo `ensureContractDefaultMembers?` (optional) trong `EncountersSession` và cài đặt tối thiểu tại `PrismaEncountersSession`**
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Không cần refactor bổ sung.**

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts src/modules/encounters/__tests__/encounters.controller.spec.ts`
  Kết quả mong đợi: tất cả test PASS.

---

### Task 2: Tích hợp Lazy Self-Heal chống xung đột `P2034` vào `EncountersServiceImpl.getEncounterDetail`

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/services/impl/encounters.service.impl.ts` (`EncountersServiceImpl.getEncounterDetail`, lines 1460–1484)
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/encounters.service.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` (chạy tại `famidoc-backend`)

**Ảnh hưởng liên quan (từ Change Impact Analysis):**
- Được gọi bởi: `EncountersController.getEncounterDetail` (`GET /api/v1/encounters/:id`), đồng thời phục vụ 5 trang FE (`DoctorVisitWorkspace`, `DoctorEncounterWrapUpPage`, `DoctorReschedulePage`, `FamilyReschedulePage`, `telehealth.api.getEncounterDetail`).
- Gọi tới: `session.findEncounter`, `session.ensureContractDefaultMembers`, `enrichEncounterWithScheduleMeta`.
- Regression test cần chạy thêm do có inbound calls: toàn bộ spec trong `src/modules/encounters/__tests__/` và `src/modules/telehealth/__tests__/telehealth-session.service.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `session.ensureContractDefaultMembers?` (Task 1).
- Cung cấp đầu ra cho: Task 3 (`DoctorVisitWorkspace`) và giữ nguyên ổn định cho 4 caller FE còn lại.

- [ ] **Bước 1 [RED]: Viết unit test cho `EncountersServiceImpl.getEncounterDetail` với 4 kịch bản (tự phục hồi khi rỗng, bỏ qua khi đã có, bảo vệ phân quyền, và không làm sập GET khi gặp xung đột `P2034`)**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/encounters.service.spec.ts`
  Test case:
  1. Khi `encounter.contract.members` là `[]` và bác sĩ phụ trách gọi `getEncounterDetail` → gọi `session.ensureContractDefaultMembers(contract.id, contract.familyId, representativeFullName)` và trả về `contract.members` chứa thành viên Chủ hộ vừa phục hồi.
  2. Khi `encounter.contract.members` đã có >= 1 thành viên → KHÔNG gọi `session.ensureContractDefaultMembers`.
  3. Khi bác sĩ không phụ trách gọi `getEncounterDetail` → ném `ForbiddenException` và KHÔNG gọi `session.ensureContractDefaultMembers`.
  4. Khi `session.ensureContractDefaultMembers` ném lỗi Prisma serialization conflict (`code: 'P2034'`) do 2 request `GET` chạy đồng thời → `getEncounterDetail` **KHÔNG** ném lỗi 500 mà vẫn trả về `encounter` an toàn (không làm vỡ `wrap-up`, `reschedule`, `telehealth`).
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` → FAIL vì `getEncounterDetail` chưa có logic gọi `ensureContractDefaultMembers` và chưa bắt an toàn lỗi `P2034`.

- [ ] **Bước 2 [GREEN]: Cập nhật `EncountersServiceImpl.getEncounterDetail` gọi `session.ensureContractDefaultMembers?.(...)` sau bước kiểm tra phân quyền khi `contract.members` rỗng, bọc `try/catch` an toàn cho lỗi `P2034`/`P2002`**
  Kỳ vọng: chạy `npm test -- src/modules/encounters/__tests__/encounters.service.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Không cần refactor bổ sung.**

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/encounters/__tests__/ src/modules/telehealth/__tests__/telehealth-session.service.spec.ts`
  Kết quả mong đợi: tất cả test PASS.

---

### Task 3: Bổ sung fallback `participants` và tái cấu trúc `DoctorVisitWorkspace` sang bố cục 2 cột tối giản

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa: `famidoc-frontend/src/features/doctor-encounters/components/doctor-visit-workspace.tsx` (`DoctorVisitWorkspace`)
- Test tương ứng: `famidoc-frontend/src/features/doctor-encounters/components/__tests__/doctor-visit-workspace.test.tsx`
- Kiểm chứng bằng: `npm test -- src/features/doctor-encounters/components/__tests__/doctor-visit-workspace.test.tsx` (chạy tại `famidoc-frontend`)

**Ảnh hưởng liên quan (từ `trace_path` / `query_graph`):**
- Được gọi bởi: `DoctorEncountersView` (`src/features/doctor-encounters/components/doctor-encounters-view.tsx`).
- Gọi tới: `encountersApi.getEncounterDetail`, `medicalBooksApi.visit`, `medicalBooksApi.confirm`, `patientsApi.addMemberVitalSign`, `patientsApi.addMemberAllergy`, `patientsApi.updateFamilyMember`, `DoctorBookVisitView`, `loadVisitDraft`, `saveVisitDraft`, `clearVisitDraft`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/features/doctor-encounters/components/__tests__/prescription-replacement.test.tsx`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `GET /api/v1/encounters/:id` (Task 2) và `participants` sẵn có.
- Cung cấp đầu ra cho: Không gian làm việc 2 cột tối giản cho bác sĩ (trái ~28% chọn thành viên, phải ~72% mở sẵn 5 ô bắt buộc + gập gọn 2 mục tùy chọn + thẻ tóm tắt chỉ đọc khi đã chốt).

- [ ] **Bước 1 [RED]: Cập nhật và bổ sung unit test cho `DoctorVisitWorkspace` theo bố cục 2 cột tối giản & fallback `participants`**
  Vị trí file test: `famidoc-frontend/src/features/doctor-encounters/components/__tests__/doctor-visit-workspace.test.tsx`
  Test case:
  1. Khi `contract.members` rỗng `[]` nhưng `encounter.participants` có 1 bệnh nhân (Chủ hộ) → cột trái vẫn hiển thị thành viên đó (`Đã chọn: 1 người`) và cột phải mở ngay form 5 ô bắt buộc (không hiển thị `"Chưa có thành viên trong hộ gia đình."`).
  2. Bố cục tối giản mặc định: không còn thanh stepper 4 bước thừa; cột trái hiện `THÀNH VIÊN KHÁM`; cột phải mở sẵn 5 ô bắt buộc (`Lý do khám`, `Triệu chứng & Khám thực thể`, `Mã ICD-10`, `Chẩn đoán`, `Dặn dò / Kế hoạch điều trị`), 2 mục tùy chọn (`Chỉ số sinh tồn & Bệnh nền / Dị ứng mới` và `Kê đơn thuốc điện tử cho lần khám này`) mặc định thu gọn và chỉ bung ra khi bấm mở.
  3. Lưu nháp vào `localStorage`, chốt hồ sơ không đơn thuốc (đồng bộ sinh hiệu + dị ứng sau khi mở mục tùy chọn), chốt hồ sơ kèm đơn thuốc (sau khi mở mục đơn thuốc) đều gửi đúng payload API.
  4. Khi chọn thành viên đã chốt (`isFinalized: true`) → cột phải hiển thị thẻ tóm tắt chỉ đọc gọn gàng kèm link `Xem / Kê đơn thay thế`.
  Kỳ vọng: chạy `npm test -- src/features/doctor-encounters/components/__tests__/doctor-visit-workspace.test.tsx` → FAIL vì `DoctorVisitWorkspace` chưa có fallback `participants`, chưa gập gọn 2 mục tùy chọn, và chưa có thẻ tóm tắt chỉ đọc cho thành viên đã chốt.

- [ ] **Bước 2 [GREEN]: Cài đặt helper `resolveWorkspaceMembers` (giữ nguyên các export `loadVisitDraft`/`saveVisitDraft`/`clearVisitDraft`) và tái cấu trúc JSX của `DoctorVisitWorkspace` theo đúng ASCII Mockup 2 cột tối giản**
  Kỳ vọng: chạy `npm test -- src/features/doctor-encounters/components/__tests__/doctor-visit-workspace.test.tsx` → PASS.

- [ ] **Bước 3 [REFACTOR]: Tách sub-component nội bộ gọn gàng cho phần thẻ tóm tắt thành viên đã chốt trong cùng file `doctor-visit-workspace.tsx` để giữ hàm render chính dễ đọc**
  Kỳ vọng: chạy `npm test -- src/features/doctor-encounters/components/__tests__/doctor-visit-workspace.test.tsx src/features/doctor-encounters/components/__tests__/prescription-replacement.test.tsx` → vẫn PASS.

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `.\node_modules\.bin\tsc --noEmit && npm test -- src/features/doctor-encounters/components/__tests__/doctor-visit-workspace.test.tsx src/features/doctor-encounters/components/__tests__/prescription-replacement.test.tsx src/features/admin-telehealth/components/__tests__/admin-telehealth-view.test.tsx`
  Kết quả mong đợi: 0 lỗi TypeScript và toàn bộ test (kể cả regression test telehealth) PASS.

---

### Task 4: Đồng bộ Playwright E2E & kiểm chứng toàn bộ CI/CD Quality Gates trên cả 2 repo

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa: `famidoc-frontend/e2e/dual-lane-encounter.spec.ts` (cập nhật locator E2E-01 khớp giao diện 2 cột tối giản mới)
- Test tương ứng: toàn bộ test suite của `famidoc-backend`, `famidoc-frontend`, và `famidoc-frontend/e2e/dual-lane-encounter.spec.ts`
- Kiểm chứng bằng: `npm test && npm run build` trên cả 2 repo và `npx playwright test e2e/dual-lane-encounter.spec.ts`

**Ảnh hưởng liên quan (từ Change Impact Analysis):**
- Được gọi bởi: CI/CD Quality Gates của cả `famidoc-backend` và `famidoc-frontend`.
- Gọi tới: Jest, Vitest, Next.js build, NestJS build, Playwright Chromium.
- Regression test cần chạy thêm do có inbound calls: toàn bộ suite của cả 2 repo (bao gồm `admin-telehealth-view.test.tsx`).

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1, Task 2, Task 3.
- Cung cấp đầu ra cho: Xác nhận 100% PASS toàn hệ thống, không ảnh hưởng các luồng nghiệp vụ khác.

- [ ] **Bước 1 [RED]: Kiểm tra `dual-lane-encounter.spec.ts` với bố cục 2 cột tối giản mới (bỏ assertion cũ `1. Chọn thành viên` không còn tồn tại)**
  Vị trí file test: `famidoc-frontend/e2e/dual-lane-encounter.spec.ts`
  Test case: E2E-01 mở `/doctor/encounters?encounterId=...` kiểm tra cột trái `THÀNH VIÊN KHÁM`, tiêu đề `CA KHÁM: ... (HH:mm)` và nhập 5 ô bắt buộc chốt hồ sơ thành công.
  Kỳ vọng: chạy `npm test -- src/features/doctor-encounters/components/__tests__/doctor-visit-workspace.test.tsx` và `npx playwright test e2e/dual-lane-encounter.spec.ts` trước khi cập nhật locator → FAIL ở dòng assert `1. Chọn thành viên`.

- [ ] **Bước 2 [GREEN]: Cập nhật locator E2E-01 trong `famidoc-frontend/e2e/dual-lane-encounter.spec.ts` khớp giao diện 2 cột tối giản**
  Kỳ vọng: chạy `npm test -- src/features/doctor-encounters/components/__tests__/doctor-visit-workspace.test.tsx` và `npx playwright test e2e/dual-lane-encounter.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Không cần refactor bổ sung.**

- [ ] **Bước 4: Xác nhận hoàn tất toàn bộ kế hoạch**
  Cách kiểm tra:
  1. Tại `famidoc-backend`: chạy `npm run lint && npm test -- --forceExit && npm run build`.
  2. Tại `famidoc-frontend`: chạy `npm run lint && npm test && npm run build`.
  Kết quả mong đợi: 100% test & build trên cả 2 repo PASS, 0 lỗi TypeScript.
