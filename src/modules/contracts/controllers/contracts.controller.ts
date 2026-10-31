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
  @Post(':id/addendums') createContractAddendum(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateContractAddendumDto,
  ) {
    return this.service.createContractAddendum(req.user, id, dto);
  }
  @Post(':id/upgrade') createPackageUpgradeContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreatePackageUpgradeDto,
  ) {
    return this.service.createPackageUpgradeContract(req.user, id, dto);
  }
  @Patch(':id/terminate') terminateContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: TerminateContractDto,
  ) {
    return this.service.terminateContract(req.user, id, dto);
  }
  // Các route hỗ trợ đọc điều khoản/xác nhận, để phụ lục và hợp đồng nâng gói không bỏ qua bước ký.
  @Get(':id/terms') getContractChangeTerms(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getContractChangeTerms(req.user, id);
  }
  @Get(':id/addendums/:addendumId/terms') getAddendumTerms(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Param('addendumId', new ParseUUIDPipe({ version: '4' }))
    addendumId: string,
  ) {
    return this.service.getContractChangeTerms(req.user, id, addendumId);
  }
  @Put(':id/addendums/:addendumId/sign') signContractAddendum(
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
  @Put(':id/sign-upgrade') signUpgradedContract(
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
