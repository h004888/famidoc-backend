// Explicit server-test opt-in. Never reset, migrate or clean the server's existing schema.
const { readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { parseEnv } = require('node:util');
const { resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const root = resolve(__dirname, '..');
async function main() {
  if (!process.argv.includes('--server-test-authorized'))
    throw new Error('Explicit server-test authorization required');
  const config = parseEnv(readFileSync(resolve(root, '.env'), 'utf8'));
  const url = new URL(config.TEST_DATABASE_URL || config.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('PostgreSQL required');
  const schema = `payment_settings_test_${randomBytes(8).toString('hex')}`;
  url.searchParams.set('schema', schema);
  const databaseUrl = url.href;
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    PAYMENTS_MODE: 'sepay_test',
    RUN_DB_TESTS: '1',
    PAYMENT_SETTINGS_ISOLATED_SCHEMA: schema,
    PAYMENT_SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  };
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  const temp = mkdtempSync(resolve(tmpdir(), 'payment-settings-db-'));
  try {
    console.log(`Isolated DB schema: ${schema}`);
    await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    let baseline = readFileSync(
      resolve(root, 'prisma/schema.prisma'),
      'utf8',
    ).split('model PaymentSettingsHead {')[0];
    baseline = baseline.replace(
      /(expectedGateway\s+String\?\s+@map\("expected_gateway"\) @db.VarChar\()100(\))/,
      (_match, start, end) => start + '50' + end,
    );
    baseline = baseline
      .replace(
        /^  (?:monitoredAccountId  |batchId             |monitoredAccount    Payment|batch               Payment).*\r?\n/gm,
        '',
      )
      .replace(
        /^  @@index\(\[(?:environment, monitoredAccountId, startedAt|batchId)\]\).*\r?\n/gm,
        '',
      );
    writeFileSync(resolve(temp, 'baseline.prisma'), baseline);
    const prisma = (args) => {
      const result = spawnSync(
        process.execPath,
        [resolve(root, 'node_modules/prisma/build/index.js'), ...args],
        { cwd: root, env, encoding: 'utf8' },
      );
      if (result.status !== 0) {
        console.error(result.stderr);
        throw new Error('Isolated schema preparation failed');
      }
    };
    prisma([
      'migrate',
      'diff',
      '--from-empty',
      '--to-schema-datamodel',
      resolve(temp, 'baseline.prisma'),
      '--script',
      '--output',
      resolve(temp, 'baseline.sql'),
    ]);
    prisma([
      'db',
      'execute',
      '--file',
      resolve(temp, 'baseline.sql'),
      '--schema',
      'prisma/schema.prisma',
    ]);
    prisma([
      'db',
      'execute',
      '--file',
      'prisma/migrations/20261125000100_payment_configuration/migration.sql',
      '--schema',
      'prisma/schema.prisma',
    ]);
    console.log('Baseline + additive payment migration: PASS');
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-vm-modules',
        resolve(root, 'node_modules/jest/bin/jest.js'),
        '--config',
        'test/jest-e2e.json',
        '--runInBand',
        '--forceExit',
        'payment-settings.e2e-spec.ts',
      ],
      { cwd: root, env, stdio: 'inherit' },
    );
    process.exitCode = result.status ?? 1;
  } finally {
    // The identifier is generated here, never accepted from caller/environment.
    if (!/^payment_settings_test_[a-f0-9]{16}$/.test(schema))
      throw new Error('Invalid isolated schema');
    await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.$disconnect();
    rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(() => {
  console.error(
    'Isolated DB checks failed; existing server schema was not modified.',
  );
  process.exitCode = 1;
});
