import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { IPublicService } from '../services/interfaces/public.service.interface';
import { PUBLIC_SERVICE_TOKEN } from '../services/interfaces/public.service.interface';
import { PortalOverviewResponseDto } from '../dtos/portal-overview-response.dto';
import { SearchPublicPackagesDto } from '../dtos/search-public-packages.dto';
import { PublicPackagesResponseDto } from '../dtos/public-packages-response.dto';
import { PublicPackageDetailDto } from '../dtos/public-package-detail.dto';
import { LookupHealthcareFacilitiesDto } from '../dtos/lookup-facilities.dto';
import { PublicFacilitiesResponseDto } from '../dtos/public-facilities-response.dto';
import { LookupDoctorDirectoryDto } from '../dtos/lookup-doctors.dto';
import { PublicDoctorsResponseDto } from '../dtos/public-doctors-response.dto';

@ApiTags('Public Portal')
@Controller('api/v1/public')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class PublicController {
  constructor(
    @Inject(PUBLIC_SERVICE_TOKEN)
    private readonly publicService: IPublicService,
  ) {}

  @Get('portal-overview')
  @ApiOperation({
    summary: 'Lấy thông tin tổng quan trang chủ Public Portal (STT 7 - UC-06)',
    description:
      'Trả về thông tin nền tảng, cơ sở pháp lý, biểu ngữ nổi bật, 4 trụ cột chuyên môn, số liệu thống kê và danh sách cơ sở y tế / gói dịch vụ tiêu biểu.',
  })
  @ApiResponse({
    status: 200,
    description: 'Lấy thông tin tổng quan thành công.',
    type: PortalOverviewResponseDto,
  })
  async getPublicPortalOverview(): Promise<PortalOverviewResponseDto> {
    return this.publicService.getPublicPortalOverview();
  }

  @Get('packages')
  @ApiOperation({
    summary:
      'Tìm kiếm và lọc danh mục gói chăm sóc sức khỏe công khai (STT 8 - UC-07)',
    description:
      'Cho phép khách vãng lai và gia đình tra cứu danh mục gói chăm sóc theo từ khóa, số tháng, khoảng giá và số thành viên tối đa áp dụng với phân trang chuẩn.',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách các gói chăm sóc sức khỏe thỏa mãn điều kiện lọc.',
    type: PublicPackagesResponseDto,
  })
  async searchPublicPackages(
    @Query() query: SearchPublicPackagesDto,
  ): Promise<PublicPackagesResponseDto> {
    return this.publicService.searchPublicPackages(query);
  }

  @Get('packages/:id')
  @ApiOperation({
    summary:
      'Xem chi tiết gói chăm sóc sức khỏe công khai theo ID (STT 9 - UC-07)',
    description:
      'Trả về đầy đủ thông tin chi tiết của gói chăm sóc: hạn mức thăm khám tại nhà, tư vấn từ xa, quyền lợi lâm sàng và điều khoản hợp đồng mẫu.',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID của gói dịch vụ chăm sóc sức khỏe',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết gói chăm sóc sức khỏe.',
    type: PublicPackageDetailDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy gói chăm sóc sức khỏe hoặc gói đã ngừng áp dụng.',
  })
  async getPublicPackageDetail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PublicPackageDetailDto> {
    return this.publicService.getPublicPackageDetail(id);
  }

  @Get('facilities')
  @ApiOperation({
    summary:
      'Tra cứu danh bạ cơ sở y tế đối tác công khai (STT 10 - UC-08)',
    description:
      'Cho phép tra cứu các bệnh viện, phòng khám đa khoa đối tác đã được thẩm định hoạt động (ACTIVE) kèm số lượng bác sĩ đang liên kết.',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách các cơ sở y tế đối tác thỏa mãn điều kiện lọc.',
    type: PublicFacilitiesResponseDto,
  })
  async lookupHealthcareFacilities(
    @Query() query: LookupHealthcareFacilitiesDto,
  ): Promise<PublicFacilitiesResponseDto> {
    return this.publicService.lookupHealthcareFacilities(query);
  }

  @Get('doctors')
  @ApiOperation({
    summary:
      'Tra cứu danh bạ bác sĩ gia đình công khai (STT 11 - UC-08)',
    description:
      'Cho phép tìm kiếm và tra cứu hồ sơ bác sĩ theo họ tên, chuyên khoa, số năm kinh nghiệm, cơ sở y tế trực thuộc và trạng thái khả dụng tiếp nhận hộ gia đình.',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách các bác sĩ gia đình thỏa mãn điều kiện lọc.',
    type: PublicDoctorsResponseDto,
  })
  async lookupDoctorDirectory(
    @Query() query: LookupDoctorDirectoryDto,
  ): Promise<PublicDoctorsResponseDto> {
    return this.publicService.lookupDoctorDirectory(query);
  }
}

