# Test 16 API của Nam bằng Thunder Client

Backend trên máy dùng cổng trong `.env` (hiện tại `http://localhost:3001`). Dùng Node 24. Backend này đang nối PostgreSQL VPS; bộ `npm run test:db` dùng DB local riêng, không dọn dữ liệu trên VPS.

## Tài khoản và dữ liệu mẫu

Mật khẩu nằm trong `.env.local`, biến `DEMO_SEED_PASSWORD`; file này được Git và Docker bỏ qua. Các tài khoản có cùng mật khẩu demo:

| Tài khoản | Vai trò |
|---|---|
| admin@demo.famidoc.invalid | Admin |
| facility@demo.famidoc.invalid | Healthcare Facility |
| doctor@demo.famidoc.invalid | Bác sĩ được phân công |
| family@demo.famidoc.invalid | Gia đình A, hợp đồng chờ trả tiền |
| family2@demo.famidoc.invalid | Gia đình B, hợp đồng demo đang phục vụ |

POST `/api/v1/auth/login`:

```json
{"identifier":"family2@demo.famidoc.invalid","password":"MẬT_KHẨU_TRONG_ENV_LOCAL"}
```

Copy accessToken trả về vào Auth → Bearer Token. Khi đổi vai trò để xác nhận phụ lục/khiếu nại, đăng nhập lại đúng tài khoản và dùng đúng token. Không tự sửa role trong body.

| Dữ liệu | ID |
|---|---|
| Hợp đồng A chờ thanh toán | 60000000-0000-4000-8000-000000000001 |
| Hợp đồng B đang phục vụ | 60000000-0000-4000-8000-000000000002 |
| Hợp đồng lịch sử TEST kỳ trước | 60000000-0000-4000-8000-000000000003 |
| Buổi khám B đã hoàn thành | 80000000-0000-4000-8000-000000000001 |
| Buổi khám B chưa hoàn thành | 80000000-0000-4000-8000-000000000002 |
| Thành viên đang được B bao phủ | 50000000-0000-4000-8000-000000000005 |
| Hai thành viên B có thể thêm | 50000000-0000-4000-8000-000000000006; 50000000-0000-4000-8000-000000000007 |
| Gói quý / năm | 70000000-0000-4000-8000-000000000002; 70000000-0000-4000-8000-000000000003 |

Các ID này là fixture. Nếu bạn đã tự thanh toán/chấm dứt/xác nhận thì trạng thái DB sẽ thay đổi theo thao tác của bạn; seed chạy lại không xóa lịch sử và không tự khôi phục hợp đồng đã đóng.

## 1. Hồ sơ và thông báo — API 53–56

Token của tài khoản nào thì các API dưới xử lý dữ liệu của chính tài khoản đó:

- GET `/api/v1/users/profile`
- PUT `/api/v1/users/profile`: `{"fullName":"DEMO - Nguyễn Hoài Nam"}`
- GET `/api/v1/notifications?page=1&limit=20&unreadOnly=true`
- PATCH `/api/v1/notifications/{id}/read`: dùng ID trong danh sách, không cần body.

Thử role/email/phone trong PUT sẽ bị 400. Dùng ID thông báo của tài khoản khác sẽ bị 404.

## 2. Đánh giá — API 49

Token Family B, POST `/api/v1/reviews/doctors`:

```json
{"encounterId":"80000000-0000-4000-8000-000000000001","ratingStars":5,"reviewComment":"DEMO - Bác sĩ giải thích dễ hiểu."}
```

Lần đầu 201; lần thứ hai cùng buổi khám 409. Dùng buổi chưa hoàn thành 409; dùng Family A để đánh giá buổi của B 404; bác sĩ không tự đánh giá mình.

## 3. Khiếu nại — API 50–52

Token Family B, POST `/api/v1/complaints`:

```json
{"contractId":"60000000-0000-4000-8000-000000000002","encounterId":"80000000-0000-4000-8000-000000000001","category":"MISSED_VISIT","description":"DEMO - Gia đình đề nghị kiểm tra chất lượng phục vụ."}
```

Lấy ID trả về. GET `/api/v1/complaints/{id}` để xem. Sau đó PATCH `/api/v1/complaints/{id}/resolve` theo thứ tự:

1. **Admin:** `{"action":"INVESTIGATE","notes":"DEMO - Tiếp nhận và đề nghị CSYT xác minh."}`
2. **CSYT phụ trách:** `{"action":"FACILITY_RESPONSE","notes":"DEMO - Đã đối chiếu lịch và giải trình của bác sĩ."}`
3. **Admin:** `{"action":"RESOLVE","outcome":"SERVICE_CORRECTION","notes":"DEMO - Yêu cầu CSYT điều chỉnh quy trình phục vụ."}`
4. **Admin:** `{"action":"CLOSE","notes":"DEMO - Các bên đã được thông báo kết quả xử lý."}`

Outcome khác: NO_VIOLATION, WARNING, REFERRED_TO_FACILITY. Không có REFUND hoặc bồi thường tiền. Bác sĩ phụ trách cũng có thể gửi phản ánh; hệ thống tự xác định người còn lại từ hợp đồng.

Nếu có bằng chứng, thêm evidenceKeys dạng `<userId>/complaints/<ten-object>`. Đây là object key sau bước upload của media stack, không phải URL bất kỳ. Seed không giả lập file có thật trên MinIO.

## 4. Phụ lục — API 44 và các route xác nhận hỗ trợ

Làm khi hợp đồng B còn ACTIVE. Token Family B, POST `/api/v1/contracts/60000000-0000-4000-8000-000000000002/addendums`:

Mua thêm một lần khám tại nhà:

```json
{"requestKey":"c1000000-0000-4000-8000-000000000001","type":"QUOTA_EXPANSION","extraHomeVisits":1}
```

Hoặc mua thêm quyền sử dụng cho hai người (vẫn cùng gói hiện tại, không chọn riêng ID người):

```json
{"requestKey":"c1000000-0000-4000-8000-000000000002","type":"MEMBER_EXTENSION","additionalMembers":2}
```

Gói áp dụng cho toàn bộ hồ sơ gia đình đang ACTIVE. Khi gia đình tăng số người, cần mua đủ số chỗ còn thiếu. Nâng/gia hạn hợp đồng sẽ tự đếm toàn bộ hồ sơ ACTIVE trong DB để tính giá, không nhận `memberIds`.

requestKey dùng để chống gửi trùng. Dùng cùng key + cùng nội dung trả cùng phụ lục; đổi nội dung mà giữ key sẽ bị 409. Mỗi yêu cầu mới dùng một UUID mới.

Phí thêm người chỉ tính phần vượt số người đã bao gồm, theo ngày còn lại, làm tròn tổng lên 1.000đ. Xem additionalAmount trả về thay vì tự nhập giá. Thêm người không cộng lượt video/khám và không đổi ngày kết thúc.

Lấy addendumId và termsHash trả về, có thể đọc lại bằng GET `/api/v1/contracts/{contractId}/addendums/{addendumId}/terms`.

Dùng lần lượt token **Family B → Admin → CSYT → Doctor**, PUT `/api/v1/contracts/{contractId}/addendums/{addendumId}/sign`:

```json
{"termsHash":"GIÁ_TRỊ_TERMSHASH_TRẢ_VỀ","acceptedTerms":true}
```

Phụ lục có phí chờ thanh toán ở phần 5. Phụ lục phí 0 có hiệu lực khi đủ xác nhận, không phát hóa đơn 0đ.

## 5. VietQR, webhook và trạng thái — API 41–43

Token Family A, POST `/api/v1/payments/vietqr` để trả tiền gói:

```json
{"contractId":"60000000-0000-4000-8000-000000000001"}
```

Hoặc token Family B để trả tiền phụ lục đã đủ xác nhận:

```json
{"contractId":"60000000-0000-4000-8000-000000000002","addendumId":"ID_PHỤ_LỤC"}
```

Lấy id/paymentCode/transferContent/amountVnd/expiresAt. Hiển thị `transferContent` là nội dung khách cần chuyển, không tự nối tên hoặc đổi mã trên frontend. GET `/api/v1/payments/{id}/status`. Backend tính tiền từ DB, không nhận amount do client tự ghi. Mã còn hạn được dùng lại; mã hết hạn thì tạo mã mới.

QR của từng hóa đơn được backend điền đủ tài khoản/ngân hàng nhận tiền, số tiền và nội dung. Khách chỉ quét, kiểm tra người nhận rồi xác nhận chuyển khoản trên app ngân hàng. Không nhận số tiền hay nội dung thanh toán do frontend tự tạo.

Nội dung QR mới có dạng `NGUYEN HOAI NAM - FD123456`. Tên lấy từ User.fullName của người đại diện gia đình, bỏ dấu/chuyển hoa và rút gọn nếu quá dài; không nhận tên/nội dung do client tự khai trong API tạo thanh toán. Phần mã FD là căn cứ ghép hóa đơn, tên chỉ để nhìn lịch sử dễ hơn. `transferContent` được lưu trong invoices.transfer_content; đổi tên tài khoản sau đó không đổi QR đã phát hành.

Trong SePay → Cấu hình chung → Cấu trúc mã thanh toán: bật nhận diện, tiền tố **FD**, hậu tố tối thiểu **6**, tối đa **6**, loại **Số nguyên**, trạng thái **Đang hoạt động**. Sau đó webhook bật **Chỉ gửi khi có mã thanh toán**, lọc tiền tố FD. Tên đứng trước FD do backend điền vào QR, không nhập tên vào ô tiền tố SePay. Test mode và Live cấu hình riêng.

PostgreSQL sequence `payment_code_number_seq` cấp số riêng cho từng lần thanh toán, dùng chung TEST/LIVE và mọi server. Đây không phải bảng nghiệp vụ; DB vẫn có 30 bảng. Không reset hoặc tái sử dụng mã: sau FD999999, API tạm dừng tạo mã và cần mở rộng định dạng, không quay về FD000001. Hóa đơn cũ không bị đổi mã; backend vẫn nhận mã 24/32 ký tự. Nếu còn QR cũ đang chờ trả tiền, duy trì cấu hình nhận diện cũ trong giai đoạn chuyển đổi hoặc chờ chúng hết hạn trước khi giới hạn bộ lọc vào 6 chữ số.

Tài liệu SePay: https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan ; https://docs.sepay.vn/tao-qr-code-vietqr-dong.html

QR chỉ giúp điền sẵn, không thể bắt buộc mọi app ngân hàng khóa ô số tiền/nội dung. Nếu khách sửa rồi chuyển sai, backend giữ giao dịch để đối soát và không tự kích hoạt gói. Frontend chỉ hiển thị đã thanh toán khi API trạng thái trả PAID; không căn cứ vào nút “Đã chuyển tiền”. Khi chưa có webhook hợp lệ, hiển thị “Đang chờ xác nhận thanh toán”.

Ba chế độ:

- `simulation`: local development, tài khoản TEST_BANK/0000000000, qrUrl=null. Không có chuyển tiền thật.
- `sepay_test`: nhận webhook từ Test mode SePay, dùng bank/account/key của sandbox bạn đã cấu hình.
- `live`: dùng tài khoản và key thật đã cấu hình; hợp đồng isDemo=true không được thanh toán trong chế độ này. Không tự bật live từ body HTTP.

POST `/api/v1/payments/webhook/vietqr` là route SePay gọi, không dùng Bearer Token người dùng. Hỗ trợ HMAC hoặc API key theo SEPAY_WEBHOOK_AUTH. HMAC ký đúng `{timestamp}.{raw_body}`, header X-SePay-Timestamp và X-SePay-Signature. API key dùng `Authorization: Apikey <key-cấu-hình>`.

Ví dụ body mô phỏng, lấy số tiền/mã từ invoice thực tế, dùng id và referenceCode mới, ngày giờ Việt Nam hiện tại:

```json
{"id":990001,"gateway":"TEST_BANK","transactionDate":"YYYY-MM-DD HH:mm:ss","accountNumber":"0000000000","code":"PAYMENT_CODE","content":"PAYMENT_CODE","transferType":"in","transferAmount":1000000,"referenceCode":"DEMO-REF-990001"}
```

Không gửi bằng cách bỏ xác thực. Bộ test tự động đã ký payload để thử webhook hợp lệ/sai, thiếu tiền, callback đồng thời và replay. Chưa gửi giao dịch thật tới tài khoản SePay của nhóm vì chưa có cấu hình/phiên đăng nhập SePay ở đây.

Khi PAID nhưng chưa đủ điều kiện cấp quyền, Admin có thể POST `/api/v1/payments/requests/{id}/recheck-activation` sau khi xử lý nguyên nhân. Route này không bỏ qua chữ ký, panel cap hoặc thời hạn.

## 6. Doanh thu và quyết toán — API 47–48

Admin hoặc CSYT: GET `/api/v1/finance/analytics?year=YYYY&month=MM&environment=TEST`. Chọn kỳ trước theo giờ Việt Nam để thấy hóa đơn lịch sử DEMO. CSYT chỉ xem đơn vị mình. Mặc định environment=LIVE nên dữ liệu demo không lẫn vào báo cáo thật.

Admin, POST `/api/v1/finance/settlements/monthly`:

```json
{"year":YYYY,"month":MM,"environment":"TEST","action":"PREPARE"}
```

Trả bảng PENDING, transferExecuted=false. Lưu riêng từng hóa đơn để không cộng lại khi gọi trùng. Ví dụ hóa đơn mẫu 1.000.000đ, VAT đã ghi 0đ: nền tảng 150.000đ, CSYT 850.000đ.

Chỉ sau khi **đã chuyển khoản và đối chiếu ngoài hệ thống**, Admin xác nhận:

```json
{"environment":"TEST","action":"CONFIRM_TRANSFER","settlementId":"ID_BẢNG_QUYẾT_TOÁN","bankTransferOrderId":"MÃ_GIAO_DỊCH_ĐÃ_ĐỐI_CHIẾU","amountPaidVnd":850000,"paidAt":"THỜI_ĐIỂM_ISO_8601","evidenceKey":"USER_ID_ADMIN/settlements/chung-tu.pdf"}
```

Nếu thất bại: `{"environment":"TEST","action":"MARK_FAILED","settlementId":"ID","failureReason":"Nội dung lỗi đã kiểm tra"}`. Không đánh dấu SETTLED khi chỉ mới lập bảng hoặc chưa thực hiện chuyển khoản. Hóa đơn đến muộn sau khi kỳ đã chốt trả 409 để được rà soát điều chỉnh, không âm thầm sửa bảng đã xác nhận.

## 7. Chấm dứt và nâng/gia hạn gói — API 46, 45

Nên thử sau các mục trên vì duyệt chấm dứt sẽ khóa quyền dịch vụ của hợp đồng B.

Family B, PATCH `/api/v1/contracts/{id}/terminate`:

```json
{"action":"REQUEST","reason":"DEMO - Các bên thống nhất kết thúc dịch vụ trước hạn."}
```

Lấy requestId (id trả về) và termsHash. CSYT và Doctor dùng token riêng, cùng PATCH:

```json
{"action":"CONSENT","requestId":"ID_ĐỀ_NGHỊ","termsHash":"HASH_ĐỀ_NGHỊ"}
```

Admin duyệt:

```json
{"action":"APPROVE","requestId":"ID_ĐỀ_NGHỊ","termsHash":"HASH_ĐỀ_NGHỊ"}
```

Family đã đồng ý khi gửi REQUEST. Admin cần đủ đồng ý và không còn buổi IN_PROGRESS. Hệ thống đóng mã chưa trả tiền/lịch chưa thực hiện, giải phóng panel, giữ bệnh án/tiền đã thu. Admin có thể REJECT kèm reason khi không chấp thuận.

Sau khi hợp đồng cũ kết thúc, Family B POST `/api/v1/contracts/{oldId}/upgrade`:

```json
{"kind":"UPGRADE","packageId":"70000000-0000-4000-8000-000000000002"}
```

Gia hạn cùng dòng gói dùng kind=RENEWAL và packageId thuộc cùng lineageCode. Hợp đồng mới PENDING_APPROVAL, không cộng dồn thời gian/lượt. GET `/api/v1/contracts/{newId}/terms`, rồi từng bên PUT `/api/v1/contracts/{newId}/sign-upgrade` với termsHash và acceptedTerms như mục 4. Đủ bốn bên mới tạo thanh toán cho newId ở mục 5.

## Chạy kiểm thử tự động

- `npm test -- --runInBand`: unit và kiểm tra tên hàm tài liệu.
- `npm run test:db`: HTTP + PostgreSQL/Redis local. Chỉ chạy với hostname local và tên DB kết thúc `_test`.
- `npm run build`: build NestJS.

Seed `npm run db:seed` chỉ nạp fixture DEMO khi ALLOW_DEMO_SEED=1 trong `.env.local`; không xóa dữ liệu. Không dùng seed để biến hợp đồng chưa ký thành hợp đồng pháp lý. Các xác nhận trong code là ghi nhận tài khoản chấp thuận điều khoản, chưa tích hợp nhà cung cấp chữ ký số CA.

## Thay đổi DB sau khi gộp bảng

Còn 30 bảng nghiệp vụ, cộng bảng `_prisma_migrations` là 31 bảng. Đã bỏ bảng riêng cho thành viên hợp đồng, xác nhận phụ lục và yêu cầu chấm dứt. Số người nằm trong `medical_contracts.member_count`; xác nhận phụ lục trong `contract_signatures.addendum_id`; lịch sử chấm dứt trong `medical_contracts.termination_requests`. Bảng `facility_settlement_items` vẫn giữ để đối soát chi tiết. Các migration cũ vẫn giữ để cài đặt và cập nhật DB theo thứ tự.

API GET `/api/v1/contracts/{id}/terms` trả thêm `memberCount` là số người hiện đã mua, tách với báo giá ban đầu trong `terms`. Demo B trên VPS đang có 3 hồ sơ ACTIVE nhưng mới mua 1 chỗ: có thể dùng ví dụ `additionalMembers: 2` ở trên để kiểm tra mua đủ cho cả gia đình. Không tự tăng chỗ đã mua chỉ vì thêm hồ sơ. Khi tạo DB test mới, hai hồ sơ bổ sung được seed INACTIVE và chỉ đổi ACTIVE khi kiểm tra việc thêm người.
