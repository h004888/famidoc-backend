import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('AuthSession Prisma Schema & Migration', () => {
  const schemaPath = resolve(__dirname, '../../../../prisma/schema.prisma');
  const migrationPath = resolve(
    __dirname,
    '../../../../prisma/migrations/20261119000100_add_auth_sessions/migration.sql',
  );

  it('defines model AuthSession mapped to auth_sessions with required fields', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    expect(schema).toContain('model AuthSession {');
    expect(schema).toContain('@@map("auth_sessions")');
    expect(schema).toContain('tokenHash');
    expect(schema).toContain('familyId');
    expect(schema).toContain('expiresAt');
    expect(schema).toContain('revokedAt');
    expect(schema).toContain('replacedBySessionId');
    expect(schema).toContain('authSessions');
  });

  it('has SQL migration creating auth_sessions table and indexes', () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE "auth_sessions"');
    expect(sql).toContain('"token_hash" VARCHAR(64) NOT NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX');
    expect(sql).toContain('FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE');
  });
});
