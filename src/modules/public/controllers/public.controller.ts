import {
  Controller,
  Get,
  Inject,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { IPublicService } from '../services/interfaces/public.service.interface';
import { PUBLIC_SERVICE_TOKEN } from '../services/interfaces/public.service.interface';
import { PortalOverviewResponseDto } from '../dtos/portal-overview-response.dto';
import { SearchPublicPackagesDto } from '../dtos/search-public-packages.dto';
import { PublicPackagesResponseDto } from '../dtos/public-packages-response.dto';

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
}

