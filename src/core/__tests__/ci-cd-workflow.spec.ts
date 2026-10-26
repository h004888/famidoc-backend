import * as fs from 'fs';
import * as path from 'path';

describe('GitHub Actions CI/CD Workflow Contract', () => {
  const rootDir = path.resolve(__dirname, '../../../');
  const workflowPath = path.join(rootDir, '.github/workflows/ci-cd.yml');

  it('phải tồn tại file .github/workflows/ci-cd.yml và cấu hình đúng 2 jobs CI và CD', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    const content = fs.readFileSync(workflowPath, 'utf8');

    // Kiểm tra trigger
    expect(content).toContain('pull_request');
    expect(content).toContain('push');

    // Kiểm tra job Quality Check (CI)
    expect(content).toContain('quality-check:');
    expect(content).toContain('npm run lint');
    expect(content).toContain('npx prisma generate');
    expect(content).toContain('npm test');
    expect(content).toContain('npm run build');

    // Kiểm tra job Build & Push Docker GHCR + Deploy Webhook (CD)
    expect(content).toContain('build-and-deploy:');
    expect(content).toContain('needs: quality-check');
    expect(content).toContain('ghcr.io');
    expect(content).toContain('DOKPLOY_DEPLOY_WEBHOOK_URL');
  });
});
