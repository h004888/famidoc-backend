import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import {
  CreateContractAddendumDto,
  CreatePackageUpgradeDto,
  SignContractChangeDto,
  TerminateContractDto,
} from '../dtos/contract-change.dto';
import {
  CreateStaffingContractDto,
  SignStaffingContractDto,
  ListStaffingContractsDto,
  StaffingContractResponseDto,
} from '../dtos/staffing-contract.dto';
import { CreateMedicalContractDto } from '../dtos/create-medical-contract.dto';
import {
  CONTRACTS_SERVICE_TOKEN,
  type IContractsService,
} from '../services/interfaces/contracts.service.interface';

@ApiTags('Contracts')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/contracts')
@UseGuards(JwtAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class ContractsController {
  constructor(
    @Inject(CONTRACTS_SERVICE_TOKEN)
    private readonly service: IContractsService,
  ) {}

  @Post('medical')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'ADMIN')
  @ApiOperation({
    summary: 'Khởi tạo hợp đồng dịch vụ y tế 4 bên ban đầu (STT 19 - UC-16)',
    description:
      'Đại diện gia đình (hoặc Admin) tạo bản thảo hợp đồng y tế ban đầu, snapshot quyền lợi gói và khởi tạo trạng thái PENDING_APPROVAL.',
  })
  @ApiBody({ type: CreateMedicalContractDto })
  @ApiResponse({
    status: 201,
    description: 'Tạo bản thảo hợp đồng y tế thành công.',
  })
  createInitialMedicalContract(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMedicalContractDto,
  ) {
    return this.service.createInitialMedicalContract(req.user, dto);
  }

  @Put(['medical/:id/sign', 'medical/:id/signatures'])
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'ADMIN', 'HEALTHCARE_FACILITY', 'DOCTOR')
  @ApiOperation({
    summary: 'Ký số điện tử hợp đồng y tế 4 bên ban đầu (STT 20 - UC-16)',
    description:
      'Tuần tự ký số 4 bên: FAMILY_REP -> ADMIN -> HEALTHCARE_FACILITY -> ASSIGNED_DOCTOR. Sau khi đủ 4 chữ ký sẽ chuyển sang PENDING_PAYMENT.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng y tế' })
  @ApiBody({ type: SignContractChangeDto })
  @ApiResponse({
    status: 200,
    description: 'Ký số thành công.',
  })
  signInitialMedicalContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SignContractChangeDto,
  ) {
    return this.service.signInitialMedicalContract(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Post('staffing')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'Thiết lập hợp đồng cung ứng nhân lực y tế B2B (STT 13 - UC-15)',
    description:
      'Thiết lập hợp đồng khung cung ứng nhân lực y tế giữa Nền tảng và Cơ sở y tế đối tác, xác lập tỷ lệ phân chia doanh thu và thời hạn hiệu lực.',
  })
  @ApiBody({ type: CreateStaffingContractDto })
  @ApiResponse({
    status: 201,
    description: 'Tạo hợp đồng nhân lực B2B thành công, chờ ký xác nhận.',
    type: StaffingContractResponseDto,
  })
  createStaffingContract(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateStaffingContractDto,
  ) {
    return this.service.createStaffingContract(
      req.user,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Put('staffing/:id/sign')
  @Post('staffing/:id/sign')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'Ký số điện tử hợp đồng cung ứng nhân lực B2B (STT 14 - UC-15)',
    description:
      'Đại diện Nền tảng (Admin) hoặc Đại diện Cơ sở y tế thực hiện ký số điện tử để kích hoạt hợp đồng cung ứng nhân lực sang trạng thái ACTIVE.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  @ApiBody({ type: SignStaffingContractDto })
  @ApiResponse({
    status: 200,
    description: 'Ký số thành công, hợp đồng đã được kích hoạt có hiệu lực.',
    type: StaffingContractResponseDto,
  })
  signStaffingContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SignStaffingContractDto,
  ) {
    return this.service.signStaffingContract(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get('staffing')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HEALTHCARE_FACILITY')
  @ApiOperation({ summary: 'Xem danh sách hợp đồng cung ứng nhân lực B2B' })
  @ApiResponse({
    status: 200,
    description: 'Danh sách hợp đồng cung ứng nhân lực.',
  })
  listStaffingContracts(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListStaffingContractsDto,
  ) {
    return this.service.listStaffingContracts(req.user, query);
  }

  @Get('staffing/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HEALTHCARE_FACILITY')
  @ApiOperation({ summary: 'Xem chi tiết hợp đồng cung ứng nhân lực B2B' })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết hợp đồng cung ứng nhân lực.',
    type: StaffingContractResponseDto,
  })
  getStaffingContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getStaffingContract(req.user, id);
  }

  @Post(':id/addendums')
  @ApiOperation({
    summary: 'Tạo phụ lục hợp đồng (thay đổi thành viên hoặc dịch vụ)',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng chính' })
  @ApiBody({ type: CreateContractAddendumDto })
  @ApiResponse({ status: 201, description: 'Tạo phụ lục hợp đồng thành công' })
  createContractAddendum(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateContractAddendumDto,
  ) {
    return this.service.createContractAddendum(req.user, id, dto);
  }

  @Post(':id/upgrade')
  @ApiOperation({ summary: 'Tạo yêu cầu nâng cấp gói chăm sóc cho hợp đồng' })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng chính' })
  @ApiBody({ type: CreatePackageUpgradeDto })
  @ApiResponse({ status: 201, description: 'Tạo yêu cầu nâng cấp thành công' })
  createPackageUpgradeContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreatePackageUpgradeDto,
  ) {
    return this.service.createPackageUpgradeContract(req.user, id, dto);
  }

  @Patch(':id/terminate')
  @ApiOperation({ summary: 'Chấm dứt/hủy hợp đồng chăm sóc sức khỏe' })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cần chấm dứt' })
  @ApiBody({ type: TerminateContractDto })
  @ApiResponse({ status: 200, description: 'Chấm dứt hợp đồng thành công' })
  terminateContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: TerminateContractDto,
  ) {
    return this.service.terminateContract(req.user, id, dto);
  }

  @Post(':id/termination')
  @ApiOperation({ summary: 'Gửi yêu cầu chấm dứt hợp đồng (UC-19 alias)' })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cần chấm dứt' })
  @ApiResponse({
    status: 200,
    description: 'Tiếp nhận yêu cầu chấm dứt hợp đồng',
  })
  requestTermination(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: { reason?: string },
  ) {
    return this.service.terminateContract(req.user, id, {
      action: 'REQUEST',
      reason: dto.reason,
    });
  }

  @Post('terminations/:id/decision')
  @ApiOperation({
    summary:
      'Phê duyệt/từ chối hoặc đồng thuận chấm dứt hợp đồng (UC-19 alias)',
  })
  @ApiParam({
    name: 'id',
    description: 'UUID của yêu cầu chấm dứt (requestId)',
  })
  @ApiResponse({
    status: 200,
    description: 'Quyết định chấm dứt hợp đồng thành công',
  })
  decideTermination(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body()
    dto: {
      contractId: string;
      action: 'APPROVE' | 'REJECT' | 'CONSENT';
      reason?: string;
      termsHash?: string;
    },
  ) {
    return this.service.terminateContract(req.user, dto.contractId, {
      action: dto.action,
      requestId: id,
      reason: dto.reason,
      termsHash: dto.termsHash,
    });
  }

  @Get(':id/terms')
  @ApiOperation({
    summary: 'Xem các điều khoản thay đổi của hợp đồng nâng cấp',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng' })
  @ApiResponse({
    status: 200,
    description: 'Nội dung điều khoản và mã hash hợp đồng',
  })
  getContractChangeTerms(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getContractChangeTerms(req.user, id);
  }

  @Get(':id/addendums/:addendumId/terms')
  @ApiOperation({ summary: 'Xem điều khoản chi tiết của phụ lục hợp đồng' })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng chính' })
  @ApiParam({ name: 'addendumId', description: 'UUID của phụ lục hợp đồng' })
  @ApiResponse({ status: 200, description: 'Nội dung điều khoản phụ lục' })
  getAddendumTerms(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('addendumId', new ParseUUIDPipe({ version: '4' }))
    addendumId: string,
  ) {
    return this.service.getContractChangeTerms(req.user, id, addendumId);
  }

  @Put(':id/addendums/:addendumId/sign')
  @ApiOperation({ summary: 'Ký xác nhận phụ lục hợp đồng' })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng chính' })
  @ApiParam({ name: 'addendumId', description: 'UUID của phụ lục hợp đồng' })
  @ApiBody({ type: SignContractChangeDto })
  @ApiResponse({ status: 200, description: 'Ký phụ lục thành công' })
  signContractAddendum(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('addendumId', new ParseUUIDPipe({ version: '4' }))
    addendumId: string,
    @Body() dto: SignContractChangeDto,
  ) {
    return this.service.signContractAddendum(
      req.user,
      id,
      addendumId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Put(':id/sign-upgrade')
  @ApiOperation({ summary: 'Ký xác nhận hợp đồng nâng cấp gói chăm sóc' })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng' })
  @ApiBody({ type: SignContractChangeDto })
  @ApiResponse({ status: 200, description: 'Ký hợp đồng nâng cấp thành công' })
  signUpgradedContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SignContractChangeDto,
  ) {
    return this.service.signUpgradedContract(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
