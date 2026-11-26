import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../core/auth/authenticated-request';
import { AdminAccountStatusDto, AdminAuditQuery, AdminComplaintsQuery, AdminFinanceReportQuery, AdminOverviewQuery, AdminUpdateDoctorPanelCapacityDto, AdminUpdateRevenueConfigDto, AdminUsersQuery, ComplaintsQuery } from './admin.dto';
import { AdminService } from './admin.service';

@ApiTags('Admin')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/admin')
@Roles('ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Tổng quan doanh thu, lượt khám và khiếu nại của nền tảng' })
  overview(@Query() query: AdminOverviewQuery) {
    return this.service.overview(query.period, query.environment);
  }

  @Get('finance-report')
  @ApiOperation({ summary: 'Báo cáo tiền thu từ hóa đơn và tiền chi trả CSYT theo từng tháng trong năm' })
  financeReport(@Query() query: AdminFinanceReportQuery) {
    return this.service.financeReport(query);
  }

  @Get('users')
  @ApiOperation({ summary: 'Danh sách tài khoản và vai trò' })
  listUsers(@Query() query: AdminUsersQuery) {
    return this.service.listUsers(query);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Tạm khóa hoặc khôi phục quyền truy cập của tài khoản' })
  changeStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AdminAccountStatusDto,
  ) {
    return this.service.changeStatus(req.user, id, dto, req.ip);
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Tra cứu nhật ký vận hành và bảo mật' })
  auditLogs(@Query() query: AdminAuditQuery) {
    return this.service.auditLogs(query);
  }

  @Get('complaints')
  @ApiOperation({ summary: 'Danh sách khiếu nại để quản trị viên xử lý' })
  complaints(@Query() query: AdminComplaintsQuery) {
    return this.service.complaints(query);
  }

  @Post('facilities/:id/resend-invite')
  @ApiOperation({ summary: 'Gửi mã thiết lập lại mật khẩu cho CSYT đang hoàn thiện hồ sơ' })
  resendFacilityInvite(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.resendFacilityInvite(req.user, id, req.ip);
  }

  @Get('revenue-config')
  @ApiOperation({ summary: 'Tỷ lệ chia doanh thu mặc định cho hợp đồng B2B mới' })
  getRevenueConfig() {
    return this.service.getRevenueConfig();
  }

  @Patch('revenue-config')
  @ApiOperation({ summary: 'Cập nhật tỷ lệ chia doanh thu mặc định (CSYT + nền tảng = 100%)' })
  updateRevenueConfig(@Req() req: AuthenticatedRequest, @Body() dto: AdminUpdateRevenueConfigDto) {
    return this.service.updateRevenueConfig(req.user, dto, req.ip);
  }

  @Patch('doctors/:id/panel-capacity')
  @ApiOperation({ summary: 'Quản trị viên chỉnh sửa trực tiếp hạn mức hộ gia đình của bác sĩ' })
  updateDoctorPanelCapacity(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AdminUpdateDoctorPanelCapacityDto,
  ) {
    return this.service.updateDoctorPanelCapacity(req.user, id, dto, req.ip);
  }
}

@ApiTags('Complaints')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/facilities/me/complaints')
@Roles('HEALTHCARE_FACILITY')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class FacilityComplaintsController {
  constructor(private readonly service: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách khiếu nại thuộc CSYT đang đăng nhập' })
  complaints(@Req() req: AuthenticatedRequest, @Query() query: ComplaintsQuery) {
    return this.service.complaints(query, req.user.id);
  }
}
