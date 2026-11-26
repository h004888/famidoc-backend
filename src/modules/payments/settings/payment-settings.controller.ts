import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { PrismaService } from '../../../core/database/prisma.service';
import { paymentsValidationPipe } from '../payments-validation.pipe';
import {
  PaymentSettingsDraftDto,
  PaymentSettingsEnvironmentDto,
  PaymentTestSessionDto,
} from './payment-settings.dto';
import { PaymentSettingsService } from './payment-settings.service';
import { PaymentSettingsCheckService } from './payment-settings-check.service';
import { PaymentConfigurationTestService } from './payment-configuration-test.service';

@Controller('api/v1/payments/admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@UsePipes(paymentsValidationPipe)
export class PaymentSettingsController {
  constructor(
    private readonly settings: PaymentSettingsService,
    private readonly checks: PaymentSettingsCheckService,
    private readonly sessions: PaymentConfigurationTestService,
    private readonly prisma: PrismaService,
  ) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  get(@Query() query: PaymentSettingsEnvironmentDto) {
    return this.settings.get(query.environment);
  }
  @Patch()
  @Header('Cache-Control', 'private, no-store')
  save(@Body() dto: PaymentSettingsDraftDto, @Req() req: AuthenticatedRequest) {
    return this.settings.save(dto, req.user.id, this.prisma);
  }
  @Post('check')
  @Header('Cache-Control', 'private, no-store')
  check(
    @Body() dto: PaymentSettingsDraftDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.checks.check(dto, req.user.id);
  }
  @Post('test-sessions')
  @Header('Cache-Control', 'private, no-store')
  create(@Body() dto: PaymentTestSessionDto, @Req() req: AuthenticatedRequest) {
    return this.sessions.create(dto, req.user.id);
  }
  @Get('test-sessions/:id')
  @Header('Cache-Control', 'private, no-store')
  session(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.sessions.get(id, req.user.id);
  }
}
