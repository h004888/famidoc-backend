# Dòng thời gian EHR dài hạn (Health Timeline MVP) — Kế hoạch triển khai

> **Phiên bản 2 (2026-11-26)** — cập nhật theo báo cáo tác động `famidoc-backend/docs/plans/2026-11-26-ehr-health-timeline-impact-report.md`. Các thay đổi so với bản 1 được tóm tắt ở mục "Thay đổi so với bản 1" ngay dưới đây.

**Mục tiêu:** Thêm tab "Dòng thời gian" trong sổ khám của từng thành viên, hiển thị theo thứ tự thời gian (mới nhất trước) các lượt khám, đơn thuốc và tài liệu, kèm phân trang cursor và phân quyền đúng các quyết định đã chốt, không làm thay đổi hành vi các luồng hiện có.

**Cách tiếp cận:** Backend thêm hàm thuần `timeline.util.ts` (cursor + gộp/sắp xếp sự kiện + điều kiện keyset Prisma), một method mới `MedicalBooksService.patientTimeline` dùng lại các helper phân quyền sẵn có (`documentScope`, `visitScope`, `doctorVisitScope`) mà KHÔNG sửa thân các helper đó, và route `GET /api/v1/medical-books/families/:familyId/patients/:patientId/timeline`. Frontend thêm `medicalBooksApi.timeline`, hàm dùng chung `downloadBookDocument`, component `HealthTimeline` (bố cục giống ảnh mẫu) và tab thứ ba trong `MemberBook`; chi tiết lượt khám mở ngay trong tab timeline bằng `VisitPage` sẵn có. Không thêm bảng/migration, không tạo service Nest mới.

## Thay đổi so với bản 1 (từ phân tích tác động)

| # | Phát hiện trong báo cáo | Cách xử lý trong bản 2 |
|---|---|---|
| 1 🔴 | Truy vấn đơn thuốc dùng quan hệ `emr` — schema Prisma đặt tên quan hệ là `clinicalEmr` (field `emrId`) → không biên dịch | Task 3 đổi toàn bộ `emr` thành `clinicalEmr`; test Task 3 assert đúng khóa `clinicalEmr` |
| 2 🔴 | Bác sĩ bấm "Xem chi tiết" lượt khám của bác sĩ khác → `visitDetail` trả 404 vì `visitScope` của bác sĩ = `doctorVisitScope` (chỉ lượt của chính mình) | Không nới `visitScope` (đang dùng cho ghi/xác nhận lượt khám). Thêm trường `canOpenDetail` vào sự kiện; bác sĩ chỉ có nút "Xem chi tiết" với lượt khám/đơn của chính mình (quyết định D4) |
| 3 🟡 | `VisitPages` giữ `page`/`visitId` là state nội bộ → `MemberBook` không thể mở một lượt khám bất kỳ | Task 8 mở chi tiết ngay trong tab timeline bằng `VisitPage` (đã đọc chữ ký: `{ id, patientId?, doctor, onConfirmed?, setPending? }`), giữ `HealthTimeline` mounted (thuộc tính `hidden`) để quay lại không mất trang đã tải |
| 4 🟡 | Bác sĩ đã hết hợp đồng: tab "Lần khám" vẫn có dữ liệu (`rosterScope`), tab timeline 404 (`documentScope`) | Giữ chặn bằng `documentScope` (khớp quyết định 1 "bác sĩ có hợp đồng ACTIVE"); frontend hiện thông báo lỗi từ server qua `prescriptionErrorMessage` (quyết định D5) |
| 5 🟡 | Tách `download` của `MemberDocuments` cần cả `documentName`, và state đang tải/lỗi không được dùng chung | Task 6 mới: file riêng `download-book-document.ts` với `downloadBookDocument(familyId, patientId, id, documentName)` ném lỗi ra ngoài; mỗi component tự giữ state. Đặt file riêng để tránh vòng import `medical-book-view.tsx` ↔ `health-timeline.tsx` |
| 6 🟡 | `patientVisits` sắp được refactor nhưng chưa có test backend | Task 2 thêm test chốt hành vi (characterization) cho `patientVisits` TRƯỚC bước refactor |
| 7 🟢 | `patient_documents` chưa có index cho sắp xếp `recordedDate desc, id desc` | Ghi vào "Ngoài phạm vi MVP"; dữ liệu theo một bệnh nhân nhỏ |

**Quyết định nghiệp vụ đã chốt:**
1. (Người dùng: "1.có") Bác sĩ đang có hợp đồng ACTIVE với gia đình xem được toàn bộ tiền sử của thành viên trong hợp đồng, kể cả lượt khám do bác sĩ khác ghi.
2. (Người dùng: "2.không") Gia đình KHÔNG thấy lượt khám chưa chốt bệnh án (giữ nguyên `visitScope` cho FAMILY_REP).
3. (Người dùng: "3.có") Tài liệu gia đình tự tải lên hiển thị trên timeline, gắn nhãn "Gia đình tự thêm".
4. **D4 (mặc định đề xuất, người dùng chưa trả lời — đổi được trước khi chạy Task 3):** MVP chỉ hiện nút "Xem chi tiết" cho bác sĩ với lượt khám/đơn thuốc mà bác sĩ đó phụ trách (`encounter.doctor.userId === actor.id`); lượt khám của bác sĩ khác chỉ hiện tóm tắt (loại khám, chẩn đoán, tên bác sĩ, ngày). Gia đình luôn có nút "Xem chi tiết" vì timeline của gia đình dùng chính `visitScope` mà `visitDetail` dùng. Phương án thay thế (nhánh chỉ-đọc trong `visitDetail`) để sau MVP.
5. **D5 (mặc định đề xuất, người dùng chưa trả lời):** Bác sĩ đã hết hợp đồng vẫn thấy tab "Dòng thời gian"; khi API trả 404, tab hiện thông báo từ server `'Không tìm thấy sổ khám của thành viên này.'` (giống hành vi tab "Tài liệu" hiện nay). Không ẩn tab vì frontend không có sẵn trạng thái hợp đồng ở `MemberBook`.

**Giả định (nêu rõ, cần người dùng phản đối nếu sai):**
- A1. Với bác sĩ: lượt khám của chính bác sĩ đó hiển thị theo `doctorVisitScope` hiện có (kể cả chưa chốt); lượt khám của bác sĩ KHÁC chỉ hiển thị khi bệnh án của thành viên đó đã chốt (`isFinalized = true`).
- A2. Bảng `patient_documents` không có cột người tải lên → MVP gán mọi tài liệu `source = 'FAMILY_UPLOAD'`, nhãn "Gia đình tự thêm" (upload chỉ qua route `@Roles('FAMILY_REP')` của medical-books và `@Roles('FAMILY_REP','ADMIN')` POST `':id/documents'` ở `famidoc-backend/src/modules/patients/controllers/patients.controller.ts:155`).
- A3. Đơn thuốc: gia đình chỉ thấy đơn có `recipientUserId = actor.id` (đồng nhất `visitDetail`); bác sĩ thấy đơn `ISSUED | EXPIRED` (ẩn `CANCELLED`) của các lượt khám trong phạm vi A1.
- A4. `occurredAt`: lượt khám = `scheduledDate` + `scheduledTime`; đơn thuốc = `createdAt`; tài liệu = `recordedDate` lúc 00:00 UTC.

**Đã tra cứu codebase (codebase-memory-mcp + đọc thân hàm):**
- `search_graph`/`get_code_snippet` (project `C-Users-ADMIN-Downloads-famidoc`): frontend sổ khám ở `famidoc-frontend/src/features/prescriptions/components/medical-book-view.tsx` — `MedicalBookView` 195, `FamilyBook` 424, `MemberBook` 633-748, `MemberDocuments` 750 (hàm `download(record: BookDocument)` 770-800 dùng `setDownloading`/`setDownloadError`, `medicalBooksApi.downloadDocument(familyId, patientId, record.id)`, đuôi `.pdf`/`.png`/`.jpg` theo `blob.type`, `link.download = record.documentName.endsWith(extension) ? record.documentName : record.documentName + extension`, `window.setTimeout(() => URL.revokeObjectURL(url), 1000)`, lỗi qua `prescriptionErrorMessage(error, 'Chưa tải được tệp. Vui lòng thử lại.')`), `VisitPages` 886-979 (state nội bộ `page`, `visitId`; render `<VisitPage key={visit.id} id patientId doctor onConfirmed={query.reload} setPending/>`), `VisitPage` 1001 (props `{ id: string; patientId?: string; doctor: boolean; onConfirmed?: () => void; setPending?: (value: boolean) => void }`, gọi `medicalBooksApi.visit(id, signal, activePatientId)`), `ReadVisit` 1153.
- `MemberBook` (đọc qua `get_code_snippet`): `const [tab, setTab] = useState<'visits' | 'documents'>('visits')`; nút `(['visits', 'documents'] as const).map(...)` trong `role="group" aria-label="Nội dung sổ khám"`, nhãn `key === 'visits' ? 'Lần khám' : 'Tài liệu'`, `aria-pressed={tab === key}`, `disabled={pending}`; render `tab === 'documents' ? <MemberDocuments familyId patientId={member.id} doctor setPending/> : <VisitPages familyId patientId={member.id} doctor pending setPending/>`.
- `prescriptionErrorMessage(error, fallback)` ở `famidoc-frontend/src/lib/api/prescriptions.api.ts:92-97`: trả message server khi `error instanceof ApiError && error.status < 500 && error.details`, ngược lại trả `fallback`.
- API `famidoc-frontend/src/lib/api/medical-books.api.ts` — `visits` 136-149, `documents` 150-158, `downloadDocument` 193.
- `famidoc-backend/src/modules/encounters/services/medical-books.service.ts`: `PAGE_SIZE = 12`, `documentSelect`, `visitSelect`; `assignedContract` L40 (`{ contractStatus: 'ACTIVE', doctor: activePrescribingDoctor(actor.id) }`), `rosterScope` L49, `familyScope` L72, `visitScope` L86, `documentScope` L104, `patientVisits` 235-297 (where `AND: [visitScope(actor), { contract: { familyId }, OR: [ { participants: { some: { patientId } } }, { clinicalEmrs: { some: { patientId } } } ] }]`, `orderBy scheduledDate desc, scheduledTime desc, id desc`, `skip (page-1)*PAGE_SIZE`, `take PAGE_SIZE + 1`), `patientDocuments` 299 (audit `READ_PATIENT_DOCUMENTS`), `visitDetail` 405 (`where: { id, ...visitScope(actor) }`).
- `famidoc-backend/src/modules/encounters/services/prescriptions.service.ts`: `activePrescribingDoctor(userId)` 174 trả `{ userId, onboardingStatus: 'ACTIVE', facility: { verificationStatus: 'ACTIVE' } }` (xác nhận `Doctor` có trường `userId`); `doctorVisitScope(userId, now)` 184 trả `{ doctor: activePrescribingDoctor(userId), OR: [ { encounterStatus: { in: [...] } }, ... ] }`.
- `trace_path` inbound: `visitScope` ← `familyPrescriptionVisits`, `patientVisits`, `visitDetail`; `doctorVisitScope` có 20 caller (hop ≤ 2) trong `PrescriptionsService` và `MedicalBooksService`; `documentScope` ← `patientDocuments`, `uploadDocument`, `downloadDocument`; `MemberBook` ← `FamilyBook` ← `MedicalBookView`. Kế hoạch KHÔNG sửa thân các hàm này.
- `writeBusinessAudit` (`famidoc-backend/src/core/business/business-helpers.ts:67`) nhận `action: string` → không cần migration enum.
- Prisma schema: `Prescription` có quan hệ `clinicalEmr` (field `emrId`), index `[recipientUserId, createdAt desc]`, enum `PrescriptionStatus` `ISSUED|EXPIRED|CANCELLED`; `PatientDocument` (id, patientId, documentName, documentType, fileUrl, mimeType, notes, fileSizeKb, recordedDate, uploadedAt; không có `@@index`); `ClinicalEmr` (encounterId, patientId, icd10Diagnosis, isFinalized); `Encounter` (contractId, doctorId, encounterType `HOME_VISIT|TELEHEALTH|FACILITY_VISIT`, scheduledDate, scheduledTime; index `idx_encounters_contract_timeline`).
- Test frontend hiện có `famidoc-frontend/src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx` (~L280) bấm ngày `/09\/11\/2026/` → kỳ vọng `medicalBooksApi.visit('older-visit', signal, 'child-5')`, bấm nút `'Tài liệu'`, kỳ vọng link `/Mở tài liệu Tài liệu mẫu/` — phải giữ PASS.

**Framework test & quy ước (đã xác nhận):**
- Backend: Jest 30 + ts-jest, `famidoc-backend/jest.config.ts` `testMatch: ['<rootDir>/src/**/__tests__/**/*.spec.ts']`. Mẫu: `famidoc-backend/src/modules/encounters/__tests__/medical-books-visit-vitals.spec.ts` (mock `prisma` bằng object `jest.fn()`, `new MedicalBooksService(prisma, storage)`, actor `{ id, role, familyUnitId } as any`).
- Lệnh backend (chạy trong `famidoc-backend/`): `npm test -- <tên-file-spec>`.
- Frontend: Vitest (`famidoc-frontend/vitest.config.ts`, jsdom, `include: ['src/**/__tests__/**/*.test.{ts,tsx}']`), @testing-library; mock bằng `vi.mock('@/lib/api/medical-books.api', ...)` và `vi.mock('@/lib/api/http-client', ...)` như `prescriptions-flow.test.tsx`.
- Lệnh frontend (chạy trong `famidoc-frontend/`): `npm test -- <đường-dẫn-test>`.

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Không thêm migration, bảng, thư viện mới.
- KHÔNG sửa thân `visitScope`, `doctorVisitScope`, `documentScope`, `familyScope`, `rosterScope`, `assignedContract`, `visitDetail` (đang phục vụ kê đơn, chia sẻ đơn, ghi/xác nhận lượt khám, tải tài liệu).
- Không thay đổi hành vi các route hiện có (`/visits`, `/documents`, `/visits/:id`) — test hiện có và test chốt hành vi mới (Task 2) phải vẫn PASS.
- Mặc định tab của `MemberBook` vẫn là `'visits'`.
- Mọi lần đọc timeline phải ghi audit `READ_PATIENT_TIMELINE` qua `writeBusinessAudit`.
- Thông báo lỗi người dùng bằng tiếng Việt có dấu.
- `limit` mặc định 20, tối đa 50.

---

### Task 1: Hàm thuần cho timeline (cursor, keyset, gộp sự kiện)

**Đối tượng liên quan (đã xác nhận):**
- Tạo mới: `famidoc-backend/src/modules/encounters/services/timeline.util.ts`
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.util.spec.ts`
- Kiểm chứng bằng: `npm test -- health-timeline.util.spec.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: chưa có (file mới) — Task 3 sẽ dùng.
- Gọi tới: `BadRequestException` từ `@nestjs/common`.
- Regression test cần chạy thêm do có inbound calls: không cần.

**Giao diện/Kết nối với các task khác:**
- Cung cấp cho Task 3: kiểu `TimelineEvent`, `TimelineCursor`, các hàm `encodeTimelineCursor`, `decodeTimelineCursor`, `mergeTimelineEvents`, `encounterKeyset`, `dateKeyset`, `dateTimeKeyset`.

Định nghĩa kiểu sẽ tạo (bản 2 thêm `canOpenDetail`):
```ts
export type TimelineEventType = 'VISIT' | 'PRESCRIPTION' | 'DOCUMENT';
export interface TimelineAttachment { id: string; name: string; downloadAvailable: boolean; isImage: boolean }
export interface TimelineEvent {
  id: string; type: TimelineEventType; occurredAt: Date;
  title: string; summary: string | null; actorName: string | null;
  source: 'CLINICAL' | 'FAMILY_UPLOAD';
  link: { encounterId?: string; documentId?: string };
  canOpenDetail: boolean;
  attachments: TimelineAttachment[];
}
export interface TimelineCursor { occurredAt: Date; id: string }
```

- [ ] **Bước 1 [RED]: Viết test cho cursor encode/decode**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.util.spec.ts`
  Test case:
  - `decodeTimelineCursor(encodeTimelineCursor({ occurredAt: new Date('2026-11-20T08:30:00.000Z'), id: 'a1' }))` trả về đúng object ban đầu (so sánh `occurredAt.toISOString()` và `id`).
  - `decodeTimelineCursor(undefined)` trả về `null`.
  - `decodeTimelineCursor('khong-hop-le')`, chuỗi base64url của `{"occurredAt":"abc","id":"x"}` và của `{"occurredAt":"2026-11-20T08:30:00.000Z"}` (thiếu id) đều ném `BadRequestException` với message `'Con trỏ phân trang không hợp lệ.'`.
  Kỳ vọng: chạy `npm test -- health-timeline.util.spec.ts` → FAIL vì module `../services/timeline.util` chưa tồn tại (Cannot find module), không phải lỗi cú pháp trong test.
- [ ] **Bước 2 [GREEN]: Viết `encodeTimelineCursor` / `decodeTimelineCursor` trong `timeline.util.ts`**
  Cách làm: JSON `{ occurredAt: ISO, id }` → `Buffer.from(json).toString('base64url')`; decode bằng try/catch, kiểm `typeof id === 'string' && id.length > 0` và `!Number.isNaN(date.getTime())`, sai thì `throw new BadRequestException('Con trỏ phân trang không hợp lệ.')`.
  Kỳ vọng: chạy `npm test -- health-timeline.util.spec.ts` → PASS.
- [ ] **Bước 3 [RED]: Viết test cho `mergeTimelineEvents(groups, limit)`**
  Test case:
  - Đầu vào 3 mảng (VISIT 2026-11-20T08:30Z id `v1`; PRESCRIPTION 2026-11-21T02:00Z id `p1`; DOCUMENT 2026-11-19T00:00Z id `d1`; DOCUMENT cùng thời điểm `2026-11-20T08:30Z` id `d9`), `limit = 3` → `items` theo thứ tự id `['p1','d9','v1']` (giảm dần theo `occurredAt`, hòa thì `id` giảm dần), `nextCursor` = encode của `{ occurredAt: 2026-11-20T08:30Z, id: 'v1' }`.
  - Cùng đầu vào, `limit = 10` → 4 phần tử, `nextCursor === null`.
  - Đầu vào toàn mảng rỗng → `{ items: [], nextCursor: null }`.
  Kỳ vọng: chạy `npm test -- health-timeline.util.spec.ts` → FAIL vì `mergeTimelineEvents` chưa được export.
- [ ] **Bước 4 [GREEN]: Viết `mergeTimelineEvents` trong `timeline.util.ts`**
  Cách làm: `groups.flat()`, sort theo `b.occurredAt - a.occurredAt` rồi `b.id.localeCompare(a.id)`, lấy `slice(0, limit)`; `nextCursor` = encode phần tử cuối nếu tổng > limit, ngược lại `null`.
  Kỳ vọng: chạy `npm test -- health-timeline.util.spec.ts` → PASS.
- [ ] **Bước 5 [RED]: Viết test cho các builder keyset Prisma**
  Test case (cursor `{ occurredAt: new Date('2026-11-20T08:30:00.000Z'), id: 'v1' }`):
  - `encounterKeyset(null)` → `{}`.
  - `encounterKeyset(cursor)` → `{ OR: [ { scheduledDate: { lt: new Date('2026-11-20T00:00:00.000Z') } }, { scheduledDate: new Date('2026-11-20T00:00:00.000Z'), scheduledTime: { lt: new Date('1970-01-01T08:30:00.000Z') } }, { scheduledDate: new Date('2026-11-20T00:00:00.000Z'), scheduledTime: new Date('1970-01-01T08:30:00.000Z'), id: { lt: 'v1' } } ] }`.
  - `dateKeyset('recordedDate', cursor)` → `{ OR: [ { recordedDate: { lt: day } }, { recordedDate: day } ] }` với `day = new Date('2026-11-20T00:00:00.000Z')`.
  - `dateKeyset('recordedDate', { occurredAt: new Date('2026-11-20T00:00:00.000Z'), id: 'd5' })` → `{ OR: [ { recordedDate: { lt: day } }, { recordedDate: day, id: { lt: 'd5' } } ] }`.
  - `dateTimeKeyset('createdAt', cursor)` → `{ OR: [ { createdAt: { lt: cursor.occurredAt } }, { createdAt: cursor.occurredAt, id: { lt: 'v1' } } ] }`.
  - `dateKeyset` và `dateTimeKeyset` với `null` → `{}`.
  Kỳ vọng: chạy `npm test -- health-timeline.util.spec.ts` → FAIL vì các hàm keyset chưa tồn tại.
- [ ] **Bước 6 [GREEN]: Viết `encounterKeyset`, `dateKeyset`, `dateTimeKeyset`**
  Cách làm: `day = new Date(iso.slice(0,10)+'T00:00:00.000Z')`, `time = new Date('1970-01-01T'+iso.slice(11))`. Riêng `dateKeyset`: nếu `cursor.occurredAt` đúng 00:00 UTC thì nhánh thứ hai là `{ recordedDate: day, id: { lt: id } }`; nếu sau 00:00 thì `{ recordedDate: day }`.
  Kỳ vọng: chạy `npm test -- health-timeline.util.spec.ts` → PASS.
- [ ] **Bước 7 [REFACTOR]: Gom việc tách `day`/`time` vào hàm nội bộ `splitDateTime(date)` dùng chung cho 3 builder**
  Kỳ vọng: chạy `npm test -- health-timeline.util.spec.ts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 8: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- health-timeline.util.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 2: Phạm vi lượt khám cho timeline theo vai trò (+ chốt hành vi `patientVisits`)

**Đối tượng liên quan (đã xác nhận):**
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/services/medical-books.service.ts` — thêm `export function timelineVisitScope(actor: AuthenticatedUser, familyId: string, patientId: string): Prisma.EncounterWhereInput` ngay sau `visitScope` (L86); refactor `patientVisits` (235-297) dùng hàm mới `patientEncounterFilter(familyId, patientId)`.
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/health-timeline-scope.spec.ts` (mới) và `famidoc-backend/src/modules/encounters/__tests__/medical-books-patient-visits.spec.ts` (mới — test chốt hành vi).
- Kiểm chứng bằng: `npm test -- health-timeline-scope.spec.ts medical-books-patient-visits.spec.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: `timelineVisitScope` chưa có caller (Task 3 dùng). `patientVisits` ← controller route `families/:familyId/patients/:patientId/visits` ← frontend `VisitPages` (tab "Lần khám").
- Gọi tới: `visitScope` (private), `doctorVisitScope` (`prescriptions.service.ts:184`) — chỉ gọi, không sửa.
- Regression test cần chạy thêm: `npm test -- medical-books-visit-vitals.spec.ts prescriptions-multi-member.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Cung cấp cho Task 3: điều kiện `where` cho truy vấn encounter và prescription.

- [ ] **Bước 1: Viết test chốt hành vi hiện tại của `patientVisits` (characterization, chưa sửa code)**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/medical-books-patient-visits.spec.ts`
  Harness: `prisma = { familyUnit: { findFirst }, patient: { findFirst }, encounter: { findMany } , auditLog: { create } }` theo đúng các bảng mà `patientVisits` gọi (đọc thân `patientVisits` bằng `get_code_snippet` trước khi viết harness), `new MedicalBooksService(prisma, {} as any)`.
  Test case:
  - FAMILY_REP `{ id: 'rep-1', role: 'FAMILY_REP' }`, `page = 2` → `encounter.findMany.mock.calls[0][0]` có `where.AND[1]` bằng `{ contract: { familyId: 'fam-1' }, OR: [ { participants: { some: { patientId: 'pat-1' } } }, { clinicalEmrs: { some: { patientId: 'pat-1' } } } ] }`, `skip: 12`, `take: 13`, `orderBy` `[ { scheduledDate: 'desc' }, { scheduledTime: 'desc' }, { id: 'desc' } ]`.
  - `encounter.findMany` trả 13 phần tử → kết quả `hasNextPage === true` và `items.length === 12`.
  - Guard bệnh nhân trả `null` → reject `NotFoundException`, `encounter.findMany` không được gọi.
  Kỳ vọng: chạy `npm test -- medical-books-patient-visits.spec.ts` → PASS ngay (ghi lại hành vi hiện tại làm lưới an toàn cho Bước 4). Nếu FAIL thì sửa test cho khớp code hiện tại, KHÔNG sửa code.
- [ ] **Bước 2 [RED]: Viết test cho `timelineVisitScope`**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/health-timeline-scope.spec.ts`
  Test case:
  - FAMILY_REP (`{ id: 'rep-1', role: 'FAMILY_REP' }`), familyId `fam-1`, patientId `pat-1` → `AND[0]` chứa `expect.objectContaining({ clinicalEmrs: { some: expect.objectContaining({ isFinalized: true }) } })` (từ `visitScope`), `AND[1]` bằng object `patientEncounterFilter` như Bước 1. Không có nhánh nào cho phép lượt khám chưa chốt (quyết định 2).
  - DOCTOR (`{ id: 'doc-user-1', role: 'DOCTOR' }`) → `AND[0].OR` có 2 nhánh: nhánh 1 `toMatchObject({ doctor: expect.objectContaining({ userId: 'doc-user-1' }) })`; nhánh 2 bằng `{ clinicalEmrs: { some: { patientId: 'pat-1', isFinalized: true } } }`; `AND[1]` như trên.
  Kỳ vọng: chạy `npm test -- health-timeline-scope.spec.ts` → FAIL vì `timelineVisitScope` chưa được export từ `../services/medical-books.service`.
- [ ] **Bước 3 [GREEN]: Viết `timelineVisitScope`**
  ```ts
  const patientFilter = { contract: { familyId }, OR: [ { participants: { some: { patientId } } }, { clinicalEmrs: { some: { patientId } } } ] };
  const roleFilter = actor.role === 'DOCTOR'
    ? { OR: [ doctorVisitScope(actor.id), { clinicalEmrs: { some: { patientId, isFinalized: true } } } ] }
    : visitScope(actor);
  return { AND: [roleFilter, patientFilter] };
  ```
  Quyền "hợp đồng ACTIVE" của bác sĩ chặn ở Task 3 bằng `documentScope`.
  Kỳ vọng: chạy `npm test -- health-timeline-scope.spec.ts` → PASS.
- [ ] **Bước 4 [REFACTOR]: Tách `function patientEncounterFilter(familyId: string, patientId: string): Prisma.EncounterWhereInput` dùng chung cho `patientVisits` và `timelineVisitScope`**
  Kỳ vọng: chạy `npm test -- health-timeline-scope.spec.ts medical-books-patient-visits.spec.ts medical-books-visit-vitals.spec.ts` → vẫn PASS, hành vi không đổi (test chốt hành vi Bước 1 bảo vệ `patientVisits`).
- [ ] **Bước 5: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- health-timeline-scope.spec.ts medical-books-patient-visits.spec.ts medical-books-visit-vitals.spec.ts prescriptions-multi-member.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 3: Method `MedicalBooksService.patientTimeline`

**Đối tượng liên quan (đã xác nhận):**
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/services/medical-books.service.ts` — thêm `async patientTimeline(actor: AuthenticatedUser, familyId: string, patientId: string, query: { cursor?: string; limit: number })` sau `patientDocuments` (L299).
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.service.spec.ts`
- Kiểm chứng bằng: `npm test -- health-timeline.service.spec.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: chưa có — Task 4.
- Gọi tới: `documentScope`, `timelineVisitScope` (Task 2), `documentInfo`, `writeBusinessAudit`, hàm Task 1; Prisma `patient.findFirst`, `encounter.findMany`, `prescription.findMany`, `patientDocument.findMany`.
- Regression test cần chạy thêm: `npm test -- medical-books-visit-vitals.spec.ts medical-books-patient-visits.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận từ Task 1, Task 2.
- Cung cấp cho Task 4: `{ items: TimelineEventDto[]; nextCursor: string | null }`, `occurredAt` là chuỗi ISO.

Truy vấn sẽ viết (mỗi nguồn `take: limit + 1`, đã áp keyset). **Bản 2: quan hệ đơn thuốc là `clinicalEmr`, thêm `doctor.userId` để tính `canOpenDetail`:**
- `patient.findFirst({ where: documentScope(actor, familyId, patientId), select: { id: true } })` → null thì `NotFoundException('Không tìm thấy sổ khám của thành viên này.')` (đây cũng là thông báo bác sĩ hết hợp đồng thấy — D5).
- `encounter.findMany({ where: { AND: [timelineVisitScope(...), encounterKeyset(cursor)] }, select: { id: true, encounterType: true, scheduledDate: true, scheduledTime: true, doctor: { select: { doctorName: true, userId: true } }, clinicalEmrs: { where: { patientId }, select: { isFinalized: true, icd10Diagnosis: true }, take: 1 } }, orderBy: [{ scheduledDate: 'desc' }, { scheduledTime: 'desc' }, { id: 'desc' }], take: limit + 1 })` → event `VISIT`, title theo `encounterType` (`TELEHEALTH` → `'Khám trực tuyến'`, `HOME_VISIT` → `'Khám tại nhà'`, `FACILITY_VISIT` → `'Khám tại cơ sở'`), summary = `icd10Diagnosis` nếu `isFinalized` ngược lại `null`, actorName = `doctor.doctorName`, source `CLINICAL`, link `{ encounterId }`, `canOpenDetail = actor.role !== 'DOCTOR' || doctor.userId === actor.id` (D4).
- `prescription.findMany({ where: { AND: [ { clinicalEmr: { patientId, encounter: timelineVisitScope(...) } }, actor.role === 'DOCTOR' ? { status: { in: ['ISSUED', 'EXPIRED'] } } : { recipientUserId: actor.id }, dateTimeKeyset('createdAt', cursor) ] }, select: { id: true, prescriptionCode: true, createdAt: true, clinicalEmr: { select: { encounterId: true, encounter: { select: { doctor: { select: { doctorName: true, userId: true } } } } } } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 })` → event `PRESCRIPTION`, title `'Đơn thuốc'`, summary `` `Mã đơn ${prescriptionCode}` ``, actorName = tên bác sĩ, link `{ encounterId }`, `canOpenDetail` cùng công thức với VISIT.
- `patientDocument.findMany({ where: { patientId, ...dateKeyset('recordedDate', cursor) }, select: documentSelect, orderBy: [{ recordedDate: 'desc' }, { id: 'desc' }], take: limit + 1 })` → event `DOCUMENT`, title = `documentName`, source `FAMILY_UPLOAD`, actorName `null`, `canOpenDetail: false`, attachments `[{ id, name: documentName, downloadAvailable: documentInfo(patientId, record).downloadAvailable, isImage: /\.(png|jpe?g)$/i.test(fileUrl ?? '') }]`, link `{ documentId }`.

- [ ] **Bước 1 [RED]: Viết test chặn ngoài phạm vi và gọi đúng scope**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.service.spec.ts`
  Harness: `prisma = { patient: { findFirst }, encounter: { findMany }, prescription: { findMany }, patientDocument: { findMany }, auditLog: { create } }` (đều `jest.fn()`), `new MedicalBooksService(prisma, {} as any)`.
  Test case:
  - `patient.findFirst` trả `null` → `patientTimeline(familyActor, 'fam-1', 'pat-1', { limit: 20 })` reject `NotFoundException` với message `'Không tìm thấy sổ khám của thành viên này.'`; `encounter.findMany` không được gọi.
  - FAMILY_REP, mọi findMany trả `[]` → `{ items: [], nextCursor: null }`; `encounter.findMany.mock.calls[0][0].where.AND[0]` bằng `timelineVisitScope(familyActor, 'fam-1', 'pat-1')`; `prescription.findMany.mock.calls[0][0].where.AND[0]` bằng `{ clinicalEmr: { patientId: 'pat-1', encounter: timelineVisitScope(familyActor, 'fam-1', 'pat-1') } }` (bảo vệ lỗi tên quan hệ `emr` → `clinicalEmr`); `where.AND[1]` bằng `{ recipientUserId: 'rep-1' }`; `prescription.findMany.mock.calls[0][0].select.clinicalEmr` được định nghĩa và `select.emr` là `undefined`; `auditLog.create` gọi 1 lần với `action: 'READ_PATIENT_TIMELINE'`.
  - DOCTOR → `prescription.findMany` where `AND[1]` bằng `{ status: { in: ['ISSUED', 'EXPIRED'] } }`.
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → FAIL vì `service.patientTimeline is not a function`.
- [ ] **Bước 2 [GREEN]: Viết khung `patientTimeline` (kiểm tra patient, 3 truy vấn với `clinicalEmr`, audit, trả `mergeTimelineEvents`)**
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → PASS.
- [ ] **Bước 3 [RED]: Viết test ánh xạ sự kiện**
  Test case (FAMILY_REP `rep-1`):
  - Encounter `{ id: 'enc-1', encounterType: 'HOME_VISIT', scheduledDate: new Date('2026-11-20T00:00:00.000Z'), scheduledTime: new Date('1970-01-01T08:30:00.000Z'), doctor: { doctorName: 'BS. Minh', userId: 'doc-user-1' }, clinicalEmrs: [{ isFinalized: true, icd10Diagnosis: 'Viêm họng cấp' }] }` → item `{ id: 'enc-1', type: 'VISIT', occurredAt: '2026-11-20T08:30:00.000Z', title: 'Khám tại nhà', summary: 'Viêm họng cấp', actorName: 'BS. Minh', source: 'CLINICAL', link: { encounterId: 'enc-1' }, canOpenDetail: true, attachments: [] }`.
  - Document `{ id: 'doc-1', documentName: 'X-quang phổi', documentType: 'IMAGING_XRAY_CT', fileUrl: 'medical-books/pat-1/abc.png', recordedDate: new Date('2026-11-19T00:00:00.000Z') }` → `type: 'DOCUMENT'`, `source: 'FAMILY_UPLOAD'`, `title: 'X-quang phổi'`, `canOpenDetail: false`, `attachments[0]` có `isImage: true`, `downloadAvailable: true`.
  - Prescription `{ id: 'rx-1', prescriptionCode: 'DT001', createdAt: new Date('2026-11-21T02:00:00.000Z'), clinicalEmr: { encounterId: 'enc-1', encounter: { doctor: { doctorName: 'BS. Minh', userId: 'doc-user-1' } } } }` → `type: 'PRESCRIPTION'`, `summary: 'Mã đơn DT001'`, `actorName: 'BS. Minh'`, `link: { encounterId: 'enc-1' }`, `canOpenDetail: true`.
  - Thứ tự `items` = `['rx-1', 'enc-1', 'doc-1']`.
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → FAIL vì khung Bước 2 chưa ánh xạ đủ trường (assert `toEqual` lệch).
- [ ] **Bước 4 [GREEN]: Viết 3 hàm ánh xạ `visitEvent`, `prescriptionEvent`, `documentEvent` (private trong file service), chuyển `occurredAt` sang ISO**
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → PASS.
- [ ] **Bước 5 [RED]: Viết test `canOpenDetail` cho bác sĩ (D4)**
  Test case: actor DOCTOR `{ id: 'doc-user-1', role: 'DOCTOR' }`; encounter `enc-own` có `doctor.userId: 'doc-user-1'`, encounter `enc-other` có `doctor.userId: 'doc-user-2'` (EMR đã chốt); prescription thuộc `enc-other` có `clinicalEmr.encounter.doctor.userId: 'doc-user-2'` → item `enc-own.canOpenDetail === true`, `enc-other.canOpenDetail === false`, item đơn thuốc `canOpenDetail === false`; `enc-other.summary` vẫn là chẩn đoán đã chốt và `actorName` là tên bác sĩ kia.
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → FAIL nếu Bước 4 chưa phân biệt bác sĩ (assert `canOpenDetail === false` lệch).
- [ ] **Bước 6 [GREEN]: Tính `canOpenDetail = actor.role !== 'DOCTOR' || doctor.userId === actor.id` trong `visitEvent` và `prescriptionEvent`**
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → PASS.
- [ ] **Bước 7 [RED]: Viết test phân trang cursor**
  Test case: `limit: 1`, 2 encounter trả về → `items.length === 1`, `nextCursor` khác null; gọi lại với `cursor = nextCursor` → `encounter.findMany.mock.calls[1][0].where.AND[1]` bằng `encounterKeyset(decodeTimelineCursor(nextCursor))`; `take` của cả 3 truy vấn bằng `2`. `cursor: 'rac'` → reject `BadRequestException`.
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → FAIL vì chưa truyền keyset/`take` theo cursor.
- [ ] **Bước 8 [GREEN]: Decode cursor đầu method, truyền `encounterKeyset`/`dateTimeKeyset`/`dateKeyset` và `take: limit + 1` vào 3 truy vấn**
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → PASS.
- [ ] **Bước 9 [REFACTOR]: Chạy 3 truy vấn song song bằng `Promise.all`, đưa map `encounterType → title` thành hằng `VISIT_TITLE`, gom công thức `canOpenDetail` vào hàm `canOpenEncounter(actor, doctorUserId)`**
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts medical-books-visit-vitals.spec.ts medical-books-patient-visits.spec.ts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 10: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- health-timeline medical-books` rồi `npx tsc --noEmit -p tsconfig.json` (bắt lỗi tên quan hệ Prisma)
  Kết quả mong đợi: tất cả PASS, không lỗi kiểu.

---

### Task 4: DTO + route `GET .../patients/:patientId/timeline`

**Đối tượng liên quan (đã xác nhận):**
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/dtos/share-prescription.dto.ts` — thêm `export class TimelineQuery` cạnh `PrescriptionPageQuery` (L476; `FamilyPrescriptionQuery extends PrescriptionPageQuery` ở L484 — không đụng).
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/controllers/medical-books.controller.ts` — thêm method `patientTimeline` ngay sau `patientDocuments` (108-119), kế thừa `@Roles('DOCTOR','FAMILY_REP')` của class.
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.controller.spec.ts`
- Kiểm chứng bằng: `npm test -- health-timeline.controller.spec.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: HTTP client (Task 5).
- Gọi tới: `MedicalBooksService.patientTimeline` (Task 3).
- Regression test cần chạy thêm: `npm test -- encounters.controller.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận từ Task 3. Cung cấp cho Task 5 hợp đồng API: query `cursor?` (string ≤ 300), `limit?` (1..50, mặc định 20); response envelope chuẩn bọc `{ items, nextCursor }`.

- [ ] **Bước 1 [RED]: Viết test validate `TimelineQuery`**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.controller.spec.ts`
  Test case (`plainToInstance(TimelineQuery, input)` + `validate`):
  - `{}` → không lỗi, `limit === 20`, `cursor === undefined`.
  - `{ limit: '50', cursor: 'abc' }` → không lỗi, `limit === 50`.
  - `{ limit: '0' }` và `{ limit: '51' }` → có lỗi trên `limit`.
  - `{ cursor: 'x'.repeat(301) }` → có lỗi trên `cursor`.
  Kỳ vọng: chạy `npm test -- health-timeline.controller.spec.ts` → FAIL vì `TimelineQuery` chưa được export.
- [ ] **Bước 2 [GREEN]: Viết `TimelineQuery`**
  `@IsOptional() @IsString() @MaxLength(300) cursor?: string;` và `@Type(() => Number) @IsInt() @Min(1, { message: 'Số bản ghi phải lớn hơn hoặc bằng 1.' }) @Max(50, { message: 'Số bản ghi tối đa là 50.' }) limit = 20;`
  Kỳ vọng: chạy `npm test -- health-timeline.controller.spec.ts` → PASS.
- [ ] **Bước 3 [RED]: Viết test controller ủy quyền cho service**
  Test case: khởi tạo `MedicalBooksController` với `books.patientTimeline = jest.fn().mockResolvedValue({ items: [], nextCursor: null })` (tham số constructor còn lại lấy đúng theo constructor hiện có — đọc bằng `get_code_snippet` trước khi viết); gọi `controller.patientTimeline({ user: actor }, 'fam-1', 'pat-1', { limit: 20, cursor: 'c' })` → `books.patientTimeline` nhận `(actor, 'fam-1', 'pat-1', { limit: 20, cursor: 'c' })` và trả đúng giá trị mock; `Reflect.getMetadata('path', MedicalBooksController.prototype.patientTimeline) === 'families/:familyId/patients/:patientId/timeline'`.
  Kỳ vọng: chạy `npm test -- health-timeline.controller.spec.ts` → FAIL vì `controller.patientTimeline` chưa tồn tại.
- [ ] **Bước 4 [GREEN]: Thêm method controller**
  ```ts
  @Get('families/:familyId/patients/:patientId/timeline')
  patientTimeline(@Req() req: AuthenticatedRequest, @Param('familyId', ParseUUIDPipe) familyId: string, @Param('patientId', ParseUUIDPipe) patientId: string, @Query() query: TimelineQuery) {
    return this.books.patientTimeline(req.user, familyId, patientId, query);
  }
  ```
  (Kiểu `req` và decorator Swagger chép đúng như method `patientVisits` 99-106.)
  Kỳ vọng: chạy `npm test -- health-timeline.controller.spec.ts` → PASS.
- [ ] **Bước 5: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- health-timeline encounters.controller.spec.ts` rồi `npx tsc --noEmit -p tsconfig.json`
  Kết quả mong đợi: tất cả PASS, không lỗi kiểu.

---

### Task 5: Frontend API `medicalBooksApi.timeline`

**Đối tượng liên quan (đã xác nhận):**
- Chỉnh sửa: `famidoc-frontend/src/lib/api/medical-books.api.ts` — thêm interface `TimelineEvent`, `TimelinePage` và method `timeline` ngay sau `documents` (150-158).
- Test tương ứng: `famidoc-frontend/src/lib/api/__tests__/medical-books-timeline-api.test.ts`
- Kiểm chứng bằng: `npm test -- src/lib/api/__tests__/medical-books-timeline-api.test.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: chưa có — Task 7.
- Gọi tới: `httpClient.get`, `unwrapApiEnvelope`, `patientPath`.
- Regression test cần chạy thêm: `npm test -- src/lib/api/__tests__/api-clients.test.ts src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx`.

**Giao diện/Kết nối với các task khác:**
- Nhận hợp đồng API từ Task 4. Cung cấp cho Task 7:
```ts
export interface TimelineEvent {
  id: string; type: 'VISIT' | 'PRESCRIPTION' | 'DOCUMENT'; occurredAt: string;
  title: string; summary: string | null; actorName: string | null;
  source: 'CLINICAL' | 'FAMILY_UPLOAD';
  link: { encounterId?: string; documentId?: string };
  canOpenDetail: boolean;
  attachments: { id: string; name: string; downloadAvailable: boolean; isImage: boolean }[];
}
export interface TimelinePage { items: TimelineEvent[]; nextCursor: string | null }
```

- [ ] **Bước 1 [RED]: Viết test cho `medicalBooksApi.timeline`**
  Vị trí file test: `famidoc-frontend/src/lib/api/__tests__/medical-books-timeline-api.test.ts`
  Test case: `vi.mock('@/lib/api/http-client', () => ({ httpClient: { get: vi.fn() } }))`; `httpClient.get` resolve envelope đúng định dạng dùng trong `famidoc-frontend/src/lib/api/__tests__/api-clients.test.ts` với `data: { items: [], nextCursor: null }`; gọi `medicalBooksApi.timeline('fam-1', 'pat-1', 'cur-1', signal)` → `httpClient.get` nhận `('/api/v1/medical-books/families/fam-1/patients/pat-1/timeline', { cursor: 'cur-1', limit: 20 }, { signal, cache: 'no-store' })` (tiền tố lấy đúng hằng `path` trong file; tham số options chép theo method `documents`) và trả `{ items: [], nextCursor: null }`. Gọi với `cursor = null` → params `{ limit: 20 }` (không có khóa `cursor`).
  Kỳ vọng: chạy `npm test -- src/lib/api/__tests__/medical-books-timeline-api.test.ts` → FAIL vì `medicalBooksApi.timeline is not a function`.
- [ ] **Bước 2 [GREEN]: Viết method `timeline(familyId, patientId, cursor: string | null, signal)`**
  Kỳ vọng: chạy `npm test -- src/lib/api/__tests__/medical-books-timeline-api.test.ts` → PASS.
- [ ] **Bước 3: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/lib/api/__tests__/medical-books-timeline-api.test.ts src/lib/api/__tests__/api-clients.test.ts src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx`
  Kết quả mong đợi: tất cả PASS.

---

### Task 6: Hàm dùng chung `downloadBookDocument` (mới ở bản 2)

**Đối tượng liên quan (đã xác nhận):**
- Tạo mới: `famidoc-frontend/src/features/prescriptions/components/download-book-document.ts` — `export async function downloadBookDocument(familyId: string, patientId: string, id: string, documentName: string): Promise<void>` (ném lỗi ra ngoài, không giữ state).
- Chỉnh sửa: `famidoc-frontend/src/features/prescriptions/components/medical-book-view.tsx` — hàm `download(record: BookDocument)` trong `MemberDocuments` (770-800) gọi `downloadBookDocument(familyId, patientId, record.id, record.documentName)`; giữ nguyên `setDownloading`, `setDownloadError`, `prescriptionErrorMessage(error, 'Chưa tải được tệp. Vui lòng thử lại.')` trong component.
- Test tương ứng: `famidoc-frontend/src/features/prescriptions/components/__tests__/download-book-document.test.ts`
- Kiểm chứng bằng: `npm test -- src/features/prescriptions/components/__tests__/download-book-document.test.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: `MemberDocuments.download` (tab "Tài liệu"), sau này `HealthTimeline` (Task 7).
- Gọi tới: `medicalBooksApi.downloadDocument` (`medical-books.api.ts:193`), `URL.createObjectURL`, `URL.revokeObjectURL`.
- Regression test cần chạy thêm: `npm test -- src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx` (tab "Tài liệu").
- Lý do đặt file riêng: `medical-book-view.tsx` sẽ import `health-timeline.tsx` (Task 8); nếu hàm nằm trong `medical-book-view.tsx` thì `health-timeline.tsx` phải import ngược lại → vòng import.

**Giao diện/Kết nối với các task khác:**
- Cung cấp cho Task 7.

- [ ] **Bước 1 [RED]: Viết test cho `downloadBookDocument`**
  Vị trí file test: `famidoc-frontend/src/features/prescriptions/components/__tests__/download-book-document.test.ts`
  Harness: `vi.mock('@/lib/api/medical-books.api', () => ({ medicalBooksApi: { downloadDocument: vi.fn() } }))`; `URL.createObjectURL = vi.fn(() => 'blob:x')`, `URL.revokeObjectURL = vi.fn()`; `vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download) })`; `vi.useFakeTimers()`.
  Test case:
  - `downloadDocument` resolve `new Blob(['x'], { type: 'application/pdf' })`; gọi `downloadBookDocument('fam-1', 'pat-1', 'doc-1', 'Kết quả')` → `downloadDocument` nhận `('fam-1', 'pat-1', 'doc-1')`, `clicked` = `['Kết quả.pdf']`; sau `vi.advanceTimersByTime(1000)` → `URL.revokeObjectURL` nhận `'blob:x'`.
  - Blob `image/png`, tên `'Ảnh.png'` → `clicked` = `['Ảnh.png']` (không thêm đuôi lần hai).
  - Blob `image/jpeg`, tên `'Ảnh'` → `'Ảnh.jpg'`.
  - `downloadDocument` reject `new Error('net')` → `downloadBookDocument(...)` reject cùng lỗi, `click` không được gọi.
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/download-book-document.test.ts` → FAIL vì không resolve được module `../download-book-document`.
- [ ] **Bước 2 [GREEN]: Viết `downloadBookDocument` bằng cách chuyển nguyên phần thân try của `download` (770-800) — không có setState, không có catch**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/download-book-document.test.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Cho `MemberDocuments.download` gọi `downloadBookDocument(familyId, patientId, record.id, record.documentName)` trong khối try, giữ nguyên setState và catch**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/download-book-document.test.ts src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx` → vẫn PASS, hành vi tab "Tài liệu" không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/features/prescriptions`
  Kết quả mong đợi: tất cả PASS.

---

### Task 7: Component `HealthTimeline`

**Đối tượng liên quan (đã xác nhận):**
- Tạo mới: `famidoc-frontend/src/features/prescriptions/components/health-timeline.tsx` — `export function HealthTimeline({ familyId, patientId, onOpenVisit }: { familyId: string; patientId: string; onOpenVisit: (encounterId: string) => void })`. **Bản 2:** bỏ prop `onDownload`; component tự tải tệp bằng `downloadBookDocument` (Task 6) và tự giữ state `downloading`/`downloadError`.
- Test tương ứng: `famidoc-frontend/src/features/prescriptions/components/__tests__/health-timeline.test.tsx`
- Kiểm chứng bằng: `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx`

**Ảnh hưởng liên quan:**
- Được gọi bởi: chưa có — Task 8.
- Gọi tới: `medicalBooksApi.timeline` (Task 5), `downloadBookDocument` (Task 6), `prescriptionErrorMessage` (`famidoc-frontend/src/lib/api/prescriptions.api.ts:92`).
- Regression test cần chạy thêm: không cần (file mới).

**Giao diện/Kết nối với các task khác:**
- Nhận từ Task 5, Task 6. Cung cấp cho Task 8.

Bố cục (theo ảnh mẫu): `<ol aria-label="Dòng thời gian sổ khám">`; mỗi `<li>` gồm cột trái ngày `dd/MM/yyyy` + giờ `HH:mm` (múi giờ `Asia/Ho_Chi_Minh`, ẩn giờ với DOCUMENT), cột giữa icon theo loại (VISIT `Stethoscope`, PRESCRIPTION `Pill`, DOCUMENT `FileText` từ `lucide-react`) trên đường dọc, cột phải thẻ có tiêu đề, tóm tắt, "Bác sĩ: {actorName}", nhãn "Gia đình tự thêm" khi `source === 'FAMILY_UPLOAD'`, nút "Xem chi tiết" CHỈ khi `canOpenDetail && link.encounterId` (D4), nút "Tải xuống" cho mỗi attachment `downloadAvailable`. Lỗi tải trang hiển thị `prescriptionErrorMessage(error, 'Không tải được dòng thời gian.')` (D5: bác sĩ hết hợp đồng thấy message 404 từ server).

- [ ] **Bước 1 [RED]: Viết test hiển thị danh sách**
  Vị trí file test: `famidoc-frontend/src/features/prescriptions/components/__tests__/health-timeline.test.tsx`
  Harness: `vi.mock('@/lib/api/medical-books.api', ...)` với `medicalBooksApi.timeline: vi.fn()`; `vi.mock('../download-book-document', () => ({ downloadBookDocument: vi.fn() }))`.
  Test case: `timeline` resolve `{ items: [visit(enc-1, '2026-11-20T01:30:00.000Z', 'Khám tại nhà', 'Viêm họng cấp', 'BS. Minh', canOpenDetail: true), doc(doc-1, '2026-11-19T00:00:00.000Z', 'X-quang phổi', FAMILY_UPLOAD)], nextCursor: null }` → sau `findByText('Khám tại nhà')`: thấy `'20/11/2026'`, `'08:30'`, `'Viêm họng cấp'`, `'Bác sĩ: BS. Minh'`, `'X-quang phổi'`, đúng 1 `'Gia đình tự thêm'`; `getAllByRole('listitem')` theo thứ tự visit rồi document.
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx` → FAIL vì không resolve được module `../health-timeline`.
- [ ] **Bước 2 [GREEN]: Viết `HealthTimeline` tải trang đầu bằng `useEffect` + `AbortController` và render theo bố cục trên**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx` → PASS.
- [ ] **Bước 3 [RED]: Viết test trạng thái rỗng, lỗi, tải thêm, quyền xem chi tiết và tải tệp**
  Test case:
  - Resolve `{ items: [], nextCursor: null }` → thấy `'Chưa có hoạt động nào trong sổ khám.'`.
  - Reject `new Error('x')` → `role="alert"` chứa `'Không tải được dòng thời gian.'` và nút `'Thử lại'`; bấm → `timeline` gọi lần 2.
  - Lần 1 `{ items: [A], nextCursor: 'c1' }`, lần 2 `{ items: [B], nextCursor: null }` → bấm `'Xem thêm'` → lần 2 nhận cursor `'c1'`, thấy cả A và B, nút `'Xem thêm'` biến mất.
  - Visit `canOpenDetail: true` → bấm `'Xem chi tiết'` → `onOpenVisit('enc-1')`. Visit `canOpenDetail: false` (bác sĩ khác) → vẫn thấy tiêu đề/chẩn đoán nhưng `queryByRole('button', { name: 'Xem chi tiết' })` là `null` trong `<li>` đó.
  - Document có attachment `downloadAvailable: true` → bấm `'Tải xuống'` → `downloadBookDocument` nhận `('fam-1', 'pat-1', 'doc-1', 'X-quang phổi')`; khi mock reject `new Error('x')` → thấy `role="alert"` chứa `'Chưa tải được tệp. Vui lòng thử lại.'`.
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx` → FAIL vì chưa có các trạng thái/nút này.
- [ ] **Bước 4 [GREEN]: Thêm state `nextCursor`, `error`, `loadingMore`, `downloading`, `downloadError`; nút "Xem thêm"/"Thử lại"; điều kiện `canOpenDetail`; gọi `downloadBookDocument` và bắt lỗi bằng `prescriptionErrorMessage(error, 'Chưa tải được tệp. Vui lòng thử lại.')`**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx` → PASS.
- [ ] **Bước 5 [REFACTOR]: Tách `TimelineItem` thành component con và hàm `formatVnDate`/`formatVnTime` dùng `Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })`**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 6: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx`
  Kết quả mong đợi: tất cả PASS.

---

### Task 8: Thêm tab "Dòng thời gian" vào `MemberBook` (mở chi tiết ngay trong tab)

**Đối tượng liên quan (đã xác nhận):**
- Chỉnh sửa: `famidoc-frontend/src/features/prescriptions/components/medical-book-view.tsx` — function `MemberBook` (633-748):
  - State `tab` thành `'timeline' | 'visits' | 'documents'`, mặc định giữ `'visits'`.
  - Thêm state `const [timelineVisitId, setTimelineVisitId] = useState<string | null>(null)`.
  - Danh sách nút thành `(['timeline', 'visits', 'documents'] as const)` với nhãn `'Dòng thời gian' | 'Lần khám' | 'Tài liệu'`; `onClick` đặt `setTab(key)` và `setTimelineVisitId(null)`.
  - Nhánh render `tab === 'timeline'`: `<div hidden={Boolean(timelineVisitId)}><HealthTimeline familyId={familyId} patientId={member.id} onOpenVisit={setTimelineVisitId} /></div>` và khi `timelineVisitId` khác null: nút `'Quay lại dòng thời gian'` (đặt `setTimelineVisitId(null)`) + `<VisitPage key={timelineVisitId} id={timelineVisitId} patientId={member.id} doctor={doctor} setPending={setPending} />`. Giữ `HealthTimeline` mounted để quay lại không mất các trang đã tải. KHÔNG đụng `VisitPages`.
  - Nhánh `documents`/`visits` giữ nguyên.
- Test tương ứng: `famidoc-frontend/src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx`
- Kiểm chứng bằng: `npm test -- src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx`

**Ảnh hưởng liên quan:**
- Được gọi bởi: `MedicalBookView` → `FamilyBook` → `MemberBook`; trang `famidoc-frontend/src/app/(dashboard)/family/medical-book/page.tsx` và luồng bác sĩ (prop `doctor`).
- Gọi tới: `HealthTimeline` (Task 7), `VisitPage` (1001, không sửa; gọi `medicalBooksApi.visit(id, signal, patientId)`).
- Regression test cần chạy thêm: `npm test -- src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx` (mặc định tab `visits`; bấm ngày `/09\/11\/2026/` gọi `medicalBooksApi.visit('older-visit', signal, 'child-5')`; bấm `'Tài liệu'` thấy link `/Mở tài liệu Tài liệu mẫu/`).

**Giao diện/Kết nối với các task khác:**
- Nhận từ Task 6, Task 7.

- [ ] **Bước 1 [RED]: Viết test tab mới**
  Vị trí file test: `famidoc-frontend/src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx`
  Harness: mock `@/lib/api/medical-books.api` và `@/lib/api/http-client` theo đúng mẫu `prescriptions-flow.test.tsx` (families/visits/documents/visit/timeline).
  Test case: render `MedicalBookView` vai trò gia đình, chọn thành viên đầu tiên → có nút `'Dòng thời gian'` với `aria-pressed="false"`, nút `'Lần khám'` đang `aria-pressed="true"`; bấm `'Dòng thời gian'` → `medicalBooksApi.timeline` gọi với `('fam-1', 'pat-1', null, expect.any(AbortSignal))` và thấy tiêu đề sự kiện mock.
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx` → FAIL vì không tìm thấy nút `'Dòng thời gian'`.
- [ ] **Bước 2 [GREEN]: Thêm tab và nhánh render `HealthTimeline` (chưa có mở chi tiết)**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx` → PASS.
- [ ] **Bước 3 [RED]: Viết test mở chi tiết lượt khám ngay trong tab**
  Test case: timeline mock trả visit `enc-9` (`canOpenDetail: true`) nằm ở trang cursor thứ hai (bấm `'Xem thêm'` trước) → bấm `'Xem chi tiết'` → `medicalBooksApi.visit` gọi với `('enc-9', expect.any(AbortSignal), 'pat-1')`; tab `'Dòng thời gian'` vẫn `aria-pressed="true"`; danh sách timeline bị ẩn (`hidden`); bấm `'Quay lại dòng thời gian'` → danh sách hiện lại, cả sự kiện trang 1 và trang 2 vẫn còn, `medicalBooksApi.timeline` KHÔNG bị gọi thêm lần nào.
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx` → FAIL vì chưa có state `timelineVisitId`/nút quay lại.
- [ ] **Bước 4 [GREEN]: Thêm state `timelineVisitId`, render `VisitPage` + nút "Quay lại dòng thời gian", bọc `HealthTimeline` trong `<div hidden>`**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx` → PASS.
- [ ] **Bước 5 [REFACTOR]: Đưa nhãn tab vào hằng `MEMBER_TABS = { timeline: 'Dòng thời gian', visits: 'Lần khám', documents: 'Tài liệu' } as const`, state dùng kiểu `keyof typeof MEMBER_TABS`**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 6: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/features/prescriptions` và `npx tsc --noEmit` trong `famidoc-frontend/`
  Kết quả mong đợi: tất cả PASS, không lỗi kiểu.

---

## Ngoài phạm vi MVP (không làm trong kế hoạch này)

- Sinh hiệu, dị ứng, bệnh mạn tính, chuyển tuyến, telehealth session riêng trên timeline.
- Cột `uploadedByUserId` cho `patient_documents` (giả định A2).
- Nhánh xem chỉ-đọc trong `visitDetail` cho bác sĩ xem lượt khám của bác sĩ khác (phương án thay thế D4).
- Ẩn tab timeline theo trạng thái hợp đồng (phương án thay thế D5).
- Index `patient_documents (patient_id, recorded_date desc, id desc)` (phát hiện 7 🟢).
- Bộ lọc theo loại/khoảng ngày trên UI.
