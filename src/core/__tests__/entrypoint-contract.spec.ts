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
});
