#!/bin/sh
set -e

# Tự động chạy migration nếu biến môi trường AUTO_MIGRATE=true
if [ "$AUTO_MIGRATE" = "true" ]; then
  echo "🚀 [CI/CD] Đang kiểm tra và đẩy migration Prisma vào database..."
  npx prisma db push --skip-generate
  echo "✅ [CI/CD] Prisma db push hoàn tất."
fi

# Chuyển quyền thực thi sang lệnh chính của container (CMD)
exec "$@"
