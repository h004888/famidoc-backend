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

  it('tài liệu phải mô tả đầy đủ Browserless sidecar, tách tag :dev/:latest, log rotation và không lộ secret', () => {
    const content = fs.readFileSync(setupDocPath, 'utf8');
    expect(content).toContain('ghcr.io/h004888/famidoc-backend:dev');
    expect(content).toContain('ghcr.io/h004888/famidoc-backend:latest');
    expect(content).toContain('ghcr.io/browserless/chromium');
    expect(content).toContain('PUPPETEER_BROWSER_WS_ENDPOINT');
    expect(content).toContain('dokploy-network');
    expect(content).toContain('/etc/docker/daemon.json');
    expect(content).toContain('max-size');
    expect(content).toContain('max-file');
    expect(content).not.toMatch(/ghp_[A-Za-z0-9]{10,}/);
  });
});
