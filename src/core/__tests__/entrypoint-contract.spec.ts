import * as fs from 'fs';
import * as path from 'path';

describe('Docker Entrypoint & Dockerfile Contract', () => {
  const rootDir = path.resolve(__dirname, '../../../');
  const entrypointPath = path.join(rootDir, 'scripts/docker-entrypoint.sh');
  const dockerfilePath = path.join(rootDir, 'Dockerfile');

  it('phải tồn tại script docker-entrypoint.sh và có xử lý AUTO_MIGRATE', () => {
    expect(fs.existsSync(entrypointPath)).toBe(true);
    const content = fs.readFileSync(entrypointPath, 'utf8');
    expect(content).toContain('AUTO_MIGRATE');
    expect(content).toContain('exec "$@"');
  });

  it('Dockerfile phải chứa khai báo HEALTHCHECK trỏ tới endpoint /health', () => {
    expect(fs.existsSync(dockerfilePath)).toBe(true);
    const content = fs.readFileSync(dockerfilePath, 'utf8');
    expect(content).toMatch(/HEALTHCHECK[\s\S]*\/health/);
    expect(content).toContain('docker-entrypoint.sh');
  });

  it('Dockerfile phải là slim Node runner (không cài Chromium/fonts, không nhân đôi Prisma layers)', () => {
    const content = fs.readFileSync(dockerfilePath, 'utf8');
    expect(content).not.toContain('chromium');
    expect(content).not.toContain('fonts-dejavu-core');
    expect(content).not.toContain('fonts-liberation');
    expect(content).not.toContain('CHROMIUM_EXECUTABLE_PATH');
    expect(content).toContain('openssl');
    expect(content).toContain('npm prune --omit=dev');
    expect(content).toContain('npm cache clean --force');
    expect(content).toContain('COPY --from=builder /app/node_modules ./node_modules');
    expect(content).not.toContain('npm ci --omit=dev');
  });

  it('.dockerignore phải loại trừ các thư mục/file nặng không cần cho build image', () => {
    const dockerignorePath = path.join(rootDir, '.dockerignore');
    expect(fs.existsSync(dockerignorePath)).toBe(true);
    const content = fs.readFileSync(dockerignorePath, 'utf8');
    for (const entry of [
      'node_modules',
      'dist',
      '.git',
      '.env*',
      'logs',
      'data',
      'docs',
      'test',
      'coverage',
      'scripts/doc-tools',
      '*.md',
      'openapi.json',
      'test-output.txt',
    ]) {
      expect(content).toContain(entry);
    }
  });
});
