# [UNIT TEST SPECIFICATION] - Authentication & Access Management (auth)
- **Ngày lập (Date):** 2026-10-26
- **Cập nhật lần cuối (Last Updated):** 2026-10-26
- **Phiên bản tài liệu (Version):** 1.0.0
- **Tiêu chuẩn:** ISO/IEC/IEEE 29119-4 | IEEE 1008
- **Kiến trúc áp dụng:** NestJS Clean Architecture (Controller - Service - Repository) với Prisma ORM & Redis
- **Mục tiêu bao phủ:** 100% Statement | 100% Branch | MC/DC (cho các điều kiện logic phức hợp) | Mutation Score >= 90%
- **Phạm vi nghiệp vụ:** Feature FT-01 (UC-01 đến UC-05) bao gồm Đăng ký tài khoản Đại diện gia đình (xác thực OTP qua Email), Đăng nhập hệ thống đa vai trò (Multi-Role, Argon2id, Brute-force Lock 5 lần/30m), Đăng xuất an toàn (JWT Blacklist), Quên/Đặt lại mật khẩu qua Email OTP, và Đổi mật khẩu định kỳ (Revoke session).
- **Giả định & Quy ước:**
  1. Dữ liệu thời gian tính theo UTC/ISO 8601.
  2. Mật khẩu được băm bằng `Argon2id` (64MB memory, 3 iterations, 1 parallelism, unique salt ngẫu nhiên).
  3. Mã OTP là chuỗi 6 chữ số số học ngẫu nhiên (`/^[0-9]{6}$/`), có hiệu lực 5 phút (TTL = 300s). Cooldown gửi lại OTP là 60s.
  4. Khóa tài khoản tạm thời kích hoạt sau 5 lần đăng nhập thất bại liên tiếp (TTL = 1800s - 30 phút).
  5. Đăng ký thành công kích hoạt Prisma Transaction tạo liên hoàn: `USER` -> `FAMILY_UNIT` -> `PATIENT` (chủ hộ theo quy tắc `BR-05`) -> `AUDIT_LOG` (`GB-16`).

---

## 1. Hợp Đồng Đơn Vị (Unit Contract)

### 1.1 Mục đích nghiệp vụ
Cung cấp cổng xác thực và quản lý quyền truy cập tập trung (Authentication & Access Management) cho toàn bộ 5 nhóm người dùng của hệ thống FamiDoc (`GUEST`, `FAMILY_REP`, `DOCTOR`, `HEALTHCARE_FACILITY`, `ADMIN`).

### 1.2 Chữ ký hàm & Interface (Signatures)

```typescript
// Token Dependency Inversion
export const AUTH_SERVICE_TOKEN = Symbol('IAuthService');
export const USER_REPOSITORY_TOKEN = Symbol('IUserRepository');

export interface IAuthService {
  registerFamilyRep(dto: RegisterFamilyRepDto): Promise<RegisterInitiateResponse>;
  resendEmailOtp(dto: ResendEmailOtpDto): Promise<ApiResponseMessage>;
  verifyEmailOtp(dto: VerifyEmailOtpDto): Promise<UserEntity>;
  login(dto: LoginDto, clientIp: string): Promise<LoginSuccessResponse>;
  logout(userId: string, token: string): Promise<void>;
  forgotPassword(dto: ForgotPasswordDto): Promise<ApiResponseMessage>;
  resetPassword(dto: ResetPasswordDto): Promise<ApiResponseMessage>;
  changePassword(userId: string, dto: ChangePasswordDto): Promise<ApiResponseMessage>;
}

export interface IUserRepository {
  findByEmail(email: string): Promise<UserEntity | null>;
  findByPhone(phone: string): Promise<UserEntity | null>;
  findById(id: string): Promise<UserEntity | null>;
  createFamilyRepWithProfile(data: CreateFamilyRepDbDto): Promise<UserEntity>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  incrementTokenVersion(userId: string): Promise<number>;
}
```

### 1.3 Tham số đầu vào (DTOs)
- `RegisterFamilyRepDto`: `{ fullName: string, phone: string, email: string, password: string, acceptedTerms: boolean }`
- `VerifyEmailOtpDto`: `{ email: string, otp: string }`
- `ResendEmailOtpDto`: `{ email: string }`
- `LoginDto`: `{ identifier: string, password: string }` (identifier là email hoặc số điện thoại)
- `ForgotPasswordDto`: `{ email: string }`
- `ResetPasswordDto`: `{ email: string, otp: string, newPassword: string }`
- `ChangePasswordDto`: `{ oldPassword: string, newPassword: string }`

### 1.4 Đầu ra kỳ vọng
- `RegisterInitiateResponse`: `{ message: string, email: string, expiresInSeconds: number }`
- `LoginSuccessResponse`: `{ accessToken: string, role: UserRole, user: UserProfileDto }`
- `ApiResponseMessage`: `{ message: string, success: boolean }`
- `UserEntity`: Thực thể User độc lập với Prisma Client.

### 1.5 Phụ thuộc cần Mock (Dependency Doubles)
1. `USER_REPOSITORY_TOKEN` (`IUserRepository`): Mock truy xuất dữ liệu User, FamilyUnit, Patient.
2. `REDIS_SERVICE` (`IRedisService`): Mock thao tác lưu/xóa OTP, bộ đếm brute-force, JWT Blacklist.
3. `MAILER_SERVICE` (`IMailerService`): Mock gửi email chứa OTP hoặc thông báo bảo mật.
4. `JWT_SERVICE` (`JwtService`): Mock tạo và verify JWT Token.
5. `PASSWORD_HASHER` (`IPasswordHasher` / Argon2id wrapper): Mock băm và verify hash mật khẩu.

---

## 2. Bảng Phân Tích Kỹ Thuật Vét Cạn

### 2.1. Phân vùng tương đương (EP) & Giá trị biên (3-value BVA)

| Tham số / Trường | Phân vùng hợp lệ (Valid EP) | Phân vùng không hợp lệ (Invalid EP) | 3-value BVA (B-1, B, B+1) | Ghi chú kỹ thuật |
| :--- | :--- | :--- | :--- | :--- |
| `password` (Đăng ký / Reset) | Độ dài [8..64] ký tự, chứa ít nhất 1 chữ hoa, 1 chữ thường, 1 số, 1 ký tự đặc biệt | Dưới 8 ký tự, trên 64 ký tự, thiếu ký tự bắt buộc, khoảng trắng | • Biên dưới 8: `7` (Invalid), `8` (Valid), `9` (Valid)<br>• Biên trên 64: `63` (Valid), `64` (Valid), `65` (Invalid) | Ném `BadRequestException` nếu vi phạm DTO |
| `otp` (Mã xác thực) | Chuỗi đúng 6 chữ số số học `[0-9]{6}` | Chuỗi < 6 ký tự, > 6 ký tự, chứa chữ/ký tự đặc biệt, rỗng | • Biên 6 ký tự: `5` chữ số (Invalid), `6` chữ số (Valid), `7` chữ số (Invalid) | Ném `BadRequestException` hoặc `UnauthorizedException` |
| `email` | Đúng định dạng RFC 5322 (`user@domain.com`) | Chuỗi không chứa `@`, thiếu domain, chứa dấu cách, rỗng, null | N/A (Kiểm tra theo Regex chuẩn `isEmail`) | Bắt buộc lowercase trước khi xử lý |
| `phone` | Chuỗi 10 số đầu số VN chuẩn (`09x`, `08x`, `03x`, `07x`, `05x`) hoặc E.164 | Chứa chữ, < 10 số, > 11 số, sai đầu số nhà mạng | • Biên 10 số: `9` số (Invalid), `10` số (Valid), `11` số (Invalid) | Chuẩn hóa regex E.164 |
| `failed_count` (Brute-force) | `[0 .. 4]` lần nhập sai liên tiếp | `>= 5` lần sai liên tiếp | • Biên 5 lần: `4` (Chưa khóa - B-1), `5` (Bắt đầu khóa 30m - B), `6` (Bị chặn khóa - B+1) | Lưu trữ đếm trong Redis với TTL 1800s |
| `resend_cooldown` (Gửi lại OTP) | Thời gian kể từ lần gửi trước `> 60` giây | Thời gian `<= 60` giây | • Biên 60s: `59s` (Từ chối spam - B-1), `60s` (Từ chối - B), `61s` (Cho phép gửi lại - B+1) | Đặt key `otp:cooldown:<email>` trong Redis |
| `acceptedTerms` | `true` | `false`, `null`, `undefined` | N/A (Boolean nhị phân) | Bắt buộc `true` để tuân thủ NĐ 13/2023 |

### 2.2. Bảng quyết định (Decision Table)

#### DT-01: Luồng Đăng nhập (UC-02 - Login Logic & Brute-force)
| Điều kiện / Trạng thái | R01 (Happy) | R02 (Lockout) | R03 (Wrong Pass) | R04 (5th Fail) | R05 (Not Found) | R06 (Suspended) | R07 (Pending) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Tài khoản bị khóa Brute-force (`failed_count >= 5`) | False | **True** | False | False | False | False | False |
| Tài khoản tồn tại trong DB | True | - | True | True | **False** | True | True |
| Trạng thái User Status | ACTIVE | - | ACTIVE | ACTIVE | - | **SUSPENDED** | **PENDING** |
| Mật khẩu khớp mã băm Argon2id | True | - | **False** | **False** | - | - | True |
| Số lần sai trước đó | 0 | - | 2 | 4 | - | - | - |
| **Hành động / Kết quả** | | | | | | | |
| Cấp JWT Token & Session | **X** | | | | | | **X (Doctor Limited)** |
| Reset bộ đếm `failed_count` = 0 | **X** | | | | | | **X** |
| Tăng bộ đếm `failed_count` + 1 | | | **X (->3)** | **X (->5, Lock 30m)** | | | |
| Ném `UnauthorizedException` (MSG07) | | | **X** | **X** | **X (GB-05)** | | |
| Ném `ForbiddenException` (MSG08 / Khóa) | | **X** | | | | **X** | |
| Ghi Audit Log | `SUCCESS` | `BLOCKED` | `FAIL` | `LOCKOUT` | `FAIL_ENUM` | `DENIED` | `LIMITED_LOGIN` |

#### DT-02: Luồng Xác thực Email OTP Đăng ký (UC-01 - Verify Registration)
| Điều kiện / Trạng thái | R11 (Happy) | R12 (OTP Hết hạn) | R13 (OTP Sai mã) | R14 (Email đã tồn tại lúc commit) |
| :--- | :---: | :---: | :---: | :---: |
| Key `otp:reg:<email>` tồn tại trong Redis | True | **False** | True | True |
| Mã OTP nhập khớp với mã trong Redis | True | - | **False** | True |
| Email chưa bị ai đăng ký trước trong DB | True | - | - | **False (Race condition)** |
| **Hành động / Kết quả** | | | | |
| Tạo User + FamilyUnit + Patient trong Transaction | **X** | | | |
| Xóa Key OTP trong Redis | **X** | | | |
| Trả về UserEntity hoàn tất | **X** | | | |
| Ném `BadRequestException` ("OTP expired/invalid") | | **X** | **X** | |
| Ném `ConflictException` (MSG09) | | | | **X** |

### 2.3. Phân tích đường đi cơ sở (McCabe Basis Paths)

Xét hàm `login(dto: LoginDto, clientIp: string)`:
- Điểm quyết định:
  1. `if (isLockedOut)` -> Path 1 (Khóa tài khoản)
  2. `if (!user)` -> Path 2 (Không thấy user, băm giả lập thời gian, ném MSG07 theo GB-05)
  3. `if (user.status === SUSPENDED || user.status === DEACTIVATED)` -> Path 3 (Tài khoản bị cấm)
  4. `if (!isPasswordValid)`
     - 4a. `if (newFailedCount >= 5)` -> Path 4 (Sai lần thứ 5 -> Khóa 30m, ném MSG07)
     - 4b. `else` -> Path 5 (Sai dưới 5 lần -> Tăng counter, ném MSG07)
  5. `if (user.role === DOCTOR && user.doctorProfile?.status === PENDING)` -> Path 6 (Bác sĩ đăng nhập giới hạn màn onboarding)
  6. Happy Path -> Path 7 (Đăng nhập thành công, cấp JWT)

$\Rightarrow$ Số điểm quyết định $D = 6 \Rightarrow$ Độ phức tạp chu trình $V(G) = D + 1 = 7$.
Liệt kê đủ 7 đường đi cơ sở độc lập tương ứng với các Test Case `UT-S-06` đến `UT-S-12`.

### 2.4. Phân tích chuyển trạng thái (State Transition)

```
[UNREGISTERED] 
       │ (UC-01: submit valid data & verify OTP)
       ▼
 [ACTIVE (Family Rep)] ◄─────────────┐
       │                             │ (Admin unblock)
       │ (Admin suspend / violate)   │
       ▼                             │
  [SUSPENDED] ───────────────────────┘
       │ (Admin soft-delete)
       ▼
 [DEACTIVATED]
```

- **0-switch coverage:** Phủ mọi trạng thái hợp lệ (`ACTIVE`, `SUSPENDED`, `DEACTIVATED`).
- **Invalid transitions:**
  - `SUSPENDED` cố thực hiện đổi mật khẩu hoặc đăng nhập -> Bị chặn (`ForbiddenException`).
  - `DEACTIVATED` cố reset mật khẩu -> Bị chặn (`ForbiddenException`).

---

## 3. Ma Trận Ca Kiểm Thử Chi Tiết (Test Case Specification Matrix)

### 3.1. Tầng Service (`auth.service.impl.spec.ts`) - Mã `UT-S-xx`

| Test ID | Mục tiêu kiểm thử | Kỹ thuật | Arrange (Setup Mocks) | Act (Dữ liệu gọi) | Assert (Kết quả kỳ vọng) | Tác động phụ (Side-effects) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **UT-S-01** | Khởi tạo đăng ký Family Rep thành công (gửi OTP qua Email) | EP | Mock Repo `findByEmail` = null, `findByPhone` = null. Mock Redis `set` = OK, `exists` cooldown = 0. Mock Mailer `send` = true. | `RegisterFamilyRepDto` hợp lệ (`email: "user@famidoc.vn"`, SĐT hợp lệ, pass 12 ký tự, `acceptedTerms: true`) | Trả về `RegisterInitiateResponse` (`expiresInSeconds: 300`). Không ném lỗi. | Verify Redis `set` key `otp:reg:user@famidoc.vn` TTL 300s. Verify Mailer gửi đúng email. |
| **UT-S-02** | Từ chối đăng ký do Email đã tồn tại | Decision Table | Mock Repo `findByEmail` trả về `UserEntity`. | DTO với Email đã có trong hệ thống | Ném `ConflictException` với nội dung tương ứng `MSG09`. | Không gọi Redis, không gọi Mailer. |
| **UT-S-03** | Từ chối đăng ký do Số điện thoại đã tồn tại | Decision Table | Mock Repo `findByEmail` = null, `findByPhone` trả về `UserEntity`. | DTO với Số điện thoại đã có | Ném `ConflictException` (MSG09). | Không gọi Redis, không gọi Mailer. |
| **UT-S-04** | Từ chối đăng ký do chưa tích chọn cam kết Điều khoản / NĐ13 | Boundary | Không cần mock repo. | DTO có `acceptedTerms: false` | Ném `BadRequestException` ("You must accept terms and privacy policy"). | Không tương tác Repo, Redis, Mailer. |
| **UT-S-05** | Xác thực Email OTP đăng ký thành công (Khởi tạo tài khoản) | EP / ACID | Mock Redis `get("otp:reg:user@famidoc.vn")` = "123456". Mock Hasher `hash` = "argon2id_hash". Mock Repo `createFamilyRepWithProfile` trả về UserEntity. | `VerifyEmailOtpDto` (`email: "user@famidoc.vn"`, `otp: "123456"`) | Trả về `UserEntity` có `role: "FAMILY_REP"`, `status: "ACTIVE"`. | Verify Redis `del("otp:reg:user@famidoc.vn")` được gọi. Verify Repo transaction được thực thi. |
| **UT-S-06** | Xác thực Email OTP thất bại do mã OTP sai | EP | Mock Redis `get` = "123456". | `VerifyEmailOtpDto` (`otp: "654321"`) | Ném `UnauthorizedException` ("Invalid or expired OTP"). | Không gọi Repo tạo tài khoản, không xóa key Redis. |
| **UT-S-07** | Xác thực Email OTP thất bại do OTP hết hạn (Key không tồn tại trong Redis) | EP / BVA | Mock Redis `get` trả về `null`. | `VerifyEmailOtpDto` (`otp: "123456"`) | Ném `UnauthorizedException` ("Invalid or expired OTP"). | Không gọi Repo tạo tài khoản. |
| **UT-S-08** | Gửi lại OTP bị từ chối do còn trong thời gian Cooldown (< 60s) | BVA (B-1: 59s) | Mock Redis `ttl("otp:cooldown:user@famidoc.vn")` = 45. | `ResendEmailOtpDto` (`email: "user@famidoc.vn"`) | Ném `HttpException` (Status 429 Too Many Requests: "Please wait 45 seconds before requesting a new OTP"). | Không sinh OTP mới, không gọi Mailer. |
| **UT-S-09** | Gửi lại OTP thành công khi hết thời gian Cooldown (> 60s) | BVA (B+1: 61s) | Mock Redis `ttl("otp:cooldown:...")` <= 0. Mock Redis `set` = OK. Mock Mailer `send` = true. | `ResendEmailOtpDto` (`email: "user@famidoc.vn"`) | Trả về `ApiResponseMessage` (MSG05: Email sent successfully). | Verify sinh mã mới, ghi đè Redis OTP và tạo cooldown mới 60s. |
| **UT-S-10** | Đăng nhập thành công (Happy Path - Cấp JWT Token) | McCabe Path 7 | Mock Redis `get("login:lock:...")` = null. Mock Repo `findByEmail` trả về User `ACTIVE`. Mock Hasher `verify` = true. Mock Jwt `sign` = "jwt_token_xyz". | `LoginDto` (`identifier: "user@famidoc.vn"`, `password: "CorrectPass@123"`) | Trả về `{ accessToken: "jwt_token_xyz", role: "FAMILY_REP" }`. | Verify Redis `del("login:fail:...")` được gọi (reset bộ đếm). |
| **UT-S-11** | Đăng nhập thất bại do tài khoản đang bị khóa Brute-force | McCabe Path 1 | Mock Redis `get("login:lock:user@famidoc.vn")` = "1". Mock Redis `ttl` = 1200. | `LoginDto` hợp lệ | Ném `ForbiddenException` ("Account temporarily locked. Please try again in 20 minutes" - MSG08). | Không gọi DB, không verify hash password. |
| **UT-S-12** | Đăng nhập thất bại do sai mật khẩu lần thứ 1 đến 4 | McCabe Path 5 | Mock Redis `get("login:lock:...")` = null. Mock Repo `findByEmail` trả về User. Mock Hasher `verify` = false. Mock Redis `incr` = 3. | `LoginDto` sai mật khẩu | Ném `UnauthorizedException` (MSG07: "Incorrect username or password. Please check again."). | Verify Redis `incr` được gọi, TTL được set 1800s. Không sinh token. |
| **UT-S-13** | Đăng nhập sai mật khẩu lần thứ 5 -> Kích hoạt khóa tài khoản 30 phút | McCabe Path 4 / BVA (B) | Mock Repo tìm thấy User. Mock Hasher `verify` = false. Mock Redis `incr` trả về 5. | `LoginDto` sai mật khẩu | Ném `UnauthorizedException` (MSG07). | Verify Redis `set("login:lock:user@famidoc.vn", "1", "EX", 1800)` được gọi. |
| **UT-S-14** | Đăng nhập thất bại do Email không tồn tại trong hệ thống (GB-05) | McCabe Path 2 | Mock Redis lock = null. Mock Repo `findByEmail` = null, `findByPhone` = null. | `LoginDto` với email ảo | Ném `UnauthorizedException` (MSG07 - Giữ nguyên thông điệp, không lộ tài khoản). | Thực hiện dummy hash check để triệt tiêu chênh lệch thời gian xử lý (Timing attack). |
| **UT-S-15** | Đăng nhập bị từ chối do tài khoản bị Suspended / Deactivated | McCabe Path 3 | Mock Repo trả về User có `status: "SUSPENDED"`. | `LoginDto` đúng mật khẩu | Ném `ForbiddenException` (MSG08: "Your account cannot be used to sign in. Please contact support"). | Không cấp token. |
| **UT-S-16** | Đăng nhập của Bác sĩ chưa được phê duyệt CCHN (Pending) | Decision Table R07 | Mock Repo trả về User `role: "DOCTOR"`, DoctorProfile `status: "PENDING"`. Mock Hasher `verify` = true. | `LoginDto` của Bác sĩ | Cấp JWT Token có phạm vi hạn chế (`scope: "ONBOARDING_ONLY"`). | Cho phép đăng nhập nhưng gắn claim hạn chế quyền truy cập chức năng lâm sàng (`GB-06`, `GB-07`). |
| **UT-S-17** | Đăng xuất an toàn (Logout - Đưa Token vào Redis Blacklist) | EP | Mock Jwt `decode` lấy `jti: "token-uuid"`, thời gian hết hạn còn lại 900s. Mock Redis `set` = OK. | `userId: "u-1"`, `token: "bearer_xyz"` | Hoàn tất không ném lỗi (void). | Verify Redis `set("blacklist:token-uuid", "revoked", "EX", 900)`. |
| **UT-S-18** | Quên mật khẩu: Gửi OTP reset qua Email cho tài khoản tồn tại | EP | Mock Repo `findByEmail` trả về User `ACTIVE`. Mock Redis `set` = OK. Mock Mailer `send` = true. | `ForgotPasswordDto` (`email: "user@famidoc.vn"`) | Trả về `ApiResponseMessage` (MSG05: "A confirmation email has been sent"). | Verify sinh OTP reset lưu Redis key `otp:reset:user@famidoc.vn` (TTL 10m). |
| **UT-S-19** | Quên mật khẩu: Email không tồn tại trong hệ thống (Bảo mật GB-05) | Defensive | Mock Repo `findByEmail` = null. | `ForgotPasswordDto` (`email: "notfound@famidoc.vn"`) | Trả về `ApiResponseMessage` (MSG05) thành công giả lập. | Không sinh OTP vào Redis, không gửi email, không ném lỗi để tránh rò rỉ danh sách email. |
| **UT-S-20** | Đặt lại mật khẩu (Reset Password) thành công bằng OTP | EP | Mock Redis `get("otp:reset:user@famidoc.vn")` = "654321". Mock Hasher `hash` = "new_hash". Mock Repo `updatePassword` = OK. Mock Repo `incrementTokenVersion` = 2. | `ResetPasswordDto` (`email: "user@famidoc.vn"`, `otp: "654321"`, `newPassword: "NewSecurePassword@2026"`) | Trả về `ApiResponseMessage` (MSG03: "Update password successfully"). | Verify cập nhật `passwordHash`, tăng `tokenVersion` để hủy phiên cũ, xóa OTP trong Redis. |
| **UT-S-21** | Đổi mật khẩu (Change Password) thành công khi nhập đúng mật khẩu cũ | EP | Mock Repo `findById` trả về User. Mock Hasher `verify(oldPass)` = true. Mock Hasher `hash(newPass)` = "new_hash". Mock Repo `updatePassword` = OK. | `userId: "u-1"`, `ChangePasswordDto` (`oldPassword: "OldPass@123"`, `newPassword: "NewPass@456"`) | Trả về `ApiResponseMessage` (MSG03). | Cập nhật DB, tăng `tokenVersion` thu hồi các thiết bị khác. |
| **UT-S-22** | Đổi mật khẩu thất bại do nhập sai mật khẩu cũ | Boundary | Mock Repo `findById` trả về User. Mock Hasher `verify(oldPass)` = false. | `userId: "u-1"`, DTO với `oldPassword` sai | Ném `BadRequestException` ("Current password is not correct"). | Không update DB, không đổi `tokenVersion`. |
| **UT-S-23** | Đổi mật khẩu thất bại do mật khẩu mới trùng với mật khẩu cũ | Business Rule | Mock Repo `findById` trả về User. Mock Hasher `verify(oldPass)` = true. | DTO có `newPassword === oldPassword` | Ném `BadRequestException` ("New password cannot be the same as current password"). | Không update DB. |

---

### 3.2. Tầng Controller (`auth.controller.spec.ts`) - Mã `UT-C-xx`

| Test ID | Endpoint / Route | Mục tiêu kiểm thử | Arrange (Mock Setup) | Act (Request) | Assert (HTTP Status & Response) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **UT-C-01** | `POST /api/v1/auth/register` | Ủy quyền gọi Service và trả về HTTP 200 | Mock Service `registerFamilyRep` trả về `RegisterInitiateResponse` | Body chứa `RegisterFamilyRepDto` hợp lệ | HTTP Status **200 OK**, body chứa message và `expiresInSeconds: 300`. Verify `service.registerFamilyRep` gọi 1 lần. |
| **UT-C-02** | `POST /api/v1/auth/verify-email-otp` | Xác thực OTP thành công trả về HTTP 201 | Mock Service `verifyEmailOtp` trả về `UserEntity` | Body chứa `VerifyEmailOtpDto` | HTTP Status **201 Created**, body chứa thông tin tài khoản được khởi tạo (ẩn mật khẩu hash). |
| **UT-C-03** | `POST /api/v1/auth/resend-email-otp` | Yêu cầu gửi lại OTP trả về HTTP 200 | Mock Service `resendEmailOtp` trả về `ApiResponseMessage` | Body chứa `ResendEmailOtpDto` | HTTP Status **200 OK**, body chứa thông báo gửi thành công. |
| **UT-C-04** | `POST /api/v1/auth/login` | Đăng nhập thành công trả về HTTP 200 và JWT | Mock Service `login` trả về `LoginSuccessResponse` | Body chứa `LoginDto` | HTTP Status **200 OK**, trả về `accessToken` và role định tuyến. |
| **UT-C-05** | `POST /api/v1/auth/logout` | Đăng xuất người dùng trả về HTTP 200 | Mock Service `logout` resolve void | Header chứa `Authorization: Bearer <token>`, user từ Request decorator | HTTP Status **200 OK**. Verify gọi `service.logout(userId, token)`. |
| **UT-C-06** | `POST /api/v1/auth/forgot-password` | Tiếp nhận quên mật khẩu trả về HTTP 200 | Mock Service `forgotPassword` resolve message | Body chứa `ForgotPasswordDto` | HTTP Status **200 OK**. |
| **UT-C-07** | `POST /api/v1/auth/reset-password` | Đặt lại mật khẩu trả về HTTP 200 | Mock Service `resetPassword` resolve message | Body chứa `ResetPasswordDto` | HTTP Status **200 OK**, message cập nhật thành công. |
| **UT-C-08** | `PUT /api/v1/auth/change-password` | Đổi mật khẩu cá nhân trả về HTTP 200 | Mock Service `changePassword` resolve message | User đã đăng nhập, body chứa `ChangePasswordDto` | HTTP Status **200 OK**. |

---

### 3.3. Tầng Repository (`user.repository.impl.spec.ts`) - Mã `UT-R-xx`

| Test ID | Phương thức | Mục tiêu kiểm thử | Arrange (Prisma Mock) | Act (Gọi Repo) | Assert (Query Args & Return) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **UT-R-01** | `findByEmail` | Tìm kiếm User theo email chính xác | Mock `prisma.user.findUnique` trả về record | `findByEmail("test@famidoc.vn")` | Verify gọi `prisma.user.findUnique` với `{ where: { email: "test@famidoc.vn" } }`. Trả về Entity chuẩn. |
| **UT-R-02** | `findByPhone` | Tìm kiếm User theo số điện thoại | Mock `prisma.user.findFirst` trả về record | `findByPhone("0912345678")` | Verify gọi `prisma.user.findFirst` với `{ where: { phone: "0912345678" } }`. |
| **UT-R-03** | `createFamilyRepWithProfile` | Thực hiện Atomic Transaction tạo 3 thực thể | Mock `prisma.$transaction` nhận callback | `createFamilyRepWithProfile(data)` | Verify trong transaction: gọi `user.create`, `familyUnit.create`, `patient.create` và liên kết đúng `HeadOfFamily_PatientID`. |
| **UT-R-04** | `updatePassword` | Cập nhật mật khẩu băm của User | Mock `prisma.user.update` | `updatePassword("u-1", "hash_new")` | Verify gọi `prisma.user.update` với `{ where: { id: "u-1" }, data: { passwordHash: "hash_new" } }`. |
| **UT-R-05** | `incrementTokenVersion` | Tăng trường `tokenVersion` lên 1 đơn vị | Mock `prisma.user.update` | `incrementTokenVersion("u-1")` | Verify gọi `prisma.user.update` với `{ data: { tokenVersion: { increment: 1 } } }`. |

---

## 4. Kịch Bản Tiêm Lỗi Phụ Thuộc (Fault Injection Matrix)

| Fault ID | Tầng áp dụng | Thành phần giả lập lỗi (Target Double) | Hành vi lỗi được bơm (Injected Fault) | Kết quả kỳ vọng (Exception / Rollback Handling) |
| :--- | :---: | :--- | :--- | :--- |
| **FI-01** | Service | `USER_REPOSITORY_TOKEN` (DB) | Ném `PrismaClientKnownRequestError` (P2002: Unique constraint failed) | Bắt lỗi và chuyển đổi thành `ConflictException` (MSG09) thay vì để lộ lỗi DB thô. |
| **FI-02** | Service | `USER_REPOSITORY_TOKEN` (DB) | Ném `PrismaClientInitializationError` / Mất kết nối DB | Ném `ServiceUnavailableException` ("Database connection failure, please try again later" - MSG25). |
| **FI-03** | Service | `REDIS_SERVICE` (Cache) | Ném `RedisTimeoutException` khi kiểm tra Brute-force Lock | Ném `ServiceUnavailableException` (Không cho phép đăng nhập nếu hạ tầng bảo mật Redis gặp sự cố). |
| **FI-04** | Service | `MAILER_SERVICE` (SMTP) | Ném `SMTPConnectionTimeout` (Quá 5000ms không gửi được email) | Rollback việc sinh OTP trong Redis, ném `ServiceUnavailableException` ("Failed to dispatch verification email. Please try again."). |
| **FI-05** | Service | `PASSWORD_HASHER` (Argon2) | Bị crash bộ nhớ khi băm chuỗi payload độc hại | Bắt lỗi an toàn, giải phóng tài nguyên và ném `InternalServerErrorException`. |
| **FI-06** | Repository | `PrismaService.$transaction` | Lỗi ở bước tạo `PATIENT` (Bước 3 trong Transaction đăng ký) | Toàn bộ bản ghi `USER` và `FAMILY_UNIT` được rollback 100%, không phát sinh bản ghi mồ côi. |

---

## 5. Tiêu Chí Nghiệm Thu Đột Biến (Mutation Checklist)

| Mutant ID | Vị trí đột biến giả định | Toán tử thay đổi | Hành vi của Mutant | Test Case phát hiện & tiêu diệt (Killing Test) |
| :--- | :--- | :--- | :--- | :--- |
| **MUT-01** | Kiểm tra độ dài mật khẩu | Đổi `>= 8` thành `> 8` | Mật khẩu 8 ký tự bị ném lỗi không chính xác | `UT-S-01` (với pass 8 ký tự) |
| **MUT-02** | Kiểm tra số lần brute-force | Đổi `>= 5` thành `> 5` | Lần thứ 5 sai mật khẩu chưa bị khóa tài khoản | `UT-S-13` (kiểm tra trạng thái lock khi counter = 5) |
| **MUT-03** | Kiểm tra thời gian Cooldown OTP | Đổi `cooldown > 0` thành `cooldown >= 0` | Không cho phép gửi lại ngay cả khi cooldown đã về 0 | `UT-S-09` |
| **MUT-04** | Khởi tạo Transaction đăng ký | Xóa lệnh gán `HeadOfFamily_PatientID` | Hồ sơ gia đình không gắn được chủ hộ đại diện (vi phạm `BR-05`) | `UT-R-03` |
| **MUT-05** | Logic Đổi mật khẩu | Xóa lệnh `incrementTokenVersion` | Đổi mật khẩu xong nhưng phiên cũ trên các thiết bị khác không bị ngắt | `UT-S-21` |
| **MUT-06** | Xóa mã OTP sau verify | Xóa dòng gọi `redis.del(key)` | Mã OTP có thể dùng lại lần thứ 2 (dính Replay Attack) | `UT-S-05` |
| **MUT-07** | Đăng xuất an toàn | Xóa dòng ghi token vào Blacklist | Token cũ vẫn có thể gọi API trong thời gian còn hạn | `UT-S-17` |

---

## 6. Ma Trận Truy Vết Phủ (Coverage Traceability)

| Thành phần đặc tả / Yêu cầu / Quy tắc nghiệp vụ | Test ID kiểm thử tương ứng | File Spec đích (Jest Target) |
| :--- | :--- | :--- |
| **UC-01 (Đăng ký tài khoản & OTP Email)** | `UT-S-01`, `UT-S-02`, `UT-S-03`, `UT-S-04`, `UT-S-05`, `UT-S-06`, `UT-S-07`, `UT-C-01`, `UT-C-02`, `UT-R-03` | `auth.service.impl.spec.ts`, `auth.controller.spec.ts`, `user.repository.impl.spec.ts` |
| **Cooldown gửi lại OTP Email** | `UT-S-08`, `UT-S-09`, `UT-C-03` | `auth.service.impl.spec.ts`, `auth.controller.spec.ts` |
| **UC-02 (Đăng nhập đa vai trò & Argon2id)** | `UT-S-10`, `UT-S-16`, `UT-C-04` | `auth.service.impl.spec.ts`, `auth.controller.spec.ts` |
| **Chống Brute-force (Khóa 30m sau 5 lần sai)** | `UT-S-11`, `UT-S-12`, `UT-S-13` | `auth.service.impl.spec.ts` |
| **Quy tắc GB-05 (Thông báo lỗi trung tính khi đăng nhập)** | `UT-S-14` | `auth.service.impl.spec.ts` |
| **Quy tắc GB-06 (Chặn tài khoản Suspended)** | `UT-S-15` | `auth.service.impl.spec.ts` |
| **UC-03 (Đăng xuất an toàn & JWT Blacklist)** | `UT-S-17`, `UT-C-05` | `auth.service.impl.spec.ts`, `auth.controller.spec.ts` |
| **UC-04 (Quên mật khẩu & OTP Email)** | `UT-S-18`, `UT-S-19`, `UT-S-20`, `UT-C-06`, `UT-C-07`, `UT-R-04` | `auth.service.impl.spec.ts`, `auth.controller.spec.ts`, `user.repository.impl.spec.ts` |
| **UC-05 (Đổi mật khẩu & Revoke Session)** | `UT-S-21`, `UT-S-22`, `UT-S-23`, `UT-C-08`, `UT-R-05` | `auth.service.impl.spec.ts`, `auth.controller.spec.ts`, `user.repository.impl.spec.ts` |
| **Quy tắc BR-05 (Liên kết Family Unit & Patient)** | `UT-R-03`, `MUT-04` | `user.repository.impl.spec.ts` |
| **Khả năng chịu lỗi & Rollback (Fault Injection)** | `FI-01`, `FI-02`, `FI-03`, `FI-04`, `FI-05`, `FI-06` | `auth.service.impl.spec.ts`, `user.repository.impl.spec.ts` |
| **Tiêu diệt đột biến logic (Mutation Testing)** | `MUT-01` đến `MUT-07` | Toàn bộ 3 file spec của module auth |

---
*Tài liệu đặc tả kiểm thử trên đóng vai trò là Hợp đồng đầu vào (Input Contract) chuẩn mực để tiến hành quy trình TDD trong skill `@nestjs-clean-architecture`.*
