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
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import {
  CreateDoctorQuotaProposalDto,
  ListQuotaProposalsQueryDto,
  ReviewDoctorQuotaProposalDto,
} from '../dtos/quota-proposal.dto';
import { DoctorQuotaProposalsService } from '../services/doctor-quota-proposals.service';

@ApiTags('Doctor Quota Governance')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class DoctorQuotaProposalsController {
  constructor(private readonly service: DoctorQuotaProposalsService) {}

  @Post('facilities/doctors/:id/quota-proposals')
  @Roles('HEALTHCARE_FACILITY')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'CSYT gửi đề xuất điều chỉnh hạn mức hộ gia đình (maxPanelCapacity) cho bác sĩ',
  })
  @ApiParam({ name: 'id', description: 'UUID của bác sĩ trực thuộc CSYT' })
  @ApiBody({ type: CreateDoctorQuotaProposalDto })
  createFacilityQuotaProposal(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) doctorId: string,
    @Body() dto: CreateDoctorQuotaProposalDto,
  ) {
    return this.service.createProposal(
      req.user,
      doctorId,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get('facilities/doctors/:id/quota-proposals')
  @Roles('HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'CSYT xem lịch sử đề xuất điều chỉnh quota của một bác sĩ trực thuộc',
  })
  @ApiParam({ name: 'id', description: 'UUID của bác sĩ trực thuộc CSYT' })
  listDoctorQuotaProposals(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) doctorId: string,
  ) {
    return this.service.listDoctorProposalsForFacility(req.user, doctorId);
  }

  @Get('facilities/quota-proposals')
  @Roles('HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'CSYT xem toàn bộ đề xuất điều chỉnh quota của đơn vị mình',
  })
  listFacilityQuotaProposals(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListQuotaProposalsQueryDto,
  ) {
    return this.service.listFacilityProposals(req.user, query);
  }

  @Get('admin/quota-proposals')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Quản trị viên xem danh sách đề xuất điều chỉnh quota từ các CSYT',
  })
  listAdminQuotaProposals(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListQuotaProposalsQueryDto,
  ) {
    return this.service.listAdminProposals(req.user, query);
  }

  @Patch('admin/quota-proposals/:id')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Quản trị viên phê duyệt hoặc từ chối đề xuất điều chỉnh quota',
  })
  @ApiParam({ name: 'id', description: 'UUID của đề xuất quota' })
  @ApiBody({ type: ReviewDoctorQuotaProposalDto })
  reviewQuotaProposal(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) proposalId: string,
    @Body() dto: ReviewDoctorQuotaProposalDto,
  ) {
    return this.service.reviewProposal(
      req.user,
      proposalId,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
