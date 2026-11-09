# Đối chiếu 16 API của Nam với code và sequence

Nguồn: bảng phân công mới ngày 31/10/2026: https://docs.google.com/spreadsheets/d/1S06OS98mzCVfxPNidvNnFGOmNd5GN9kl/edit

Các tên trong bảng dưới là tên **đã có trong code**. Cột STT giữ nguyên 41–56 trong bảng phân công. Controller nhận HTTP, service xử lý quy tắc, repository đọc/ghi PostgreSQL qua Prisma.

## Danh sách đúng 16 API

| STT | UC | HTTP endpoint | Controller | Service | Việc xử lý |
|---:|---|---|---|---|---|
| 41 | UC-33 | `POST /api/v1/payments/vietqr` | `PaymentsController.createVietQRPayment` | `PaymentsServiceImpl.createVietQRPayment` | Lấy giá đã chốt, kiểm tra đủ xác nhận và tạo/reuse hóa đơn 15 phút. |
| 42 | UC-34 | `POST /api/v1/payments/webhook/vietqr` | `SePayWebhookController.handleVietQRWebhook` | `PaymentsServiceImpl.handleVietQRWebhook` | Xác thực nguồn, chống trùng, đối chiếu tiền và cập nhật quyền trong cùng transaction. |
| 43 | UC-33 | `GET /api/v1/payments/{paymentId}/status` | `PaymentsController.getPaymentStatus` | `PaymentsServiceImpl.getPaymentStatus` | Chỉ trả hóa đơn thuộc gia đình đang đăng nhập hoặc tài khoản Admin. |
| 44 | UC-17 | `POST /api/v1/contracts/{id}/addendums` | `ContractsController.createContractAddendum` | `ContractsServiceImpl.createContractAddendum` | Lập phụ lục thêm người hoặc mua thêm khám tại nhà. Chưa cấp quyền ngay. |
| 45 | UC-18 | `POST /api/v1/contracts/{id}/upgrade` | `ContractsController.createPackageUpgradeContract` | `ContractsServiceImpl.createPackageUpgradeContract` | Tạo hợp đồng mới sau khi hợp đồng cũ hết hạn/chấm dứt; không cộng dồn quyền lợi. |
| 46 | UC-19 | `PATCH /api/v1/contracts/{id}/terminate` | `ContractsController.terminateContract` | `ContractsServiceImpl.terminateContract` | Đề nghị → các bên đồng ý → Admin duyệt; giữ tiền đã thu và bệnh án. |
| 47 | UC-35 | `GET /api/v1/finance/analytics` | `FinanceController.getRevenueAnalytics` | `FinanceServiceImpl.getRevenueAnalytics` | Báo cáo tiền đã đối soát, thuế đã ghi trên hóa đơn và tỷ lệ 15%/85%. |
| 48 | UC-35 | `POST /api/v1/finance/settlements/monthly` | `FinanceController.executeMonthlySettlement` | `FinanceServiceImpl.executeMonthlySettlement` | Lập bảng kỳ trước, theo dõi từng hóa đơn, xác nhận kết quả chuyển khoản thủ công. |
| 49 | UC-36 | `POST /api/v1/reviews/doctors` | `ReviewsController.submitDoctorReview` | `ReviewsServiceImpl.submitDoctorReview` | Gia đình đánh giá một lần sau ca khám hoàn thành; cập nhật điểm bác sĩ. |
| 50 | UC-37 | `POST /api/v1/complaints` | `ComplaintsController.submitIncidentComplaint` | `ComplaintsServiceImpl.submitIncidentComplaint` | Gia đình/bác sĩ được phân công gửi phản ánh gắn đúng hợp đồng. |
| 51 | UC-38 | `GET /api/v1/complaints/{id}` | `ComplaintsController.getComplaintDetail` | `ComplaintsServiceImpl.getComplaintDetail` | Chỉ các bên trong hợp đồng và Admin được xem tiến trình. |
| 52 | UC-38 | `PATCH /api/v1/complaints/{id}/resolve` | `ComplaintsController.resolveComplaint` | `ComplaintsServiceImpl.resolveComplaint` | Admin thụ lý, CSYT xác minh, Admin kết luận phi tài chính và đóng hồ sơ. |
| 53 | UC-10 | `GET /api/v1/users/profile` | `UsersController.getCurrentUserProfile` | `UsersServiceImpl.getCurrentUserProfile` | Xem hồ sơ của chính tài khoản đang đăng nhập; không lộ password hash. |
| 54 | UC-10 | `PUT /api/v1/users/profile` | `UsersController.updateUserProfile` | `UsersServiceImpl.updateUserProfile` | Sửa tên/avatar của mình; không tự sửa role, trạng thái, email hoặc điện thoại đã xác thực. |
| 55 | UC-11 | `GET /api/v1/notifications` | `NotificationsController.getUserNotifications` | `NotificationsServiceImpl.getUserNotifications` | Phân trang và lọc thông báo chưa đọc của đúng người nhận. |
| 56 | UC-11 | `PATCH /api/v1/notifications/{id}/read` | `NotificationsController.markNotificationAsRead` | `NotificationsServiceImpl.markNotificationAsRead` | Đánh dấu đã đọc đúng thông báo của mình; gọi lại không tạo tác dụng phụ. |

## Cách chuyển thành sequence

1. Người dùng gửi HTTP tới controller đúng route trong bảng.
2. Với API cần đăng nhập: Nest gọi `JwtAuthGuard.canActivate`, và `RolesGuard.canActivate` nếu route quy định vai trò. Webhook dùng `SePayWebhookGuard.canActivate` thay JWT.
3. Controller gọi đúng hàm service cùng tên trong bảng.
4. Với nghiệp vụ nhiều bước, service gọi repository.transaction và dùng session trong callback. Participant đọc/ghi DB là lớp Prisma...Session, không phải một dịch vụ bên ngoài.
5. Dùng alt cho các điều kiện lỗi và loop cho xác nhận nhiều bên, danh sách hóa đơn hoặc thông báo. Chỉ vẽ các nhánh thật sự liên quan UC của biểu đồ đó.

`serializable` mở transaction và thử lại khi DB báo xung đột đồng thời. `writeBusinessAudit` ghi người thao tác/loại thao tác/ID, không chép bệnh án vào audit chung. `notifyContractParties` gửi thông báo trạng thái cho các bên liên quan.

## Chi tiết hàm để vẽ từng sequence

### 41. createVietQRPayment — UC-33

`POST /api/v1/payments/vietqr`

Dùng alt cho hợp đồng/phụ lục; thiếu xác nhận trả 409. Mã còn hạn được dùng lại. QR của simulation là null; sepay_test/live trả URL VietQR từ dữ liệu backend. Giá và số người không lấy trực tiếp từ body. `PrismaPaymentsSession.nextPaymentNumber` lấy số từ PostgreSQL sequence, `createPaymentCode` định dạng FD + 6 chữ số, `buildTransferContent` ghép tên tài khoản không dấu với mã. Nội dung này lưu cùng hóa đơn; `withQrCode` điền acc/bank/amount/des từ dữ liệu đã lưu. `extractPaymentCodes` vẫn nhận mã cũ 32 ký tự và không ghép một phần của mã bị sửa.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `PaymentsController.createVietQRPayment` | `src/modules/payments/controllers/payments.controller.ts:35` |
| 2 | `PaymentsServiceImpl.createVietQRPayment` | `src/modules/payments/services/impl/payments.service.impl.ts:55` |
| 3 | `PaymentsRepositoryImpl.transaction` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:106` |
| 4 | `PrismaPaymentsSession.findContract` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:218` |
| 5 | `PrismaPaymentsSession.contractEntity` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:124` |
| 6 | `missingActivationRequirements` | `src/modules/payments/activation/contract-activation.ts:4` |
| 7 | `PaymentsServiceImpl.otherActiveContractExists` | `src/modules/payments/services/impl/payments.service.impl.ts:428` |
| 8 | `PrismaPaymentsSession.listRequests` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:380` |
| 9 | `PrismaPaymentsSession.nextPaymentNumber` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:118` |
| 10 | `createPaymentCode` | `src/modules/payments/sepay/sepay-transaction.helpers.ts:8` |
| 11 | `buildTransferContent` | `src/modules/payments/sepay/sepay-transaction.helpers.ts:18` |
| 12 | `PrismaPaymentsSession.saveRequest` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:394` |
| 13 | `PaymentsServiceImpl.withQrCode` | `src/modules/payments/services/impl/payments.service.impl.ts:403` |

### 42. handleVietQRWebhook — UC-34

`POST /api/v1/payments/webhook/vietqr`

Dùng alt: trùng ID cùng nội dung → ACK lại; cùng ID khác nội dung → 409; sai mã/tài khoản/số tiền/thời hạn → lưu REVIEW_REQUIRED. Chỉ nhánh MATCHED mới đánh PAID và thử cấp quyền. Thiếu điều kiện cấp quyền thì vẫn giữ tiền PAID để kiểm tra, không tự hoàn.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `SePayWebhookController.handleVietQRWebhook` | `src/modules/payments/controllers/sepay-webhook.controller.ts:27` |
| 2 | `PaymentsServiceImpl.handleVietQRWebhook` | `src/modules/payments/services/impl/payments.service.impl.ts:195` |
| 3 | `SePayWebhookGuard.canActivate` | `src/modules/payments/guards/sepay-webhook.guard.ts:21` |
| 4 | `PaymentsRepositoryImpl.transaction` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:106` |
| 5 | `PrismaPaymentsSession.findTransaction` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:424` |
| 6 | `transactionFingerprint` | `src/modules/payments/sepay/sepay-transaction.helpers.ts:76` |
| 7 | `extractPaymentCodes` | `src/modules/payments/sepay/sepay-transaction.helpers.ts:54` |
| 8 | `PrismaPaymentsSession.findRequestByCode` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:371` |
| 9 | `PaymentsServiceImpl.reconciliationReason` | `src/modules/payments/services/impl/payments.service.impl.ts:297` |
| 10 | `PrismaPaymentsSession.findTransactionByReference` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:435` |
| 11 | `PrismaPaymentsSession.saveTransaction` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:450` |
| 12 | `PrismaPaymentsSession.saveRequest` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:394` |
| 13 | `PaymentsServiceImpl.activateInTransaction` | `src/modules/payments/services/impl/payments.service.impl.ts:352` |
| 14 | `PrismaPaymentsSession.saveContract` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:307` |
| 15 | `activateAddendumRights` | `src/modules/contracts/activation/activate-addendum.ts:9` |

### 43. getPaymentStatus — UC-33

`GET /api/v1/payments/{paymentId}/status`

Nếu mã PENDING đã hết hạn thì lưu EXPIRED trước khi trả. Hóa đơn của gia đình khác trả 404. TEST/LIVE được tra cứu riêng.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `PaymentsController.getPaymentStatus` | `src/modules/payments/controllers/payments.controller.ts:46` |
| 2 | `PaymentsServiceImpl.getPaymentStatus` | `src/modules/payments/services/impl/payments.service.impl.ts:134` |
| 3 | `PaymentsRepositoryImpl.transaction` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:106` |
| 4 | `PrismaPaymentsSession.findRequest` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:362` |
| 5 | `PaymentsServiceImpl.assertPaymentOwner` | `src/modules/payments/services/impl/payments.service.impl.ts:416` |
| 6 | `PrismaPaymentsSession.saveRequest` | `src/modules/payments/repositories/impl/payments.repository.impl.ts:394` |

### 44. createContractAddendum — UC-17

`POST /api/v1/contracts/{id}/addendums`

Hai loại hiện tại: QUOTA_EXPANSION mua thêm khám tại nhà và MEMBER_EXTENSION thêm người. Không bán lượt video. Người thêm còn trong số đã bao gồm thì phí 0. Vượt số đã bao gồm tính theo số ngày còn lại, làm tròn tổng lên 1.000đ. Tối đa 6 người. Gia hạn kỳ tiếp theo dùng hợp đồng mới với kind=RENEWAL.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `ContractsController.createContractAddendum` | `src/modules/contracts/controllers/contracts.controller.ts:42` |
| 2 | `ContractsServiceImpl.createContractAddendum` | `src/modules/contracts/services/impl/contracts.service.impl.ts:63` |
| 3 | `ContractsRepositoryImpl.transaction` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:27` |
| 4 | `PrismaContractsSession.findContractForUpdate` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:35` |
| 5 | `getContractSignerRole` | `src/core/business/business-helpers.ts:13` |
| 6 | `ContractsServiceImpl.assertContractServing` | `src/modules/contracts/services/impl/contracts.service.impl.ts:629` |
| 7 | `PrismaContractsSession.findAddendumByKey` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:73` |
| 8 | `readFrozenContractTerms` | `src/modules/contracts/pricing/contract-change-pricing.ts:5` |
| 9 | `PrismaContractsSession.countFamilyMembers` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:47` |
| 10 | `calculateHomeVisitAddendum` | `src/modules/contracts/pricing/contract-change-pricing.ts:21` |
| 11 | `calculateMemberAddendum` | `src/modules/contracts/pricing/contract-change-pricing.ts:37` |
| 12 | `createTermsHash` | `src/core/business/business-helpers.ts:32` |
| 13 | `PrismaContractsSession.createAddendum` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:86` |
| 14 | `PrismaContractsSession.recordChange` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:228` |

### 45. createPackageUpgradeContract — UC-18

`POST /api/v1/contracts/{id}/upgrade`

Dùng alt cho source chưa kết thúc → 409; đã có bản nâng cùng điều khoản → trả lại bản đó; chưa có → tạo PENDING_APPROVAL. Các xác nhận cũ không được sao chép. Ngày/lượt/tiền chưa dùng của hợp đồng cũ không được cộng vào hợp đồng mới.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `ContractsController.createPackageUpgradeContract` | `src/modules/contracts/controllers/contracts.controller.ts:49` |
| 2 | `ContractsServiceImpl.createPackageUpgradeContract` | `src/modules/contracts/services/impl/contracts.service.impl.ts:163` |
| 3 | `ContractsRepositoryImpl.transaction` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:27` |
| 4 | `PrismaContractsSession.findContractForUpdate` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:35` |
| 5 | `PrismaContractsSession.updateContractStatus` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:101` |
| 6 | `PrismaContractsSession.refreshDoctorPanel` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:116` |
| 7 | `PrismaContractsSession.findOpenUpgrade` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:56` |
| 8 | `PrismaContractsSession.hasOtherActiveContract` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:50` |
| 9 | `PrismaContractsSession.findPackage` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:44` |
| 10 | `PrismaContractsSession.countFamilyMembers` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:47` |
| 11 | `calculateCarePackageQuote` | `src/modules/care-packages/pricing/calculate-care-package-quote.ts:9` |
| 12 | `PrismaContractsSession.createUpgrade` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:95` |
| 13 | `PrismaContractsSession.recordChange` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:228` |

### 46. terminateContract — UC-19

`PATCH /api/v1/contracts/{id}/terminate`

Phải vẽ các nhánh action. REQUEST chỉ lưu đề nghị. CONSENT ghi nhận đúng tài khoản của từng bên. APPROVE chỉ Admin, sau đồng ý của gia đình/CSYT/bác sĩ và không còn ca IN_PROGRESS. Sau đó đóng mã chưa trả tiền, hủy lịch chưa thực hiện và cập nhật panel. Không xóa bệnh án hoặc thay hóa đơn PAID.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `ContractsController.terminateContract` | `src/modules/contracts/controllers/contracts.controller.ts:56` |
| 2 | `ContractsServiceImpl.terminateContract` | `src/modules/contracts/services/impl/contracts.service.impl.ts:435` |
| 3 | `ContractsRepositoryImpl.transaction` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:27` |
| 4 | `PrismaContractsSession.findContractForUpdate` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:35` |
| 5 | `getContractSignerRole` | `src/core/business/business-helpers.ts:13` |
| 6 | `PrismaContractsSession.findPendingTermination` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:137` |
| 7 | `PrismaContractsSession.createTermination` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:151` |
| 8 | `PrismaContractsSession.findTermination` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:144` |
| 9 | `PrismaContractsSession.updateTermination` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:175` |
| 10 | `PrismaContractsSession.hasEncounterInProgress` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:192` |
| 11 | `PrismaContractsSession.updateContractStatus` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:101` |
| 12 | `PrismaContractsSession.cancelUnpaidRights` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:198` |
| 13 | `PrismaContractsSession.refreshDoctorPanel` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:116` |
| 14 | `PrismaContractsSession.recordChange` | `src/modules/contracts/repositories/impl/contracts.repository.impl.ts:228` |

### 47. getRevenueAnalytics — UC-35

`GET /api/v1/finance/analytics`

Mặc định kỳ trước theo giờ Việt Nam, environment=LIVE. Muốn xem demo cần environment=TEST trong development. CSYT chỉ có số liệu đơn vị mình. Chỉ lấy invoice PAID có giao dịch MATCHED đúng môi trường và quyền dịch vụ đã được cấp.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `FinanceController.getRevenueAnalytics` | `src/modules/finance/controllers/finance.controller.ts:38` |
| 2 | `FinanceServiceImpl.getRevenueAnalytics` | `src/modules/finance/services/impl/finance.service.impl.ts:31` |
| 3 | `FinanceServiceImpl.resolveReportingPeriod` | `src/modules/finance/services/impl/finance.service.impl.ts:261` |
| 4 | `FinanceRepositoryImpl.transaction` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:16` |
| 5 | `PrismaFinanceSession.findFacilityForUser` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:24` |
| 6 | `PrismaFinanceSession.findEligibleInvoices` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:30` |
| 7 | `FinanceServiceImpl.getInvoiceShares` | `src/modules/finance/services/impl/finance.service.impl.ts:255` |
| 8 | `calculateRevenueShares` | `src/modules/finance/pricing/revenue-sharing.ts:2` |
| 9 | `PrismaFinanceSession.countUnmatchedTransactions` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:60` |
| 10 | `PrismaFinanceSession.findSettlements` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:69` |

### 48. executeMonthlySettlement — UC-35

`POST /api/v1/finance/settlements/monthly`

PREPARE lập/cập nhật bảng PENDING và lưu FacilitySettlementItem, chưa chuyển tiền. MARK_FAILED lưu lỗi. CONFIRM_TRANSFER kiểm tra số tiền, mã giao dịch, thời điểm và object key chứng từ của Admin rồi mới SETTLED. Đây là đối soát thủ công; chưa có hàm tự gửi tiền tới ngân hàng. Bảng đã chốt không ghi đè; hóa đơn không được vào hai kỳ.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `FinanceController.executeMonthlySettlement` | `src/modules/finance/controllers/finance.controller.ts:44` |
| 2 | `FinanceServiceImpl.executeMonthlySettlement` | `src/modules/finance/services/impl/finance.service.impl.ts:84` |
| 3 | `FinanceServiceImpl.resolveReportingPeriod` | `src/modules/finance/services/impl/finance.service.impl.ts:261` |
| 4 | `FinanceRepositoryImpl.transaction` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:16` |
| 5 | `PrismaFinanceSession.findEligibleInvoices` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:30` |
| 6 | `PrismaFinanceSession.findPeriodSettlement` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:85` |
| 7 | `PrismaFinanceSession.createSettlement` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:102` |
| 8 | `calculateRevenueShares` | `src/modules/finance/pricing/revenue-sharing.ts:2` |
| 9 | `PrismaFinanceSession.createSettlementItems` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:105` |
| 10 | `PrismaFinanceSession.updateSettlement` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:110` |
| 11 | `FinanceServiceImpl.recordTransferResult` | `src/modules/finance/services/impl/finance.service.impl.ts:187` |
| 12 | `PrismaFinanceSession.findSettlement` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:80` |
| 13 | `PrismaFinanceSession.recordFinanceEvent` | `src/modules/finance/repositories/impl/finance.repository.impl.ts:116` |

### 49. submitDoctorReview — UC-36

`POST /api/v1/reviews/doctors`

Dùng alt cho sai gia đình → 404; buổi chưa hoàn thành → 409; đã đánh giá → 409. Điểm bình quân và tổng đánh giá tính từ DB trong cùng transaction.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `ReviewsController.submitDoctorReview` | `src/modules/reviews/controllers/reviews.controller.ts:33` |
| 2 | `ReviewsServiceImpl.submitDoctorReview` | `src/modules/reviews/services/impl/reviews.service.impl.ts:21` |
| 3 | `ReviewsRepositoryImpl.transaction` | `src/modules/reviews/repositories/impl/reviews.repository.impl.ts:14` |
| 4 | `PrismaReviewsSession.findEncounter` | `src/modules/reviews/repositories/impl/reviews.repository.impl.ts:22` |
| 5 | `PrismaReviewsSession.findReview` | `src/modules/reviews/repositories/impl/reviews.repository.impl.ts:28` |
| 6 | `PrismaReviewsSession.createReview` | `src/modules/reviews/repositories/impl/reviews.repository.impl.ts:31` |
| 7 | `PrismaReviewsSession.updateDoctorRating` | `src/modules/reviews/repositories/impl/reviews.repository.impl.ts:34` |
| 8 | `PrismaReviewsSession.recordReviewAudit` | `src/modules/reviews/repositories/impl/reviews.repository.impl.ts:49` |

### 50. submitIncidentComplaint — UC-37

`POST /api/v1/complaints`

Chỉ Family Representative hoặc bác sĩ phụ trách. Target được suy ra từ hợp đồng, không lấy tùy ý từ client. Bằng chứng là object key trong vùng người gửi; API này không tự tải file lên MinIO.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `ComplaintsController.submitIncidentComplaint` | `src/modules/complaints/controllers/complaints.controller.ts:39` |
| 2 | `ComplaintsServiceImpl.submitIncidentComplaint` | `src/modules/complaints/services/impl/complaints.service.impl.ts:28` |
| 3 | `ComplaintsRepositoryImpl.transaction` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:19` |
| 4 | `PrismaComplaintsSession.findContract` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:27` |
| 5 | `getContractSignerRole` | `src/core/business/business-helpers.ts:13` |
| 6 | `PrismaComplaintsSession.encounterBelongsToContract` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:33` |
| 7 | `PrismaComplaintsSession.createComplaint` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:39` |
| 8 | `PrismaComplaintsSession.recordComplaintEvent` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:51` |

### 51. getComplaintDetail — UC-38

`GET /api/v1/complaints/{id}`

Không vẽ bước đọc toàn bộ EMR. Phản hồi chỉ có nội dung phản ánh, bằng chứng tham chiếu và trạng thái/xác minh/kết luận được phân quyền.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `ComplaintsController.getComplaintDetail` | `src/modules/complaints/controllers/complaints.controller.ts:45` |
| 2 | `ComplaintsServiceImpl.getComplaintDetail` | `src/modules/complaints/services/impl/complaints.service.impl.ts:86` |
| 3 | `ComplaintsRepositoryImpl.transaction` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:19` |
| 4 | `PrismaComplaintsSession.findComplaint` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:42` |
| 5 | `ComplaintsServiceImpl.assertComplaintAccess` | `src/modules/complaints/services/impl/complaints.service.impl.ts:195` |

### 52. resolveComplaint — UC-38

`PATCH /api/v1/complaints/{id}/resolve`

INVESTIGATE: Admin mở thụ lý. FACILITY_RESPONSE: CSYT phụ trách ghi giải trình. RESOLVE: Admin chốt sau xác minh. CLOSE: Admin đóng hồ sơ đã giải quyết. Các outcome đều phi tài chính; không có refund/compensation.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `ComplaintsController.resolveComplaint` | `src/modules/complaints/controllers/complaints.controller.ts:51` |
| 2 | `ComplaintsServiceImpl.resolveComplaint` | `src/modules/complaints/services/impl/complaints.service.impl.ts:100` |
| 3 | `ComplaintsRepositoryImpl.transaction` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:19` |
| 4 | `PrismaComplaintsSession.findComplaint` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:42` |
| 5 | `ComplaintsServiceImpl.assertComplaintAccess` | `src/modules/complaints/services/impl/complaints.service.impl.ts:195` |
| 6 | `PrismaComplaintsSession.updateComplaint` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:48` |
| 7 | `PrismaComplaintsSession.recordComplaintEvent` | `src/modules/complaints/repositories/impl/complaints.repository.impl.ts:51` |

### 53. getCurrentUserProfile — UC-10

`GET /api/v1/users/profile`

userId từ JWT guard, không có tham số để xem hồ sơ người khác. Select các trường được phép trả về.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `UsersController.getCurrentUserProfile` | `src/modules/users/controllers/users.controller.ts:32` |
| 2 | `UsersServiceImpl.getCurrentUserProfile` | `src/modules/users/services/impl/users.service.impl.ts:19` |
| 3 | `UsersRepositoryImpl.findProfile` | `src/modules/users/repositories/impl/users.repository.impl.ts:11` |

### 54. updateUserProfile — UC-10

`PUT /api/v1/users/profile`

DTO chỉ nhận fullName/avatarUrl. Nếu bổ sung đổi email/phone sau này phải có bước xác thực riêng. Update và audit log cùng thành công hoặc cùng bị hủy.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `UsersController.updateUserProfile` | `src/modules/users/controllers/users.controller.ts:36` |
| 2 | `UsersServiceImpl.updateUserProfile` | `src/modules/users/services/impl/users.service.impl.ts:24` |
| 3 | `UsersRepositoryImpl.updateUserProfile` | `src/modules/users/repositories/impl/users.repository.impl.ts:17` |
| 4 | `writeBusinessAudit` | `src/core/business/business-helpers.ts:47` |

### 55. getUserNotifications — UC-11

`GET /api/v1/notifications`

WHERE user_id luôn lấy từ JWT. Danh sách, tổng số và số chưa đọc lấy từ cùng một snapshot DB. unreadOnly là chuỗi true/false, không ép Boolean("false").

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `NotificationsController.getUserNotifications` | `src/modules/notifications/controllers/notifications.controller.ts:35` |
| 2 | `NotificationsServiceImpl.getUserNotifications` | `src/modules/notifications/services/impl/notifications.service.impl.ts:14` |
| 3 | `NotificationsRepositoryImpl.getUserNotifications` | `src/modules/notifications/repositories/impl/notifications.repository.impl.ts:9` |

### 56. markNotificationAsRead — UC-11

`PATCH /api/v1/notifications/{id}/read`

UPDATE có đồng thời id và userId. Không tìm thấy hoặc không thuộc người nhận đều trả 404. Đã đọc rồi vẫn trả bản ghi đã đọc.

| Bước | Hàm thực tế | Nơi tìm trong project |
|---:|---|---|
| 1 | `NotificationsController.markNotificationAsRead` | `src/modules/notifications/controllers/notifications.controller.ts:42` |
| 2 | `NotificationsServiceImpl.markNotificationAsRead` | `src/modules/notifications/services/impl/notifications.service.impl.ts:17` |
| 3 | `NotificationsRepositoryImpl.markNotificationAsRead` | `src/modules/notifications/repositories/impl/notifications.repository.impl.ts:30` |

## Các bước hỗ trợ cần vẽ cùng phụ lục/nâng gói

- GET `/api/v1/contracts/{id}/terms`: `ContractsController.getContractChangeTerms` → `ContractsServiceImpl.getContractChangeTerms`.
- GET `/api/v1/contracts/{id}/addendums/{addendumId}/terms`: `ContractsController.getAddendumTerms` → cùng hàm service ở trên, trả dấu nhận dạng termsHash của bản điều khoản.
- PUT `/api/v1/contracts/{id}/addendums/{addendumId}/sign`: `ContractsServiceImpl.signContractAddendum` → `validateAcceptance` → `assertSigningOrder` → `PrismaContractsSession.saveAddendumSignature`.
- PUT `/api/v1/contracts/{id}/sign-upgrade`: `ContractsServiceImpl.signUpgradedContract` → `calculateContractTermsHash` → `validateAcceptance` → `assertSigningOrder` → `PrismaContractsSession.saveUpgradeSignature`.
- Thứ tự xác nhận: Family Representative → Admin → Healthcare Facility → assigned Doctor.
- Phụ lục phí 0 được cấp quyền khi đủ xác nhận. Phụ lục có phí chờ webhook trả tiền. Cả hai dùng `activateAddendumRights` để chỉ cập nhật đúng một lần.
- POST `/api/v1/payments/requests/{id}/recheck-activation`: Admin gọi lại bước kiểm tra cấp quyền nếu tiền đã nhận nhưng trước đó thiếu điều kiện. Service dùng `PaymentsServiceImpl.tryActivate`.

**Phạm vi xác nhận:** các API trên lưu việc tài khoản đã chấp thuận đúng bản điều khoản và thời điểm, không tích hợp nhà cung cấp chứng thư số/CA. Sequence hiện tại không có bước ký bằng CA bên ngoài. Hợp đồng ban đầu UC-16 vẫn thuộc phần việc của Hiếu; route sign-upgrade chỉ phục vụ hợp đồng nâng/gia hạn được tạo trong module này.

## Những điểm cần đồng bộ trong tài liệu

- Có 16 API của Nam. Có thêm các route hỗ trợ để đọc/xác nhận điều khoản, hủy mã chờ và kiểm tra cấp quyền; chúng không thay tên của 16 API đã phân công.
- Hoàn tiền, bồi thường tài chính và ví bác sĩ không thuộc các luồng này.
- Thu tiền qua VietQR/SePay vào tài khoản nền tảng. Quyết toán cho CSYT theo 15%/85%, CSYT trả bác sĩ theo chính sách nội bộ.
- Chia doanh thu từ hóa đơn đã đối soát trong kỳ, tách thuế đã ghi nhận, không tự áp một mức VAT cho mọi khoản.
- Xác nhận đã chuyển tiền hiện là thao tác đối soát của Admin với mã giao dịch/chứng từ. Không có kết nối chuyển khoản tự động để vẽ thêm vào sequence.
- Bằng chứng khiếu nại/quyết toán lưu object key. Upload, kiểm tra file thật và cấp URL MinIO là phần media stack; các API này không tự thực hiện upload.
- Gia hạn/nâng gói tạo hợp đồng mới không chồng lấn, không lấy ngày/lượt còn thừa của gói trước. Hợp đồng mới vẫn phải được các bên xác nhận và thanh toán.

## Bảo vệ tên hàm khỏi lệch tài liệu

Test `src/core/__tests__/nam-sequence-alignment.spec.ts` đọc TypeScript AST để kiểm tra: đủ 16 route/tên controller, có hàm service cùng tên, và các hàm Class.method được tham chiếu trong file này thật sự tồn tại. Khi đổi tên hàm, sửa lại bảng này cùng lúc để test tiếp tục đạt.

Tài liệu kỹ thuật SePay đã đối chiếu:
- https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc
- https://docs.sepay.vn/tao-qr-code-vietqr-dong.html

## Chỉ mục các hàm hỗ trợ quan trọng

| Hàm | File và dòng thực tế |
|---|---|
| `JwtAuthGuard.canActivate` | `src/core/auth/jwt-auth.guard.ts:31` |
| `RolesGuard.canActivate` | `src/core/auth/roles.guard.ts:18` |
| `serializable` | `src/core/database/prisma-transaction.ts:6` |
| `getContractSignerRole` | `src/core/business/business-helpers.ts:13` |
| `createTermsHash` | `src/core/business/business-helpers.ts:32` |
| `calculateContractTermsHash` | `src/modules/contracts/pricing/contract-terms-hash.ts:13` |
| `readFrozenContractTerms` | `src/modules/contracts/pricing/contract-change-pricing.ts:5` |
| `calculateHomeVisitAddendum` | `src/modules/contracts/pricing/contract-change-pricing.ts:21` |
| `calculateMemberAddendum` | `src/modules/contracts/pricing/contract-change-pricing.ts:37` |
| `ensureSupportedAmount` | `src/modules/contracts/pricing/contract-change-pricing.ts:67` |
| `calculateCarePackageQuote` | `src/modules/care-packages/pricing/calculate-care-package-quote.ts:9` |
| `calculateRevenueShares` | `src/modules/finance/pricing/revenue-sharing.ts:2` |
| `todayInVietnam` | `src/core/business/business-helpers.ts:35` |
| `getVietnamMonthWindow` | `src/core/business/business-helpers.ts:41` |
| `writeBusinessAudit` | `src/core/business/business-helpers.ts:47` |
| `notifyContractParties` | `src/core/business/business-helpers.ts:64` |
| `activateAddendumRights` | `src/modules/contracts/activation/activate-addendum.ts:9` |
| `missingActivationRequirements` | `src/modules/payments/activation/contract-activation.ts:4` |
| `addContractMonths` | `src/modules/payments/activation/contract-activation.ts:25` |
| `parseSePayDate` | `src/modules/payments/sepay/sepay-transaction.helpers.ts:39` |
| `extractPaymentCodes` | `src/modules/payments/sepay/sepay-transaction.helpers.ts:54` |
| `transactionFingerprint` | `src/modules/payments/sepay/sepay-transaction.helpers.ts:76` |
| `PaymentsServiceImpl.withQrCode` | `src/modules/payments/services/impl/payments.service.impl.ts:403` |
| `ContractsServiceImpl.toContractSummary` | `src/modules/contracts/services/impl/contracts.service.impl.ts:595` |

## Cấu trúc dữ liệu sau khi gộp bảng

- Gói dành cho cả gia đình: `medical_contracts.member_count` là số người đã mua; `service_packages` lưu số người cơ bản, tối đa và phí thêm người/tháng. Phụ lục tăng số lượng, không chọn ID người được hưởng dịch vụ.
- `contract_signatures`: `addendum_id = NULL` là xác nhận hợp đồng; có ID là xác nhận phụ lục. Hai nhóm có unique index riêng, không dùng xác nhận nhóm này cho nhóm kia.
- `medical_contracts.termination_requests`: danh sách yêu cầu chấm dứt và xác nhận/phê duyệt, giữ cả yêu cầu bị từ chối. `termination_reason` và `terminated_at` vẫn lưu kết quả cuối cùng. Hàm `PrismaContractsSession.readTerminationRequests` đọc danh sách; `createTermination` thêm yêu cầu và `updateTermination` cập nhật đúng yêu cầu trong transaction đã khóa hợp đồng.
- `facility_settlement_items` được giữ nguyên để bàn giao từng hóa đơn và chống quyết toán trùng.
- `legacy_member_ids` chỉ giữ dữ liệu trước chuyển đổi để đối chiếu hash đã ký; không phải danh sách phân quyền của gói mới.

## Kết quả kiểm tra ngày 31/10/2026

- 189 unit test đạt, gồm 19 test đối chiếu route/tên hàm trong tài liệu này.
- 38 integration test với PostgreSQL/Redis local đạt; có luồng đầy đủ cho cả 16 API và 2 route đăng ký sau khi gộp dev.
- 31 lượt smoke HTTP tới bản backend nối DB VPS đạt.
- Nest build, TypeScript check và Docker image build đạt. Lint không có error; còn cảnh báo unbound-method trong test cũ.
- DB VPS có 30 bảng nghiệp vụ và 1 bảng migration; schema khớp Prisma, không có drift. Đã sao lưu trước cập nhật. Migration gộp bảng đã được thử trên bản sao riêng với chữ ký phụ lục và yêu cầu chấm dứt có dữ liệu; dữ liệu chuyển đủ, unique index vẫn chặn ký trùng.
- Backend local: http://localhost:3001. Chưa deploy source/image mới lên endpoint công khai của nhóm, chưa commit/push.

Cần cấu hình trước khi dùng thực tế: key/tài khoản/webhook SePay theo môi trường; quy tắc thuế/chứng từ đã chốt; xác nhận chuyển tiền của Admin. Chưa tích hợp CA và chưa đăng ký cron tự chạy ngày 5; hệ thống hiện cung cấp API để Admin/hạ tầng scheduler gọi. Npm audit trong Docker vẫn báo 6 cảnh báo high ở dependency production; chưa nâng major hoặc dùng audit fix --force trong phạm vi này.
