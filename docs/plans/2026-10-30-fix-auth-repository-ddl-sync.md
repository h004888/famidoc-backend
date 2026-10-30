# Đồng bộ tầng Auth Repository với CSDL 29 Bảng và Quản lý Thu hồi Token qua Redis (Phương án A) — Kế hoạch triển khai

**Mục tiêu:** Đồng bộ hóa toàn bộ tầng dữ liệu Auth (Interface, Repository, Service, Unit & E2E Tests) tương thích 100% với Prisma Schema 29 bảng mới theo DDL SQL chuẩn 3NF và ISO 27799, giải quyết triệt để 6 lỗi biên dịch TypeScript, giúp CI/CD Quality Gates chuyển xanh hoàn toàn.

**Cách tiếp cận:** Áp dụng Phương án A: Giữ nguyên 100% định nghĩa DDL 29 bảng của CSDL (bảng `users` không chứa cột `token_version`). Tái cấu trúc transaction đăng ký hộ gia đình theo đúng quan hệ 3NF (`User` -> `FamilyUnit` -> `Patient` -> `AuditLog`). Chuyển toàn bộ cơ chế thu hồi token JWT khi đổi mật khẩu sang Redis qua cơ chế blacklist / revocation key.

**Đã tra cứu codebase (codebase-memory-mcp):**
- `get_architecture`: Dự án NestJS Package-by-Feature kết hợp Clean Architecture, Prisma ORM, PostgreSQL và Redis.
- `search_graph`: Xác định chính xác các file liên quan:
  - `src/modules/auth/repositories/interfaces/auth.repository.interface.ts` (định nghĩa `AuthEntity`, `CreateFamilyRepDbData`, `IAuthRepository`)
  - `src/modules/auth/repositories/impl/auth.repository.impl.ts` (triển khai `AuthRepositoryImpl`)
  - `src/modules/auth/services/impl/auth.service.impl.ts` (triển khai `AuthServiceImpl`)
  - `src/modules/auth/__tests__/auth.repository.impl.spec.ts`
  - `src/modules/auth/__tests__/auth.service.impl.spec.ts`
  - `test/auth-db.e2e-spec.ts`
- `trace_path`: Xác nhận `AuthRepositoryImpl` chỉ được gọi bởi `AuthServiceImpl` và các test suites, không có call site ngoài module Auth.

**Framework test & quy ước (đã xác nhận qua codebase-memory-mcp):**
- Framework: Jest (`jest`) với `--experimental-vm-modules` và `--forceExit`
- Vị trí đặt file test: Thư mục `src/modules/auth/__tests__/*.spec.ts` và `test/*.e2e-spec.ts`
- Lệnh chạy test: `npm test -- <path-to-spec>` hoặc `npm test -- --forceExit`
- Lệnh kiểm tra build: `npm run build`

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Tuyệt đối không thay đổi schema CSDL 29 bảng trong `prisma/schema.prisma`.
- Đảm bảo toàn bộ 58 unit tests hiện có và lệnh `npm run build` đều PASS.

---

### Task 1: Chuẩn hóa Interface AuthEntity, CreateFamilyRepDbData và IAuthRepository

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `src/modules/auth/repositories/interfaces/auth.repository.interface.ts`
- Test tương ứng: `src/modules/auth/__tests__/auth.repository.impl.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `AuthRepositoryImpl`, `AuthServiceImpl`, `auth.repository.impl.spec.ts`, `auth.service.impl.spec.ts`
- Gọi tới: `base.repository.interface.ts`, `create-auth.dto.ts`, `update-auth.dto.ts`
- Regression test cần chạy thêm: `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Schema Prisma 29 bảng đã tạo
- Cung cấp đầu ra cho: Task 2 (`AuthRepositoryImpl`) và Task 3 (`AuthServiceImpl`)

- [x] **Bước 1 [RED]: Viết test kiểm tra AuthEntity không còn tokenVersion và IAuthRepository chuẩn hóa**
  Vị trí file test: `src/modules/auth/__tests__/auth.repository.impl.spec.ts`
  Test case: Bổ sung test kiểm tra định nghĩa interface `AuthEntity` ánh xạ đúng các trường của model `User` (`failedLoginAttempts`, `lockedUntil`, không chứa `tokenVersion`) và `CreateFamilyRepDbData` có trường `homeAddress`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → FAIL với lỗi biên dịch kiểu dữ liệu do `tokenVersion` vẫn còn bắt buộc trong interface cũ.
- [x] **Bước 2 [GREEN]: Cập nhật auth.repository.interface.ts khớp với Prisma User model mới**
  Cập nhật file `src/modules/auth/repositories/interfaces/auth.repository.interface.ts`:
  - `AuthEntity`: xóa `tokenVersion: number;` và `familyUnitId?: string | null;`, thêm `failedLoginAttempts: number;`, `lockedUntil: Date | null;`, `avatarUrl: string | null;`.
  - `CreateFamilyRepDbData`: thêm trường tùy chọn `homeAddress?: string;`.
  - `IAuthRepository`: loại bỏ phương thức `incrementTokenVersion(userId: string): Promise<number>;`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → PASS bước kiểm tra interface contract.
- [x] **Bước 3 [REFACTOR]: Tinh chỉnh import types và loại bỏ các type thừa**
  Rà soát `auth.repository.interface.ts`, đảm bảo chỉ export các kiểu dữ liệu cần thiết, tuân thủ TypeScript strict mode.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts`
  Kết quả mong đợi: tất cả test cases của task đều PASS.

---

### Task 2: Tái cấu trúc transaction đăng ký createFamilyRepWithProfile và cập nhật AuthRepositoryImpl theo chuẩn 3NF

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `src/modules/auth/repositories/impl/auth.repository.impl.ts`
- Test tương ứng: `src/modules/auth/__tests__/auth.repository.impl.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `AuthServiceImpl`
- Gọi tới: `PrismaService` (`user`, `familyUnit`, `patient`, `auditLog`)
- Regression test cần chạy thêm: `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (`auth.repository.interface.ts`)
- Cung cấp đầu ra cho: Task 3 (`AuthServiceImpl`)

- [x] **Bước 1 [RED]: Viết test cho luồng transaction đăng ký 3NF mới trong auth.repository.impl.spec.ts**
  Vị trí file test: `src/modules/auth/__tests__/auth.repository.impl.spec.ts`
  Test case: Cập nhật `[UT-R-03] createFamilyRepWithProfile` để kiểm tra thứ tự gọi chính xác:
  1. `prismaService.user.create` với email, phone, passwordHash, fullName, role 'FAMILY_REP', status 'ACTIVE'.
  2. `prismaService.familyUnit.create` với `representativeUserId = user.id`, `homeAddress`, `emergencyPhone`.
  3. `prismaService.patient.create` với `familyId = family.id`, `relationshipToHead = 'SELF'`.
  4. `prismaService.auditLog.create` với `actorUserId = user.id`, `action = 'REGISTER_FAMILY_REP'`, `resourceName = 'users'`.
  Xóa test `[UT-R-05] incrementTokenVersion` khỏi repository spec vì hàm này đã chuyển giao sang Redis.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → FAIL vì code triển khai cũ vẫn gọi `familyUnit.create` đầu tiên và gán `familyUnitId` cho user.
- [x] **Bước 2 [GREEN]: Viết lại implementation của createFamilyRepWithProfile và xóa incrementTokenVersion trong AuthRepositoryImpl**
  Cập nhật file `src/modules/auth/repositories/impl/auth.repository.impl.ts`:
  - Trong `createFamilyRepWithProfile`:
    - Tạo `User` trước và lấy `user.id`.
    - Tạo `FamilyUnit` gắn `representativeUserId: user.id`, `homeAddress: data.homeAddress || 'Chưa cập nhật địa chỉ'`, `emergencyPhone: data.phone`, `status: 'ACTIVE'`.
    - Tạo `Patient` gắn `familyId: family.id`, `fullName: data.fullName`, `relationshipToHead: 'SELF'`, `dateOfBirth: new Date('1990-01-01')`, `gender: 'OTHER'`, `status: 'ACTIVE'`.
    - Tạo `AuditLog` gắn `actorUserId: user.id`, `action: 'REGISTER_FAMILY_REP'`, `resourceName: 'users'`, `resourceId: user.id`, `clientIp: '127.0.0.1'`.
    - Trả về `user as unknown as AuthEntity`.
  - Xóa hàm `incrementTokenVersion` khỏi `AuthRepositoryImpl`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → PASS toàn bộ test suite.
- [x] **Bước 3 [REFACTOR]: Tối ưu hóa code transaction và loại bỏ mã dư thừa**
  Đảm bảo transaction xử lý sạch sẽ, đúng chuẩn BasePrismaRepository.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 3: Chuyển đổi quản lý thu hồi token sang Redis trong AuthServiceImpl

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `src/modules/auth/services/impl/auth.service.impl.ts`
- Test tương ứng: `src/modules/auth/__tests__/auth.service.impl.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `AuthController`
- Gọi tới: `IAuthRepository`, `redisClient`, `JwtService`, `mailerService`
- Regression test cần chạy thêm: `npm test -- src/modules/auth/__tests__/auth.controller.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 và Task 2
- Cung cấp đầu ra cho: Toàn bộ module Auth

- [x] **Bước 1 [RED]: Cập nhật test cases trong auth.service.impl.spec.ts kiểm tra thu hồi token qua Redis**
  Vị trí file test: `src/modules/auth/__tests__/auth.service.impl.spec.ts`
  Test case:
  - Cập nhật test `login` để kiểm tra payload JWT không còn `tokenVersion`.
  - Cập nhật test `resetPassword` và `changePassword`: thay vì kỳ vọng `authRepository.incrementTokenVersion`, kỳ vọng `redisClient.set` được gọi với key `token:revoked:${userId}` hoặc xóa session của user trên Redis.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts` → FAIL do `AuthServiceImpl` hiện tại vẫn đang gọi `authRepository.incrementTokenVersion`.
- [x] **Bước 2 [GREEN]: Cập nhật AuthServiceImpl sử dụng Redis để vô hiệu hóa token**
  Cập nhật file `src/modules/auth/services/impl/auth.service.impl.ts`:
  - Trong hàm `login`: bỏ thuộc tính `tokenVersion: user.tokenVersion` khỏi `payload` ký JWT.
  - Trong hàm `resetPassword`: thay `await this.authRepository.incrementTokenVersion(user.id);` bằng `await this.redisClient.set('token:revoked:' + user.id, Math.floor(Date.now() / 1000).toString(), 'EX', 7 * 86400);`.
  - Trong hàm `changePassword`: thay `await this.authRepository.incrementTokenVersion(userId);` bằng `await this.redisClient.set('token:revoked:' + userId, Math.floor(Date.now() / 1000).toString(), 'EX', 7 * 86400);`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts` → PASS toàn bộ 12 test cases.
- [x] **Bước 3 [REFACTOR]: Dọn dẹp import và warnings linter trong AuthServiceImpl**
  Loại bỏ import thừa `AUTH_SERVICE_TOKEN` và thêm tiền tố gạch dưới cho biến không dùng `_clientIp`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts` → vẫn PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 4: Cập nhật E2E test và kiểm chứng toàn diện toàn dự án (Full Build & Test Pass)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Chỉnh sửa: `test/auth-db.e2e-spec.ts`
- Test tương ứng: `test/auth-db.e2e-spec.ts`
- Kiểm chứng bằng: `npm run build` và `npm test -- --forceExit`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: CI/CD Pipeline (`.github/workflows/ci-cd.yml`)
- Gọi tới: Toàn bộ backend NestJS
- Regression test cần chạy thêm: Chạy toàn bộ 8 test suites

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1, 2, 3 hoàn tất
- Cung cấp đầu ra cho: Sẵn sàng commit và push để CI/CD GitHub Actions chuyển xanh

- [x] **Bước 1 [RED]: Cập nhật test/auth-db.e2e-spec.ts phản ánh schema mới**
  Vị trí file test: `test/auth-db.e2e-spec.ts`
  Test case: Sửa test case số 6 trong `test/auth-db.e2e-spec.ts`: thay vì kiểm tra `repository.incrementTokenVersion` trên DB, kiểm tra việc cập nhật `passwordHash` thành công và không còn truy cập trường `tokenVersion` trên model `User`.
  Kỳ vọng: chạy `npm test -- test/auth-db.e2e-spec.ts` → FAIL nếu gọi hàm cũ chưa cập nhật.
- [x] **Bước 2 [GREEN]: Đồng bộ test/auth-db.e2e-spec.ts để test PASS hoàn toàn**
  Cập nhật file `test/auth-db.e2e-spec.ts` để kiểm thử chính xác các hàm `findByEmail`, `findByPhone`, `updatePassword`, và ràng buộc duy nhất `email`/`phone`.
  Kỳ vọng: chạy `npm test -- test/auth-db.e2e-spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR]: Chạy toàn bộ lint, test và build kiểm chứng**
  Chạy lần lượt:
  1. `npm run lint`
  2. `npm test -- --forceExit`
  3. `npm run build`
  Kỳ vọng: `npm run build` exit code 0 (PASS hoàn toàn không còn bất kỳ lỗi TypeScript nào).
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm run build` và `npm test -- --forceExit`
  Kết quả mong đợi: toàn bộ test suites PASS, build NestJS thành công 100%.
