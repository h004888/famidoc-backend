import { existsSync } from 'node:fs';

// Node 24 nạp .env local; biến đã cấu hình trong VPS/shell vẫn được ưu tiên.
if (existsSync('.env')) process.loadEnvFile('.env');
