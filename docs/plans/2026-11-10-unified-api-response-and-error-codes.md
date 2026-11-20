# Chuẩn Hóa Phản Hồi API Unified Envelope và Hệ Thống Mã Lỗi — Kế hoạch triển khai

**Mục tiêu:** Xây dựng và triển khai toàn diện hệ thống phản hồi API chuẩn hóa (Unified Envelope Pattern) tích hợp IETF RFC 9457 (Problem Details), ISO 8601 UTC và danh mục mã lỗi định danh dùng chung cho toàn bộ Famidoc Backend.

**Cách tiếp cận:** Tiếp cận theo mô hình TDD (Red -> Green -> Refactor), xây dựng từ tầng Core (Types, Enums, Exceptions, Utils) lên tầng Pipeline (Interceptor, Exception Filter, Swagger Decorator) và kích hoạt toàn cục trên NestJS Application.

**Đã tra cứu codebase (codebase-memory-mcp):**
- Đã xác nhận qua `get_architecture`: Dự án sử dụng NestJS 12, TypeScript, kiến trúc module hóa với các package `core`, `modules` (auth, contracts, doctors, patients, payments, care-packages, finance...).
- Đã xác nhận qua `search_graph`: Tồn tại `StandardApiResponseFilter` tại `src/core/filters/standard-api-response.filter.ts` nhưng mới chỉ được dùng cục bộ tại `auth.controller.ts`, thiếu trường chuẩn RFC 9457 (`invalidParams` 4 trường, `instance`, `type`).
- Đã xác nhận qua `get_code_snippet`: Controllers đang xử lý thủ công `rawRequestId` và `setHeader('X-Request-Id')`, DTO phân trang (`PaginationMetaDto`) bị phân mảnh giữa các module.
- Đã xác nhận qua `read_file` (`src/main.ts`): Chưa có Global Interceptor cho transform response và chưa đăng ký Global Filter `StandardApiResponseFilter`.

**Framework test & quy ước (đã xác nhận qua codebase-memory-mcp):**
- Framework: Jest (`node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit`)
- Vị trí đặt file test: Thư mục `__tests__` đặt cạnh source code hoặc file `*.spec.ts`
- Lệnh chạy test: `npm test -- <path-to-test-file>`

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Mọi mã lỗi định danh phải tuân theo chuẩn `UPPER_SNAKE_CASE`.
- Thời gian luôn định dạng theo ISO 8601 múi giờ UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- Mã trạng thái `code` trong body JSON luôn khớp 1:1 với HTTP Status Code ở Header.

---

### Task 1: Định nghĩa Types và Contracts dùng chung (Shared Types & Contracts)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `src/core/types/api-response.interface.ts`
- Chỉnh sửa: `src/modules/auth/dtos/auth-responses.dto.ts`
- Test tương ứng: `src/core/types/__tests__/api-response.interface.spec.ts`
- Kiểm chứng bằng: `npm test -- src/core/types/__tests__/api-response.interface.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `StandardApiResponseFilter`, `TransformResponseInterceptor`, các DTO response trong toàn bộ hệ thống.
- Gọi tới: Không có phụ thuộc bên ngoài.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/auth/__tests__/auth.controller.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Đặc tả chuẩn phản hồi Unified Envelope và Problem Details RFC 9457.
- Cung cấp đầu ra cho: Task 2 (Constants), Task 3 (Exceptions), Task 5 (Interceptor), Task 6 (Filter).

- [x] **Bước 1 [RED]: Viết test cho Type Guards và Contracts phản hồi chuẩn**
  Vị trí file test: `src/core/types/__tests__/api-response.interface.spec.ts`
  Test case: Kiểm tra hàm type guard `isSuccessResponse` và `isErrorResponse` phân biệt chính xác response thành công (`success: true`) và thất bại (`success: false`).
  Kỳ vọng: chạy `npm test -- src/core/types/__tests__/api-response.interface.spec.ts` → FAIL với lý do module chưa tồn tại.
- [x] **Bước 2 [GREEN]: Viết code tối thiểu tại src/core/types/api-response.interface.ts để test ở Bước 1 PASS**
  Định nghĩa các interface: `ApiSuccessResponse<T>`, `ApiErrorResponse`, `ApiResponse<T>`, `ProblemDetails`, `InvalidParamItem`, `PaginationMeta`, `CursorPaginationMeta`, cùng các hàm type guard `isSuccessResponse`, `isErrorResponse`.
  Kỳ vọng: chạy `npm test -- src/core/types/__tests__/api-response.interface.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR]: Tinh chỉnh cấu trúc export và tương thích ngược với auth-responses.dto.ts**
  Re-export các type từ `src/core/types/api-response.interface.ts` sang `src/modules/auth/dtos/auth-responses.dto.ts` để các module đang dùng không bị gãy import.
  Kỳ vọng: chạy `npm test -- src/core/types/__tests__/api-response.interface.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- src/core/types/__tests__/api-response.interface.spec.ts`)
  Kết quả mong đợi: tất cả PASS.

---

### Task 2: Định nghĩa Danh mục mã lỗi và Enum vi phạm dữ liệu (Shared Enums & Constants)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `src/core/constants/error-codes.constant.ts`
- Test tương ứng: `src/core/constants/__tests__/error-codes.constant.spec.ts`
- Kiểm chứng bằng: `npm test -- src/core/constants/__tests__/error-codes.constant.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Task 3 (Exceptions), Task 6 (Filter), các domain services (`auth`, `contracts`, `doctors`, `payments`).
- Gọi tới: Không có phụ thuộc bên ngoài.
- Regression test cần chạy thêm do có inbound calls: không cần.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (Types).
- Cung cấp đầu ra cho: Task 3 (Exceptions) và Task 6 (Filter).

- [x] **Bước 1 [RED]: Viết test cho hệ thống hằng số mã lỗi và hàm helper resolveErrorTypeUri**
  Vị trí file test: `src/core/constants/__tests__/error-codes.constant.spec.ts`
  Test case: Kiểm tra tất cả mã lỗi thuộc các nhóm `SYSTEM`, `AUTH`, `VALIDATION`, `CONTRACT`, `DOCTOR`, `PAYMENT` không bị trùng lặp giá trị; hàm `resolveErrorTypeUri` chuyển đổi mã lỗi thành URI RFC 9457 hợp lệ với tiền tố `https://api.famidoc.vn/errors/`.
  Kỳ vọng: chạy `npm test -- src/core/constants/__tests__/error-codes.constant.spec.ts` → FAIL với lý do file chưa tồn tại.
- [x] **Bước 2 [GREEN]: Viết code tối thiểu tại src/core/constants/error-codes.constant.ts để test ở Bước 1 PASS**
  Khai báo `SystemErrorCode`, `AuthErrorCode`, `ValidationErrorCode`, `ValidationIssue`, `ContractErrorCode`, `DoctorErrorCode`, `CarePackageErrorCode`, `PaymentErrorCode`, hằng số `ERROR_TYPE_BASE_URI` và hàm `resolveErrorTypeUri`.
  Kỳ vọng: chạy `npm test -- src/core/constants/__tests__/error-codes.constant.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR]: Tinh chỉnh bảng tra cứu URI để tối ưu hiệu năng O(1)**
  Sử dụng Record map hoặc switch case tinh gọn thay vì lồng chuỗi điều kiện.
  Kỳ vọng: chạy `npm test -- src/core/constants/__tests__/error-codes.constant.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- src/core/constants/__tests__/error-codes.constant.spec.ts`)
  Kết quả mong đợi: tất cả PASS.

---

### Task 3: Xây dựng Lớp Ngoại lệ nghiệp vụ cơ sở (BaseApiException & Domain Exceptions)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `src/core/exceptions/api.exception.ts`
- Test tương ứng: `src/core/exceptions/__tests__/api.exception.spec.ts`
- Kiểm chứng bằng: `npm test -- src/core/exceptions/__tests__/api.exception.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Toàn bộ các services trong `src/modules/*`.
- Gọi tới: `src/core/constants/error-codes.constant.ts`, `src/core/types/api-response.interface.ts`.
- Regression test cần chạy thêm do có inbound calls: không cần.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (Types) và Task 2 (Error Codes).
- Cung cấp đầu ra cho: Task 6 (Filter).

- [x] **Bước 1 [RED]: Viết test cho BaseApiException và các lớp ngoại lệ con**
  Vị trí file test: `src/core/exceptions/__tests__/api.exception.spec.ts`
  Test case: Kiểm tra `BaseApiException` kế thừa đúng `HttpException` của NestJS, mang đầy đủ `errorCode`, `status`, `detail`, `invalidParams`. Kiểm tra các lớp dẫn xuất: `ValidationException` (HTTP 422), `ResourceNotFoundException` (HTTP 404), `BusinessConflictException` (HTTP 409), `UnauthorizedApiException` (HTTP 401), `ForbiddenApiException` (HTTP 403).
  Kỳ vọng: chạy `npm test -- src/core/exceptions/__tests__/api.exception.spec.ts` → FAIL với lý do class chưa tồn tại.
- [x] **Bước 2 [GREEN]: Viết code tối thiểu tại src/core/exceptions/api.exception.ts để test ở Bước 1 PASS**
  Cài đặt `BaseApiException` cùng các subclass `ValidationException`, `ResourceNotFoundException`, `BusinessConflictException`, `UnauthorizedApiException`, `ForbiddenApiException`.
  Kỳ vọng: chạy `npm test -- src/core/exceptions/__tests__/api.exception.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR]: Chuẩn hóa hàm factory tạo ProblemDetails từ Exception instance**
  Bổ sung phương thức `toProblemDetails(instanceUri?: string): ProblemDetails` vào `BaseApiException` để giảm tải logic cho Filter.
  Kỳ vọng: chạy `npm test -- src/core/exceptions/__tests__/api.exception.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- src/core/exceptions/__tests__/api.exception.spec.ts`)
  Kết quả mong đợi: tất cả PASS.

---

### Task 4: Xây dựng Tiện ích Phân trang và DTO phân trang dùng chung (Pagination Utils & DTO)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `src/core/utils/pagination.helper.ts`
- Tạo mới: `src/core/dtos/pagination-query.dto.ts`
- Test tương ứng: `src/core/utils/__tests__/pagination.helper.spec.ts`
- Kiểm chứng bằng: `npm test -- src/core/utils/__tests__/pagination.helper.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Các Controller và Service xử lý danh sách (`care-packages`, `contracts`, `doctors`, `payments`).
- Gọi tới: `src/core/types/api-response.interface.ts`.
- Regression test cần chạy thêm do có inbound calls: không cần.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (Types).
- Cung cấp đầu ra cho: Task 5 (Transform Interceptor).

- [x] **Bước 1 [RED]: Viết test cho PaginationHelper và CursorHelper**
  Vị trí file test: `src/core/utils/__tests__/pagination.helper.spec.ts`
  Test case: Kiểm tra `PaginationHelper.createOffsetPagination` tính đúng `totalPages`, `hasNextPage`, `hasPreviousPage` cho các trường hợp: danh sách rỗng, trang đầu, trang giữa, trang cuối. Kiểm tra `CursorHelper.encode` và `CursorHelper.decode` mã hóa và giải mã chuẩn URL-safe Base64.
  Kỳ vọng: chạy `npm test -- src/core/utils/__tests__/pagination.helper.spec.ts` → FAIL với lý do helper chưa tồn tại.
- [x] **Bước 2 [GREEN]: Viết code tối thiểu tại src/core/utils/pagination.helper.ts và src/core/dtos/pagination-query.dto.ts để test ở Bước 1 PASS**
  Triển khai các phương thức tính toán phân trang và class `PaginationQueryDto` kế thừa các decorator `class-validator` (`@IsOptional`, `@IsInt`, `@Min`, `@Max`).
  Kỳ vọng: chạy `npm test -- src/core/utils/__tests__/pagination.helper.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR]: Xử lý an toàn các giá trị biên đầu vào (số âm, NaN, số thập phân)**
  Thêm logic clamp giá trị `page` tối thiểu là 1, `pageSize` tối thiểu là 1 và tối đa là 100.
  Kỳ vọng: chạy `npm test -- src/core/utils/__tests__/pagination.helper.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- src/core/utils/__tests__/pagination.helper.spec.ts`)
  Kết quả mong đợi: tất cả PASS.

---

### Task 5: Xây dựng Interceptor chuẩn hóa phản hồi thành công (TransformResponseInterceptor)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `src/core/interceptors/transform-response.interceptor.ts`
- Tạo mới: `src/core/decorators/bypass-transform.decorator.ts`
- Test tương ứng: `src/core/interceptors/__tests__/transform-response.interceptor.spec.ts`
- Kiểm chứng bằng: `npm test -- src/core/interceptors/__tests__/transform-response.interceptor.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Toàn bộ controller routes khi đăng ký Global Interceptor.
- Gọi tới: `src/core/types/api-response.interface.ts`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/core/health/__tests__/health.controller.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (Types), Task 4 (Pagination Utils).
- Cung cấp đầu ra cho: Task 8 (Đăng ký toàn cục).

- [x] **Bước 1 [RED]: Viết test cho TransformResponseInterceptor**
  Vị trí file test: `src/core/interceptors/__tests__/transform-response.interceptor.spec.ts`
  Test case: Mock `ExecutionContext` và `CallHandler`. Kiểm tra: 
  1. Phản hồi single resource trả về cấu trúc `{ success: true, code, message, data, timestamp, requestId }`.
  2. Phản hồi paginated resource (có `{ data, meta }`) giữ nguyên metadata và bọc đúng envelope.
  3. Bỏ qua transform khi route có gắn decorator `@BypassTransform()`.
  4. Header `X-Request-Id` được đồng bộ sang Response header.
  Kỳ vọng: chạy `npm test -- src/core/interceptors/__tests__/transform-response.interceptor.spec.ts` → FAIL với lý do interceptor chưa tồn tại.
- [x] **Bước 2 [GREEN]: Viết code tối thiểu tại src/core/interceptors/transform-response.interceptor.ts để test ở Bước 1 PASS**
  Triển khai class `TransformResponseInterceptor` implements `NestInterceptor` của NestJS với RxJS `map` operator.
  Kỳ vọng: chạy `npm test -- src/core/interceptors/__tests__/transform-response.interceptor.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR]: Xử lý tính lũy đẳng (Idempotent Wrapping) khi controller đã bọc sẵn envelope**
  Nếu kết quả trả về từ controller đã có sẵn cấu trúc `{ success: true, data: ... }` thì không bọc thêm tầng lồng thứ hai.
  Kỳ vọng: chạy `npm test -- src/core/interceptors/__tests__/transform-response.interceptor.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- src/core/interceptors/__tests__/transform-response.interceptor.spec.ts`)
  Kết quả mong đợi: tất cả PASS.

---

### Task 6: Nâng cấp Filter toàn cục chuẩn hóa phản hồi lỗi theo RFC 9457 (StandardApiResponseFilter)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `src/core/filters/standard-api-response.filter.ts`
- Test tương ứng: `src/core/filters/__tests__/standard-api-response.filter.spec.ts`
- Kiểm chứng bằng: `npm test -- src/core/filters/__tests__/standard-api-response.filter.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Toàn bộ controller routes khi đăng ký Global Filter.
- Gọi tới: `src/core/exceptions/api.exception.ts`, `src/core/constants/error-codes.constant.ts`, `src/core/types/api-response.interface.ts`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/modules/auth/__tests__/auth.controller.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (Types), Task 2 (Error Codes), Task 3 (Exceptions).
- Cung cấp đầu ra cho: Task 8 (Đăng ký toàn cục).

- [x] **Bước 1 [RED]: Viết test cho StandardApiResponseFilter nâng cấp chuẩn RFC 9457**
  Vị trí file test: `src/core/filters/__tests__/standard-api-response.filter.spec.ts`
  Test case: Kiểm tra các trường hợp bắt lỗi:
  1. `BaseApiException` trả về đầy đủ `errorCode`, `detail`, `title`, `type` và `instance`.
  2. `BadRequestException` từ `class-validator` bóc tách ra danh sách `invalidParams` chuẩn 4 trường (`field`, `issue`, `message`, `rejectedValue`).
  3. Lỗi 500 hệ thống không làm lộ stack trace và trả về `errorCode: INTERNAL_SERVER_ERROR`.
  4. Header `X-Request-Id` luôn có mặt trên response header.
  Kỳ vọng: chạy `npm test -- src/core/filters/__tests__/standard-api-response.filter.spec.ts` → FAIL do filter hiện tại chưa có các trường `instance`, `invalidParams` chuẩn và chưa xử lý `BaseApiException`.
- [x] **Bước 2 [GREEN]: Chỉnh sửa code tại src/core/filters/standard-api-response.filter.ts để test ở Bước 1 PASS**
  Nâng cấp hàm `catch()` bóc tách `BaseApiException`, chuẩn hóa `invalidParams` và gán URL hiện tại vào `instance`.
  Kỳ vọng: chạy `npm test -- src/core/filters/__tests__/standard-api-response.filter.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR]: Tách logic bóc tách validation params thành helper function riêng**
  Tách hàm `extractValidationErrors(resObj: any): InvalidParamItem[]` ra module con để code gọn gàng, dễ bảo trì.
  Kỳ vọng: chạy `npm test -- src/core/filters/__tests__/standard-api-response.filter.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- src/core/filters/__tests__/standard-api-response.filter.spec.ts`)
  Kết quả mong đợi: tất cả PASS.

---

### Task 7: Xây dựng Custom Decorator Swagger (ApiStandardResponse Decorator)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `src/core/decorators/api-standard-response.decorator.ts`
- Test tương ứng: `src/core/decorators/__tests__/api-standard-response.decorator.spec.ts`
- Kiểm chứng bằng: `npm test -- src/core/decorators/__tests__/api-standard-response.decorator.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Các Controller Swagger docs (`@ApiTags`, `@ApiOperation`).
- Gọi tới: `@nestjs/swagger`, `src/core/types/api-response.interface.ts`.
- Regression test cần chạy thêm do có inbound calls: không cần.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (Types).
- Cung cấp đầu ra cho: Hệ thống Swagger UI tại `/docs`.

- [x] **Bước 1 [RED]: Viết test cho decorator ApiStandardResponse**
  Vị trí file test: `src/core/decorators/__tests__/api-standard-response.decorator.spec.ts`
  Test case: Kiểm tra decorator tạo ra metadata OpenAPI chuẩn với schema gồm các trường: `success`, `code`, `message`, `data`, `meta`, `timestamp`, `requestId`.
  Kỳ vọng: chạy `npm test -- src/core/decorators/__tests__/api-standard-response.decorator.spec.ts` → FAIL với lý do decorator chưa tồn tại.
- [x] **Bước 2 [GREEN]: Viết code tối thiểu tại src/core/decorators/api-standard-response.decorator.ts để test ở Bước 1 PASS**
  Triển khai decorator gộp bằng cách dùng `applyDecorators` và `ApiExtraModels`, `ApiOkResponse`, `getSchemaPath`.
  Kỳ vọng: chạy `npm test -- src/core/decorators/__tests__/api-standard-response.decorator.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR]: Hỗ trợ tự động tạo schema cho trường hợp phân trang (isPaginated: true)**
  Bổ sung schema mẫu cho trường `meta.pagination` khi cờ `isPaginated` được bật.
  Kỳ vọng: chạy `npm test -- src/core/decorators/__tests__/api-standard-response.decorator.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- src/core/decorators/__tests__/api-standard-response.decorator.spec.ts`)
  Kết quả mong đợi: tất cả PASS.

---

### Task 8: Đăng ký Toàn cục trong Hệ thống và Kiểm thử Tích hợp (Global Registration & E2E Verification)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `src/main.ts`
- Tạo mới: `test/standard-api-response.e2e-spec.ts`
- Test tương ứng: `test/standard-api-response.e2e-spec.ts`
- Kiểm chứng bằng: `npm test -- test/standard-api-response.e2e-spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Toàn bộ HTTP traffic vào server.
- Gọi tới: `TransformResponseInterceptor`, `StandardApiResponseFilter`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/core/health/__tests__/health.controller.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 5 (Interceptor) và Task 6 (Filter).
- Cung cấp đầu ra cho: Toàn bộ hệ sinh thái Famidoc Backend.

- [x] **Bước 1 [RED]: Viết test E2E cho luồng phản hồi toàn cục**
  Vị trí file test: `test/standard-api-response.e2e-spec.ts`
  Test case: Tạo NestJS testing module với test controller chứa 3 endpoint: GET thành công, GET phân trang, POST vi phạm validation DTO. Kiểm tra:
  1. GET trả về HTTP 200 kèm envelope chuẩn, `requestId` đồng bộ Header và Body.
  2. POST sai DTO trả về HTTP 422 kèm RFC 9457 Problem Details (`invalidParams` chứa đúng trường lỗi).
  Kỳ vọng: chạy `npm test -- test/standard-api-response.e2e-spec.ts` → FAIL vì test app chưa được cấu hình Global Interceptor và Global Filter.
- [x] **Bước 2 [GREEN]: Đăng ký Global Interceptor và Global Filter tại src/main.ts để test ở Bước 1 PASS**
  Thêm `app.useGlobalInterceptors(new TransformResponseInterceptor());` và `app.useGlobalFilters(new StandardApiResponseFilter());` vào hàm `bootstrap()` trong `src/main.ts`. Cấu hình tương tự trong fixture test E2E.
  Kỳ vọng: chạy `npm test -- test/standard-api-response.e2e-spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR]: Chạy toàn bộ regression test suite của Core module**
  Chạy lại các test hiện có của `src/core/health/__tests__/health.controller.spec.ts` và `src/core/__tests__/jwt-auth-guard.spec.ts` để chứng minh không làm đứt gãy luồng cũ.
  Kỳ vọng: chạy `npm test -- src/core/health/__tests__/health.controller.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- test/standard-api-response.e2e-spec.ts`)
  Kết quả mong đợi: tất cả PASS.

