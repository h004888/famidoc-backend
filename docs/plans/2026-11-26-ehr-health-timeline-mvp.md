# Dòng thời gian EHR dài hạn (Health Timeline MVP) — Kế hoạch triển khai

**Mục tiêu:** Thêm tab "Dòng thời gian" trong sổ khám của từng thành viên, hiển thị theo thứ tự thời gian (mới nhất trước) các lượt khám, đơn thuốc và tài liệu, kèm phân trang cursor và phân quyền đúng 3 quyết định đã chốt.

**Cách tiếp cận:** Backend thêm hàm thuần `timeline.util.ts` (cursor + gộp/sắp xếp sự kiện + điều kiện keyset Prisma), một method mới `MedicalBooksService.patientTimeline` dùng lại các helper phân quyền sẵn có (`documentScope`, `visitScope`, `assignedContract`), và route `GET /api/v1/medical-books/families/:familyId/patients/:patientId/timeline`. Frontend thêm `medicalBooksApi.timeline`, component `HealthTimeline` (bố cục giống ảnh mẫu: cột ngày/giờ – trục icon – thẻ nội dung) và tab thứ ba trong `MemberBook`. Không thêm bảng/migration, không tạo service Nest mới (tránh phải đăng ký provider) — gộp vào `MedicalBooksService` vì mọi helper phân quyền đều là hàm private trong file đó.

**Quyết định nghiệp vụ đã chốt (người dùng trả lời "1.có, 2.không, 3.có"):**
1. Bác sĩ đang có hợp đồng ACTIVE với gia đình xem được toàn bộ tiền sử của thành viên trong hợp đồng, kể cả lượt khám do bác sĩ khác ghi.
2. Gia đình KHÔNG thấy lượt khám chưa chốt bệnh án (giữ nguyên `visitScope` cho FAMILY_REP).
3. Tài liệu gia đình tự tải lên hiển thị trên timeline, gắn nhãn "Gia đình tự thêm".

**Giả định (nêu rõ, cần người dùng phản đối nếu sai):**
- A1. Với bác sĩ (quyết định 1): lượt khám của chính bác sĩ đó hiển thị theo `doctorVisitScope` hiện có (kể cả chưa chốt); lượt khám của bác sĩ KHÁC chỉ hiển thị khi bệnh án của thành viên đó đã chốt (`isFinalized = true`) — tránh lộ bản nháp của người khác.
- A2. Bảng `patient_documents` không có cột người tải lên. Upload chỉ đi qua route `@Roles('FAMILY_REP')` của medical-books và `@Roles('FAMILY_REP','ADMIN')` của patients → MVP gán mọi tài liệu `source = 'FAMILY_UPLOAD'`, nhãn "Gia đình tự thêm". Trường hợp ADMIN tải hộ được chấp nhận là sai nhãn (hiếm); sửa triệt để cần thêm cột `uploadedByUserId` — ngoài phạm vi MVP.
- A3. Đơn thuốc: gia đình chỉ thấy đơn có `recipientUserId = actor.id` (đồng nhất với `visitDetail` hiện có) và chỉ thuộc lượt khám đã nằm trong `visitScope`; bác sĩ thấy đơn của mọi lượt khám trong phạm vi A1 có trạng thái `ISSUED | EXPIRED` (ẩn `CANCELLED`).
- A4. Thời điểm sự kiện (`occurredAt`): lượt khám = `scheduledDate` + `scheduledTime`; đơn thuốc = `createdAt`; tài liệu = `recordedDate` lúc 00:00 UTC.

**Đã tra cứu codebase (codebase-memory-mcp + đọc thân hàm):**
- `search_graph` (project `C-Users-ADMIN-Downloads-famidoc`): frontend sổ khám ở `famidoc-frontend/src/features/prescriptions/components/medical-book-view.tsx` — `MedicalBookView` 195, `FamilyBook` 424, `MemberBook` 633-748, `MemberDocuments` 750, `VisitPages` 886, `ReadVisit` 1153; API `famidoc-frontend/src/lib/api/medical-books.api.ts` — `visits` 136-149, `documents` 150-158, `downloadDocument` 193.
- Đọc `famidoc-backend/src/modules/encounters/services/medical-books.service.ts`: hằng `PAGE_SIZE = 12`, `documentSelect`, `visitSelect`; helper private `assignedContract(actor)` (= `{contractStatus:'ACTIVE', doctor: activePrescribingDoctor(actor.id)}`), `rosterScope`, `familyScope`, `visitScope(actor)` (FAMILY_REP: `contract.familyUnit.representativeUserId`, TELEHEALTH hoặc HOME_VISIT có `doctorCompletedAt`, `clinicalEmrs some isFinalized true`), `documentScope(actor, familyId, patientId)` (bác sĩ phải có `contractMembers some contract assignedContract + familyId`), `documentInfo(patientId, record)`; method `patientVisits` (phân trang offset, `orderBy scheduledDate desc, scheduledTime desc, id desc`), `patientDocuments` (ghi audit `READ_PATIENT_DOCUMENTS` qua `writeBusinessAudit`).
- `famidoc-backend/src/modules/encounters/services/prescriptions.service.ts`: `activePrescribingDoctor(userId)` 174, `doctorVisitScope(userId, now)` 184 (lọc `doctor: activePrescribingDoctor(userId)` + trạng thái encounter) — đây là nguyên nhân bác sĩ mới không thấy tiền sử.
- `famidoc-backend/src/modules/encounters/controllers/medical-books.controller.ts`: `@Controller('api/v1/medical-books')`, `@Roles('DOCTOR','FAMILY_REP')`; route `families/:familyId/patients/:patientId/visits` (99-106) dùng `ParseUUIDPipe` và `PrescriptionPageQuery`.
- DTO `PrescriptionPageQuery` ở `famidoc-backend/src/modules/encounters/dtos/share-prescription.dto.ts:476` (class-validator + `@Type(() => Number)`).
- Prisma schema: `PatientDocument` (id, patientId, documentName, documentType, fileUrl, mimeType, notes, fileSizeKb, recordedDate, uploadedAt — không có người tải); `ClinicalEmr` (encounterId, patientId, icd10Code, icd10Diagnosis, isFinalized, finalizedAt); `Prescription` (emrId, prescriptionCode, prescribedDate, recipientUserId, status `ISSUED|EXPIRED|CANCELLED`, createdAt); `Encounter` (contractId, doctorId, encounterType `HOME_VISIT|TELEHEALTH|FACILITY_VISIT`, scheduledDate Date, scheduledTime Time, doctorCompletedAt).
- `MemberBook` có state `const [tab, setTab] = useState<'visits' | 'documents'>('visits')` và danh sách nút `(['visits', 'documents'] as const).map(...)` với nhãn `'Lần khám' : 'Tài liệu'`; nhánh render `tab === 'documents' ? <MemberDocuments/> : <VisitPages/>`.

**Framework test & quy ước (đã xác nhận):**
- Backend: Jest 30 + ts-jest, `famidoc-backend/jest.config.ts` `testMatch: ['<rootDir>/src/**/__tests__/**/*.spec.ts']`, `testEnvironment: 'node'`. Mẫu: `famidoc-backend/src/modules/encounters/__tests__/medical-books-visit-vitals.spec.ts` (mock `prisma` bằng object `jest.fn()`, `new MedicalBooksService(prisma, storage)`, actor `{ id, role, familyUnitId } as any`).
- Lệnh backend (chạy trong `famidoc-backend/`): `npm test -- <tên-file-spec>`.
- Frontend: Vitest (`famidoc-frontend/vitest.config.ts`, jsdom, `include: ['src/**/__tests__/**/*.test.{ts,tsx}']`), @testing-library; mock module bằng `vi.mock('@/lib/api/medical-books.api', ...)` và `vi.mock('@/lib/api/http-client', ...)` như `famidoc-frontend/src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx`.
- Lệnh frontend (chạy trong `famidoc-frontend/`): `npm test -- <đường-dẫn-test>`.

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Không thêm migration, bảng, thư viện mới.
- Không thay đổi hành vi các route hiện có (`/visits`, `/documents`, `/visits/:id`) — test hiện có của chúng phải vẫn PASS.
- Mọi lần đọc timeline phải ghi audit `READ_PATIENT_TIMELINE` qua `writeBusinessAudit`.
- Thông báo lỗi người dùng bằng tiếng Việt có dấu, giữ giọng văn các message hiện có.
- `limit` mặc định 20, tối đa 50.

---

### Task 1: Hàm thuần cho timeline (cursor, keyset, gộp sự kiện)

**Đối tượng liên quan (đã xác nhận):**
- Tạo mới: `famidoc-backend/src/modules/encounters/services/timeline.util.ts`
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.util.spec.ts`
- Kiểm chứng bằng: `npm test -- health-timeline.util.spec.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: chưa có (file mới) — Task 3 sẽ dùng.
- Gọi tới: không có phụ thuộc ngoài TypeScript.
- Regression test cần chạy thêm do có inbound calls: không cần.

**Giao diện/Kết nối với các task khác:**
- Cung cấp cho Task 3: kiểu `TimelineEvent`, `TimelineCursor`, các hàm `encodeTimelineCursor`, `decodeTimelineCursor`, `mergeTimelineEvents`, `encounterKeyset`, `dateKeyset`, `dateTimeKeyset`.

Định nghĩa kiểu sẽ tạo:
```ts
export type TimelineEventType = 'VISIT' | 'PRESCRIPTION' | 'DOCUMENT';
export interface TimelineAttachment { id: string; name: string; downloadAvailable: boolean; isImage: boolean }
export interface TimelineEvent {
  id: string; type: TimelineEventType; occurredAt: Date;
  title: string; summary: string | null; actorName: string | null;
  source: 'CLINICAL' | 'FAMILY_UPLOAD'; link: { encounterId?: string; documentId?: string };
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
  - `dateKeyset('recordedDate', cursor)` (cursor 08:30) → `{ OR: [ { recordedDate: { lt: day } }, { recordedDate: day } ] }` với `day = new Date('2026-11-20T00:00:00.000Z')` (mọi tài liệu ngày 20 có occurredAt 00:00, đứng sau cursor 08:30).
  - `dateKeyset('recordedDate', { occurredAt: new Date('2026-11-20T00:00:00.000Z'), id: 'd5' })` → `{ OR: [ { recordedDate: { lt: day } }, { recordedDate: day, id: { lt: 'd5' } } ] }`.
  - `dateTimeKeyset('createdAt', cursor)` → `{ OR: [ { createdAt: { lt: cursor.occurredAt } }, { createdAt: cursor.occurredAt, id: { lt: 'v1' } } ] }`.
  - `dateKeyset` và `dateTimeKeyset` với `null` → `{}`.
  Kỳ vọng: chạy `npm test -- health-timeline.util.spec.ts` → FAIL vì các hàm keyset chưa tồn tại.
- [ ] **Bước 6 [GREEN]: Viết `encounterKeyset`, `dateKeyset`, `dateTimeKeyset`**
  Cách làm: tách `day = new Date(iso.slice(0,10)+'T00:00:00.000Z')`, `time = new Date('1970-01-01T'+iso.slice(11))`. Riêng `dateKeyset`: nếu `cursor.occurredAt` đúng 00:00 UTC thì nhánh thứ hai là `{ recordedDate: day, id: { lt: id } }`; nếu sau 00:00 thì nhánh thứ hai là `{ recordedDate: day }`.
  Kỳ vọng: chạy `npm test -- health-timeline.util.spec.ts` → PASS.
- [ ] **Bước 7 [REFACTOR]: Gom việc tách `day`/`time` từ Date vào một hàm nội bộ `splitDateTime(date)` dùng chung cho 3 builder**
  Kỳ vọng: chạy `npm test -- health-timeline.util.spec.ts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 8: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- health-timeline.util.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 2: Phạm vi lượt khám cho timeline theo vai trò

**Đối tượng liên quan (đã xác nhận):**
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/services/medical-books.service.ts` — thêm và `export function timelineVisitScope(actor: AuthenticatedUser, familyId: string, patientId: string): Prisma.EncounterWhereInput` đặt ngay sau `visitScope`.
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/health-timeline-scope.spec.ts`
- Kiểm chứng bằng: `npm test -- health-timeline-scope.spec.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: chưa có — Task 3.
- Gọi tới: `visitScope` (private, cùng file), `doctorVisitScope` (`prescriptions.service.ts:184`).
- Regression test cần chạy thêm: `npm test -- medical-books-visit-vitals.spec.ts` (cùng file service bị sửa).

**Giao diện/Kết nối với các task khác:**
- Cung cấp cho Task 3: điều kiện `where` cho truy vấn encounter.

- [ ] **Bước 1 [RED]: Viết test cho `timelineVisitScope`**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/health-timeline-scope.spec.ts`
  Test case:
  - FAMILY_REP (`{ id: 'rep-1', role: 'FAMILY_REP' }`), familyId `fam-1`, patientId `pat-1` → kết quả có `AND` gồm (a) đúng object mà `visitScope` trả về cho FAMILY_REP (kiểm bằng `expect.objectContaining({ clinicalEmrs: { some: expect.objectContaining({ isFinalized: true }) } })`) và (b) `{ contract: { familyId: 'fam-1' }, OR: [ { participants: { some: { patientId: 'pat-1' } } }, { clinicalEmrs: { some: { patientId: 'pat-1' } } } ] }`. Đảm bảo quyết định 2: KHÔNG có nhánh nào cho phép lượt khám chưa chốt.
  - DOCTOR (`{ id: 'doc-user-1', role: 'DOCTOR' }`) → `AND[0]` có `OR` gồm 2 nhánh: nhánh 1 `toMatchObject({ doctor: expect.objectContaining({ userId: 'doc-user-1' }) })` (lượt khám của chính bác sĩ, từ `doctorVisitScope`); nhánh 2 bằng `{ clinicalEmrs: { some: { patientId: 'pat-1', isFinalized: true } } }` (lượt khám của bác sĩ khác đã chốt — quyết định 1 + giả định A1); `AND[1]` giống case FAMILY_REP (b).
  Kỳ vọng: chạy `npm test -- health-timeline-scope.spec.ts` → FAIL vì `timelineVisitScope` chưa được export từ `../services/medical-books.service`.
- [ ] **Bước 2 [GREEN]: Viết `timelineVisitScope` trong `medical-books.service.ts`**
  Cách làm:
  ```ts
  const patientFilter = { contract: { familyId }, OR: [ { participants: { some: { patientId } } }, { clinicalEmrs: { some: { patientId } } } ] };
  const roleFilter = actor.role === 'DOCTOR'
    ? { OR: [ doctorVisitScope(actor.id), { clinicalEmrs: { some: { patientId, isFinalized: true } } } ] }
    : visitScope(actor);
  return { AND: [roleFilter, patientFilter] };
  ```
  Ghi chú: quyền "có hợp đồng ACTIVE" của bác sĩ được chặn ở bước kiểm tra bệnh nhân bằng `documentScope` (Task 3), không lặp lại ở đây.
  Kỳ vọng: chạy `npm test -- health-timeline-scope.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Cho `patientVisits` dùng lại `patientFilter` bằng cách tách hằng/hàm nhỏ `patientEncounterFilter(familyId, patientId)` dùng chung giữa `patientVisits` và `timelineVisitScope`**
  Kỳ vọng: chạy `npm test -- health-timeline-scope.spec.ts medical-books-visit-vitals.spec.ts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- health-timeline-scope.spec.ts medical-books-visit-vitals.spec.ts prescriptions-multi-member.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 3: Method `MedicalBooksService.patientTimeline`

**Đối tượng liên quan (đã xác nhận):**
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/services/medical-books.service.ts` — thêm method `async patientTimeline(actor: AuthenticatedUser, familyId: string, patientId: string, query: { cursor?: string; limit: number })` đặt sau `patientDocuments`.
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.service.spec.ts`
- Kiểm chứng bằng: `npm test -- health-timeline.service.spec.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: chưa có — Task 4.
- Gọi tới: `documentScope`, `timelineVisitScope` (Task 2), `documentInfo`, `writeBusinessAudit`, các hàm của Task 1; Prisma `patient.findFirst`, `encounter.findMany`, `prescription.findMany`, `patientDocument.findMany`.
- Regression test cần chạy thêm: `npm test -- medical-books-visit-vitals.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận từ Task 1, Task 2.
- Cung cấp cho Task 4: kết quả `{ items: TimelineEventDto[]; nextCursor: string | null }` với `occurredAt` đã chuyển sang chuỗi ISO.

Truy vấn sẽ viết (mỗi nguồn `take: limit + 1`, đã áp keyset):
- `patient.findFirst({ where: documentScope(actor, familyId, patientId), select: { id: true } })` → null thì `NotFoundException('Không tìm thấy sổ khám của thành viên này.')`.
- `encounter.findMany({ where: { AND: [timelineVisitScope(...), encounterKeyset(cursor)] }, select: { ...visitSelect, clinicalEmrs: { where: { patientId }, select: { isFinalized: true, icd10Diagnosis: true }, take: 1 } }, orderBy: [scheduledDate desc, scheduledTime desc, id desc] })` → event `VISIT`, title `'Khám trực tuyến' | 'Khám tại nhà' | 'Khám tại cơ sở'` theo `encounterType`, summary = `icd10Diagnosis` (null nếu chưa chốt), actorName = `doctor.doctorName`, source `CLINICAL`, link `{ encounterId }`.
- `prescription.findMany({ where: { AND: [ { emr: { patientId, encounter: timelineVisitScope(...) } }, actor.role === 'DOCTOR' ? { status: { in: ['ISSUED','EXPIRED'] } } : { recipientUserId: actor.id }, dateTimeKeyset('createdAt', cursor) ] }, select: { id, prescriptionCode, createdAt, emr: { select: { encounterId: true, encounter: { select: { doctor: { select: { doctorName: true } } } } } } }, orderBy: [createdAt desc, id desc] })` → event `PRESCRIPTION`, title `'Đơn thuốc'`, summary `` `Mã đơn ${prescriptionCode}` ``, link `{ encounterId }`.
- `patientDocument.findMany({ where: { patientId, ...dateKeyset('recordedDate', cursor) }, select: documentSelect, orderBy: [recordedDate desc, id desc] })` → event `DOCUMENT`, title = `documentName`, source `FAMILY_UPLOAD`, actorName `null`, attachments = `[{ id, name: documentName, downloadAvailable: documentInfo(...).downloadAvailable, isImage: /\.(png|jpe?g)$/i.test(fileUrl ?? '') }]`, link `{ documentId }`.

- [ ] **Bước 1 [RED]: Viết test chặn ngoài phạm vi và gọi đúng scope**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.service.spec.ts`
  Harness: `prisma = { patient: { findFirst }, encounter: { findMany }, prescription: { findMany }, patientDocument: { findMany }, auditLog: { create } }` (đều `jest.fn()`), `new MedicalBooksService(prisma, {} as any)`.
  Test case:
  - `patient.findFirst` trả `null` → `patientTimeline(familyActor, 'fam-1', 'pat-1', { limit: 20 })` reject `NotFoundException`; `encounter.findMany` không được gọi.
  - FAMILY_REP, patient tồn tại, mọi findMany trả `[]` → kết quả `{ items: [], nextCursor: null }`; `encounter.findMany.mock.calls[0][0].where.AND[0]` bằng `timelineVisitScope(familyActor, 'fam-1', 'pat-1')`; `prescription.findMany.mock.calls[0][0].where.AND[1]` bằng `{ recipientUserId: 'rep-1' }`; `auditLog.create` được gọi 1 lần với `action: 'READ_PATIENT_TIMELINE'`.
  - DOCTOR → `prescription.findMany` where `AND[1]` bằng `{ status: { in: ['ISSUED', 'EXPIRED'] } }`.
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → FAIL vì `service.patientTimeline is not a function`.
- [ ] **Bước 2 [GREEN]: Viết khung `patientTimeline` (kiểm tra patient, 3 truy vấn, audit, trả `mergeTimelineEvents`)**
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → PASS.
- [ ] **Bước 3 [RED]: Viết test ánh xạ sự kiện**
  Test case (FAMILY_REP):
  - `encounter.findMany` trả 1 encounter `{ id: 'enc-1', encounterType: 'HOME_VISIT', scheduledDate: new Date('2026-11-20T00:00:00.000Z'), scheduledTime: new Date('1970-01-01T08:30:00.000Z'), doctor: { doctorName: 'BS. Minh' }, clinicalEmrs: [{ isFinalized: true, icd10Diagnosis: 'Viêm họng cấp' }] }` → item `{ id: 'enc-1', type: 'VISIT', occurredAt: '2026-11-20T08:30:00.000Z', title: 'Khám tại nhà', summary: 'Viêm họng cấp', actorName: 'BS. Minh', source: 'CLINICAL', link: { encounterId: 'enc-1' }, attachments: [] }`.
  - `patientDocument.findMany` trả `{ id: 'doc-1', documentName: 'X-quang phổi', documentType: 'IMAGING_XRAY_CT', fileUrl: 'medical-books/pat-1/abc.png', recordedDate: new Date('2026-11-19T00:00:00.000Z') }` → item có `type: 'DOCUMENT'`, `source: 'FAMILY_UPLOAD'`, `title: 'X-quang phổi'`, `attachments[0]` có `isImage: true` và `downloadAvailable: true`.
  - `prescription.findMany` trả `{ id: 'rx-1', prescriptionCode: 'DT001', createdAt: new Date('2026-11-21T02:00:00.000Z'), emr: { encounterId: 'enc-1', encounter: { doctor: { doctorName: 'BS. Minh' } } } }` → item `type: 'PRESCRIPTION'`, `summary: 'Mã đơn DT001'`, `link: { encounterId: 'enc-1' }`.
  - Thứ tự `items` = `['rx-1', 'enc-1', 'doc-1']`.
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → FAIL vì khung Bước 2 chưa ánh xạ đủ trường (assert `toEqual` lệch).
- [ ] **Bước 4 [GREEN]: Viết 3 hàm ánh xạ `visitEvent`, `prescriptionEvent`, `documentEvent` (private trong file service) và chuyển `occurredAt` sang ISO ở kết quả trả về**
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → PASS.
- [ ] **Bước 5 [RED]: Viết test phân trang cursor**
  Test case: `limit: 1`, có 2 encounter trả về → `items.length === 1`, `nextCursor` khác null; gọi lại với `cursor = nextCursor` → `encounter.findMany.mock.calls[1][0].where.AND[1]` bằng `encounterKeyset(decodeTimelineCursor(nextCursor))`; `take` của cả 3 truy vấn bằng `2` (limit + 1). `cursor: 'rac'` → reject `BadRequestException`.
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → FAIL vì Bước 2 chưa truyền keyset/`take` theo cursor.
- [ ] **Bước 6 [GREEN]: Decode cursor đầu method, truyền `encounterKeyset`/`dateTimeKeyset`/`dateKeyset` và `take: limit + 1` vào 3 truy vấn**
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts` → PASS.
- [ ] **Bước 7 [REFACTOR]: Chạy 3 truy vấn song song bằng `Promise.all` và đưa map `encounterType → title` thành hằng `VISIT_TITLE`**
  Kỳ vọng: chạy `npm test -- health-timeline.service.spec.ts medical-books-visit-vitals.spec.ts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 8: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- health-timeline`
  Kết quả mong đợi: tất cả spec `health-timeline*.spec.ts` và `medical-books-visit-vitals.spec.ts` PASS.

---

### Task 4: DTO + route `GET .../patients/:patientId/timeline`

**Đối tượng liên quan (đã xác nhận):**
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/dtos/share-prescription.dto.ts` — thêm `export class TimelineQuery` cạnh `PrescriptionPageQuery` (dòng 476).
- Chỉnh sửa: `famidoc-backend/src/modules/encounters/controllers/medical-books.controller.ts` — thêm method `patientTimeline` ngay sau `patientDocuments` (dòng 108-119), cùng decorator vai trò kế thừa từ class `@Roles('DOCTOR','FAMILY_REP')`.
- Test tương ứng: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.controller.spec.ts`
- Kiểm chứng bằng: `npm test -- health-timeline.controller.spec.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: HTTP client (Task 5).
- Gọi tới: `MedicalBooksService.patientTimeline` (Task 3).
- Regression test cần chạy thêm: `npm test -- encounters.controller.spec.ts` (cùng module).

**Giao diện/Kết nối với các task khác:**
- Nhận từ Task 3. Cung cấp cho Task 5 hợp đồng API: query `cursor?` (string), `limit?` (1..50, mặc định 20); response envelope chuẩn bọc `{ items, nextCursor }`.

- [ ] **Bước 1 [RED]: Viết test validate `TimelineQuery`**
  Vị trí file test: `famidoc-backend/src/modules/encounters/__tests__/health-timeline.controller.spec.ts`
  Test case (dùng `plainToInstance(TimelineQuery, input)` + `validate` của class-validator):
  - `{}` → không lỗi, `limit === 20`, `cursor === undefined`.
  - `{ limit: '50', cursor: 'abc' }` → không lỗi, `limit === 50`.
  - `{ limit: '0' }` và `{ limit: '51' }` → có lỗi trên thuộc tính `limit`.
  - `{ cursor: 'x'.repeat(301) }` → có lỗi trên thuộc tính `cursor`.
  Kỳ vọng: chạy `npm test -- health-timeline.controller.spec.ts` → FAIL vì `TimelineQuery` chưa được export.
- [ ] **Bước 2 [GREEN]: Viết `TimelineQuery`**
  `@IsOptional() @IsString() @MaxLength(300) cursor?: string;` và `@Type(() => Number) @IsInt() @Min(1, { message: 'Số bản ghi phải lớn hơn hoặc bằng 1.' }) @Max(50, { message: 'Số bản ghi tối đa là 50.' }) limit = 20;`
  Kỳ vọng: chạy `npm test -- health-timeline.controller.spec.ts` → PASS.
- [ ] **Bước 3 [RED]: Viết test controller ủy quyền cho service**
  Test case: `new MedicalBooksController(books as any, ...)` với `books.patientTimeline = jest.fn().mockResolvedValue({ items: [], nextCursor: null })` (tham số constructor còn lại lấy đúng theo constructor hiện có của controller — đọc bằng `get_code_snippet` trước khi viết test); gọi `controller.patientTimeline({ user: actor }, 'fam-1', 'pat-1', { limit: 20, cursor: 'c' })` → `books.patientTimeline` được gọi với `(actor, 'fam-1', 'pat-1', { limit: 20, cursor: 'c' })` và trả về đúng giá trị mock. Kiểm metadata route: `Reflect.getMetadata('path', MedicalBooksController.prototype.patientTimeline) === 'families/:familyId/patients/:patientId/timeline'`.
  Kỳ vọng: chạy `npm test -- health-timeline.controller.spec.ts` → FAIL vì `controller.patientTimeline` chưa tồn tại.
- [ ] **Bước 4 [GREEN]: Thêm method controller**
  ```ts
  @Get('families/:familyId/patients/:patientId/timeline')
  patientTimeline(@Req() req: AuthenticatedRequest, @Param('familyId', ParseUUIDPipe) familyId: string, @Param('patientId', ParseUUIDPipe) patientId: string, @Query() query: TimelineQuery) {
    return this.books.patientTimeline(req.user, familyId, patientId, query);
  }
  ```
  (Kiểu `req` và decorator Swagger, nếu có, chép đúng như method `patientVisits` dòng 96-106.)
  Kỳ vọng: chạy `npm test -- health-timeline.controller.spec.ts` → PASS.
- [ ] **Bước 5: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- health-timeline encounters.controller.spec.ts` rồi `npx tsc --noEmit -p tsconfig.json`
  Kết quả mong đợi: tất cả PASS, không lỗi kiểu.

---

### Task 5: Frontend API `medicalBooksApi.timeline`

**Đối tượng liên quan (đã xác nhận):**
- Chỉnh sửa: `famidoc-frontend/src/lib/api/medical-books.api.ts` — thêm interface `TimelineEvent`, `TimelinePage` và method `timeline` ngay sau `documents` (dòng 150-158).
- Test tương ứng: `famidoc-frontend/src/lib/api/__tests__/medical-books-timeline-api.test.ts`
- Kiểm chứng bằng: `npm test -- src/lib/api/__tests__/medical-books-timeline-api.test.ts`

**Ảnh hưởng liên quan:**
- Được gọi bởi: chưa có — Task 6.
- Gọi tới: `httpClient.get`, `unwrapApiEnvelope`, `patientPath`.
- Regression test cần chạy thêm: `npm test -- src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx`.

**Giao diện/Kết nối với các task khác:**
- Nhận hợp đồng API từ Task 4. Cung cấp cho Task 6 kiểu dữ liệu:
```ts
export interface TimelineEvent {
  id: string; type: 'VISIT' | 'PRESCRIPTION' | 'DOCUMENT'; occurredAt: string;
  title: string; summary: string | null; actorName: string | null;
  source: 'CLINICAL' | 'FAMILY_UPLOAD';
  link: { encounterId?: string; documentId?: string };
  attachments: { id: string; name: string; downloadAvailable: boolean; isImage: boolean }[];
}
export interface TimelinePage { items: TimelineEvent[]; nextCursor: string | null }
```

- [ ] **Bước 1 [RED]: Viết test cho `medicalBooksApi.timeline`**
  Vị trí file test: `famidoc-frontend/src/lib/api/__tests__/medical-books-timeline-api.test.ts`
  Test case: `vi.mock('@/lib/api/http-client', () => ({ httpClient: { get: vi.fn() } }))`; `httpClient.get` resolve envelope `{ success: true, data: { items: [], nextCursor: null } }` (định dạng envelope lấy đúng như test `famidoc-frontend/src/lib/api/__tests__/api-clients.test.ts` hiện có); gọi `medicalBooksApi.timeline('fam-1', 'pat-1', 'cur-1', signal)` → `httpClient.get` được gọi với `('/api/v1/medical-books/families/fam-1/patients/pat-1/timeline', { cursor: 'cur-1', limit: 20 }, { signal, cache: 'no-store' })` (tiền tố `path` lấy đúng hằng trong file) và hàm trả `{ items: [], nextCursor: null }`. Gọi với `cursor = null` → params là `{ limit: 20 }` (không có khóa `cursor`).
  Kỳ vọng: chạy `npm test -- src/lib/api/__tests__/medical-books-timeline-api.test.ts` → FAIL vì `medicalBooksApi.timeline is not a function`.
- [ ] **Bước 2 [GREEN]: Viết method `timeline(familyId, patientId, cursor: string | null, signal)`**
  Kỳ vọng: chạy `npm test -- src/lib/api/__tests__/medical-books-timeline-api.test.ts` → PASS.
- [ ] **Bước 3: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/lib/api/__tests__/medical-books-timeline-api.test.ts src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx`
  Kết quả mong đợi: tất cả PASS.

---

### Task 6: Component `HealthTimeline`

**Đối tượng liên quan (đã xác nhận):**
- Tạo mới: `famidoc-frontend/src/features/prescriptions/components/health-timeline.tsx` — `export function HealthTimeline({ familyId, patientId, onOpenVisit, onDownload }: { familyId: string; patientId: string; onOpenVisit: (encounterId: string) => void; onDownload: (documentId: string) => void })`.
- Test tương ứng: `famidoc-frontend/src/features/prescriptions/components/__tests__/health-timeline.test.tsx`
- Kiểm chứng bằng: `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx`

**Ảnh hưởng liên quan:**
- Được gọi bởi: chưa có — Task 7.
- Gọi tới: `medicalBooksApi.timeline` (Task 5).
- Regression test cần chạy thêm: không cần (file mới).

**Giao diện/Kết nối với các task khác:**
- Nhận từ Task 5. Cung cấp cho Task 7 component.

Bố cục (theo ảnh mẫu): danh sách `<ol>`; mỗi `<li>` gồm cột trái ngày `dd/MM/yyyy` + giờ `HH:mm` (múi giờ `Asia/Ho_Chi_Minh`, ẩn giờ với DOCUMENT), cột giữa icon theo loại (VISIT: `Stethoscope`, PRESCRIPTION: `Pill`, DOCUMENT: `FileText` từ `lucide-react` — thư viện icon đang dùng trong `medical-book-view.tsx`) trên một đường dọc, cột phải thẻ có tiêu đề, tóm tắt, "Bác sĩ: {actorName}", nhãn "Gia đình tự thêm" khi `source === 'FAMILY_UPLOAD'`, nút "Xem chi tiết" (VISIT/PRESCRIPTION có `link.encounterId`) và nút "Tải xuống" cho mỗi attachment `downloadAvailable`.

- [ ] **Bước 1 [RED]: Viết test hiển thị danh sách**
  Vị trí file test: `famidoc-frontend/src/features/prescriptions/components/__tests__/health-timeline.test.tsx`
  Test case: mock `medicalBooksApi.timeline` resolve `{ items: [visitEvent(enc-1, '2026-11-20T01:30:00.000Z', 'Khám tại nhà', 'Viêm họng cấp', 'BS. Minh'), docEvent(doc-1, '2026-11-19T00:00:00.000Z', 'X-quang phổi', FAMILY_UPLOAD)], nextCursor: null }` → sau `findByText('Khám tại nhà')`: thấy `'20/11/2026'`, `'08:30'` (UTC+7), `'Viêm họng cấp'`, `'Bác sĩ: BS. Minh'`, `'X-quang phổi'`, đúng 1 phần tử `'Gia đình tự thêm'`; thứ tự `getAllByRole('listitem')` là visit rồi document.
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx` → FAIL vì không resolve được module `../health-timeline`.
- [ ] **Bước 2 [GREEN]: Viết `HealthTimeline` tải trang đầu bằng `useEffect` + `AbortController` và render theo bố cục trên**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx` → PASS.
- [ ] **Bước 3 [RED]: Viết test trạng thái rỗng, lỗi, tải thêm và hành động**
  Test case:
  - Resolve `{ items: [], nextCursor: null }` → thấy `'Chưa có hoạt động nào trong sổ khám.'`.
  - Reject `new Error('x')` → thấy `role="alert"` chứa `'Không tải được dòng thời gian.'` và nút `'Thử lại'`; bấm → `timeline` được gọi lần 2.
  - Lần 1 resolve `{ items: [A], nextCursor: 'c1' }`, lần 2 resolve `{ items: [B], nextCursor: null }` → bấm `'Xem thêm'` → `timeline` lần 2 nhận cursor `'c1'`, hiển thị cả A và B, nút `'Xem thêm'` biến mất.
  - Bấm `'Xem chi tiết'` của visit → `onOpenVisit('enc-1')`; bấm `'Tải xuống'` của tài liệu → `onDownload('doc-1')`.
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx` → FAIL vì chưa có các trạng thái/nút này.
- [ ] **Bước 4 [GREEN]: Thêm state `nextCursor`, `error`, `loadingMore`, nút "Xem thêm"/"Thử lại", gắn callback**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx` → PASS.
- [ ] **Bước 5 [REFACTOR]: Tách `TimelineItem` thành component con và hàm `formatVnDate/formatVnTime` dùng `Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })`**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 6: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline.test.tsx`
  Kết quả mong đợi: tất cả PASS.

---

### Task 7: Thêm tab "Dòng thời gian" vào `MemberBook`

**Đối tượng liên quan (đã xác nhận):**
- Chỉnh sửa: `famidoc-frontend/src/features/prescriptions/components/medical-book-view.tsx` — function `MemberBook` (633-748): kiểu state `tab` thành `'timeline' | 'visits' | 'documents'`, mặc định giữ `'visits'`; danh sách nút thành `(['timeline', 'visits', 'documents'] as const)` với nhãn `'Dòng thời gian' | 'Lần khám' | 'Tài liệu'`; nhánh render thêm `tab === 'timeline' ? <HealthTimeline .../>`.
- Test tương ứng: `famidoc-frontend/src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx`
- Kiểm chứng bằng: `npm test -- src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx`

**Ảnh hưởng liên quan:**
- Được gọi bởi: `MedicalBookView` → `FamilyBook` → `MemberBook`; trang `famidoc-frontend/src/app/(dashboard)/family/medical-book/page.tsx` và luồng bác sĩ (`doctor` prop).
- Gọi tới: `HealthTimeline` (Task 6); `onOpenVisit` dùng đúng cơ chế mở lượt khám mà `VisitPages` đang dùng; `onDownload` dùng lại hàm `download` trong `MemberDocuments` (dòng 770-800) — tách thành hàm module-level `downloadBookDocument(familyId, patientId, id)` trước khi dùng (đọc thân hàm bằng `get_code_snippet` lúc thực thi).
- Regression test cần chạy thêm: `npm test -- src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx` (đang render `MedicalBookView`, mặc định tab `visits` phải không đổi).

**Giao diện/Kết nối với các task khác:**
- Nhận từ Task 6.

- [ ] **Bước 1 [RED]: Viết test tab mới**
  Vị trí file test: `famidoc-frontend/src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx`
  Test case: mock `@/lib/api/medical-books.api` theo đúng mẫu `prescriptions-flow.test.tsx` (families/visits/documents/timeline); render `MedicalBookView` vai trò gia đình, chọn thành viên đầu tiên → có nút `'Dòng thời gian'` với `aria-pressed="false"` và tab `'Lần khám'` đang `aria-pressed="true"`; bấm `'Dòng thời gian'` → `medicalBooksApi.timeline` được gọi với `('fam-1', 'pat-1', null, expect.any(AbortSignal))` và thấy tiêu đề sự kiện mock.
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx` → FAIL vì không tìm thấy nút `'Dòng thời gian'`.
- [ ] **Bước 2 [GREEN]: Sửa `MemberBook` như mô tả ở mục Đối tượng liên quan**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx` → PASS.
- [ ] **Bước 3 [REFACTOR]: Đưa nhãn tab vào hằng `MEMBER_TABS = { timeline: 'Dòng thời gian', visits: 'Lần khám', documents: 'Tài liệu' } as const` và dùng `Object.keys`/kiểu `keyof typeof MEMBER_TABS` cho state**
  Kỳ vọng: chạy `npm test -- src/features/prescriptions/components/__tests__/health-timeline-tab.test.tsx src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/features/prescriptions` và `npx tsc --noEmit` trong `famidoc-frontend/`
  Kết quả mong đợi: tất cả PASS, không lỗi kiểu.

---

## Ngoài phạm vi MVP (không làm trong kế hoạch này)

- Sinh hiệu, dị ứng, bệnh mạn tính, chuyển tuyến, telehealth session riêng trên timeline.
- Cột `uploadedByUserId` cho `patient_documents` (giả định A2).
- Bộ lọc theo loại/khoảng ngày trên UI.
