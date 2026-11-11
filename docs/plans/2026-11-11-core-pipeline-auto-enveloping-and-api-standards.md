# Chuẩn Hóa Toàn Diện Tầng Lõi Kiến Trúc (Core Pipeline Auto-Enveloping & Domain Error Resolver) — Kế hoạch triển khai

**Mục tiêu:** Xây dựng cơ chế chuẩn hóa phản hồi tự động ở tầng lõi NestJS Pipeline, đảm bảo 100% API đạt chuẩn Unified Envelope (`ApiSuccessResponse<T>`), định danh mã lỗi chi tiết theo phân hệ (`ApiErrorResponse` RFC 9457), đồng bộ tài liệu Swagger và xử lý đúng chuẩn cho Webhook mà không cần sửa thủ công 89 endpoints.

**Cách tiếp cận:** Tiếp cận theo TDD (Red -> Green -> Refactor), nâng cấp trực tiếp 3 trụ cột tầng Core: (1) Interceptor tự động bypass webhook kết hợp decorator tường minh, (2) Exception Filter bổ sung Contextual Domain Error Code Resolver, (3) Swagger OpenAPI Post-Processor tự động bọc schema envelope toàn cục cho tài liệu `/docs` và `openapi.json`.

**Đã tra cứu codebase (codebase-memory-mcp):**
- Đã xác nhận qua `get_architecture`: Dự án sử dụng NestJS 12, TypeScript, kiến trúc module hóa với các package `core` (134 nodes) và `modules` (677 nodes).
- Đã xác nhận qua `trace_path`: `BypassTransform` hiện có 0 caller trong production; `TransformResponseInterceptor` được gọi từ `src/main.ts` dòng 25 và các file test integration/e2e.
- Đã xác nhận qua `get_code_snippet`: `SePayWebhookController` tại `src/modules/payments/controllers/sepay-webhook.controller.ts` xử lý 2 route `webhooks/sepay/test` và `api/v1/payments/webhook/vietqr`, trả về `{ success: true }` nhưng chưa có decorator `@BypassTransform()`.
- Đã xác nhận qua `read_file`: `StandardApiResponseFilter` tại `src/core/filters/standard-api-response.filter.ts` đang fallback về các mã lỗi generic `RESOURCE_NOT_FOUND`, `BAD_REQUEST` khi bắt `HttpException` thuần.
- Đã xác nhận qua `read_file`: `src/main.ts` và `scripts/export-openapi.ts` đang gọi `SwaggerModule.createDocument(app, swaggerConfig)` trực tiếp mà chưa qua khâu wrap envelope tự động.

**Framework test & quy ước (đã xác nhận qua codebase-memory-mcp):**
- Framework: Jest (`node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit`)
- Vị trí đặt file test: Thư mục `__tests__` đặt cạnh source code hoặc file `*.spec.ts`
- Lệnh chạy test: `npm test -- <path-to-test-file>`

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Mọi mã lỗi định danh phải tuân theo chuẩn `UPPER_SNAKE_CASE` và hằng số trong `src/core/constants/error-codes.constant.ts`.
- Không được làm đứt gãy luồng hoạt động của các API cũ và không thay đổi logic nghiệp vụ trong Services.
- Swagger UI (`/docs`) và file `openapi.json` phải phản ánh chính xác cấu trúc `ApiSuccessResponse` với đầy đủ các trường `success`, `code`, `message`, `data`, `meta`, `timestamp`, `requestId`.

---

### Task 1: Nâng cấp Interceptor Tự Động Nhận Diện Webhook & Gắn Bypass Cho SePay Webhook

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `src/core/interceptors/transform-response.interceptor.ts` (Class `TransformResponseInterceptor`)
- Chỉnh sửa: `src/modules/payments/controllers/sepay-webhook.controller.ts` (Class `SePayWebhookController`)
- Test tương ứng: `src/core/interceptors/__tests__/transform-response.interceptor.spec.ts`
- Kiểm chứng bằng: `npm test -- src/core/interceptors/__tests__/transform-response.interceptor.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Toàn bộ HTTP traffic thành công của ứng dụng.
- Gọi tới: `@nestjs/common`, `src/core/decorators/bypass-transform.decorator.ts`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- test/standard-api-response.e2e-spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Cấu hình `BYPASS_TRANSFORM_KEY` và URL route pattern.
- Cung cấp đầu ra cho: Cổng thanh toán SePay và các cổng Webhook bên thứ 3 trong tương lai.

- [ ] **Bước 1 [RED]: Viết test kiểm tra Interceptor tự động bypass khi route là Webhook hoặc có decorator @BypassTransform**
  Vị trí file test: `src/core/interceptors/__tests__/transform-response.interceptor.spec.ts`
  Test case: Mock `ExecutionContext` với request URL `/api/v1/payments/webhook/vietqr` và `/webhooks/sepay/test`. Kiểm tra interceptor trả về dữ liệu gốc `{ success: true }` mà không bọc thêm envelope `{ success: true, data: { success: true } }`.
  Kỳ vọng: chạy `npm test -- src/core/interceptors/__tests__/transform-response.interceptor.spec.ts` → FAIL do interceptor hiện tại vẫn bọc envelope nếu thiếu decorator.
- [ ] **Bước 2 [GREEN]: Nâng cấp code tại src/core/interceptors/transform-response.interceptor.ts và gắn decorator tại sepay-webhook.controller.ts**
  Thêm kiểm tra đường dẫn URL chứa `/webhook/` hoặc `/webhooks/` vào điều kiện bypass tự động; gắn `@BypassTransform()` lên `SePayWebhookController`.
  Kỳ vọng: chạy `npm test -- src/core/interceptors/__tests__/transform-response.interceptor.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Tinh chỉnh hàm helper kiểm tra URL bypass để hỗ trợ cấu hình mở rộng**
  Tách logic kiểm tra `isWebhookOrExternalPath(url: string): boolean` thành helper function nội bộ rõ ràng.
  Kỳ vọng: chạy `npm test -- src/core/interceptors/__tests__/transform-response.interceptor.spec.ts` → vẫn PASS.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- src/core/interceptors/__tests__/transform-response.interceptor.spec.ts` và `npm test -- test/standard-api-response.e2e-spec.ts`)
  Kết quả mong đợi: tất cả PASS.

---

### Task 2: Xây dựng Bộ Phân Giải Mã Lỗi Ngữ Cảnh Domain trong StandardApiResponseFilter

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `src/core/filters/standard-api-response.filter.ts` (Class `StandardApiResponseFilter`)
- Test tương ứng: `src/core/filters/__tests__/standard-api-response.filter.spec.ts`
- Kiểm chứng bằng: `npm test -- src/core/filters/__tests__/standard-api-response.filter.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Toàn bộ HTTP traffic lỗi của ứng dụng (Global Exception Filter).
- Gọi tới: `src/core/constants/error-codes.constant.ts`, `src/core/types/api-response.interface.ts`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/core/__tests__/standard-api-response.integration.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `HttpException` thuần từ các Services và URL request (`instance`).
- Cung cấp đầu ra cho: Client/Frontend nhận được mã lỗi nghiệp vụ chuẩn theo từng phân hệ.

- [ ] **Bước 1 [RED]: Viết test kiểm tra Filter ánh xạ mã lỗi ngữ cảnh domain khi nhận HttpException thuần**
  Vị trí file test: `src/core/filters/__tests__/standard-api-response.filter.spec.ts`
  Test case: 
  1. Ném `NotFoundException` với instance URL `/api/v1/contracts/123` → Filter phải trả về `errorCode: CONTRACT_NOT_FOUND`.
  2. Ném `NotFoundException` với instance URL `/api/v1/doctors/456` → Filter phải trả về `errorCode: DOCTOR_NOT_FOUND`.
  3. Ném `NotFoundException` với instance URL `/api/v1/care-packages/789` → Filter phải trả về `errorCode: PACKAGE_NOT_FOUND`.
  4. Ném `NotFoundException` với instance URL không xác định `/api/v1/unknown` → Filter fallback về `RESOURCE_NOT_FOUND`.
  Kỳ vọng: chạy `npm test -- src/core/filters/__tests__/standard-api-response.filter.spec.ts` → FAIL do filter hiện tại chỉ trả về `RESOURCE_NOT_FOUND` chung chung.
- [ ] **Bước 2 [GREEN]: Cài đặt Contextual Error Code Resolver trong src/core/filters/standard-api-response.filter.ts**
  Bổ sung phương thức `resolveContextualErrorCode(status: HttpStatus, instanceUrl: string, exceptionResponse: any): string` sử dụng bảng ánh xạ tiền tố route (`/api/v1/contracts`, `/api/v1/doctors`, `/api/v1/care-packages`, `/api/v1/payments`, `/api/v1/auth`).
  Kỳ vọng: chạy `npm test -- src/core/filters/__tests__/standard-api-response.filter.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Tối ưu hóa bảng tra cứu định danh mã lỗi với cấu trúc RoutePattern Mapping**
  Sử dụng mảng cấu hình quy tắc `{ pattern: RegExp, statusMap: Record<number, string> }` giúp dễ dàng mở rộng thêm module mới mà không sửa logic cốt lõi của filter.
  Kỳ vọng: chạy `npm test -- src/core/filters/__tests__/standard-api-response.filter.spec.ts` → vẫn PASS.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- src/core/filters/__tests__/standard-api-response.filter.spec.ts`)
  Kết quả mong đợi: tất cả PASS.

---

### Task 3: Xây dựng Bộ Chuyển Đổi Schema Tự Động Cho Swagger (Swagger Envelope Post-Processor)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `src/core/swagger/swagger-envelope.transformer.ts` (Function `transformOpenApiWithEnvelope`)
- Test tương ứng: `src/core/swagger/__tests__/swagger-envelope.transformer.spec.ts`
- Kiểm chứng bằng: `npm test -- src/core/swagger/__tests__/swagger-envelope.transformer.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `src/main.ts` (Swagger UI bootstrap) và `scripts/export-openapi.ts` (lệnh export file).
- Gọi tới: `@nestjs/swagger`, `src/core/types/api-response.interface.ts`.
- Regression test cần chạy thêm do có inbound calls: không có.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `OpenAPIObject` do `SwaggerModule.createDocument()` sinh ra.
- Cung cấp đầu ra cho: Giao diện `/docs` và file `openapi.json` được bọc chuẩn Unified Envelope 100%.

- [ ] **Bước 1 [RED]: Viết test cho hàm transformOpenApiWithEnvelope**
  Vị trí file test: `src/core/swagger/__tests__/swagger-envelope.transformer.spec.ts`
  Test case: Tạo mock document OpenAPI với 1 route bình thường trả về object, 1 route danh sách trả về array, 1 route webhook có cờ bypass. Kiểm tra:
  1. Route bình thường có response 200 được bọc vào envelope với các trường `success`, `code`, `message`, `data`, `meta: null`, `timestamp`, `requestId`.
  2. Route danh sách (list) có `meta.pagination` được bổ sung cấu trúc phân trang chuẩn `page`, `pageSize`, `totalRecords`, `totalPages`.
  3. Route webhook giữ nguyên schema gốc không bị bọc envelope.
  4. Route đã bọc sẵn bằng `ApiStandardResponse` không bị bọc lồng lần thứ hai.
  Kỳ vọng: chạy `npm test -- src/core/swagger/__tests__/swagger-envelope.transformer.spec.ts` → FAIL với lý do transformer chưa tồn tại.
- [ ] **Bước 2 [GREEN]: Viết code tối thiểu tại src/core/swagger/swagger-envelope.transformer.ts để test ở Bước 1 PASS**
  Triển khai hàm `transformOpenApiWithEnvelope(document: OpenAPIObject): OpenAPIObject` duyệt qua `document.paths`, bóc tách schema của response HTTP 200/201 và đóng gói vào Envelope Schema.
  Kỳ vọng: chạy `npm test -- src/core/swagger/__tests__/swagger-envelope.transformer.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Xử lý chuẩn hóa các trường hợp tham chiếu $ref và Type array**
  Đảm bảo nếu schema gốc dùng `$ref` (ví dụ `#/components/schemas/CarePackageDto`) thì schema mới giữ nguyên `$ref` trong trường `data`.
  Kỳ vọng: chạy `npm test -- src/core/swagger/__tests__/swagger-envelope.transformer.spec.ts` → vẫn PASS.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- src/core/swagger/__tests__/swagger-envelope.transformer.spec.ts`)
  Kết quả mong đợi: tất cả PASS.

---

### Task 4: Tích hợp Tầng Lõi Vào main.ts, export-openapi.ts và Kiểm thử Tích hợp Toàn diện

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `src/main.ts`
- Chỉnh sửa: `scripts/export-openapi.ts`
- Chỉnh sửa: `scripts/audit-api-standards.ts`
- Test tương ứng: `test/standard-api-response.e2e-spec.ts`
- Kiểm chứng bằng: `npm test -- test/standard-api-response.e2e-spec.ts` và `npm run audit:apis`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Toàn bộ quá trình khởi động máy chủ và build pipeline.
- Gọi tới: `src/core/swagger/swagger-envelope.transformer.ts`, `TransformResponseInterceptor`, `StandardApiResponseFilter`.
- Regression test cần chạy thêm do có inbound calls: `npm test -- src/core/health/__tests__/health.controller.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (Interceptor), Task 2 (Filter), Task 3 (Swagger Transformer).
- Cung cấp đầu ra cho: 100% hệ thống API Famidoc Backend đạt chuẩn tuyệt đối.

- [ ] **Bước 1 [RED]: Viết test E2E kiểm tra Swagger Document và Webhook Bypass sau khi khởi tạo ứng dụng NestJS**
  Vị trí file test: `test/standard-api-response.e2e-spec.ts`
  Test case: Tạo NestJS testing application, kiểm tra endpoint `/docs-json` trả về OpenAPI spec đã có envelope bọc quanh các endpoint thông thường, và endpoint webhook `/api/v1/payments/webhook/vietqr` trả về dữ liệu phẳng không bọc envelope.
  Kỳ vọng: chạy `npm test -- test/standard-api-response.e2e-spec.ts` → FAIL do `main.ts` và E2E fixture chưa tích hợp `transformOpenApiWithEnvelope`.
- [ ] **Bước 2 [GREEN]: Tích hợp transformOpenApiWithEnvelope vào src/main.ts, scripts/export-openapi.ts và cập nhật audit-api-standards.ts**
  1. Trong `src/main.ts`, bọc hàm `documentFactory` bằng `transformOpenApiWithEnvelope(SwaggerModule.createDocument(app, swaggerConfig))`.
  2. Trong `scripts/export-openapi.ts`, áp dụng tương tự trước khi ghi file `openapi.json`.
  3. Cập nhật `scripts/audit-api-standards.ts` để ghi nhận các endpoint được Swagger Auto-Enveloping bảo vệ là `FULL_COMPLIANT`.
  Kỳ vọng: chạy `npm test -- test/standard-api-response.e2e-spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR]: Xuất lại file openapi.json và tài liệu docs/api-inventory.md chính thức**
  Chạy lệnh `npm run export:openapi` để sinh lại file `openapi.json` đã chuẩn hóa toàn bộ 89 endpoint.
  Kỳ vọng: chạy `npm test -- test/standard-api-response.e2e-spec.ts` và `npm run audit:apis` → vẫn PASS với tỷ lệ Full Compliant đạt 100%.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test suite (`npm test -- test/standard-api-response.e2e-spec.ts`, `npm test -- src/core/health/__tests__/health.controller.spec.ts`, và `npm run audit:apis`)
  Kết quả mong đợi: tất cả PASS.
