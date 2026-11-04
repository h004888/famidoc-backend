import { ValidationPipe } from '@nestjs/common';

// Chỉ áp dụng cho module gói dịch vụ, không đổi cách kiểm tra API của các thành viên khác.
export const carePackagesValidationPipe = new ValidationPipe({
  transform: true, // Chuyển dữ liệu request thành instance DTO để chạy decorator kiểm tra.
  whitelist: true, // Chỉ cho phép các trường có khai báo decorator trong DTO.
  forbidNonWhitelisted: true, // Có trường lạ như status/version trong body thì báo lỗi 400.
  forbidUnknownValues: true, // Từ chối giá trị không có metadata kiểm tra phù hợp.
  // Không tự biến chuỗi "100000" thành giá; query phân trang có hàm chuyển riêng.
  transformOptions: { enableImplicitConversion: false },
});
