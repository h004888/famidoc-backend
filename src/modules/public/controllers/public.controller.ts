import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiStandardResponse } from '../../../core/decorators/api-standard-response.decorator';
import { ResponseMessage } from '../../../core/decorators/response-message.decorator';
import type { IPublicService } from '../services/interfaces/public.service.interface';
import { PUBLIC_SERVICE_TOKEN } from '../services/interfaces/public.service.interface';
import { PortalOverviewResponseDto } from '../dtos/portal-overview-response.dto';
import { SearchPublicPackagesDto } from '../dtos/search-public-packages.dto';
import { PublicPackagesResponseDto } from '../dtos/public-packages-response.dto';
import { PublicPackageDetailDto } from '../dtos/public-package-detail.dto';
import { LookupHealthcareFacilitiesDto } from '../dtos/lookup-facilities.dto';
import { PublicFacilitiesResponseDto } from '../dtos/public-facilities-response.dto';
import { LookupDoctorDirectoryDto } from '../dtos/lookup-doctors.dto';
import {
  PublicDoctorItemDto,
  PublicDoctorsResponseDto,
} from '../dtos/public-doctors-response.dto';
import { SubmitConsultationRequestDto } from '../dtos/submit-consultation-request.dto';
import { ConsultationRequestResponseDto } from '../dtos/consultation-request-response.dto';

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

  @Get(['portal-overview', 'overview'])
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
    description:
      'Không tìm thấy gói chăm sóc sức khỏe hoặc gói đã ngừng áp dụng.',
  })
  async getPublicPackageDetail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PublicPackageDetailDto> {
    return this.publicService.getPublicPackageDetail(id);
  }

  @Get(['facilities', 'directory'])
  @ApiOperation({
    summary: 'Tra cứu danh bạ cơ sở y tế đối tác công khai (STT 10 - UC-08)',
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

  @Get('facilities/:id')
  @ApiOperation({
    summary: 'Xem chi tiết cơ sở y tế công khai theo ID (UC-08)',
    description:
      'Trả về thông tin chi tiết của cơ sở y tế đối tác đã được thẩm định hoạt động (ACTIVE).',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID của cơ sở y tế',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết cơ sở y tế.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Không tìm thấy cơ sở y tế hoặc cơ sở y tế chưa được kích hoạt.',
  })
  async getPublicFacilityDetail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<any> {
    return this.publicService.getPublicFacilityDetail(id);
  }

  @Get('doctors')
  @ApiOperation({
    summary: 'Tra cứu danh bạ bác sĩ gia đình công khai (STT 11 - UC-08)',
    description:
      'Cho phép tìm kiếm và tra cứu hồ sơ bác sĩ theo họ tên, chuyên khoa, số năm kinh nghiệm, cơ sở y tế trực thuộc và trạng thái khả dụng tiếp nhận hộ gia đình.',
  })
  @ResponseMessage('Tra cứu danh bạ bác sĩ gia đình thành công')
  @ApiStandardResponse({
    type: PublicDoctorItemDto,
    isPaginated: true,
    description: 'Danh sách các bác sĩ gia đình thỏa mãn điều kiện lọc.',
  })
  async lookupDoctorDirectory(
    @Query() query: LookupDoctorDirectoryDto,
  ): Promise<PublicDoctorsResponseDto> {
    return this.publicService.lookupDoctorDirectory(query);
  }

  @Get('doctors/:id')
  @ApiOperation({
    summary: 'Xem chi tiết bác sĩ gia đình công khai theo ID (UC-08)',
    description:
      'Trả về thông tin chi tiết hồ sơ bác sĩ gia đình đã hoàn tất kích hoạt (ACTIVE).',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID của bác sĩ',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ApiStandardResponse({
    type: PublicDoctorItemDto,
    status: 200,
    description: 'Chi tiết hồ sơ bác sĩ.',
  })
  @ApiResponse({
    status: 400,
    description: 'ID bác sĩ không đúng định dạng UUID v4.',
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy bác sĩ hoặc bác sĩ chưa được kích hoạt.',
  })
  async getPublicDoctorDetail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PublicDoctorItemDto> {
    return this.publicService.getPublicDoctorDetail(id);
  }

  @Post(['consultation-requests', 'inquiries'])
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Gửi yêu cầu tư vấn gói dịch vụ chăm sóc gia đình (STT 12 - UC-09)',
    description:
      'Khách hàng hoặc đại diện gia đình gửi thông tin liên hệ và nhu cầu chăm sóc để đội ngũ tư vấn viên/bác sĩ liên hệ tư vấn gói phù hợp.',
  })
  @ApiBody({ type: SubmitConsultationRequestDto })
  @ApiResponse({
    status: 201,
    description: 'Tiếp nhận yêu cầu tư vấn thành công.',
    type: ConsultationRequestResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Dữ liệu đầu vào không hợp lệ hoặc gói dịch vụ chỉ định không tồn tại.',
  })
  async submitConsultationRequest(
    @Body() dto: SubmitConsultationRequestDto,
    @Req() req: Request,
  ): Promise<ConsultationRequestResponseDto> {
    const clientIp =
      (req.headers['x-forwarded-for'] as string) || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return this.publicService.submitConsultationRequest(
      dto,
      clientIp,
      userAgent,
    );
  }
}
