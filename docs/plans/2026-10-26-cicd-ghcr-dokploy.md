# Triển khai CI/CD qua GitHub Actions, GHCR và Dokploy (Phương án 1) — Kế hoạch triển khai

**Mục tiêu:** Xây dựng hệ thống CI/CD hoàn chỉnh cho `famidoc-backend`, bao gồm kiểm thử tự động (Quality Gate) trên GitHub Actions, đóng gói Docker Image đẩy lên GitHub Container Registry (GHCR), và tự động kích hoạt Dokploy triển khai an toàn mà không tiêu tốn tài nguyên build trên VPS.

**Cách tiếp cận:**
1. Chuẩn hóa test runner script và bổ sung Health Check endpoint theo chuẩn TDD.
2. Tối ưu Dockerfile và script khởi động container đảm bảo tách biệt migration an toàn.
3. Tạo GitHub Actions workflow pipeline gồm 2 giai đoạn: `CI (Quality Gates)` và `CD (Build & Push GHCR + Dokploy Trigger)`.
4. Cấu hình Registry GHCR và Webhook trong Dokploy để hoàn tất chu trình triển khai tự động.

**Đã tra cứu codebase (codebase-memory-mcp):**
- `get_architecture`: Dự án sử dụng NestJS v12 + TypeScript, kiến trúc module hóa với các package chính `modules`, `core`, `schema`, `app`. Entry point tại `src/main.ts` lắng nghe cổng 4000.
- `get_architecture` (path="test"): Đã xác nhận cấu trúc test gồm unit test đặt tại `src/**/__tests__/**/*.spec.ts` và e2e test tại `test/`.
- `search_code` / `read_file`: `package.json` sử dụng `jest` v30 với cờ `--experimental-vm-modules`, `oxlint` v1.58 làm linter, Prisma Client v6.19.3. Hiện có 52 unit test đang PASS khi chạy cùng `--forceExit`.
- `dokploy-mcp` (`project-all`, `application-one`): Dự án Dokploy là `famidoc`, application ID `swj73osF0TmNE9lbBTkQU` (`famidoc-backend`), kết nối qua domain `api.160.191.242.45.traefik.me`. Log deployment trước đây ghi nhận lỗi timeout kết nối Docker Hub khi VPS tự compile.
- `github-mcp` (`list_branches`, `get_file_contents`): Repository `h004888/famidoc-backend` hiện có các nhánh `dev`, `main`, `hungpx`, `nam`; chưa có thư mục `.github/workflows/`.

**Framework test & quy ước (đã xác nhận qua codebase-memory-mcp):**
- Framework: `jest` (ts-jest) chạy dưới môi trường Node.js với cờ `--experimental-vm-modules`.
- Vị trí đặt file test: `src/**/__tests__/*.spec.ts` tương ứng theo từng module.
- Lệnh chạy test: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit` hoặc `npm test -- --forceExit`.

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code phải theo chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Mọi secrets (như GitHub Personal Access Token, Dokploy Webhook URL, Database credentials) tuyệt đối không được hardcode vào file mã nguồn hoặc git commit.
- Giữ nguyên toàn bộ logic nghiệp vụ hiện có của module Auth và Prisma Repository.

---

### Task 1: Chuẩn hóa Test Runner và Bổ sung Health Check Endpoint

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `src/core/health/health.controller.ts`
- Chỉnh sửa: `package.json`, `src/app.module.ts`
- Test tương ứng: `src/core/health/__tests__/health.controller.spec.ts`
- Kiểm chứng bằng: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/health/__tests__/health.controller.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Hệ thống giám sát của Dokploy Traefik / Docker Healthcheck
- Gọi tới: `AppModule` (đăng ký `HealthController`)
- Regression test cần chạy thêm do có inbound calls: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/base-prisma.repository.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Yêu cầu chuẩn hóa lệnh test CI trong `package.json`
- Cung cấp đầu ra cho: Dockerfile Healthcheck ở Task 2 và Dokploy Traefik Health monitor ở Task 4

- [ ] **Bước 1 [RED]: Viết test cho HealthController endpoint GET /health**
  Vị trí file test: `src/core/health/__tests__/health.controller.spec.ts`
  Test case: Kiểm tra phương thức `check()` của `HealthController` trả về object có cấu trúc `{ status: 'ok', timestamp: expect.any(String), uptime: expect.any(Number) }`.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/health/__tests__/health.controller.spec.ts` → FAIL với lý do `Cannot find module '../health.controller'`, không fail vì lỗi cú pháp.
- [ ] **Bước 2 [GREEN]: Tạo HealthController và khai báo trong AppModule, cập nhật script test trong package.json**
  Vị trí triển khai: Tạo `src/core/health/health.controller.ts`, import vào `src/app.module.ts`, và thêm cờ `--forceExit` vào script `"test"` trong `package.json`.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/health/__tests__/health.controller.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR] (nếu cần): Tinh chỉnh cấu trúc dữ liệu HealthResponse DTO**
  Mô tả: Tách interface `HealthCheckResponse` đảm bảo chuẩn type-safe cho Swagger documentation.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/health/__tests__/health.controller.spec.ts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- --forceExit`)
  Kết quả mong đợi: tất cả 53 tests PASS, bao gồm cả regression test của các call site đã liệt kê ở trên.

---

### Task 2: Tối ưu Dockerfile & Entrypoint tách biệt Migration an toàn

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `scripts/docker-entrypoint.sh`
- Chỉnh sửa: `Dockerfile`
- Test tương ứng: `src/core/__tests__/entrypoint-contract.spec.ts`
- Kiểm chứng bằng: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/entrypoint-contract.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Lệnh `ENTRYPOINT` của Docker Container Runner
- Gọi tới: `npx prisma db push` hoặc `npx prisma migrate deploy` dựa trên biến môi trường `AUTO_MIGRATE=true`
- Regression test cần chạy thêm do có inbound calls: không cần

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Health check endpoint tại Task 1
- Cung cấp đầu ra cho: Docker Build Job trong GitHub Actions tại Task 3

- [ ] **Bước 1 [RED]: Viết test xác thực hợp đồng cấu hình runtime entrypoint script**
  Vị trí file test: `src/core/__tests__/entrypoint-contract.spec.ts`
  Test case: Đọc nội dung `scripts/docker-entrypoint.sh` và `Dockerfile`, kiểm tra file tồn tại, có quyền execute, có xử lý cờ `AUTO_MIGRATE`, và lệnh `HEALTHCHECK` trỏ tới `/health`.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/entrypoint-contract.spec.ts` → FAIL với lý do `ENOENT: no such file or directory, open 'scripts/docker-entrypoint.sh'`, không fail vì lỗi cú pháp.
- [ ] **Bước 2 [GREEN]: Tạo file scripts/docker-entrypoint.sh và cập nhật Dockerfile**
  Vị trí triển khai: Tạo `scripts/docker-entrypoint.sh` với điều kiện kiểm tra biến môi trường trước khi chạy migration và khởi chạy `node dist/main`. Thêm `HEALTHCHECK` trong `Dockerfile`.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/entrypoint-contract.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR] (nếu cần): Tối ưu các tầng cache layer trong Dockerfile**
  Mô tả: Tinh chỉnh thứ tự COPY package*.json và prisma schema để tận dụng Docker Build Cache tối đa.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/entrypoint-contract.spec.ts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- --forceExit`)
  Kết quả mong đợi: tất cả tests PASS, bao gồm cả regression test của các call site đã liệt kê ở trên.

---

### Task 3: Thiết lập GitHub Actions Pipeline (.github/workflows/ci-cd.yml)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `.github/workflows/ci-cd.yml`
- Chỉnh sửa: không có
- Test tương ứng: `src/core/__tests__/ci-cd-workflow.spec.ts`
- Kiểm chứng bằng: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/ci-cd-workflow.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: GitHub Push/Pull Request Events trên nhánh `main` và `dev`
- Gọi tới: GHCR API và Dokploy Redeploy Webhook
- Regression test cần chạy thêm do có inbound calls: không cần

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Dockerfile tối ưu ở Task 2
- Cung cấp đầu ra cho: Image container trên `ghcr.io` và Webhook trigger cho Dokploy ở Task 4

- [ ] **Bước 1 [RED]: Viết test kiểm tra cấu trúc và tính hợp lệ của GitHub Actions Workflow file**
  Vị trí file test: `src/core/__tests__/ci-cd-workflow.spec.ts`
  Test case: Đọc và phân tích file `.github/workflows/ci-cd.yml`, xác nhận có chứa 2 jobs `quality-check` (chạy `oxlint`, `npm test`, `nest build`) và `build-and-deploy` (đăng nhập `ghcr.io`, build docker image, gọi webhook Dokploy).
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/ci-cd-workflow.spec.ts` → FAIL với lý do `ENOENT: no such file or directory, open '.github/workflows/ci-cd.yml'`, không fail vì lỗi cú pháp.
- [ ] **Bước 2 [GREEN]: Tạo file .github/workflows/ci-cd.yml với đầy đủ 2 jobs CI và CD**
  Vị trí triển khai: Tạo `.github/workflows/ci-cd.yml` thiết lập workflow tự động kiểm tra code và publish docker image lên GHCR khi merge vào `dev`/`main`.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/ci-cd-workflow.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR] (nếu cần): Tối ưu caching cho npm dependencies và Docker buildx trong workflow**
  Mô tả: Sử dụng `actions/cache@v4` và `docker/setup-buildx-action` kết hợp `cache-from: type=gha` và `cache-to: type=gha,mode=max`.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/ci-cd-workflow.spec.ts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- --forceExit`)
  Kết quả mong đợi: tất cả tests PASS, bao gồm cả regression test của các call site đã liệt kê ở trên.

---

### Task 4: Cấu hình Registry GHCR & Webhook Triển Khai trên Dokploy

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: không có file mã nguồn mới
- Chỉnh sửa: Cấu hình ứng dụng Dokploy qua Dokploy API / MCP (`registry-create`, `application-update`)
- Test tương ứng: `src/core/__tests__/dokploy-config-contract.spec.ts`
- Kiểm chứng bằng: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/dokploy-config-contract.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Job `build-and-deploy` của GitHub Actions
- Gọi tới: Container Docker `famidoc-backend` trên server Dokploy
- Regression test cần chạy thêm do có inbound calls: không cần

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Image đã push lên `ghcr.io/h004888/famidoc-backend` ở Task 3
- Cung cấp đầu ra cho: Hệ thống chạy thực tế trên domain `api.160.191.242.45.traefik.me`

- [ ] **Bước 1 [RED]: Viết test kiểm tra tài liệu và contract tích hợp biến môi trường Dokploy**
  Vị trí file test: `src/core/__tests__/dokploy-config-contract.spec.ts`
  Test case: Kiểm tra file hướng dẫn tích hợp `docs/deployment/dokploy-ghcr-setup.md` tồn tại, chứa đầy đủ các khóa cấu hình yêu cầu: URL image `ghcr.io/h004888/famidoc-backend`, port mapping `4000`, và token webhook.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/dokploy-config-contract.spec.ts` → FAIL với lý do `ENOENT: no such file or directory, open 'docs/deployment/dokploy-ghcr-setup.md'`, không fail vì lỗi cú pháp.
- [ ] **Bước 2 [GREEN]: Tạo tài liệu hướng dẫn và cấu hình Registry GHCR trong Dokploy**
  Vị trí triển khai: Tạo `docs/deployment/dokploy-ghcr-setup.md`, cập nhật cấu hình Dokploy sang `buildType: docker` image và liên kết Registry GitHub Container Registry.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/dokploy-config-contract.spec.ts` → PASS.
- [ ] **Bước 3 [REFACTOR] (nếu cần): Tinh gọn tài liệu và đối soát checklist bảo mật**
  Mô tả: Rà soát không có token nhạy cảm nào bị lộ trong tài liệu cấu hình.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/dokploy-config-contract.spec.ts` → vẫn PASS, hành vi không đổi.
- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy toàn bộ test liên quan tới task (`npm test -- --forceExit`)
  Kết quả mong đợi: tất cả tests PASS, bao gồm cả regression test của các call site đã liệt kê ở trên.
