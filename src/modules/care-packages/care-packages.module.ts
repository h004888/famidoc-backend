import { CARE_PACKAGES_SERVICE_TOKEN } from './services/interfaces/care-packages.service.interface';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { Module } from '@nestjs/common';
import { AdminCarePackagesController } from './controllers/admin-care-packages.controller';
import { CarePackagesController } from './controllers/care-packages.controller';
import { CarePackagesServiceImpl } from './services/impl/care-packages.service.impl';
import { CARE_PACKAGES_REPOSITORY_TOKEN } from './repositories/interfaces/care-packages.repository.interface';
import { CarePackagesRepositoryImpl } from './repositories/impl/care-packages.repository.impl';

@Module({
  // Tách API công khai và API quản trị để áp dụng quyền truy cập riêng.
  imports: [AuthAccessModule],
  controllers: [CarePackagesController, AdminCarePackagesController],
  providers: [
    CarePackagesServiceImpl,
    { provide: CARE_PACKAGES_SERVICE_TOKEN, useExisting: CarePackagesServiceImpl },
    {
      // Interface không tồn tại khi chạy; Symbol là khóa để Nest cấp đúng repository.
      provide: CARE_PACKAGES_REPOSITORY_TOKEN,
      // Lưu bền vững trong service_packages của schema chung, không dùng Map khi chạy API.
      useClass: CarePackagesRepositoryImpl,
    },
  ],
  // Cho module khác dùng nghiệp vụ gói; không truy cập repository trực tiếp.
  exports: [CarePackagesServiceImpl, CARE_PACKAGES_SERVICE_TOKEN],
})
export class CarePackagesModule {}
