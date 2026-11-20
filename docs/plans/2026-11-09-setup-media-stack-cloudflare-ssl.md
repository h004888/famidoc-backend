# Chuẩn hóa Media Stack Production với Cloudflare SSL — Kế hoạch triển khai

**Mục tiêu:** Nâng cấp cụm Media Stack (SeaweedFS S3 + imgproxy + Nginx) lên chuẩn Production có tên miền chính thức, mã hóa SSL qua Cloudflare Edge và bảo mật S3 Gateway bằng cặp Access Key/Secret Key an toàn.

**Cách tiếp cận:** Sử dụng `cloudflare-api` MCP để tạo 2 bản ghi subdomain (`s3.famidoc.online`, `media.famidoc.online`) với chế độ Cloudflare Proxy (Orange Cloud) nhằm tự động cấp phát SSL TLS 1.3 và chống DDoS. Dùng `ssh-mcp` để cấu hình file định danh `s3.json` trên VPS, mount vào SeaweedFS và cập nhật router Traefik để định tuyến HTTPS an toàn. Cuối cùng, triển khai service và helper trong `famidoc-backend` theo chu trình TDD nghiêm ngặt trước khi kiểm thử E2E toàn diện.

**Đã tra cứu codebase (codebase-memory-mcp):**
- Đã kiểm tra kiến trúc `famidoc-backend` qua `get_architecture`: NestJS 12, TypeScript, kiến trúc module/core/shared.
- Đã tra cứu qua `search_code`: Các biến môi trường S3 và StorageService hiện chưa được triển khai trong backend.
- Đã kiểm tra zone Cloudflare qua `cloudflare-api`: Zone `famidoc.online` (ID: `3965ae485f46494b9c1a5d6338edfb0b`) đang trỏ về VPS `160.191.242.45`.
- Đã kiểm tra container `media-storage` qua `ssh-mcp`: SeaweedFS hỗ trợ cờ `-s3.config` để đọc danh sách credentials IAM.

**Framework test & quy ước (đã xác nhận qua codebase-memory-mcp):**
- Framework: Jest (`jest`)
- Vị trí đặt file test: `src/**/__tests__/**/*.spec.ts`
- Lệnh chạy test: `npm test -- <path-to-test-file>`

## Ràng buộc chung (Global Constraints)

- Mọi task viết/sửa hành vi code trong backend phải tuân thủ nghiêm ngặt chu trình Red → Green → Refactor.
- Không có task nào được coi là hoàn tất nếu thiếu test tự động tương ứng và kết quả xác nhận PASS.
- Mọi kết nối ra ngoài internet tới SeaweedFS S3 và Nginx Cache bắt buộc phải đi qua Cloudflare Edge SSL (HTTPS:443).
- Cổng S3 Gateway nội bộ trên VPS (8333) không được bind trực tiếp ra `0.0.0.0:8333` mà chỉ được tiếp nhận qua Traefik với bộ lọc Host `s3.famidoc.online`.

---

### Task 1: Thiết lập bản ghi DNS Subdomain và Cloudflare Edge SSL

**Đối tượng liên quan:**
- Cloudflare Zone: `famidoc.online` (ID: `3965ae485f46494b9c1a5d6338edfb0b`)
- Bản ghi mới: `s3.famidoc.online` (Type A -> `160.191.242.45`, Proxied = true)
- Bản ghi mới: `media.famidoc.online` (Type A -> `160.191.242.45`, Proxied = true)

**Giao diện/Kết nối với các task khác:**
- Cung cấp đầu vào: 2 subdomain có SSL hợp lệ sẵn sàng để Traefik trên VPS tiếp nhận traffic ở Task 2.

- [x] **Bước 1: Tạo bản ghi A cho `s3.famidoc.online` trên Cloudflare**
  Tạo bản ghi DNS qua `cloudflare-api` với `type: "A"`, `name: "s3"`, `content: "160.191.242.45"`, `proxied: true`.
  Kỳ vọng: Cloudflare trả về `success: true`.
- [x] **Bước 2: Tạo bản ghi A cho `media.famidoc.online` trên Cloudflare**
  Tạo bản ghi DNS qua `cloudflare-api` với `type: "A"`, `name: "media"`, `content: "160.191.242.45"`, `proxied: true`.
  Kỳ vọng: Cloudflare trả về `success: true`.
- [x] **Bước 3: Xác minh phân giải DNS và chứng chỉ SSL Edge**
  Cách kiểm tra: Gửi yêu cầu HTTP HEAD tới cả 2 tên miền qua cURL.
  Kỳ vọng: Cả 2 domain phân giải về IP proxy của Cloudflare và trả về mã phản hồi SSL thành công.

---

### Task 2: Cấu hình bảo mật SeaweedFS S3 và cập nhật Traefik Router trên VPS

**Đối tượng liên quan:**
- VPS Path: `/etc/dokploy/media-stack/seaweedfs/s3.json`
- VPS Compose: `/etc/dokploy/compose/compose-bypass-multi-byte-interface-xkfroz/code/docker-compose.yml`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1 (DNS đã phân giải về VPS).
- Cung cấp đầu ra cho: Task 3 (Cặp Access Key / Secret Key chính thức cho Backend).

- [x] **Bước 1: Tạo file cấu hình bảo mật `s3.json` trên VPS**
  Khởi tạo file `/etc/dokploy/media-stack/seaweedfs/s3.json` chứa danh tính quản trị viên:
  - `name: "admin"`
  - `accessKey: "AKIAFAMIDOCMEDIA2026"`
  - `secretKey: "sec_famidoc_production_media_secret_key_98234"`
  - `actions: ["Read", "Write", "List", "Tagging", "Admin"]`
  Kỳ vọng: File được tạo với quyền truy cập phù hợp.
- [x] **Bước 2: Cập nhật cấu hình Docker Compose cho `media-storage` và `imgproxy`**
  Chỉnh sửa `docker-compose.yml`:
  - Mount file `s3.json` vào container `media-storage` tại `/etc/seaweedfs/s3.json`.
  - Cập nhật lệnh khởi chạy `media-storage`: `command: server -dir=/data -s3 -s3.config=/etc/seaweedfs/s3.json -filer -ip.bind=0.0.0.0`.
  - Gắn nhãn Traefik cho `media-storage`: `traefik.http.routers.media-s3.rule=Host('s3.famidoc.online')` trỏ vào cổng `8333`.
  - Đổi nhãn Traefik của `media-nginx-cache`: `Host('media.famidoc.online')`.
  - Cập nhật biến môi trường của `imgproxy`: `AWS_ACCESS_KEY_ID` và `AWS_SECRET_ACCESS_KEY` khớp với cặp key mới tạo.
  - Kết nối service `storage` vào mạng `dokploy-network`.
  Kỳ vọng: File compose được lưu cú pháp hợp lệ.
- [x] **Bước 3: Khởi động lại cụm dịch vụ Media và kiểm tra quyền truy cập**
  Chạy lệnh deploy lại cụm media trên VPS bằng `docker compose up -d`.
  Cách kiểm tra: Gửi request không có key tới `https://s3.famidoc.online/photos` -> Kỳ vọng 403 Forbidden; gửi request có key hợp lệ -> Kỳ vọng 200 OK.

---

### Task 3: Triển khai `StorageService` và `MediaUrlUtil` trong `famidoc-backend` (TDD-first)

**Đối tượng liên quan (đã xác nhận qua codebase-memory-mcp):**
- Tạo mới: `src/core/services/storage.service.ts`
- Tạo mới: `src/shared/utils/media-url.util.ts`
- Test tương ứng: `src/core/__tests__/storage.service.spec.ts`
- Test tương ứng: `src/shared/__tests__/media-url.util.spec.ts`
- Kiểm chứng bằng: `npm test -- src/shared/__tests__/media-url.util.spec.ts src/core/__tests__/storage.service.spec.ts`

**Ảnh hưởng liên quan (từ trace_path / detect_changes):**
- Được gọi bởi: Các module upload tài liệu và cập nhật hồ sơ người dùng trong tương lai (`PatientDocument`, `UsersModule`).
- Gọi tới: `@aws-sdk/client-s3` (PutObjectCommand).
- Regression test cần chạy thêm: `npm test -- src/core/__tests__/dokploy-config-contract.spec.ts`.

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 2 (Thông tin endpoint `s3.famidoc.online` và cặp key mới).
- Cung cấp đầu ra cho: Task 4 (Bộ client hoàn chỉnh để chạy kiểm thử tích hợp).

- [x] **Bước 1 [RED]: Viết test cho `buildMediaUrl` tiện ích sinh URL ảnh có chữ ký HMAC**
  Vị trí file test: `src/shared/__tests__/media-url.util.spec.ts`
  Test case:
  - Sinh URL đúng định dạng `https://media.famidoc.online/<signature>/resize:fill:300:200:0/gravity:sm/plain/s3://photos/avatars/user.jpg@webp`.
  - Trả về rỗng nếu đầu vào key rỗng.
  - Giữ nguyên URL nếu đầu vào đã là đường dẫn HTTP/HTTPS tuyệt đối.
  Kỳ vọng: chạy `npm test -- src/shared/__tests__/media-url.util.spec.ts` → FAIL với lý do hàm `buildMediaUrl` chưa tồn tại.
- [x] **Bước 2 [GREEN]: Viết code tối thiểu tại `src/shared/utils/media-url.util.ts` để test ở Bước 1 PASS**
  Triển khai hàm `buildMediaUrl` sử dụng module `crypto` tạo chữ ký HMAC SHA-256 mã hóa base64url.
  Kỳ vọng: chạy `npm test -- src/shared/__tests__/media-url.util.spec.ts` → PASS.
- [x] **Bước 3 [RED]: Viết test cho `StorageService` xử lý upload file lên S3**
  Vị trí file test: `src/core/__tests__/storage.service.spec.ts`
  Test case:
  - Khởi tạo S3Client với `forcePathStyle: true` và endpoint lấy từ biến môi trường.
  - Gửi `PutObjectCommand` đúng Bucket, Key và ContentType khi gọi `uploadFile`.
  - Sinh đường dẫn tương đối (relative s3Key) duy nhất chứa tiền tố thư mục.
  Kỳ vọng: chạy `npm test -- src/core/__tests__/storage.service.spec.ts` → FAIL với lý do class `StorageService` chưa tồn tại.
- [x] **Bước 4 [GREEN]: Viết code tối thiểu tại `src/core/services/storage.service.ts` để test ở Bước 3 PASS**
  Cài đặt package `@aws-sdk/client-s3` và cài đặt class `StorageService` với phương thức `uploadFile`.
  Kỳ vọng: chạy `npm test -- src/core/__tests__/storage.service.spec.ts` → PASS.
- [x] **Bước 5 [REFACTOR]: Tinh chỉnh cấu trúc và xử lý ngoại lệ cho `StorageService` và `MediaUrlUtil`**
  Tách các hằng số mặc định, bổ sung log chuẩn NestJS Logger mà không làm thay đổi hành vi nghiệp vụ.
  Kỳ vọng: chạy `npm test -- src/shared/__tests__/media-url.util.spec.ts src/core/__tests__/storage.service.spec.ts` → vẫn PASS.
- [x] **Bước 6: Xác nhận hoàn tất task và kiểm tra hồi quy**
  Cách kiểm tra: chạy toàn bộ test liên quan `npm test -- src/shared/__tests__/media-url.util.spec.ts src/core/__tests__/storage.service.spec.ts src/core/__tests__/dokploy-config-contract.spec.ts`
  Kỳ vọng: Tất cả các test suites PASS 100%.

---

### Task 4: Kiểm thử E2E tích hợp luồng Media trên môi trường Live

**Đối tượng liên quan:**
- Endpoint S3: `https://s3.famidoc.online`
- Endpoint Media: `https://media.famidoc.online`

**Giao diện/Kết nối với các task khác:**
- Nhận đầu vào từ: Task 1, 2 và 3.
- Cung cấp đầu ra cho: Hệ thống Production sẵn sàng đưa vào vận hành.

- [x] **Bước 1: Chạy kịch bản upload ảnh test từ máy ngoài vào `s3.famidoc.online`**
  Thực hiện tải một file ảnh mẫu lên bucket `photos` với cặp Access Key / Secret Key mới thông qua `StorageService` hoặc script S3.
  Kỳ vọng: SeaweedFS phản hồi HTTP 200 OK với ETag hợp lệ.
- [x] **Bước 2: Kiểm thử truy cập ảnh qua CDN `media.famidoc.online`**
  Gọi link ảnh đã sinh chữ ký HMAC với kích thước `300x200` định dạng WebP qua `https://media.famidoc.online/...`.
  Kỳ vọng: Nginx Cache và imgproxy trả về HTTP 200 OK, `Content-Type: image/webp`.
- [x] **Bước 3: Kiểm chứng cơ chế Cache HIT**
  Gọi lại link ảnh lần thứ 2.
  Kỳ vọng: Header phản hồi có `X-Cache-Status: HIT` (hoặc Cloudflare `cf-cache-status: HIT`), thời gian phản hồi dưới 10ms.

---

### Task 5: Cập nhật tài liệu kỹ thuật và file môi trường mẫu

**Đối tượng liên quan:**
- File chỉnh sửa: `huong_dan_su_dung_media_stack.md`
- File cập nhật: `famidoc-backend/.env.example`

- [x] **Bước 1: Cập nhật các biến môi trường mẫu trong `.env.example`**
  Bổ sung các biến `MEDIA_BASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `IMGPROXY_KEY`, `IMGPROXY_SALT` với giá trị tên miền chính thức `famidoc.online`.
  Kỳ vọng: File `.env.example` có đầy đủ chú thích rõ ràng.
- [x] **Bước 2: Đồng bộ tài liệu `huong_dan_su_dung_media_stack.md`**
  Thay thế toàn bộ các tham chiếu tên miền tạm `traefik.me` bằng `famidoc.online`, ghi nhận cặp Access Key/Secret Key mới và hướng dẫn cấu hình chi tiết cho các lập trình viên.
  Kỳ vọng: Tài liệu nhất quán và không còn link chết.

