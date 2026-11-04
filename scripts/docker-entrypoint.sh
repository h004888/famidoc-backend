#!/bin/sh
set -e

# Tự động chạy migration nếu biến môi trường AUTO_MIGRATE=true
if [ "$AUTO_MIGRATE" = "true" ]; then
  echo "🚀 [CI/CD] Đang kiểm tra và đẩy migration Prisma vào database..."
  node node_modules/prisma/build/index.js migrate deploy
  echo "✅ [CI/CD] Prisma migrate deploy hoàn tất."
fi

# Chuyển quyền thực thi sang lệnh chính của container (CMD)
exec "$@"
