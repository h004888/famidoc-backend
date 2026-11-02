import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { IPublicService } from '../services/interfaces/public.service.interface';
import { PUBLIC_SERVICE_TOKEN } from '../services/interfaces/public.service.interface';
import { PortalOverviewResponseDto } from '../dtos/portal-overview-response.dto';

@ApiTags('Public Portal')
@Controller('api/v1/public')
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
}
