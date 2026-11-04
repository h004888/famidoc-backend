# Chuẩn hóa API Login (Lockout 30 phút, DB Sync) và Change Password (PATCH) — Kế hoạch triển khai

**Mục tiêu:** Đồng bộ trạng thái khóa tài khoản và số lần đăng nhập thất bại xuống PostgreSQL cho API `login`, chuẩn hóa thông báo khóa 30 phút, chuyển đổi method `@Patch` cho API `change-password`, đồng thời giữ nguyên thư viện mã hóa mật khẩu `bcryptjs` theo đúng yêu cầu.

**Cách tiếp cận:**
1. Mở rộng `IAuthRepository` và `AuthRepositoryImpl` với 2 phương thức `updateFailedAttempts` và `resetFailedAttempts` để thao tác trực tiếp với 2 cột `failed_login_attempts` và `locked_until` trên bảng `users` của Prisma.
2. Cập nhật `AuthServiceImpl.login` để đồng bộ cập nhật số lần đăng nhập sai và thời gian khóa 30 phút vào cả Redis và Database, sửa thông báo khóa tài khoản từ 20 phút thành 30 phút theo chuẩn SRS. Giữ nguyên thuật toán băm mật khẩu `bcryptjs`.
3. Chuyển decorator `@Put('change-password')` thành `@Patch('change-password')` trong `AuthController` theo chuẩn RESTful của tài liệu đặc tả Report 3.

**Đã tra cứu codebase (codebase-memory-mcp):**
- Đã xác nhận qua `get_code_snippet`:
  - `AuthServiceImpl.login` tại `src/modules/auth/services/impl/auth.service.impl.ts`: dòng 220 đang báo `"Account temporarily locked. Please try again in 20 minutes"`, dòng 251 set Redis TTL 1800s.
  - `AuthController.changePassword` tại `src/modules/auth/controllers/auth.controller.ts`: dòng 97 đang dùng `@Put('change-password')`.
  - `User` model tại `prisma/schema.prisma`: có sẵn `failedLoginAttempts Int @default(0) @map("failed_login_attempts")` và `lockedUntil DateTime? @map("locked_until") @db.Timestamptz()`.
  - `AuthEntity` tại `src/modules/auth/repositories/interfaces/auth.repository.interface.ts`: đã khai báo sẵn `failedLoginAttempts?: number` và `lockedUntil?: Date | null`.

**Framework test & quy ước (đã xác nhận qua codebase-memory-mcp):**
- Framework: Jest (`jest`, `ts-jest` qua `node --experimental-vm-modules`)
- Vị trí đặt file test: `src/modules/auth/__tests__/*.spec.ts`
- Lệnh chạy test: `npm test -- src/modules/auth/__tests__/`

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Tuyệt đối giữ nguyên thư viện `bcryptjs`, không thay đổi sang thư viện băm mật khẩu khác.
- Đảm bảo tương thích ngược và không làm gãy 49 test hiện có trong `src/modules/auth/__tests__/`.

---

### Task 1: Mở rộng Repository cập nhật `failedLoginAttempts` và `lockedUntil` xuống PostgreSQL

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: Không có
- Chỉnh sửa:
  - `src/modules/auth/repositories/interfaces/auth.repository.interface.ts`
  - `src/modules/auth/repositories/impl/auth.repository.impl.ts`
- Test tương ứng: `src/modules/auth/__tests__/auth.repository.impl.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `AuthServiceImpl` (Task 2)
- Gọi tới: `PrismaService.user.update`
- Regression test cần chạy thêm do có inbound calls: `src/modules/auth/__tests__/auth.repository.impl.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Mô hình `User` hiện có trong `prisma/schema.prisma`
- Cung cấp đầu ra cho: `AuthServiceImpl.login` ở Task 2 để đồng bộ dữ liệu khóa tài khoản

- [x] **Bước 1 [RED]: Viết test cho phương thức `updateFailedAttempts` và `resetFailedAttempts`**
  Vị trí file test: `src/modules/auth/__tests__/auth.repository.impl.spec.ts`
  Test case:
  - `updateFailedAttempts(userId, attempts, lockedUntil)` gọi `prismaService.user.update` với `data: { failedLoginAttempts: attempts, lockedUntil }`.
  - `resetFailedAttempts(userId)` gọi `prismaService.user.update` với `data: { failedLoginAttempts: 0, lockedUntil: null }`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → FAIL với lý do `repository.updateFailedAttempts is not a function` hoặc `repository.resetFailedAttempts is not a function`.
- [x] **Bước 2 [GREEN]: Khai báo interface và hiện thực code tại `AuthRepositoryImpl`**
  Thêm phương thức vào `IAuthRepository`:
  - `updateFailedAttempts(userId: string, attempts: number, lockedUntil?: Date | null): Promise<void>`
  - `resetFailedAttempts(userId: string): Promise<void>`
  Hiện thực trong `AuthRepositoryImpl`:
  - `updateFailedAttempts`: gọi `this.prismaService.user.update({ where: { id: userId }, data: { failedLoginAttempts: attempts, lockedUntil: lockedUntil ?? null } })`.
  - `resetFailedAttempts`: gọi `this.prismaService.user.update({ where: { id: userId }, data: { failedLoginAttempts: 0, lockedUntil: null } })`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Tối ưu hóa xử lý giá trị mặc định của `lockedUntil`**
  Đảm bảo `lockedUntil` nhận `undefined` hoặc `null` đều được chuyển thành `null` hợp lệ cho Prisma update.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts` → PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/auth/__tests__/auth.repository.impl.spec.ts`
  Kết quả mong đợi: tất cả test case trong suite PASS.

---

### Task 2: Chuẩn hóa Service Login: Sửa thông báo khóa 30 phút, đồng bộ lockout và reset failed attempts xuống DB

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: Không có
- Chỉnh sửa:
  - `src/modules/auth/services/impl/auth.service.impl.ts`
- Test tương ứng: `src/modules/auth/__tests__/auth.service.impl.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: `AuthController.login`
- Gọi tới: `IAuthRepository.updateFailedAttempts`, `IAuthRepository.resetFailedAttempts`, `RedisClient`, `bcryptjs`
- Regression test cần chạy thêm do có inbound calls: `src/modules/auth/__tests__/auth.controller.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `IAuthRepository` từ Task 1
- Cung cấp đầu ra cho: API `POST /api/v1/auth/login`

- [x] **Bước 1 [RED]: Viết test kiểm tra thông báo khóa 30 phút, kiểm tra lock từ DB và kiểm tra đồng bộ DB khi fail/thành công**
  Vị trí file test: `src/modules/auth/__tests__/auth.service.impl.spec.ts`
  Test case:
  - `[UT-S-11b]`: Khi tài khoản bị lock (Redis có key hoặc `user.lockedUntil > now`), `service.login` ném `ForbiddenException` với thông báo chính xác `'Account temporarily locked. Please try again in 30 minutes'`.
  - `[UT-S-12b]`: Khi đăng nhập sai mật khẩu lần 1-4, `authRepository.updateFailedAttempts` được gọi với số lần fail tương ứng và `lockedUntil = null`.
  - `[UT-S-13b]`: Khi đăng nhập sai mật khẩu lần thứ 5, `authRepository.updateFailedAttempts` được gọi với số lần 5 và `lockedUntil` là mốc thời gian 30 phút sau.
  - `[UT-S-10b]`: Khi đăng nhập thành công và `user.failedLoginAttempts > 0`, `authRepository.resetFailedAttempts` được gọi để đặt lại số lần sai về 0 trên DB.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts` → FAIL do thông báo hiện tại là `20 minutes` và `authRepository.updateFailedAttempts`/`resetFailedAttempts` chưa được gọi trong `login`.
- [x] **Bước 2 [GREEN]: Cập nhật `AuthServiceImpl.login` đáp ứng các test case trên (giữ nguyên bcryptjs)**
  Tại `src/modules/auth/services/impl/auth.service.impl.ts`:
  - Đổi message tại dòng 220 thành `'Account temporarily locked. Please try again in 30 minutes'`.
  - Thêm kiểm tra: nếu `user?.lockedUntil && new Date(user.lockedUntil) > new Date()`, throw `ForbiddenException('Account temporarily locked. Please try again in 30 minutes')`.
  - Khi sai mật khẩu:
    + Gọi `await this.authRepository.updateFailedAttempts(user.id, failCount, failCount >= 5 ? new Date(Date.now() + 1800 * 1000) : null)`.
  - Khi đăng nhập thành công:
    + Nếu `user.failedLoginAttempts && user.failedLoginAttempts > 0`, gọi `await this.authRepository.resetFailedAttempts(user.id)`.
  - Giữ nguyên `bcrypt.compare` và `bcrypt.hash` của thư viện `bcryptjs`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Tinh chỉnh xử lý thời gian khóa và đồng bộ cache Redis**
  Đảm bảo hằng số thời gian khóa `LOCKOUT_DURATION_SECONDS = 1800` (30 phút) được dùng chung cho cả TTL Redis và tính toán `lockedUntil` của Database.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts` → PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts`
  Kết quả mong đợi: toàn bộ test suite auth service PASS.

---

### Task 3: Chuyển đổi HTTP Method `@Patch` cho API Đổi mật khẩu `changePassword`

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: Không có
- Chỉnh sửa:
  - `src/modules/auth/controllers/auth.controller.ts`
- Test tương ứng: `src/modules/auth/__tests__/auth.controller.spec.ts`
- Kiểm chứng bằng: `npm test -- src/modules/auth/__tests__/auth.controller.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Client / Frontend calling `PATCH /api/v1/auth/change-password`
- Gọi tới: `IAuthService.changePassword`
- Regression test cần chạy thêm do có inbound calls: Không có inbound nội bộ, xác nhận qua trace_path

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: DTO `ChangePasswordDto`
- Cung cấp đầu ra cho: Client API `PATCH /api/v1/auth/change-password`

- [x] **Bước 1 [RED]: Viết test kiểm tra decorator `@Patch('change-password')` của method `changePassword`**
  Vị trí file test: `src/modules/auth/__tests__/auth.controller.spec.ts`
  Test case:
  - Sử dụng `Reflect.getMetadata('method', controller.changePassword)` kiểm tra phương thức HTTP khớp với `RequestMethod.PATCH` (giá trị enum là 4 hoặc import `RequestMethod` từ `@nestjs/common`).
  - Kiểm tra metadata `'path'` của `controller.changePassword` là `'change-password'`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.controller.spec.ts` → FAIL vì hiện tại metadata trả về `RequestMethod.PUT`.
- [x] **Bước 2 [GREEN]: Đổi decorator `@Put('change-password')` thành `@Patch('change-password')`**
  Tại `src/modules/auth/controllers/auth.controller.ts`:
  - Import `Patch` từ `@nestjs/common`.
  - Đổi `@Put('change-password')` thành `@Patch('change-password')`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.controller.spec.ts` → PASS.
- [x] **Bước 3 [REFACTOR] (nếu cần): Dọn dẹp import không sử dụng trong controller**
  Xóa import `Put` nếu không còn endpoint nào khác trong controller dùng tới `Put`.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.controller.spec.ts` → PASS.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/auth/__tests__/auth.controller.spec.ts`
  Kết quả mong đợi: toàn bộ test suite auth controller PASS.

---

### Task 4: Chạy kiểm thử hồi quy toàn bộ Auth Module và Kiểm tra biên dịch (Build Verification)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: Không có
- Chỉnh sửa: Không có
- Test tương ứng: Toàn bộ thư mục `src/modules/auth/__tests__/`
- Kiểm chứng bằng: `npm test -- src/modules/auth/__tests__/` và `npm run build`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Toàn bộ module auth
- Gọi tới: Jest test runner và TypeScript compiler (`tsc`)
- Regression test cần chạy thêm do có inbound calls: Không có

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Kết quả của Task 1, Task 2, Task 3
- Cung cấp đầu ra cho: Dự án sẵn sàng triển khai thực tế

- [x] **Bước 1 [RED]: Tạo kịch bản kiểm tra toàn diện tích hợp controller - service - repository**
  Vị trí file test: `src/modules/auth/__tests__/auth.service.impl.spec.ts`
  Test case:
  - Kiểm thử chuỗi trạng thái: Đăng nhập sai 4 lần → không lock DB; sai lần 5 → lock DB 30 phút + lock Redis; đợi hết lock hoặc reset → đăng nhập thành công và DB reset failedAttempts về 0.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/auth.service.impl.spec.ts` → FAIL nếu có bất kỳ mắt xích nào trong chuỗi chưa liên kết trơn tru.
- [x] **Bước 2 [GREEN]: Hoàn thiện các mock và đảm bảo toàn bộ luồng tích hợp hoạt động thông suốt**
  Khớp mọi tham số giữa service và repository.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/` → PASS toàn bộ 100% test suites.
- [x] **Bước 3 [REFACTOR] (nếu cần): Kiểm tra lint và style code**
  Chạy kiểm tra cú pháp TypeScript và formatting không làm thay đổi hành vi code.
  Kỳ vọng: chạy `npm test -- src/modules/auth/__tests__/` → PASS và biên dịch thành công `npm run build`.
- [x] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `npm test -- src/modules/auth/__tests__/`
  Kết quả mong đợi: 3/3 test suites PASS, 0 fail.
