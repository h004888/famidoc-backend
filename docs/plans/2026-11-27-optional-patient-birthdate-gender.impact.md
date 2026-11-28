# Báo cáo tác động — Plan "Ngày sinh / giới tính tùy chọn"

Plan: `famidoc-backend/docs/plans/2026-11-27-optional-patient-birthdate-gender.md`
Nguồn dữ liệu: codebase-memory-mcp, project `C-Users-ADMIN-Downloads-famidoc` (index 2026-11-26T08:06Z, status ready) — `search_code`, `query_graph` (CALLS), `trace_path`, `get_code_snippet`; đọc thân hàm bằng `sed` sau khi graph đã định vị.

## 0. Verdict

**⚠️ CÓ TÁC ĐỘNG PHÁT SINH — cần sửa plan trước khi làm.** 3 lỗi chặn (🔴) mà plan chưa bao phủ:

1. `patientAgeMonths(null)` **không trả `null`** — `new Date(null)` = 01/01/1970 là ngày hợp lệ → tuổi ≈ 56 năm. Cơ chế chặn của Task 4 & Task 7 sẽ **không bao giờ kích hoạt**.
2. `PrescriptionsService.createSharedPrescription` dòng 833 `patient.dateOfBirth.toISOString()` → **TypeError / 500** khi ngày sinh null.
3. `ContractsServiceImpl.getCareNeedsSummary` dòng 2639-2641 dùng `new Date()` khi thiếu ngày sinh → tuổi 0 → **người lớn bị xếp `CHILD`** trong tóm tắt nhu cầu chăm sóc.

## 1. Phạm vi dự kiến (theo plan)

| Task | Symbol | Vị trí |
|---|---|---|
| 1 | model `Patient` | `famidoc-backend/prisma/schema.prisma:628-648` + migration mới |
| 2 | `AuthRepositoryImpl.createFamilyRepEntities` / `PrismaEncountersSession.ensureContractDefaultMembers` | `auth/repositories/impl/auth.repository.impl.ts:58-108` / `encounters/repositories/impl/encounters.repository.impl.ts:55-91` |
| 3 | `CreatePatientDto`, `computeProfileCompleteness` (mới), `PatientsServiceImpl` | `patients/dtos/create-patient.dto.ts:21-103` |
| 4 | `PATIENT_PROFILE_INCOMPLETE`, `createSharedPrescription` | `core/constants/error-codes.constant.ts`, `encounters/services/prescriptions.service.ts:732-899` |
| 5 | `PATCH medical-books/visits/:id/patient-profile` | `encounters/controllers/medical-books.controller.ts` |
| 6-7 | `PatientDto`, `BookMember`, `family-members-view.tsx`, `MemberExamWizard` | frontend |

## 2. Tác động trực tiếp (caller của symbol bị sửa)

| Symbol bị sửa | Caller (query_graph CALLS) | Rủi ro |
|---|---|---|
| `createFamilyRepEntities` | `createFamilyRepWithProfile`, `completeFamilyRepRegistration` (cùng file) — luồng đăng ký | 🟡 |
| `PatientsRepositoryImpl.buildPatientCreateData` (`patients.repository.impl.ts:104-122`, dòng 111 `new Date(data.dateOfBirth)`) | `create`, `createWithActiveContractLock`, `createAndAttachToContract` | 🟡 — **plan chưa nêu**: khi DTO optional, `new Date(undefined)` = Invalid Date → Prisma lỗi. Phải đổi thành `data.dateOfBirth ? new Date(...) : null`, `gender ?? null` |
| `PatientsServiceImpl.validateDateOfBirth` | `createPatient` (dòng 153) | 🟡 — phải bỏ qua khi undefined |
| `PatientsRepositoryImpl.update` (dòng 377-378) | — | 🟢 đã xử lý `undefined`; nhưng **không cho phép xóa** ngày sinh về null (chấp nhận được) |
| `createSharedPrescription` | `share`, `prescribeFamily`, `confirmVisitRecord`, `replace` (4 caller) | 🟡 — mọi luồng kê đơn đi qua đây |
| `resolveDoctorVisitMember` (Task 5 tái sử dụng) | `saveVisitDraft`, `confirmVisitRecord` | 🟢 chỉ thêm caller |
| `patientAgeMonths` backend | `createSharedPrescription`, `prescription-safety.spec.ts` | 🔴 xem §3.1 |
| `patientAgeMonths` frontend | `validatePrescriptionStep`, `PrescriptionContextFields`, `submit` (prescription-form) | 🔴 xem §3.1 |
| Prisma type `Patient.dateOfBirth: Date \| null` | ~47 file đọc trường (xem §3) | 🔴 ≥5 vị trí, có route public |

## 3. Tác động PHÁT SINH (ngoài plan)

### 3.1 🔴 `patientAgeMonths` coi `null` là 1970
- `famidoc-backend/src/modules/encounters/prescription-rules.ts:29-47` và `famidoc-frontend/src/lib/prescription-rules.ts:29-47`: `const birth = new Date(dateOfBirth)` — với `null` → epoch, `Number.isFinite` = true → trả ~670 tháng.
- Hệ quả: guard `if (ageMonths === null)` ở `prescriptions.service.ts:768` và chặn ở `validatePrescriptionStep` (Task 7) **không chạy**; quy tắc trẻ < 72 tháng bị bỏ qua (đúng loại lỗi mà plan muốn sửa).
- **Cần thêm vào plan:** `if (dateOfBirth == null || dateOfBirth === '') return null;` ở cả 2 bản + test `patientAgeMonths(null) === null`.

### 3.2 🔴 Crash 500 khi kê đơn
- `prescriptions.service.ts:833` `dateOfBirth: patient.dateOfBirth.toISOString().slice(0, 10)` — sau khi sửa 3.1 thì guard chặn trước, nhưng TypeScript strict sẽ báo lỗi; nên giữ `?.` / non-null assert sau guard.

### 3.3 🔴 Tóm tắt nhu cầu chăm sóc phân nhóm sai
- `contracts/services/impl/contracts.service.impl.ts:2565-2710` `getCareNeedsSummary`: dòng 2639 `dob = rawPatient.dateOfBirth ? new Date(...) : new Date()` → tuổi 0 → `ageGroup = 'CHILD'` (2653-2655); dòng 2695 `gender: rawPatient.gender || 'OTHER'` → lại tạo giá trị giả.
- DTO `contracts/dtos/care-needs-summary.dto.ts:65` `dateOfBirth!: Date`, `:78 gender!: string` → phải nullable, thêm `ageGroup: 'UNKNOWN'` hoặc `age: null`.

### 3.4 🟡 Hiển thị "01/01/1970" ở frontend (`new Date(null)` hợp lệ)
| Vị trí | Hiện trạng với null |
|---|---|
| `famidoc-frontend/src/features/doctor-encounters/components/prescription-context-fields.tsx:135` `date.format(new Date(visit.patient.dateOfBirth))` | hiện 01/01/1970 |
| `famidoc-frontend/src/features/prescriptions/components/medical-book-view.tsx:76` `dateLabel` (dùng ở 575, 671, 1422) | hiện 01/01/1970 (chỉ bắt NaN) |
| `famidoc-frontend/src/features/prescriptions/components/family-prescriptions-view.tsx:24,343` | hiện 01/01/1970 (snapshot cũ vẫn có giá trị — chỉ ảnh hưởng đơn mới) |
| `famidoc-frontend/src/features/chronic-care/components/chronic-care-view.tsx:270-271` | 🟢 đã check truthy |
| `famidoc-frontend/src/features/family-dashboard/components/family-dashboard-view.tsx:40-44` `calculateAge` | trả **45** khi thiếu → tuổi giả trên dashboard |
| `famidoc-frontend/src/features/doctor-families/lib/family-format.ts:40` `ageFrom(value: string)` | `Date.parse(null)` → NaN → null 🟢, nhưng chữ ký cần `string \| null` |
| `formatDate`, `member-profile.util.ts:52 calculateAge`, `doctor-dashboard-view.tsx:132`, `family-members-view.tsx:357 formatBirthDisplay` | 🟢 đã xử lý null |
| `family-members-view.tsx:432` `gender: ... : 'Nam'` | 🟡 null → hiển thị "Nam" (plan Task 6 chỉ sửa chiều ngược `mapGenderLabelToCode`) |
| `doctor-family-detail-view.tsx:172` `GENDER_LABEL[member.gender] ?? '—'` | 🟢 |

### 3.5 🟡 Hợp đồng & tài liệu
- `ContractsServiceImpl.formatStaffingContract` (`contracts.service.impl.ts:2808-2857`, 8 caller: create/update/sign/requestRevision/requestTermination/terminate/list/getStaffingContract) — chỉ truyền tiếp, 🟢 nhưng response type đổi sang nullable.
- `ContractDocumentRendererService.renderHtml` (`contract-document-renderer.service.ts:82-228`, caller `getContractDocument`) — đã fallback `'N/A'` 🟢; cân nhắc đổi thành "Chưa cập nhật".
- `PrismaContractsSession.findActivePatientsByFamilyId` (`contracts.repository.impl.ts:196-215`) — type trả về đổi nullable → kiểm tra nơi nhận.
- `MedicalBooksService.visitDetail` (`medical-books.service.ts:631-841`, dòng 814; caller controller `visitDetail`, `familyPrescriptionVisits`) — trả null ra frontend.
- `doctor-families.service.ts:98` `orderBy: [{ dateOfBirth: 'asc' }]` — Postgres đặt NULL cuối khi ASC 🟢.

### 3.6 🟡 Kiểu frontend chưa liệt kê trong plan
`famidoc-frontend/src/lib/api/doctors.api.ts:245`, `patients.api.ts:93` (kiểu thứ 2 ngoài `PatientDto`), `contracts.api.ts:47,181`, `encounters.api.ts:78`, `telehealth.api.ts:66`, `prescription-rules.ts:69` — cần `string | null` để `tsc` bắt hết các chỗ ở §3.4.

## 4. Mâu thuẫn với plan

| # | Plan nói | Thực tế |
|---|---|---|
| M1 | Task 4/7: "chặn khi `ageMonths === null`" | `patientAgeMonths(null)` không trả null (§3.1) |
| M2 | Task 3 chỉ sửa DTO + util | Repository `buildPatientCreateData` và `validateDateOfBirth` sẽ lỗi khi trường vắng |
| M3 | Task 1 migration xóa dữ liệu giả `1990-01-01 + OTHER` | `getCareNeedsSummary` dòng 2695 vẫn tự gắn `'OTHER'` → giá trị giả tái xuất hiện ở tầng response |
| M4 | Task 4: chỉ thay 1 BadRequestException | `createSharedPrescription` còn nhiều `BadRequestException('...')` chuỗi trần (vd. dòng 775) — vi phạm AGENTS.md nhưng **ngoài phạm vi**, chỉ nêu |

## 5. Test liên quan (sẽ phải cập nhật fixture/kỳ vọng)

Backend: `contracts/__tests__/contract-care-summary-and-document.spec.ts`, `contract-renewal.service.spec.ts`, `medical-contracts-query.spec.ts`, `package-upgrade-video-quota.spec.ts`; `encounters/services/__tests__/prescription-form-fields.spec.ts`, `prescription-safety.spec.ts`; `encounters/__tests__/medical-books-visit-vitals.spec.ts`, `prescriptions-multi-member.spec.ts`, `visit-record-integrity.spec.ts`; `patients/__tests__/create-patient.dto.spec.ts` (kỳ vọng "bắt buộc" sẽ đảo ngược), `patients.controller.spec.ts`, `patients.repository.impl.spec.ts`, `patients.service.spec.ts`; `users/__tests__/users.controller.spec.ts`.

Frontend: `doctor-dashboard/.../doctor-view.test.tsx`; `doctor-encounters/.../doctor-visit-workspace.test.tsx`, `family-prescription-panel.test.tsx`, `member-exam-wizard.test.tsx`, `prescription-replacement.test.tsx`, `prescription-safety.test.tsx`; `family-dashboard/.../family-dashboard-view.test.tsx`, `family-member-care-responsive.test.tsx`, `family-today-visit-card.test.tsx`, `family-typography.test.tsx`; `family-members/.../family-members-api.test.tsx`; `prescriptions/.../health-timeline-tab.test.tsx`, `prescriptions-flow.test.tsx`; `lib/api/__tests__/api-clients.test.ts`.

**Test mới cần thêm:** `patientAgeMonths(null)` (cả 2 phía); `getCareNeedsSummary` với ngày sinh null; `buildPatientCreateData` không có dateOfBirth/gender; `dateLabel(null)` hiển thị "Chưa cập nhật".

## 6. Phạm vi truy vấn
- `search_code` regex `\.(dateOfBirth|gender)\b` trong `famidoc-backend/src` → 10 symbol, 20 match.
- `query_graph` CALLS cho 12 hàm (createSharedPrescription, getCareNeedsSummary, formatStaffingContract, renderHtml, findActivePatientsByFamilyId, buildPatientCreateData, createFamilyRepEntities, visitDetail, createPatient, patientAgeMonths, validateDateOfBirth, resolveDoctorVisitMember) → 28 cạnh.
- Frontend: grep văn bản `dateOfBirth|.gender` (graph không theo dõi truy cập thuộc tính).

## 7. Giới hạn
- Index lúc 2026-11-26; 52 file parse một phần, 119 file không index (chủ yếu ngoài `src`).
- Graph không nối Prisma type → mọi nơi đọc `patient.dateOfBirth` qua `any` (vd. `contracts.service.impl.ts` dùng `m: any`) **sẽ không được `tsc` bắt** — phải soát thủ công các vị trí ở §3.
- JSON snapshot đã lưu (`recordSnapshot` trong medical-books/prescriptions) giữ giá trị cũ; dữ liệu giả `1990-01-01` trong snapshot cũ sẽ **không** được migration làm sạch.

## 8. Khuyến nghị bổ sung vào plan
1. **Task 0 mới (làm trước):** sửa `patientAgeMonths` hai phía trả null khi đầu vào null/rỗng + test.
2. Task 3: thêm sửa `buildPatientCreateData` (null-safe) và `validateDateOfBirth` (bỏ qua khi vắng).
3. Task mới: `getCareNeedsSummary` + `CareNeedsSummary` DTO nullable, `ageGroup` cho trường hợp không rõ, bỏ `|| 'OTHER'`.
4. Task 6: sửa `family-members-view.tsx:432` (null → "Chưa cập nhật"), `family-dashboard-view.tsx:40` (bỏ mặc định 45), `medical-book-view.tsx:76` & `family-prescriptions-view.tsx:24` & `prescription-context-fields.tsx:135` (null → "Chưa cập nhật"); đổi các kiểu ở §3.6 sang nullable.
5. Ghi nhận: snapshot đơn thuốc cũ không được làm sạch — quyết định có cần không.
