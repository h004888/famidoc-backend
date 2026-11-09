import '../src/core/config/load-environment';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import * as fs from 'fs';
import * as path from 'path';

async function generateOpenApi() {
  const app = await NestFactory.create(AppModule, { logger: false });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('FamiDoc Healthcare Backend API')
    .setDescription('Tài liệu chuẩn OpenAPI / Swagger UI chính thức của hệ thống Bác sĩ Gia đình FamiDoc')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Nhập JWT Bearer token vào đây',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // 1. Xuất file openapi.json
  const openApiPath = path.resolve(process.cwd(), 'openapi.json');
  fs.writeFileSync(openApiPath, JSON.stringify(document, null, 2), 'utf-8');
  console.log(`[Export] Đã xuất OpenAPI spec: ${openApiPath}`);

  // 2. Tổng hợp theo Tag và xuất docs/api-inventory.md
  const byTag: Record<string, Array<{ method: string; path: string; summary: string }>> = {};
  let totalOperations = 0;

  for (const [routePath, methods] of Object.entries(document.paths)) {
    for (const [method, details] of Object.entries(methods as any)) {
      if (typeof details === 'object' && details !== null) {
        totalOperations++;
        const tag = (details as any).tags?.[0] || 'Default';
        byTag[tag] = byTag[tag] || [];
        byTag[tag].push({
          method: method.toUpperCase(),
          path: routePath,
          summary: (details as any).summary || (details as any).description || '',
        });
      }
    }
  }

  let md = '# Danh Mục Toàn Bộ API Backend (FamiDoc API Inventory)\n\n';
  md += `> **Tổng số Endpoint:** ${totalOperations} APIs\n`;
  md += `> **Số phân hệ (Tags):** ${Object.keys(byTag).length} phân hệ\n`;
  md += `> **Swagger UI:** \`/docs\` hoặc \`/api/docs\`\n`;
  md += `> **OpenAPI JSON Spec:** \`openapi.json\` (\`/docs-json\`)\n\n`;

  for (const [tag, items] of Object.entries(byTag)) {
    md += `### ${tag} (${items.length} APIs)\n\n`;
    md += '| Method | Endpoint | Mô tả / Nghiệp vụ |\n';
    md += '| :--- | :--- | :--- |\n';
    items.forEach((i) => {
      md += `| \`${i.method}\` | \`${i.path}\` | ${i.summary || '-'} |\n`;
    });
    md += '\n';
  }

  const docsDir = path.resolve(process.cwd(), 'docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }
  const mdPath = path.resolve(docsDir, 'api-inventory.md');
  fs.writeFileSync(mdPath, md, 'utf-8');
  console.log(`[Export] Đã xuất tài liệu Markdown: ${mdPath}`);
  console.log(`[Summary] Tổng cộng: ${totalOperations} APIs across ${Object.keys(byTag).length} phân hệ.`);

  await app.close();
  process.exit(0);
}

generateOpenApi().catch((err) => {
  console.error('Error generating OpenAPI spec:', err);
  process.exit(1);
});
