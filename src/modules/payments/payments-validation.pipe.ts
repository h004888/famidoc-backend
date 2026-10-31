import { ValidationPipe } from '@nestjs/common';

// Từ chối trường ngoài DTO, đặc biệt giá/status client tự thêm để bỏ qua nghiệp vụ.
export const paymentsValidationPipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  forbidUnknownValues: true,
  transformOptions: { enableImplicitConversion: false },
});
