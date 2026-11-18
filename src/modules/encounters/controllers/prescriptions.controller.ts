import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import {
  FamilyPrescriptionQuery,
  PrescriptionPageQuery,
  SharePrescriptionDto,
} from '../dtos/share-prescription.dto';
import { PrescriptionsService } from '../services/prescriptions.service';

@ApiTags('Prescriptions')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/prescriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PrescriptionsController {
  constructor(private readonly prescriptions: PrescriptionsService) {}

  @Get('encounters')
  @Roles('DOCTOR')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Danh sách buổi khám của bác sĩ để kê và gửi đơn thuốc',
  })
  doctorVisits(
    @Req() req: AuthenticatedRequest,
    @Query() query: PrescriptionPageQuery,
  ) {
    return this.prescriptions.doctorVisits(req.user, query.page);
  }

  @Post('encounters/:id')
  @Roles('DOCTOR')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Lưu đơn thuốc và chia sẻ với người đại diện được phép nhận',
  })
  share(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SharePrescriptionDto,
  ) {
    return this.prescriptions.share(req.user, id, dto);
  }

  @Get()
  @Roles('FAMILY_REP')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Lịch sử đơn thuốc được chia sẻ với tài khoản gia đình',
  })
  familyList(
    @Req() req: AuthenticatedRequest,
    @Query() query: FamilyPrescriptionQuery,
  ) {
    return this.prescriptions.familyList(req.user, query);
  }

  @Get(':id')
  @Roles('FAMILY_REP')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Chi tiết đơn thuốc được chia sẻ với tài khoản gia đình',
  })
  familyDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.prescriptions.familyDetail(req.user, id);
  }
}
