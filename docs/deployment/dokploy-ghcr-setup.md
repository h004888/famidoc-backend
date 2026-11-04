# Hướng Dẫn Tích Hợp Dokploy với GitHub Container Registry (GHCR)

Tài liệu này hướng dẫn cách kết nối ứng dụng `famidoc-backend` trên Dokploy với GitHub Actions qua image registry `ghcr.io/h004888/famidoc-backend`.

---

## 1. Thông Tin Cấu Hình Cơ Bản

- **Dokploy Application ID**: `swj73osF0TmNE9lbBTkQU`
- **Tên Service**: `famidoc-backend`
- **Docker Image**: `ghcr.io/h004888/famidoc-backend:latest` (hoặc `:dev`)
- **Container Port**: `4000`
- **Biến môi trường bổ sung (Environment Variables)**:
  ```env
  PORT=4000
  NODE_ENV=production
  AUTO_MIGRATE=true
  ```

---

## 2. Các Bước Cấu Hình Trên Dokploy

### Cách A: Cấu hình qua giao diện Dokploy Dashboard
1. Truy cập vào Dashboard Dokploy của bạn (`http://160.191.242.45:3000`).
2. Điều hướng vào Project **famidoc** > Environment **production** > Application **famidoc-backend**.
3. Tại tab **Provider / Source**:
   - Chuyển Source Type từ **GitHub** sang **Docker**.
   - Nhập **Docker Image**: `ghcr.io/h004888/famidoc-backend:latest`
   - Nếu package GitHub ở chế độ Private:
     - **Username**: `h004888`
     - **Password**: GitHub Personal Access Token (PAT classic) với quyền `read:packages`.
     - **Registry URL**: `ghcr.io`
   - Nếu package GitHub ở chế độ Public: có thể để trống username/password.
4. Tại tab **Deployments**:
   - Tắt tính năng tự động deploy theo Git commit nếu trước đó đã bật (để tránh Dokploy build lại code bằng Dockerfile trên VPS).
   - Sao chép đường dẫn **Deploy Webhook URL** (Dạng: `http://160.191.242.45:3000/api/deploy/...` hoặc token deploy).

---

## 3. Cấu Hình GitHub Secrets

Truy cập repository GitHub: `https://github.com/h004888/famidoc-backend/settings/secrets/actions`
Thêm Secret sau:

| Tên Secret | Giá trị |
|---|---|
| `DOKPLOY_DEPLOY_WEBHOOK_URL` | Dán Webhook Redeploy URL đã lấy từ Dokploy ở bước trên |

> **Lưu ý bảo mật:**
> - Tuyệt đối không commit token hoặc webhook URL trực tiếp vào source code.
> - GitHub Actions sử dụng biến tích hợp `${{ secrets.GITHUB_TOKEN }}` để tự động build và push image lên GHCR mà không cần tạo thêm token thủ công cho CI.

---

## 4. Xác Thực Sau Triển Khai

Khi workflow GitHub Actions chạy thành công:
1. Job `quality-check` kiểm tra lint, test, build thành công (100% PASS).
2. Job `build-and-deploy` đóng gói image và đẩy lên `ghcr.io/h004888/famidoc-backend:latest`.
3. GitHub Actions gửi request POST tới `DOKPLOY_DEPLOY_WEBHOOK_URL`.
4. Dokploy kéo image mới từ GHCR về và khởi động container trong vòng vài giây mà không làm tiêu tốn CPU/RAM của VPS.
5. Kiểm tra trạng thái endpoint: `curl https://api.160.191.242.45.traefik.me/health` trả về `{"status":"ok", ...}`.
