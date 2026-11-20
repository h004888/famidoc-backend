# Tối ưu triệt để CI/CD Backend (GHCR + Browserless Sidecar + Slim Runner) — Kế hoạch triển khai

**Mục tiêu:** Loại bỏ hoàn toàn việc build Docker trên VPS và thu gọn image `famidoc-backend` từ `1.69 GB` xuống `~250–350 MB` bằng cách sửa pipeline GitHub Actions + GHCR, tách Chromium thành container sidecar dùng chung, và chuyển Dokploy sang chế độ pull image từ GHCR kèm cơ chế tự dọn dẹp rác Docker/GHCR.

**Cách tiếp cận:** Thực hiện tuần tự từ tầng ứng dụng đến tầng đóng gói và hạ tầng: (1) mở rộng `ContractPdfRendererService` hỗ trợ kết nối Browserless qua WebSocket (`PUPPETEER_BROWSER_WS_ENDPOINT`) trong khi giữ nguyên chữ ký `renderPdf(html)` và fallback local; (2) tinh gọn `Dockerfile` và `.dockerignore` để bỏ Chromium và loại bỏ các tầng Prisma/npm bị nhân đôi; (3) sửa lỗi skip webhook và tách tag `:dev`/`:latest` kèm dọn package cũ trong `.github/workflows/ci-cd.yml`; (4) cập nhật tài liệu triển khai và chuyển đổi cấu hình Dokploy + Browserless sidecar + Docker log rotation trên VPS.

**Đã tra cứu codebase (`codebase-memory-mcp`) & tài liệu kỹ thuật (`ddg-search`):**
- `get_architecture` (`C-Users-ADMIN-Downloads-famidoc-famidoc-backend`): dự án NestJS v12 + TypeScript + Prisma, gồm 4452 nodes / 14204 edges, các package chính `modules`, `core`, `schema`; route `GET /health` đã có tại `src/core/health/health.controller.ts` (`HealthController`).
- `search_graph` & `trace_path` (`ContractPdfRendererService` tại `src/modules/contracts/services/contract-pdf-renderer.service.ts:23-155`): chỉ có 2 callers trực tiếp ở tầng service là `ContractsServiceImpl.provisionB2bDocumensoEnvelope` (`:909-1007`) và `ContractsServiceImpl.provisionDocumensoEnvelope` (`:3358-3367`) cùng file unit test `src/modules/contracts/__tests__/contract-pdf-renderer.service.spec.ts`; hop 2–3 gồm `createInitialMedicalContract`, `createPackageUpgradeContract`, `createStaffingContract`, `updateStaffingContract`, `getSigningSession`, `getStaffingSigningSession`, `initiateFourPartyContract`.
- `search_code` (`ContractPdfRendererService`): xác nhận DI token tại `src/modules/contracts/contracts.module.ts:24,31`, constructor `@Optional() @Inject(ContractPdfRendererService)` và fallback `new ContractPdfRendererService()` tại `src/modules/contracts/services/impl/contracts.service.impl.ts:122-124,972,3364`; các file spec liên quan gồm `contract-pdf-renderer.service.spec.ts`, `staffing-contracts.service.spec.ts`, `unpaid-contract-cancellation.spec.ts`.
- `trace_path(mode="run")` trên `Dockerfile` & đọc `Dockerfile`, `.dockerignore`, `.github/workflows/ci-cd.yml`, `scripts/docker-entrypoint.sh`, `prisma/schema.prisma`: xác nhận `Dockerfile` cài `chromium` + `fonts-*` (`689 MB`) ở cả `builder` và `runner`, `npm ci --omit=dev` (`629 MB`) kèm 3 lệnh `COPY --from=builder` đè `@prisma/client`/`@prisma/engines`/`.prisma` (`139.6 MB`), `.github/workflows/ci-cd.yml:96` đánh giá `if: ${{ env.DOKPLOY_WEBHOOK != '' }}` trước khi gán `env:` của step nên webhook luôn bị skip.
- `search_graph` (`src/core/__tests__/`): đã có sẵn 3 bộ test contract hạ tầng là `src/core/__tests__/entrypoint-contract.spec.ts`, `src/core/__tests__/ci-cd-workflow.spec.ts`, `src/core/__tests__/dokploy-config-contract.spec.ts`.
- `ddg-search` (`docs.browserless.io/enterprise/docker/config`, `docs.browserless.io/baas/quick-start`): xác nhận Browserless v2 (`ghcr.io/browserless/chromium`) sử dụng `puppeteer.connect({ browserWSEndpoint: 'ws://<host>:3000?token=<TOKEN>' })`, hỗ trợ biến môi trường `TOKEN`, `CONCURRENT`, `QUEUED`, `TIMEOUT`, `HEALTH`, và kết thúc session bằng `browser.close()`.

**Framework test & quy ước (đã xác nhận qua `codebase-memory-mcp` và `jest.config.ts`):**
- Framework: `jest` v30 (`ts-jest` v29.4.0) chạy trên Node 24 với `--experimental-vm-modules` (`testEnvironment: 'node'`).
- Vị trí đặt file test: `src/**/__tests__/**/*.spec.ts` (khai báo tại `jest.config.ts:16`).
- Lệnh chạy test: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit` (hoặc `npm test -- <path-to-spec>`).

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa code hoặc contract cấu hình (Tasks 1–4) bắt buộc tuân thủ chu trình Red → Green → Refactor.
- Không có task nào được đánh dấu hoàn tất nếu thiếu test tự động tương ứng và log xác nhận PASS.
- Giữ nguyên toàn bộ chữ ký public (`renderPdf(html: string): Promise<Buffer>`, `connect()`, `disconnect()`) và khả năng gọi `new ContractPdfRendererService()` không tham số của `ContractPdfRendererService`.
- Không commit token, password, webhook URL hoặc secret thật vào bất kỳ file nào trong repository.
- Không bật thao tác ghi lên VPS/Dokploy trước khi hoàn tất kiểm chứng local và nhận xác nhận triển khai hạ tầng.

---

### Task 1: Hỗ trợ kết nối Remote Browserless WebSocket trong `ContractPdfRendererService`

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa: `src/modules/contracts/services/contract-pdf-renderer.service.ts` (`ContractPdfRendererService`, thêm `PUPPETEER_CONNECTOR_TOKEN`, `PuppeteerConnectFn`, cập nhật `constructor`, `launchBrowser` / `openBrowser`)
- Test tương ứng: `src/modules/contracts/__tests__/contract-pdf-renderer.service.spec.ts`
- Kiểm chứng bằng: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/modules/contracts/__tests__/contract-pdf-renderer.service.spec.ts`

**Ảnh hưởng liên quan (từ `trace_path` / `search_code`):**
- Được gọi bởi: `ContractsServiceImpl.provisionB2bDocumensoEnvelope` (`src/modules/contracts/services/impl/contracts.service.impl.ts:972-973`) và `ContractsServiceImpl.provisionDocumensoEnvelope` (`:3364-3365`); các hàm gọi gián tiếp hop 2–3 (`createInitialMedicalContract`, `createPackageUpgradeContract`, `createStaffingContract`, `updateStaffingContract`, `getSigningSession`, `getStaffingSigningSession`, `initiateFourPartyContract`).
- Gọi tới: `puppeteer-core` (`default.connect` khi có `PUPPETEER_BROWSER_WS_ENDPOINT`, `default.launch` khi chạy fallback local).
- Regression test cần chạy thêm do có inbound calls: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/modules/contracts/__tests__/staffing-contracts.service.spec.ts src/modules/contracts/__tests__/unpaid-contract-cancellation.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: biến môi trường `PUPPETEER_BROWSER_WS_ENDPOINT` (sẽ được cung cấp bởi Browserless sidecar ở Task 5).
- Cung cấp đầu ra cho: Task 2 có thể loại bỏ hoàn toàn Chromium khỏi `Dockerfile` mà chức năng xuất PDF hợp đồng vẫn vận hành bình thường.

- [ ] **Bước 1 [RED]: Viết test cho nhánh kết nối WebSocket (`PUPPETEER_BROWSER_WS_ENDPOINT`) và fallback local trong `contract-pdf-renderer.service.spec.ts`**
  Vị trí file test: `src/modules/contracts/__tests__/contract-pdf-renderer.service.spec.ts`
  Test case:
  1. Khi `process.env.PUPPETEER_BROWSER_WS_ENDPOINT = 'ws://chromium-renderer:3000?token=test-token'`, `renderPdf('<html><body>HĐ</body></html>')` gọi `connector` với `{ browserWSEndpoint: 'ws://chromium-renderer:3000?token=test-token' }`, không gọi `launcher`, xuất PDF buffer, và đóng `page.close()` + `browser.close()` trong `finally`.
  2. Khi `process.env.PUPPETEER_BROWSER_WS_ENDPOINT` không được đặt (hoặc chuỗi rỗng/khoảng trắng), `renderPdf()` fallback gọi `launcher` cục bộ với `executablePath` như hành vi hiện tại và không gọi `connector`.
  3. Khi `connector` ném lỗi kết nối WebSocket, `renderPdf()` ném `ServiceUnavailableException` và giải phóng mutex để lần gọi kế tiếp vẫn chạy bình thường.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/modules/contracts/__tests__/contract-pdf-renderer.service.spec.ts` → FAIL với lý do `PUPPETEER_CONNECTOR_TOKEN` / tham số `connector` chưa tồn tại hoặc `launcher` vẫn bị gọi thay vì `connector`, không fail vì lỗi cú pháp không chủ đích sau khi khai báo import.

- [ ] **Bước 2 [GREEN]: Cập nhật `ContractPdfRendererService` tại `src/modules/contracts/services/contract-pdf-renderer.service.ts` để test ở Bước 1 PASS**
  Chi tiết triển khai:
  - Export thêm `export type PuppeteerConnectFn = (options: ConnectOptions) => Promise<Browser>;` và `export const PUPPETEER_CONNECTOR_TOKEN = Symbol('PUPPETEER_CONNECTOR_TOKEN');`.
  - Thêm tham số tùy chọn thứ 2 vào constructor: `@Optional() @Inject(PUPPETEER_CONNECTOR_TOKEN) connector?: PuppeteerConnectFn` (giữ nguyên tham số đầu `launcher?: PuppeteerLaunchFn` để tương thích 100% với các test đang gọi `new ContractPdfRendererService(launcher)`).
  - Trong `openBrowser()` (thay thế hoặc gọi từ `connect()`): kiểm tra `const wsEndpoint = process.env.PUPPETEER_BROWSER_WS_ENDPOINT?.trim();`. Nếu `wsEndpoint` có giá trị, gọi `this.connector({ browserWSEndpoint: wsEndpoint })` hoặc `(await import('puppeteer-core')).default.connect({ browserWSEndpoint: wsEndpoint })`; ngược lại giữ nguyên luồng `launchBrowser()` cục bộ.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/modules/contracts/__tests__/contract-pdf-renderer.service.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Tách helper chọn chế độ kết nối (`resolveWsEndpoint`) và đảm bảo an toàn đóng kết nối**
  Mô tả: Tách phần đọc & chuẩn hóa `PUPPETEER_BROWSER_WS_ENDPOINT` và log mode kết nối (ẩn token trong log nếu URL có `?token=...`, không để lộ secret ra stdout/log), đảm bảo `disconnect()` vẫn idempotent.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/modules/contracts/__tests__/contract-pdf-renderer.service.spec.ts` → vẫn PASS.

- [ ] **Bước 4: Xác nhận hoàn tất task & chạy regression tests**
  Cách kiểm tra: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/modules/contracts/__tests__/contract-pdf-renderer.service.spec.ts src/modules/contracts/__tests__/staffing-contracts.service.spec.ts src/modules/contracts/__tests__/unpaid-contract-cancellation.spec.ts`
  Kết quả mong đợi: tất cả PASS, hành vi callers `ContractsServiceImpl` không bị phá vỡ.

---

### Task 2: Tối ưu `Dockerfile` (Slim Runner không Chromium, không nhân đôi Prisma) và `.dockerignore`

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa: `Dockerfile` (`builder` stage và `runner` stage), `.dockerignore`
- Test tương ứng: `src/core/__tests__/entrypoint-contract.spec.ts`
- Kiểm chứng bằng: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/entrypoint-contract.spec.ts`

**Ảnh hưởng liên quan (từ `trace_path`):**
- Được gọi bởi: Job `build-and-deploy` trong `.github/workflows/ci-cd.yml` khi build Docker image.
- Gọi tới: `scripts/docker-entrypoint.sh` (`node node_modules/prisma/build/index.js migrate deploy` khi `AUTO_MIGRATE=true`), `node dist/main.js`, `GET /health` trong `HEALTHCHECK`.
- Regression test cần chạy thêm do có inbound calls: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/health/__tests__/health.controller.spec.ts`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (loại bỏ yêu cầu binary Chromium cục bộ trong container backend).
- Cung cấp đầu ra cho: Task 3 (GitHub Actions build image nhẹ `~250–350 MB` đẩy lên GHCR).

- [ ] **Bước 1 [RED]: Bổ sung kiểm tra slim `Dockerfile` và đầy đủ `.dockerignore` vào `src/core/__tests__/entrypoint-contract.spec.ts`**
  Vị trí file test: `src/core/__tests__/entrypoint-contract.spec.ts`
  Test case:
  1. `Dockerfile` không được chứa gói `chromium`, `fonts-dejavu-core`, `fonts-liberation`, hoặc `CHROMIUM_EXECUTABLE_PATH`.
  2. `Dockerfile` stage `runner` phải cài `openssl` cho Prisma runtime, KHÔNG chạy lại `npm ci --omit=dev` kết hợp `COPY --from=builder /app/node_modules/@prisma/...` đè lớp, mà phải prune ở `builder` (`npm prune --omit=dev`) và copy `node_modules` một lần từ `builder` (`COPY --from=builder /app/node_modules ./node_modules`), kèm dọn cache (`npm cache clean --force` hoặc tương đương).
  3. `.dockerignore` tồn tại và chứa các mẫu loại trừ `node_modules`, `dist`, `.git`, `.env*`, `logs`, `data`, `docs`, `test`, `coverage`, `scripts/doc-tools`, `*.md`, `openapi.json`, `test-output.txt`.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/entrypoint-contract.spec.ts` → FAIL với lý do `Dockerfile` hiện tại vẫn chứa `chromium` / `npm ci --omit=dev` và `.dockerignore` thiếu các thư mục rác.

- [ ] **Bước 2 [GREEN]: Cập nhật `Dockerfile` và `.dockerignore` để test ở Bước 1 PASS**
  Chi tiết triển khai:
  - Stage `builder` (`FROM node:24-bookworm-slim AS builder`): giữ `WORKDIR /app`, bỏ hoàn toàn `apt-get install ... chromium fonts-*` (chỉ giữ `openssl` nếu `prisma generate` cần), `COPY package*.json ./`, `COPY prisma ./prisma/`, `RUN npm ci`, `COPY . .`, `RUN npx prisma generate && npm run build && npm prune --omit=dev && npm cache clean --force`.
  - Stage `runner` (`FROM node:24-bookworm-slim AS runner`): `WORKDIR /app`, `RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*`, set `ENV NODE_ENV=production` & `ENV PORT=4000`, `COPY package*.json ./`, `COPY prisma ./prisma/`, `COPY --from=builder /app/node_modules ./node_modules`, `COPY --from=builder /app/dist ./dist`, `COPY scripts/docker-entrypoint.sh /app/scripts/docker-entrypoint.sh`, `RUN chmod +x /app/scripts/docker-entrypoint.sh`, giữ nguyên `EXPOSE 4000`, `HEALTHCHECK` tới `http://localhost:4000/health`, `ENTRYPOINT`, `CMD ["node", "dist/main.js"]`.
  - Mở rộng `.dockerignore` bổ sung: `logs`, `data`, `docs`, `test`, `coverage`, `scripts/doc-tools`, `*.md`, `openapi.json`, `test-output.txt`, `.agents`, `.claude`, `compose.local.yml`, `jest.config.ts`, `.oxlintrc.json`, `.prettierrc`.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/entrypoint-contract.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Kiểm tra thứ tự COPY & layer cache của `Dockerfile`**
  Mô tả: Xác nhận `COPY package*.json ./` và `COPY prisma ./prisma/` nằm trước `COPY . .` để tận dụng tối đa Docker layer cache trên GitHub Actions (`cache-from: type=gha`), và kiểm tra `node_modules/prisma/build/index.js` vẫn còn sau `npm prune --omit=dev` (vì `prisma` nằm trong `dependencies` của `package.json:54`).
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/entrypoint-contract.spec.ts src/core/health/__tests__/health.controller.spec.ts` → vẫn PASS.

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/entrypoint-contract.spec.ts src/core/health/__tests__/health.controller.spec.ts`
  Kết quả mong đợi: tất cả PASS.

---

### Task 3: Sửa triệt để `.github/workflows/ci-cd.yml` (Webhook, Tag theo nhánh, Smoke Check, GHCR Retention)

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa: `.github/workflows/ci-cd.yml`
- Test tương ứng: `src/core/__tests__/ci-cd-workflow.spec.ts`
- Kiểm chứng bằng: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/ci-cd-workflow.spec.ts`

**Ảnh hưởng liên quan (từ `search_graph`):**
- Được gọi bởi: GitHub `push` và `pull_request` events trên nhánh `main` và `dev`.
- Gọi tới: `quality-check` (`npm ci`, `npx prisma generate`, `npm run lint`, `npm test -- --forceExit`, `npm run build`), GHCR (`docker/build-push-action@v6`), Dokploy Webhook (`DOKPLOY_DEPLOY_WEBHOOK_URL`), endpoint verify `https://api.famidoc.online/health`, và `actions/delete-package-versions`.
- Regression test cần chạy thêm do có inbound calls: không cần (file workflow là entry point ngoài cùng).

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: `Dockerfile` tối ưu ở Task 2.
- Cung cấp đầu ra cho: image `ghcr.io/h004888/famidoc-backend:dev` / `:latest` và trigger webhook Dokploy ở Task 5.

- [ ] **Bước 1 [RED]: Bổ sung test assertions sửa lỗi webhook, tách tag và dọn GHCR trong `src/core/__tests__/ci-cd-workflow.spec.ts`**
  Vị trí file test: `src/core/__tests__/ci-cd-workflow.spec.ts`
  Test case:
  1. Nội dung `.github/workflows/ci-cd.yml` KHÔNG được chứa bug `if: ${{ env.DOKPLOY_WEBHOOK != '' }}` ở step webhook; step kích hoạt Dokploy phải kiểm tra rõ `DOKPLOY_DEPLOY_WEBHOOK_URL` (fail rõ ràng nếu rỗng giống `famidoc-frontend` hoặc kiểm tra từ `env` cấp job/bắt buộc non-empty).
  2. Cấu hình `docker/metadata-action` tách riêng tag `:latest` chỉ bật cho `refs/heads/main` (`enable=${{ github.ref == 'refs/heads/main' }}`) và `:dev` chỉ bật cho `refs/heads/dev` (`enable=${{ github.ref == 'refs/heads/dev' }}`), kèm tag `type=sha,prefix=sha-,format=short`.
  3. Sau bước gọi Dokploy webhook phải có bước Post-Deploy Health Smoke Check gọi `/health` (có retry để chờ container mới khởi động xong).
  4. Phải có bước/job dọn dẹp các phiên bản image cũ trên GHCR bằng `actions/delete-package-versions` (với `min-versions-to-keep` để không tích tụ vô hạn các bản `sha-*` / untagged).
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/ci-cd-workflow.spec.ts` → FAIL đúng lý do `.github/workflows/ci-cd.yml` hiện tại vẫn giữ `if: ${{ env.DOKPLOY_WEBHOOK != '' }}`, gộp `:latest` cho cả `dev`/`main`, thiếu health smoke check và thiếu `actions/delete-package-versions`.

- [ ] **Bước 2 [GREEN]: Cập nhật `.github/workflows/ci-cd.yml` để test ở Bước 1 PASS**
  Chi tiết triển khai:
  - Sửa `tags:` trong `docker/metadata-action@v5`:
    - `type=raw,value=latest,enable=${{ github.ref == 'refs/heads/main' }}`
    - `type=raw,value=dev,enable=${{ github.ref == 'refs/heads/dev' }}`
    - `type=sha,prefix=sha-,format=short`
  - Sửa step `Kích hoạt Dokploy Deploy Webhook`: bỏ `if: ${{ env.DOKPLOY_WEBHOOK != '' }}`; kiểm tra trực tiếp `[ -z "$DOKPLOY_WEBHOOK" ]` trong bash (fail với thông báo lỗi rõ ràng nếu chưa cấu hình secret `DOKPLOY_DEPLOY_WEBHOOK_URL`) và chấp nhận mọi mã HTTP `2xx` (`200..299`).
  - Thêm step `Post-Deploy Healthcheck`: polling `https://api.famidoc.online/health` tối đa 25 lần (mỗi lần cách 3s) kiểm tra HTTP 200 và `"status":"ok"` (chạy khi nhánh deploy tới domain tương ứng hoặc cấu hình qua `secrets.BACKEND_HEALTHCHECK_URL || 'https://api.famidoc.online/health'`).
  - Thêm job hoặc step cuối `cleanup-ghcr` dùng `actions/delete-package-versions@v5` (`package-name: famidoc-backend`, `package-type: container`, `min-versions-to-keep: 10`, `delete-only-untagged-versions: true` hoặc giữ lại `latest`/`dev` bằng `ignore-versions: '^(latest|dev)$'`) để không bao giờ xóa nhầm tag đang chạy trên production/dev.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/ci-cd-workflow.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Kiểm tra cú pháp YAML và quyền `permissions` của workflow**
  Mô tả: Xác nhận `permissions` ở cấp workflow có `contents: read` và `packages: write` (đủ cho `GITHUB_TOKEN` push GHCR và `actions/delete-package-versions`), đồng thời kiểm tra không trùng lặp logic shell script.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/ci-cd-workflow.spec.ts` → vẫn PASS.

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/ci-cd-workflow.spec.ts`
  Kết quả mong đợi: PASS.

---

### Task 4: Cập nhật tài liệu cấu hình & hợp đồng hạ tầng (`docs/deployment/dokploy-ghcr-setup.md`)

**Đối tượng liên quan (đã xác nhận qua `codebase-memory-mcp`):**
- Tạo mới: không có
- Chỉnh sửa: `docs/deployment/dokploy-ghcr-setup.md`
- Test tương ứng: `src/core/__tests__/dokploy-config-contract.spec.ts`
- Kiểm chứng bằng: `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/dokploy-config-contract.spec.ts`

**Ảnh hưởng liên quan (từ `search_graph`):**
- Được gọi bởi: quy trình vận hành deploy trên Dokploy / VPS ở Task 5.
- Gọi tới: tài liệu tham chiếu `ghcr.io/h004888/famidoc-backend`, `ghcr.io/browserless/chromium`, `PUPPETEER_BROWSER_WS_ENDPOINT`, `/etc/docker/daemon.json`.
- Regression test cần chạy thêm do có inbound calls: không cần.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: cấu trúc env `PUPPETEER_BROWSER_WS_ENDPOINT` (Task 1), chiến lược tag `:dev`/`:latest` (Task 3).
- Cung cấp đầu ra cho: Task 5 thực thi đúng từng thông số cấu hình trên Dokploy và VPS.

- [ ] **Bước 1 [RED]: Bổ sung kiểm tra hợp đồng tài liệu sidecar & VPS hygiene vào `src/core/__tests__/dokploy-config-contract.spec.ts`**
  Vị trí file test: `src/core/__tests__/dokploy-config-contract.spec.ts`
  Test case:
  1. `docs/deployment/dokploy-ghcr-setup.md` phải chứa đầy đủ: `ghcr.io/h004888/famidoc-backend:dev` và `:latest`, `ghcr.io/browserless/chromium`, `PUPPETEER_BROWSER_WS_ENDPOINT`, `dokploy-network`, và cấu hình `/etc/docker/daemon.json` (`max-size`, `max-file`).
  2. Tài liệu không được chứa chuỗi token/password thật (ví dụ không chứa tiền tố token thật `ghp_` hoặc giá trị secret cứng).
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/dokploy-config-contract.spec.ts` → FAIL với lý do tài liệu hiện tại chưa có `ghcr.io/browserless/chromium`, `PUPPETEER_BROWSER_WS_ENDPOINT` và `/etc/docker/daemon.json`.

- [ ] **Bước 2 [GREEN]: Cập nhật `docs/deployment/dokploy-ghcr-setup.md` để test ở Bước 1 PASS**
  Chi tiết triển khai:
  - Cập nhật phần thông số Dokploy `famidoc-backend`: tách rõ tag `:dev` cho nhánh `dev` (`api.famidoc.online`) và `:latest` cho nhánh `main`, chuyển Source Type sang `Docker` (`ghcr.io`), tắt `autoDeploy` Git và `cleanCache`.
  - Bổ sung mục thiết lập Compose Service `chromium-renderer` sử dụng `ghcr.io/browserless/chromium:latest` trên `dokploy-network` (chỉ nội bộ, không publish port ra ngoài, cấu hình `TOKEN`, `CONCURRENT=3`, `QUEUED=10`, `TIMEOUT=60000`, `HEALTH=true`) và biến `PUPPETEER_BROWSER_WS_ENDPOINT=ws://chromium-renderer:3000?token=<TOKEN>` trong `famidoc-backend`.
  - Bổ sung mục cấu hình `/etc/docker/daemon.json` log rotation (`"log-driver": "json-file"`, `"max-size": "10m"`, `"max-file": "3"`) và bật cleanup cache trên Dokploy (`enableDockerCleanup`, `cleanupCacheApplications`).
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/dokploy-config-contract.spec.ts` → PASS.

- [ ] **Bước 3 [REFACTOR]: Rà soát đối chiếu domain & bảo mật trong tài liệu**
  Mô tả: Cập nhật domain verify từ `api.160.191.242.45.traefik.me` sang `https://api.famidoc.online/health` khớp với cấu hình domain thực tế trên Dokploy (`domains[0].host`), đảm bảo tất cả placeholder token dùng `<TOKEN>`.
  Kỳ vọng: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/dokploy-config-contract.spec.ts` → vẫn PASS.

- [ ] **Bước 4: Xác nhận hoàn tất task**
  Cách kiểm tra: chạy `node --experimental-vm-modules ./node_modules/jest/bin/jest.js --forceExit src/core/__tests__/dokploy-config-contract.spec.ts`
  Kết quả mong đợi: PASS.

---

### Task 5: Triển khai hạ tầng Dokploy, Browserless Sidecar và Dọn dẹp VPS *(Operational Setup — Không sửa source code)*

**Đối tượng liên quan (đã xác nhận qua Dokploy MCP & SSH):**
- Dokploy Project `famidoc` / Environment `production` (`environmentId: "tQ-J3ZjEq-U4nbtIhmmS4"`)
- Dokploy Application `famidoc-backend` (`applicationId: "swj73osF0TmNE9lbBTkQU"`)
- VPS `160.191.242.45` (`/etc/docker/daemon.json`, `/etc/dokploy/applications/famidoc-backend-8rwqvm/code`)
- GitHub Repository `h004888/famidoc-backend` Secret `DOKPLOY_DEPLOY_WEBHOOK_URL`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: image `ghcr.io/h004888/famidoc-backend:dev` được push sau khi merge code từ Tasks 1–4.
- Cung cấp đầu ra cho: hệ thống production chạy hoàn toàn bằng pull image từ GHCR + Browserless sidecar.

- [ ] **Bước 1: Tạo và deploy Compose Service `chromium-renderer` trên Dokploy**
  Tạo Compose Service trong `environmentId: "tQ-J3ZjEq-U4nbtIhmmS4"` (`compose-create` + `compose-deploy`) chạy image `ghcr.io/browserless/chromium:latest`, kết nối external network `dokploy-network`, không mở port public, giới hạn `CONCURRENT=3`, `QUEUED=10`, `TIMEOUT=60000`, `HEALTH=true`, kèm `TOKEN` ngẫu nhiên an toàn.

- [ ] **Bước 2: Bổ sung `PUPPETEER_BROWSER_WS_ENDPOINT` vào biến môi trường của `famidoc-backend`**
  Dùng `application-saveEnvironment` cho `swj73osF0TmNE9lbBTkQU` giữ nguyên toàn bộ biến môi trường hiện có và thêm `PUPPETEER_BROWSER_WS_ENDPOINT="ws://chromium-renderer:3000?token=<TOKEN>"`.

- [ ] **Bước 3: Xác nhận GitHub Secret `DOKPLOY_DEPLOY_WEBHOOK_URL` và push code Tasks 1–4 lên `dev`**
  Kiểm tra secret `DOKPLOY_DEPLOY_WEBHOOK_URL` trên GitHub repo `h004888/famidoc-backend` trỏ đúng tới webhook của `swj73osF0TmNE9lbBTkQU`; chạy workflow CI/CD để build & push `ghcr.io/h004888/famidoc-backend:dev` lên GHCR.

- [ ] **Bước 4: Chuyển đổi `famidoc-backend` trên Dokploy sang `sourceType: "docker"` (GHCR)**
  Gọi `application-saveDockerProvider` cho `swj73osF0TmNE9lbBTkQU` (`dockerImage: "ghcr.io/h004888/famidoc-backend:dev"`, `registryUrl: "ghcr.io"`, cùng credentials GHCR đọc packages) và `application-update` đặt `sourceType: "docker"`, `autoDeploy: false`, `cleanCache: false`; sau đó gọi `application-deploy` để kéo image slim mới.

- [ ] **Bước 5: Cấu hình Docker Log Rotation, Dokploy Cleanup và dọn thư mục clone cũ trên VPS**
  - Cấu hình `/etc/docker/daemon.json` trên VPS (`"log-driver": "json-file"`, `"log-opts": { "max-size": "10m", "max-file": "3" }`) và reload Docker daemon một cách an toàn ở cửa sổ bảo trì.
  - Bật `cleanupCacheApplications: true` trên Dokploy (`settings-updateDockerCleanup`).
  - Xóa thư mục source code clone cũ `/etc/dokploy/applications/famidoc-backend-8rwqvm/code` và chạy `docker image prune -f` dọn image cũ (`famidoc-backend-8rwqvm:latest` 1.69 GB) sau khi container mới từ GHCR đã chạy ổn định.
  - Xác nhận `curl -s https://api.famidoc.online/health` trả về `{"status":"ok",...}` và `docker images` hiển thị image backend mới kích thước `~250–350 MB`.

---

### Task 6: Xác minh toàn bộ Lint, Test Suite và NestJS Build trước khi bàn giao

**Đối tượng liên quan (đã xác nhận qua `package.json`):**
- Toàn bộ source code `src/` và unit test `src/**/__tests__/**/*.spec.ts`

- [ ] **Bước 1: Chạy kiểm tra Prisma Generate, Lint, Full Unit Tests và Build**
  Chạy tuần tự:
  `npx prisma generate && npm run lint && npm test -- --forceExit && npm run build`
  Kỳ vọng: toàn bộ exit code `0`, 0 lỗi lint, tất cả unit tests PASS, `dist/` biên dịch thành công.
