const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');

// Chỉ giữ một .env. Khi chạy test, chọn các biến TEST_* thay vì DATABASE_URL của DB dùng chung.
const root = resolve(__dirname, '..');
try {
  // Jest cần Node 24 để nạp NestJS dạng ESM. Dừng sớm và báo rõ thay vì hiện hàng loạt lỗi import.
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major !== 24 || minor < 15) {
    throw new Error(
      `Đang dùng Node ${process.version}. Project yêu cầu Node 24.15 trở lên trong dòng 24. ` +
        'Chạy nvm install 24.22.1 rồi nvm use 24.22.1, kiểm tra node -v và chạy lại npm run test:db.',
    );
  }

  const config = parseEnv(readFileSync(resolve(root, '.env'), 'utf8'));
  const database = new URL(config.TEST_DATABASE_URL);
  const localHosts = ['localhost', '127.0.0.1'];

  // Bộ integration test có dọn dữ liệu: tuyệt đối không cho chạy vào VPS.
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !localHosts.includes(database.hostname) ||
    !database.pathname.endsWith('_test') ||
    config.TEST_DATABASE_URL === config.DATABASE_URL
  ) {
    throw new Error(
      'TEST_DATABASE_URL phải trỏ đến PostgreSQL local, tên DB kết thúc bằng _test.',
    );
  }

  if (config.TEST_REDIS_URL) {
    const redis = new URL(config.TEST_REDIS_URL);
    if (
      redis.protocol !== 'redis:' ||
      !localHosts.includes(redis.hostname) ||
      !/^\/[1-9]\d*$/.test(redis.pathname)
    ) {
      throw new Error(
        'TEST_REDIS_URL phải trỏ đến Redis local và dùng DB riêng, ví dụ /15.',
      );
    }
  }

  if (process.argv.includes('--check')) {
    console.log(
      'Cấu hình test hợp lệ: PostgreSQL local *_test và Redis local riêng.',
    );
    process.exit(0);
  }

  const result = spawnSync(
    process.execPath,
    [
      '--experimental-vm-modules',
      resolve(root, 'node_modules/jest/bin/jest.js'),
      '--config',
      'test/jest-e2e.json',
      '--runInBand',
      '--forceExit',
      ...process.argv.slice(2),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: config.TEST_DATABASE_URL,
        REDIS_URL: config.TEST_REDIS_URL,
        RUN_DB_TESTS: '1',
        PAYMENTS_MODE: 'simulation',
        CONTRACT_REMINDERS_ENABLED: 'false',
        JWT_SECRET: 'local-integration-tests-only-000000000000',
        SMTP_URL: '',
        MAIL_FROM: '',
      },
    },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
