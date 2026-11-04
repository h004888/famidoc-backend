import './core/config/load-environment';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // Giữ rawBody để xác thực webhook bằng đúng byte nhận được.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const { method, originalUrl } = req;
    const start = Date.now();

    res.on('finish', () => {
      const { statusCode } = res;
      const duration = Date.now() - start;
      console.log(`[HTTP] ${method} ${originalUrl} ${statusCode} - ${duration}ms`);
    });

    next();
  });

  // Chỉ kích hoạt Swagger UI trên môi trường không phải Production (hoặc khi chủ động bật ENABLE_SWAGGER=true)
  const isSwaggerEnabled =
    process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true';

  if (isSwaggerEnabled) {
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

    const documentFactory = () => SwaggerModule.createDocument(app, swaggerConfig);

    // Cấu hình chuẩn hóa theo đúng thông số kỹ thuật của Swagger UI (swagger-api/swagger-ui)
    const swaggerCustomOptions = {
      swaggerOptions: {
        persistAuthorization: true,      // Lưu JWT Token không bị mất khi F5 trình duyệt
        deepLinking: true,               // Cho phép tạo anchor link trực tiếp đến từng API (/docs#/Auth/...)
        displayRequestDuration: true,    // Đo và hiển thị thời gian phản hồi (ms) của request khi test
        docExpansion: 'list',            // Hiển thị danh sách các endpoints gọn gàng theo từng nhóm tag
        filter: true,                    // Bật ô tìm kiếm / lọc nhanh API theo từ khóa hoặc path
        tryItOutEnabled: true,           // Tự động mở sẵn chế độ "Try it out" để test nhanh không cần bấm nút phụ
        tagsSorter: 'alpha',             // Sắp xếp các nhóm API theo thứ tự Alphabet
        operationsSorter: 'alpha',       // Sắp xếp các endpoint trong nhóm theo thứ tự Alphabet
        showExtensions: true,            // Hiển thị các trường mở rộng
        showCommonExtensions: true,      // Hiển thị các ràng buộc định dạng (minLength, maxLength, pattern...)
      },
      customSiteTitle: 'FamiDoc Healthcare API Documentation',
      jsonDocumentUrl: 'docs-json',      // Cung cấp route tải tài liệu định dạng JSON: /docs-json
      yamlDocumentUrl: 'docs-yaml',      // Cung cấp route tải tài liệu định dạng YAML: /docs-yaml
    };

    SwaggerModule.setup('docs', app, documentFactory, swaggerCustomOptions);
    SwaggerModule.setup('api/docs', app, documentFactory, swaggerCustomOptions);
  }

  await app.listen(process.env.PORT ?? 4000, '0.0.0.0');
}
void bootstrap();
