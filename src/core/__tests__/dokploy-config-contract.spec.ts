import * as fs from 'fs';
import * as path from 'path';

describe('Dokploy Configuration & GHCR Setup Contract', () => {
  const rootDir = path.resolve(__dirname, '../../../');
  const setupDocPath = path.join(rootDir, 'docs/deployment/dokploy-ghcr-setup.md');

  it('phải tồn tại tài liệu hướng dẫn docs/deployment/dokploy-ghcr-setup.md với đầy đủ hướng dẫn tích hợp', () => {
    expect(fs.existsSync(setupDocPath)).toBe(true);
    const content = fs.readFileSync(setupDocPath, 'utf8');

    expect(content).toContain('ghcr.io/h004888/famidoc-backend');
    expect(content).toContain('4000');
    expect(content).toContain('DOKPLOY_DEPLOY_WEBHOOK_URL');
    expect(content).toContain('AUTO_MIGRATE');
  });
});
