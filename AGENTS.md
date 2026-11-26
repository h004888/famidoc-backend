# Backend API Error Rules (FamiDoc Backend)

Mọi endpoint, controller, service, pipe và exception filter trong `famidoc-backend` **BẮT BUỘC** tuân thủ chuẩn phản hồi lỗi thống nhất sau:

## 1. Cấu trúc JSON chuẩn khi lỗi

```json
{
  "success": false,
  "code": 422,
  "data": null,
  "meta": null,
  "error": {
    "title": "Unprocessable Content",
    "errorCode": "VALIDATION_FAILED",
    "detail": "Tên gói phải có ít nhất 10 ký tự.",
    "instance": "/api/v1/admin/care-packages",
    "invalidParams": [
      {
        "field": "name",
        "issue": "MIN_LENGTH",
        "message": "Tên gói phải có ít nhất 10 ký tự."
      }
    ],
    "conditions": [
      {
        "code": "P1",
        "condition": "500.000đ <= đơn giá <= 2.000.000đ",
        "message": "Đơn giá hiện tại là 300.000đ, nằm ngoài khoảng cho phép."
      }
    ]
  },
  "timestamp": "2026-11-26T15:20:36.000Z",
  "requestId": "..."
}
```

## 2. Quy tắc triển khai

1. **Bỏ `error.type`**: Không sinh và không trả về trường `type` (`https://api.famidoc.vn/errors/...`) trong `ProblemDetails`.
2. **Bỏ `message` chung chung ở root**: Không trả `message` chung chung ở tầng ngoài khi có lỗi; luôn hiển thị đúng chi tiết lỗi ở `error.detail` và từng trường cụ thể trong `invalidParams` / `conditions`.
3. **Thông báo lỗi 100% tiếng Việt**:
   - Lỗi validation DTO (`422`): dịch/chuẩn hóa toàn bộ thông báo của `class-validator` sang tiếng Việt trong `invalidParams[].message`.
   - Lỗi quy tắc nghiệp vụ / xung đột (`400`, `409`): trả kèm `conditions` (`code`, `condition`, `message`) bằng tiếng Việt, nêu thẳng điều kiện bị vi phạm hoặc còn thiếu.
   - Lỗi ràng buộc DB (Prisma `P2002`, `P2003`, check constraint): bắt trong `StandardApiResponseFilter`, trả HTTP `409`/`400` với `errorCode` cụ thể (`DB_UNIQUE_VIOLATION`, v.v.) và `invalidParams` tiếng Việt.
4. **Dùng nguồn mã lỗi tập trung**:
   - Khai báo tất cả `errorCode` tại `src/core/constants/error-codes.constant.ts`.
   - Ném `BaseApiException` (hoặc subclass trong `src/core/exceptions/api.exception.ts`), tránh ném `HttpException` chuỗi trần hoặc truyền key `code` lệch chuẩn.
