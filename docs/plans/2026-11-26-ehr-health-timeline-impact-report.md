# Báo cáo phân tích tác động thay đổi

**Project:** C-Users-ADMIN-Downloads-famidoc
**Nguồn kế hoạch:** famidoc-backend/docs/plans/2026-11-26-ehr-health-timeline-mvp.md (7 task, MVP dòng thời gian sức khỏe)
**Ngày phân tích:** 2026-11-26
**Trạng thái index:** ready, 23.675 node / 67.689 edge, index lúc 2026-11-26T01:33Z. Graph lệch số dòng ở `prescriptions.service.ts` và `share-prescription.dto.ts`; số dòng trong báo cáo này đã đối chiếu lại với file thật.

## 0. Kết luận nhanh (Verdict)

- Tổng số symbol mục tiêu đã phân tích: 11
- Tổng số điểm chạm bị ảnh hưởng (trong + ngoài phạm vi): 19
- Số điểm chạm PHÁT SINH ngoài kế hoạch: 6 (3 lỗi chặn, 3 rủi ro hành vi)
- Mức rủi ro tổng thể: 🟡 Trung bình
- Kết luận: các nghiệp vụ hiện có (kê đơn, chia sẻ đơn, xác nhận lượt khám, tài liệu, lịch hẹn) không bị đổi hành vi, vì plan chỉ thêm hàm mới và refactor `patientVisits` nhưng giữ nguyên logic. Tuy vậy cần sửa plan trước khi code ở 3 điểm: tên quan hệ Prisma `emr` sai, bác sĩ bấm "Xem chi tiết" lượt khám của bác sĩ khác sẽ bị 404, và `onOpenVisit` không nối được vào `VisitPages`.

## 1. Phạm vi dự kiến (rút từ tài liệu)

| # | Symbol / File mục tiêu | Loại thay đổi | Hành vi thay đổi được mô tả | Tài liệu khẳng định KHÔNG ảnh hưởng tới |
|---|---|---|---|---|
| 1 | `famidoc-backend/src/modules/encounters/services/timeline.util.ts` | Thêm | Cursor base64url, keyset, gộp/sắp xếp sự kiện | — |
| 2 | `timelineVisitScope` (medical-books.service.ts) | Thêm | Bác sĩ: lượt khám của mình hoặc lượt khám có EMR đã chốt; gia đình: `visitScope` | Gia đình không thấy lượt chưa chốt |
| 3 | `patientEncounterFilter` + `MedicalBooksService.patientVisits` | Sửa (refactor) | Tách bộ lọc bệnh nhân dùng chung | Hành vi `patientVisits` giữ nguyên |
| 4 | `MedicalBooksService.patientTimeline` | Thêm | Gộp 3 nguồn, phân trang bằng cursor, ghi audit `READ_PATIENT_TIMELINE` | — |
| 5 | `TimelineQuery` (share-prescription.dto.ts) | Thêm | `cursor`, `limit` 1..50 | `PrescriptionPageQuery` |
| 6 | `MedicalBooksController.patientTimeline` | Thêm | `GET families/:familyId/patients/:patientId/timeline` | Các route hiện có |
| 7 | `medicalBooksApi.timeline` + types | Thêm | Client API | — |
| 8 | `HealthTimeline` (health-timeline.tsx) | Thêm | UI timeline | — |
| 9 | `MemberBook` | Sửa | Thêm tab "Dòng thời gian", mặc định "Lần khám" | Tab cũ giữ nguyên |
| 10 | `MemberDocuments.download` → `downloadBookDocument` | Sửa (tách hàm) | Dùng chung cho timeline | Hành vi tải tài liệu |
| 11 | Ngoài phạm vi | — | — | Sinh hiệu, dị ứng, bệnh mạn tính, chuyển tuyến, bộ lọc |

## 2. Tác động trực tiếp (trong phạm vi dự kiến)

| # | Symbol bị ảnh hưởng | File | Quan hệ (loại cạnh) | Chiều | Khoảng cách (hop) | Mức rủi ro | Bằng chứng (tool đã dùng) |
|---|---|---|---|---|---|---|---|
| 1 | `...medical-books.service.MedicalBooksService.patientVisits` | famidoc-backend/src/modules/encounters/services/medical-books.service.ts:L235 | refactor nội bộ; gọi `familyScope`, `rosterScope`, `visitScope` | outbound | 1 | 🟡 | `trace_path(patientVisits, both, 2)` |
| 2 | `...medical-books.controller.MedicalBooksController.patientVisits` | famidoc-backend/src/modules/encounters/controllers/medical-books.controller.ts:L99 | CALLS → `patientVisits` (route công khai `.../visits`) | inbound | 1 | 🔴 (public route, nếu refactor đổi `where`) | `trace_path(patientVisits, both, 2)` |
| 3 | `...medical-books.service.visitScope` | medical-books.service.ts:L86 | được `timelineVisitScope` gọi lại; callers hiện có: `familyPrescriptionVisits`, `patientVisits`, `visitDetail` | inbound | 1 | 🟢 (không sửa thân hàm) | `trace_path(visitScope, inbound, 1)` |
| 4 | `...prescriptions.service.doctorVisitScope` | famidoc-backend/src/modules/encounters/services/prescriptions.service.ts:L184 | được `timelineVisitScope` gọi lại; 8 caller trực tiếp, 20 tới hop 2 | inbound | 1 | 🟢 (không sửa) | `trace_path(doctorVisitScope, inbound, 2)` |
| 5 | `...medical-books.service.documentScope` | medical-books.service.ts:L104 | được `patientTimeline` dùng làm guard; callers hiện có `patientDocuments`, `uploadDocument`, `downloadDocument` | inbound | 1 | 🟢 (không sửa) | `trace_path(documentScope, inbound, 2)` |
| 6 | `...business-helpers.writeBusinessAudit` | famidoc-backend/src/core/business/business-helpers.ts:L67 | CALLS; `action: string`, không phải enum → không cần migration | outbound | 1 | 🟢 | `get_code_snippet(writeBusinessAudit)` |
| 7 | `...share-prescription.dto.PrescriptionPageQuery` / `FamilyPrescriptionQuery` | famidoc-backend/src/modules/encounters/dtos/share-prescription.dto.ts:L476, L484 | chỉ thêm class bên cạnh, không kế thừa | — | — | 🟢 | `search_graph`, đối chiếu file |
| 8 | `...medical-book-view.MemberBook` | famidoc-frontend/src/features/prescriptions/components/medical-book-view.tsx:L633 | callers: `FamilyBook` (hop 1), `MedicalBookView` (hop 2) | inbound | 1–2 | 🟡 | `trace_path(MemberBook, both, 2)` |
| 9 | `...medical-book-view.MemberDocuments` / `download` | medical-book-view.tsx:L750, L770 | MemberBook CALLS MemberDocuments; `download` chỉ gọi nội bộ | inbound | 1 | 🟢 | `trace_path(MemberBook)`, `get_code_snippet(download)` |
| 10 | Trang `famidoc-frontend/src/app/(dashboard)/family/medical-book/page.tsx` | — | render `MedicalBookView` → `FamilyBook` → `MemberBook` | inbound | 3 | 🟡 (giao diện gia đình thấy tab mới) | `search_code(MedicalBookView)` |

## 3. ⚠️ Tác động PHÁT SINH ngoài kế hoạch

| # | Symbol bị ảnh hưởng | File | Quan hệ tới symbol mục tiêu | Vì sao bị ảnh hưởng | Mức rủi ro | Bằng chứng |
|---|---|---|---|---|---|---|
| 1 | `MedicalBooksService.visitDetail` (route `GET api/v1/medical-books/visits/:id`) | medical-books.service.ts:L405 | Timeline gắn `link.encounterId`, nút "Xem chi tiết" sẽ gọi luồng này | `visitDetail` lọc `where: { id, ...visitScope(actor) }`, với bác sĩ tức là `doctorVisitScope` (chỉ lượt khám của chính bác sĩ đó). Timeline cho bác sĩ thấy lượt khám đã chốt của bác sĩ khác (quyết định 1), nhưng bấm "Xem chi tiết" sẽ nhận 404. Phải mở rộng scope của `visitDetail` cho trường hợp này (chỉ đọc) hoặc ẩn nút. Lưu ý `visitDetail` còn được luồng xác nhận/ghi lượt khám dùng, nên không được nới `visitScope` dùng chung. | 🔴 | `get_code_snippet(visitDetail)`, `trace_path(visitScope, inbound, 1)` |
| 2 | Truy vấn `prescription.findMany` trong Task 3 | famidoc-backend/prisma/schema.prisma (model `Prescription`) | Plan dùng `emr: { patientId, encounter }` và `select emr` | Tên quan hệ đúng là `clinicalEmr` (`clinicalEmr ClinicalEmr @relation(fields: [emrId] ...)`). Viết `emr` sẽ lỗi TypeScript/Prisma. | 🔴 (chặn build) | đọc `prisma/schema.prisma`, model `Prescription` |
| 3 | `VisitPages` (state `visitId`, `page` nội bộ) | medical-book-view.tsx:L886 | Task 7 nói `onOpenVisit` "dùng đúng cơ chế mở lượt khám mà `VisitPages` đang dùng" | `visitId` và `page` là `useState` nội bộ của `VisitPages`, và lượt khám chỉ được chọn trong trang hiện tại (`visits.find(...) ?? visits[0]`). `MemberBook` không có cách nào set `visitId` từ bên ngoài; lượt khám ở trang 2+ sẽ không mở được. Cần nâng state lên `MemberBook` (thêm prop `initialVisitId` hoặc tương tự) hoặc mở chi tiết bằng `VisitPage`/`medicalBooksApi.visit` ngay trong tab timeline. Khi đổi chữ ký `VisitPages` thì test `prescriptions-flow.test.tsx` (dòng ~280, click `/09\/11\/2026/` → `medicalBooksApi.visit`) phải chạy lại. | 🟡 | `get_code_snippet(VisitPages)`, đọc test dòng 275-300 |
| 4 | Guard bệnh nhân: `rosterScope` (patientVisits) và `documentScope` (timeline) | medical-books.service.ts:L49, L104 | `patientTimeline` dùng `documentScope`, `patientVisits` dùng `familyScope + rosterScope` | `rosterScope` cho bác sĩ **không còn hợp đồng ACTIVE** nhưng từng có lượt khám (`encounterParticipants.some.encounter: doctorVisitScope`) xem tab "Lần khám". `documentScope` đòi `contractStatus: 'ACTIVE'`. Kết quả: cùng một màn hình, tab "Lần khám" có dữ liệu còn tab "Dòng thời gian" báo 404. Cách xử lý giống tab "Tài liệu" hiện nay (cũng dùng `documentScope`), nên cần chọn: ẩn tab timeline khi không còn HĐ, hoặc chấp nhận và hiển thị thông báo rõ ràng. | 🟡 | `get_code_snippet(rosterScope, documentScope, assignedContract)` |
| 5 | `downloadBookDocument(familyId, patientId, id)` | medical-book-view.tsx:L770 | Tách từ `download(record: BookDocument)` | Thân hàm cần `record.documentName` để đặt tên tệp và dùng state `setDownloading`/`setDownloadError` của `MemberDocuments`. Chữ ký trong plan thiếu tên tài liệu; khi tách ra phải truyền thêm `documentName` và trả lỗi/throw cho component tự xử lý state. Nếu không, tệp tải từ timeline sẽ không có tên/đuôi đúng. | 🟡 | `get_code_snippet(download)` |
| 6 | Hiệu năng: `patient_documents` không có index theo `(patient_id, recorded_date)` | famidoc-backend/prisma/schema.prisma (model `PatientDocument`) | Task 3 keyset `recordedDate desc, id desc` | Model chỉ có `@@map`, không có `@@index`. Với dữ liệu nhỏ (tài liệu theo một bệnh nhân) thì không đáng kể; `Prescription` có index `[recipientUserId, createdAt desc]` (khớp truy vấn gia đình), `Encounter` có `idx_encounters_contract_timeline` (khớp). Bác sĩ lọc đơn qua `clinicalEmr.patientId` không có index phù hợp. Không chặn MVP, chỉ ghi nhận. | 🟢 | đọc `prisma/schema.prisma` |

## 4. Mâu thuẫn với khẳng định của tài liệu

| # | Tài liệu khẳng định | Thực tế trong graph | Mức độ nghiêm trọng |
|---|---|---|---|
| 1 | Quyết định 1: bác sĩ có HĐ ACTIVE xem toàn bộ tiền sử kể cả bác sĩ khác ghi | Timeline hiển thị được, nhưng `visitDetail` vẫn dùng `doctorVisitScope` → chi tiết lượt khám của bác sĩ khác trả 404 | 🔴 Cao |
| 2 | Task 7: "`onOpenVisit` dùng đúng cơ chế mở lượt khám mà `VisitPages` đang dùng" | Cơ chế đó là state nội bộ, không có API mở từ ngoài | 🟡 Trung bình |
| 3 | Task 3: quan hệ `emr` trên `Prescription` | Schema đặt tên `clinicalEmr` | 🔴 Cao (lỗi build) |
| 4 | Task 2/3: refactor `patientVisits` "giữ nguyên hành vi" | Đúng về logic (`AND[scope, {contract:{familyId}, OR:[participants, clinicalEmrs]}]`), nhưng **không có test backend nào bao `patientVisits`** (search_code trong `__tests__` không thấy) → khẳng định chưa được kiểm chứng bằng test | 🟡 Trung bình |

## 5. Test và tài liệu liên quan cần cập nhật

| # | Symbol/File bị ảnh hưởng | Test tương ứng (TESTS edge) | Ghi chú |
|---|---|---|---|
| 1 | `MedicalBooksService.patientVisits` (refactor) | Không có | Cần thêm test khóa `where` của `encounter.findMany` **trước** khi refactor (characterization test) |
| 2 | `MemberBook`, `VisitPages`, `MemberDocuments` | famidoc-frontend/src/features/prescriptions/components/__tests__/prescriptions-flow.test.tsx | Chạy lại; test click nút `'Tài liệu'` và chọn lượt khám theo ngày. Nếu mock `medicalBooksApi` liệt kê hàm tường minh thì thêm `timeline: vi.fn()` |
| 3 | `medicalBooksApi.timeline` | famidoc-frontend/src/lib/api/__tests__/api-clients.test.ts | Thêm case URL/query |
| 4 | `visitDetail` (nếu sửa theo mục 3.1) | Chưa có spec riêng; liên quan `famidoc-backend/src/modules/encounters/__tests__/visit-record-integrity.spec.ts`, `medical-books-visit-vitals.spec.ts` | Chạy lại toàn bộ `__tests__` của module encounters |
| 5 | Plan | famidoc-backend/docs/plans/2026-11-26-ehr-health-timeline-mvp.md | Sửa `emr` → `clinicalEmr`, bổ sung xử lý mục 3.1, 3.3, 3.5 |

## 6. Phạm vi truy vấn đã thực hiện

- `index_status(project)` → ready, 23.675 node / 67.689 edge
- `search_graph(name_pattern="^(visitScope|documentScope|patientVisits|doctorVisitScope|activePrescribingDoctor|MemberBook|MemberDocuments|PrescriptionPageQuery|MedicalBooksService|MedicalBooksController|patientDocuments)$")` → 14 kết quả
- `trace_path(visitScope, inbound, 1)` → 3 caller: `familyPrescriptionVisits`, `patientVisits`, `visitDetail`
- `trace_path(doctorVisitScope, inbound, 2)` → 20 caller (PrescriptionsService.doctorVisits/prescribeFamily/replace/share/resolveDoctorVisitMember/confirmVisitRecord/saveVisitDraft, MedicalBooksService.*, scripts/verify-prescription-storage main)
- `trace_path(documentScope, inbound, 2)` → 6 caller (patientDocuments, uploadDocument, downloadDocument ở service + controller)
- `trace_path(patientVisits, both, 2)` → 1 caller (controller), 5 callee
- `trace_path(MemberBook, both, 2)` → 2 caller, 13 callee
- `get_code_snippet` cho: `visitScope`, `documentScope`, `patientVisits`, `doctorVisitScope`, `assignedContract`, `rosterScope`, `familyScope`, `visitDetail`, `patientDocuments`, `MemberBook`, `VisitPages`, `download`, `writeBusinessAudit`
- `search_code("MedicalBooksService|medicalBooksApi|MedicalBookView")` → 24 file
- `search_code("patientVisits|patientDocuments|encounter.findMany|'Lần khám'|'Tài liệu'", path_filter=tests)` → 4 file test, không có test cho `patientVisits`
- Đọc trực tiếp: `prisma/schema.prisma` (model Prescription, PatientDocument, Encounter, enum PrescriptionStatus), số dòng thật của `PrescriptionPageQuery`, `doctorVisitScope`

## 7. Giới hạn của báo cáo này

- Graph index cũ hơn file (lệch số dòng); số dòng đã đối chiếu lại bằng đọc file, nhưng các cạnh CALLS có thể thiếu nếu code mới được thêm sau 01:33Z.
- Không có cạnh TESTS cho các symbol này; test liên quan tìm bằng text search, có thể sót test dùng tên khác.
- Không trace runtime; không kiểm tra hiệu năng thật trên dữ liệu production (mục 3.6 là suy luận từ schema).
- Chưa đọc hết `visitDetail` (dòng 485-548) và phía frontend mở chi tiết lượt khám (`VisitPage`, `ReadVisit`); kết luận ở mục 3.1 dựa trên điều kiện `where` ở đầu hàm.
- Các nghiệp vụ khác (kê đơn, chia sẻ đơn, xác nhận lượt khám, lịch hẹn, hợp đồng, telehealth) **không bị tác động**: plan không sửa thân `visitScope`, `doctorVisitScope`, `documentScope`, `familyScope`, `rosterScope`; đây là kết luận từ việc plan chỉ thêm hàm mới, không phải chứng minh tuyệt đối.

## 8. Khuyến nghị hành động

1. Sửa plan Task 3: `emr` → `clinicalEmr` (cả `where` và `select`).
2. Quyết định cách bác sĩ xem chi tiết lượt khám của bác sĩ khác: (a) thêm nhánh chỉ-đọc trong `visitDetail` khi có `patientId` và bác sĩ có HĐ ACTIVE + EMR đã chốt, hoặc (b) MVP ẩn nút "Xem chi tiết" với lượt khám không thuộc bác sĩ hiện tại. Không nới `visitScope` dùng chung.
3. Task 7: mở chi tiết lượt khám ngay trong tab timeline (dùng `VisitPage` với `medicalBooksApi.visit`) thay vì nhảy sang `VisitPages`; tránh phải sửa state của `VisitPages`.
4. Task 7: `downloadBookDocument(familyId, patientId, id, documentName)` trả Promise/throw, component tự giữ state đang tải/lỗi.
5. Task 2: thêm characterization test cho `patientVisits` trước bước refactor.
6. Quyết định với bác sĩ hết HĐ: ẩn tab "Dòng thời gian" (đồng bộ với tab "Tài liệu") hay hiện thông báo.
