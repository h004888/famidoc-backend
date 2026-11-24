import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../core/auth/optional-jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import {
  AssignQueueDoctorDto,
  CancelMatchingQueueDto,
  ListMatchingQueueQueryDto,
  MatchDoctorsIntakeDto,
} from '../dtos/matching.dto';
import {
  DiscoverSystemOneModelsQueryDto,
  TestMatchingConfigDto,
  UpdateMatchingConfigDto,
} from '../dtos/matching-config.dto';
import { DoctorMatchingService } from '../services/doctor-matching.service';
import { JevClientService } from '../services/jev-client.service';
import { MatchingConfigService } from '../services/matching-config.service';

@ApiTags('Doctor Matching & Coordination Queue')
@Controller('api/v1')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class MatchingController {
  constructor(
    private readonly matchingService: DoctorMatchingService,
    private readonly matchingConfigService: MatchingConfigService,
    private readonly jevClientService: JevClientService,
  ) {}

  @Get('matching/options')
  @ApiOperation({
    summary:
      'Lấy danh mục động cho bước gợi ý bác sĩ: khu vực có CSYT/BS còn slot, nhóm tuổi, nhu cầu chăm sóc và học hàm/học vị',
  })
  getMatchingOptions() {
    return this.matchingService.getMatchingOptions();
  }

  @Post('matching/doctors')
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Track B — Gợi ý bác sĩ gia đình bằng TypeSafe Jev System One kết hợp cân bằng tải đối tác (hoặc chuyển vào Hàng chờ Admin)',
  })
  @ApiBody({ type: MatchDoctorsIntakeDto })
  matchDoctors(
    @Req() req: AuthenticatedRequest,
    @Body() dto: MatchDoctorsIntakeDto,
  ) {
    return this.matchingService.matchDoctors(req.user, dto);
  }

  @Get('matching/sessions/:id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Lấy chi tiết phiên gợi ý bác sĩ (Track B) để preview trước khi tạo hợp đồng',
  })
  @ApiParam({ name: 'id', description: 'UUID của phiên gợi ý (MatchingSession)' })
  getMatchingSession(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.matchingService.getMatchingSession(req.user, id);
  }

  @Get('matching-queue/my')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('FAMILY_REP')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Đại diện hộ gia đình xem danh sách yêu cầu đang trong hàng chờ điều phối',
  })
  listMyQueueRequests(@Req() req: AuthenticatedRequest) {
    return this.matchingService.listMyQueueRequests(req.user);
  }

  @Get('matching-queue/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('FAMILY_REP', 'ADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Xem chi tiết yêu cầu hàng chờ điều phối (bao gồm bác sĩ & CSYT đã được gán)',
  })
  @ApiParam({ name: 'id', description: 'UUID của yêu cầu hàng chờ' })
  getQueueRequestDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.matchingService.getQueueRequestDetail(req.user, id);
  }

  @Patch('matching-queue/:id/cancel')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('FAMILY_REP', 'ADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Đại diện hộ gia đình hủy yêu cầu đang ở trạng thái QUEUED',
  })
  @ApiParam({ name: 'id', description: 'UUID của yêu cầu hàng chờ' })
  @ApiBody({ type: CancelMatchingQueueDto })
  cancelQueueRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CancelMatchingQueueDto,
  ) {
    return this.matchingService.cancelQueueRequest(req.user, id, dto);
  }

  @Get('admin/matching-queue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Quản trị viên xem danh sách hàng chờ điều phối bác sĩ',
  })
  listAdminQueueRequests(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMatchingQueueQueryDto,
  ) {
    return this.matchingService.listAdminQueueRequests(req.user, query);
  }

  @Patch('admin/matching-queue/:id/assign')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Quản trị viên phân công bác sĩ còn slot cho yêu cầu hàng chờ (tự suy ra CSYT & thông báo gia đình)',
  })
  @ApiParam({ name: 'id', description: 'UUID của yêu cầu hàng chờ' })
  @ApiBody({ type: AssignQueueDoctorDto })
  assignQueueDoctor(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AssignQueueDoctorDto,
  ) {
    return this.matchingService.assignQueueDoctor(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get('admin/matching-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Quản trị viên xem cấu hình runtime của model decision chuẩn System One (/v1/systemone)',
  })
  getAdminMatchingConfig(@Req() req: AuthenticatedRequest) {
    return this.matchingConfigService.getAdminConfig(req.user);
  }

  @Patch('admin/matching-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Quản trị viên cập nhật endpoint, model, kiểu câu hỏi và ngưỡng matching System One tại runtime',
  })
  @ApiBody({ type: UpdateMatchingConfigDto })
  updateAdminMatchingConfig(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateMatchingConfigDto,
  ) {
    return this.matchingConfigService.updateAdminConfig(
      req.user,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post('admin/matching-config/test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Quản trị viên kiểm tra kết nối & test thử payload chuẩn /v1/systemone trước khi lưu',
  })
  @ApiBody({ type: TestMatchingConfigDto })
  testAdminMatchingConfig(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TestMatchingConfigDto,
  ) {
    return this.jevClientService.testSystemOneConnection(req.user, dto);
  }

  @Get('admin/matching-config/models')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Quản trị viên quét danh sách model sẵn có từ máy chủ Ollama (/api/tags) theo Endpoint URL',
  })
  discoverOllamaModels(
    @Req() req: AuthenticatedRequest,
    @Query() query: DiscoverSystemOneModelsQueryDto,
  ) {
    return this.matchingConfigService.discoverOllamaModels(
      req.user,
      query.endpointUrl,
    );
  }
}
