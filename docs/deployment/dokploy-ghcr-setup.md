# Hướng Dẫn Tích Hợp Dokploy với GitHub Container Registry (GHCR) & Browserless Sidecar

Tài liệu này hướng dẫn cách kết nối ứng dụng `famidoc-backend` trên Dokploy với GitHub Actions qua image registry `ghcr.io/h004888/famidoc-backend` và tách Chromium sang container sidecar dùng chung.

---

## 1. Thông Tin Cấu Hình Cơ Bản

- **Dokploy Application ID**: `swj73osF0TmNE9lbBTkQU`
- **Tên Service**: `famidoc-backend`
- **Docker Image**:
  - Nhánh `dev`: `ghcr.io/h004888/famidoc-backend:dev`
  - Nhánh `main`: `ghcr.io/h004888/famidoc-backend:latest`
- **Container Port**: `4000`
- **Biến môi trường bổ sung (Environment Variables)**:
  ```env
  PORT=4000
  NODE_ENV=production
  AUTO_MIGRATE=true
  PUPPETEER_BROWSER_WS_ENDPOINT=ws://chromium-renderer:3000?token=<TOKEN>
  ```

---

## 2. Thiết Lập Browserless Chromium Sidecar Trên Dokploy

1. Tạo **Compose Service** tên `chromium-renderer` trong cùng environment `production` trên Dokploy.
2. Sử dụng image `ghcr.io/browserless/chromium:latest` gắn vào mạng nội bộ `dokploy-network` (không mở port public ra Internet):
   ```yaml
   services:
     chromium-renderer:
       image: ghcr.io/browserless/chromium:latest
       container_name: chromium-renderer
       restart: unless-stopped
       environment:
         TOKEN: "<TOKEN>"
         CONCURRENT: "3"
         QUEUED: "10"
         TIMEOUT: "60000"
         HEALTH: "true"
       networks:
         - dokploy-network

   networks:
     dokploy-network:
       external: true
   ```
3. Cập nhật `PUPPETEER_BROWSER_WS_ENDPOINT=ws://chromium-renderer:3000?token=<TOKEN>` vào Environment Variables của `famidoc-backend`.

---

## 3. Chuyển `famidoc-backend` Sang Docker Provider (GHCR) Trên Dokploy

1. Điều hướng vào Project **famidoc** > Environment **production** > Application **famidoc-backend**.
2. Tại tab **Provider / Source**:
   - Chuyển Source Type từ **GitHub** sang **Docker**.
   - Nhập **Docker Image**: `ghcr.io/h004888/famidoc-backend:dev` (cho môi trường `dev`) hoặc `ghcr.io/h004888/famidoc-backend:latest` (cho `main`).
   - **Registry URL**: `ghcr.io` kèm **Username** và GitHub PAT (`read:packages`) nếu package ở chế độ Private.
3. Tại tab **Deployments / Advanced**:
   - Tắt **Auto Deploy** theo Git commit và tắt **Clean Cache** để VPS không bao giờ clone & build lại code bằng Dockerfile.
   - Sao chép **Deploy Webhook URL** để lưu vào GitHub Secrets.

---

## 4. Cấu Hình GitHub Secrets

Truy cập `https://github.com/h004888/famidoc-backend/settings/secrets/actions` và thêm:

| Tên Secret | Giá trị |
|---|---|
| `DOKPLOY_DEPLOY_WEBHOOK_URL` | Webhook Redeploy URL lấy từ Dokploy |

---

## 5. Bảo Trì Dung Lượng VPS (Docker Log Rotation & Cleanup)

1. Cấu hình log rotation cho Docker tại `/etc/docker/daemon.json` trên VPS:
   ```json
   {
     "log-driver": "json-file",
     "log-opts": {
       "max-size": "10m",
       "max-file": "3"
     }
   }
   ```
2. Bật `enableDockerCleanup` và `cleanupCacheApplications` trong Dokploy Server Settings.
3. Kiểm tra trạng thái sau triển khai: `curl https://api.famidoc.online/health` trả về `{"status":"ok", ...}`.
