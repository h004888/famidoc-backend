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
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import {
  CreateContractAddendumDto,
  CreatePackageUpgradeDto,
  SignContractChangeDto,
  TerminateContractDto,
} from '../dtos/contract-change.dto';
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

  @Post(':id/addendums')
  @ApiOperation({ summary: 'Tạo phụ lục hợp đồng (thay đổi thành viên hoặc dịch vụ)' })
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

  @Get(':id/terms')
  @ApiOperation({ summary: 'Xem các điều khoản thay đổi của hợp đồng nâng cấp' })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng' })
  @ApiResponse({ status: 200, description: 'Nội dung điều khoản và mã hash hợp đồng' })
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
