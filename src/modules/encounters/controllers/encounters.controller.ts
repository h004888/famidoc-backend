import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { ResponseMessage } from '../../../core/decorators/response-message.decorator';
import {
  ENCOUNTERS_SERVICE_TOKEN,
  type IEncountersService,
} from '../services/interfaces/encounters.service.interface';
import { CreatePeriodicEncounterDto } from '../dtos/create-periodic-encounter.dto';
import { CreateAdHocEncounterDto } from '../dtos/create-adhoc-encounter.dto';
import { FinalizeEncounterDto } from '../dtos/finalize-encounter.dto';
import { ConfirmEncounterDto } from '../dtos/confirm-encounter.dto';
import { RequestRescheduleDto } from '../dtos/request-reschedule.dto';
import { DecideRescheduleRequestDto } from '../dtos/decide-reschedule-request.dto';
import { ListEncountersQueryDto } from '../dtos/list-encounters-query.dto';
import { DoctorManualScheduleDto } from '../dtos/doctor-manual-schedule.dto';
import { AdjustCadenceMilestoneDto } from '../dtos/adjust-cadence-milestone.dto';

@ApiTags('Encounters & Examination Scheduling')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/encounters')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
export class EncountersController {
  constructor(
    @Inject(ENCOUNTERS_SERVICE_TOKEN)
    private readonly service: IEncountersService,
  ) {}

  @Post('periodic')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Bác sĩ phụ trách lên lộ trình khám định kỳ dựa trên gói dịch vụ và hồ sơ sức khỏe',
  })
  @ApiBody({ type: CreatePeriodicEncounterDto })
  @ApiResponse({ status: 201, description: 'Đề xuất lịch khám định kỳ thành công' })
  @ApiResponse({ status: 400, description: 'Hạn ngạch gói đã hết hoặc dữ liệu không hợp lệ' })
  @ResponseMessage('Đề xuất lịch khám định kỳ thành công')
  createPeriodicEncounter(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreatePeriodicEncounterDto,
  ) {
    return this.service.createPeriodicEncounter(req.user, dto);
  }

  @Post('ad-hoc')
  @Roles('FAMILY_REP', 'ADMIN')
  @ApiOperation({
    summary: 'Đại diện gia đình gửi yêu cầu khám đột xuất (Ad-hoc) tới bác sĩ phụ trách',
  })
  @ApiBody({ type: CreateAdHocEncounterDto })
  @ApiResponse({ status: 201, description: 'Gửi yêu cầu khám đột xuất thành công' })
  @ResponseMessage('Gửi yêu cầu khám đột xuất thành công')
  createAdHocEncounter(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateAdHocEncounterDto,
  ) {
    return this.service.createAdHocEncounter(req.user, dto);
  }

  @Patch(':id/finalize')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Bác sĩ rà soát và chốt lịch khám cùng hình thức khám gửi gia đình duyệt',
  })
  @ApiParam({ name: 'id', description: 'ID của buổi khám (Encounter)' })
  @ApiBody({ type: FinalizeEncounterDto })
  @ApiResponse({ status: 200, description: 'Chốt lịch khám đề xuất thành công' })
  @ResponseMessage('Chốt lịch khám đề xuất thành công')
  finalizeEncounter(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: FinalizeEncounterDto,
  ) {
    return this.service.finalizeEncounter(req.user, id, dto);
  }

  @Patch(':id/confirm')
  @Roles('FAMILY_REP', 'DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Gia đình hoặc Bác sĩ xác nhận đồng ý lịch khám & đối chiếu ca trực để đồng bộ lịch',
  })
  @ApiParam({ name: 'id', description: 'ID của buổi khám' })
  @ApiBody({ type: ConfirmEncounterDto })
  @ApiResponse({ status: 200, description: 'Đồng bộ lịch khám thành công hoặc phát cảnh báo xung đột ca trực' })
  @ResponseMessage('Xác nhận lịch khám thành công')
  confirmEncounter(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ConfirmEncounterDto,
  ) {
    return this.service.confirmEncounter(req.user, id, dto);
  }

  @Patch(':id/cancel')
  @Roles('FAMILY_REP', 'DOCTOR', 'ADMIN')
  @ApiOperation({ summary: 'Hủy lịch khám và hoàn trả lượt nếu đủ điều kiện cutoff' })
  @ApiParam({ name: 'id', description: 'ID của buổi khám' })
  @ResponseMessage('Hủy lịch khám thành công')
  cancelEncounter(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body('reason') reason?: string,
  ) {
    return (this.service as any).cancelEncounter(req.user, id, reason);
  }

  @Patch(':id/on-the-way')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({ summary: 'Bác sĩ báo đang di chuyển tới nhà gia đình' })
  @ApiParam({ name: 'id', description: 'ID của buổi khám' })
  @ResponseMessage('Đã cập nhật trạng thái đang di chuyển')
  markOnTheWay(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.markOnTheWay(req.user, id);
  }

  @Patch(':id/arrive')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({ summary: 'Bác sĩ check-in đã có mặt tại nhà gia đình' })
  @ApiParam({ name: 'id', description: 'ID của buổi khám' })
  @ResponseMessage('Đã check-in có mặt tại nhà gia đình')
  markArrived(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.markArrived(req.user, id);
  }

  @Patch(':id/confirm-arrival')
  @Roles('FAMILY_REP', 'ADMIN')
  @ApiOperation({ summary: 'Gia đình xác nhận 1 chạm bác sĩ đã có mặt tại nhà' })
  @ApiParam({ name: 'id', description: 'ID của buổi khám' })
  @ResponseMessage('Đã xác nhận bác sĩ có mặt tại nhà')
  confirmArrival(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.confirmArrival(req.user, id);
  }

  @Post(':id/reschedule')
  @Roles('FAMILY_REP', 'DOCTOR', 'HEALTHCARE_FACILITY', 'ADMIN')
  @ApiOperation({
    summary: 'Gia đình, Bác sĩ hoặc CSYT gửi yêu cầu đổi lịch khám (SLA >= 4 giờ)',
  })
  @ApiParam({ name: 'id', description: 'ID của buổi khám' })
  @ApiBody({ type: RequestRescheduleDto })
  @ApiResponse({ status: 201, description: 'Tạo yêu cầu đổi lịch thành công và gửi tới 2 bên còn lại' })
  @ApiResponse({ status: 400, description: 'Từ chối tự động do thời gian báo trước dưới 4 giờ' })
  @ResponseMessage('Gửi yêu cầu đổi lịch khám thành công')
  requestReschedule(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RequestRescheduleDto,
  ) {
    return this.service.requestReschedule(req.user, id, dto);
  }

  @Patch(':id/reschedule-requests/:requestId/decision')
  @Roles('FAMILY_REP', 'DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Phê duyệt (APPROVE) hoặc từ chối (REJECT) yêu cầu đổi lịch 2 bên (Gia đình <-> Bác sĩ)',
  })
  @ApiParam({ name: 'id', description: 'ID của buổi khám' })
  @ApiParam({ name: 'requestId', description: 'ID của yêu cầu đổi lịch' })
  @ApiBody({ type: DecideRescheduleRequestDto })
  @ResponseMessage('Ghi nhận quyết định đổi lịch thành công')
  decideRescheduleRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
    @Body() dto: DecideRescheduleRequestDto,
  ) {
    return this.service.decideRescheduleRequest(req.user, id, requestId, dto);
  }

  @Patch(':id/reschedule-requests/:requestId/withdraw')
  @Roles('FAMILY_REP', 'DOCTOR', 'ADMIN')
  @ApiOperation({ summary: 'Bên gửi tự thu hồi yêu cầu đổi lịch đang chờ duyệt (nhả khung tạm giữ)' })
  @ResponseMessage('Đã thu hồi đề xuất đổi lịch')
  withdrawRescheduleRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('requestId') requestId: string,
  ) {
    return this.service.withdrawRescheduleRequest(req.user, id, requestId);
  }

  @Get('reschedule-requests/pending')
  @Roles('FAMILY_REP', 'DOCTOR', 'HEALTHCARE_FACILITY', 'ADMIN')
  @ApiOperation({ summary: 'Danh sách yêu cầu đổi lịch đang chờ duyệt theo vai trò' })
  @ResponseMessage('Lấy danh sách yêu cầu đổi lịch thành công')
  getPendingRescheduleRequests(@Req() req: AuthenticatedRequest) {
    return this.service.getPendingRescheduleRequests(req.user);
  }

  @Get('timetable/doctor')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({ summary: 'Lấy thời khóa biểu lịch khám của bác sĩ' })
  @ResponseMessage('Lấy thời khóa biểu bác sĩ thành công')
  getDoctorTimetable(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListEncountersQueryDto,
  ) {
    return this.service.getDoctorTimetable(req.user, query);
  }

  @Get('doctors/:doctorId/monthly-availability')
  @Roles('FAMILY_REP', 'DOCTOR', 'HEALTHCARE_FACILITY', 'ADMIN')
  @ApiOperation({ summary: 'Lấy tình trạng 2 khung Sáng/Chiều cả tháng của Bác sĩ' })
  @ResponseMessage('Lấy lịch trống theo tháng thành công')
  getDoctorMonthlyAvailability(
    @Req() req: AuthenticatedRequest,
    @Param('doctorId') doctorId: string,
    @Query('month') month: string,
    @Query('contractId') contractId?: string,
    @Query('excludeEncounterId') excludeEncounterId?: string,
  ) {
    return this.service.getDoctorMonthlyAvailability(
      req.user,
      doctorId,
      month,
      contractId,
      excludeEncounterId,
    );
  }

  @Get('doctors/:doctorId/video-availability')
  @Roles('FAMILY_REP', 'DOCTOR', 'HEALTHCARE_FACILITY', 'ADMIN')
  @ApiOperation({ summary: 'Lấy tình trạng 2 khung Sáng/Chiều đặt Tư vấn Video theo tháng của Bác sĩ' })
  @ResponseMessage('Lấy lịch trống Tư vấn Video theo tháng thành công')
  getDoctorVideoAvailability(
    @Req() req: AuthenticatedRequest,
    @Param('doctorId') doctorId: string,
    @Query('month') month: string,
    @Query('contractId') contractId?: string,
  ) {
    return (this.service as any).getDoctorVideoAvailability(
      req.user,
      doctorId,
      month,
      contractId,
    );
  }

  @Patch(':id/doctor-manual-schedule')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({ summary: 'Bác sĩ tự xếp tay ngày & khung cho mốc kín lịch (EF3)' })
  @ResponseMessage('Chốt lịch xếp tay thành công')
  doctorManualSchedule(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: DoctorManualScheduleDto,
  ) {
    return this.service.doctorManualSchedule(req.user, id, dto);
  }

  @Post('contracts/:contractId/retry-auto-schedule')
  @Roles('HEALTHCARE_FACILITY', 'FAMILY_REP', 'ADMIN')
  @ApiOperation({ summary: 'Chạy lại xếp lịch tự động sau khi bổ sung thông tin (EF1)' })
  @ResponseMessage('Đã kích hoạt xếp lịch tự động lại thành công')
  retryContractAutoSchedule(
    @Req() req: AuthenticatedRequest,
    @Param('contractId') contractId: string,
  ) {
    return this.service.retryContractAutoSchedule(req.user, contractId);
  }

  @Get('timetable/family')
  @Roles('FAMILY_REP', 'ADMIN')
  @ApiOperation({ summary: 'Lấy thời khóa biểu lịch khám của hộ gia đình' })
  @ResponseMessage('Lấy thời khóa biểu gia đình thành công')
  getFamilyTimetable(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListEncountersQueryDto,
  ) {
    return this.service.getFamilyTimetable(req.user, query);
  }

  @Get('facility/schedule-board')
  @Roles('HEALTHCARE_FACILITY', 'ADMIN')
  @ApiOperation({
    summary: 'CSYT giám sát bảng điều phối ca trực nội viện và lịch khám ngoại viện của bác sĩ',
  })
  @ResponseMessage('Lấy bảng điều phối ca trực thành công')
  getFacilityScheduleBoard(
    @Req() req: AuthenticatedRequest,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    return this.service.getFacilityScheduleBoard(req.user, fromDate, toDate);
  }

  @Get(':id')
  @Roles('DOCTOR', 'FAMILY_REP', 'HEALTHCARE_FACILITY', 'ADMIN')
  @ApiOperation({ summary: 'Xem thông tin chi tiết một buổi khám' })
  @ApiParam({ name: 'id', description: 'ID của buổi khám' })
  @ResponseMessage('Lấy thông tin buổi khám thành công')
  getEncounterDetail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.service.getEncounterDetail(req.user, id);
  }

  @Post('cadence/finalize/:contractId')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Bác sĩ chốt toàn bộ khung lịch khám định kỳ theo gói cho gia đình',
  })
  @ApiParam({ name: 'contractId', description: 'ID của hợp đồng y tế' })
  @ApiResponse({ status: 200, description: 'Chốt khung lịch định kỳ thành công' })
  @ResponseMessage('Chốt khung lịch định kỳ thành công')
  finalizeCadenceSchedule(
    @Req() req: AuthenticatedRequest,
    @Param('contractId') contractId: string,
  ) {
    return this.service.finalizeCadenceSchedule(req.user, contractId);
  }

  @Post('cadence/confirm/:contractId')
  @Roles('FAMILY_REP', 'ADMIN')
  @ApiOperation({
    summary: 'Gia đình xác nhận hàng loạt toàn bộ các mốc lịch định kỳ bác sĩ đã chốt',
  })
  @ApiParam({ name: 'contractId', description: 'ID của hợp đồng y tế' })
  @ApiResponse({ status: 200, description: 'Xác nhận toàn bộ lộ trình khám định kỳ thành công' })
  @ResponseMessage('Xác nhận toàn bộ lộ trình khám định kỳ thành công')
  confirmCadenceSchedule(
    @Req() req: AuthenticatedRequest,
    @Param('contractId') contractId: string,
  ) {
    return this.service.confirmCadenceSchedule(req.user, contractId);
  }

  @Patch('cadence/:id')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Bác sĩ điều chỉnh một mốc khám định kỳ trong khung lịch dự kiến',
  })
  @ApiParam({ name: 'id', description: 'ID của buổi khám định kỳ' })
  @ApiBody({ type: AdjustCadenceMilestoneDto })
  @ApiResponse({ status: 200, description: 'Cập nhật mốc khám định kỳ thành công' })
  @ResponseMessage('Cập nhật mốc khám định kỳ thành công')
  adjustCadenceMilestone(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AdjustCadenceMilestoneDto,
  ) {
    return this.service.adjustCadenceMilestone(req.user, id, dto);
  }

  @Post('cadence/backfill/:contractId')
  @Roles('DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Tạo bù khung lịch khám định kỳ cho hợp đồng đang ACTIVE chưa có lịch',
  })
  @ApiParam({ name: 'contractId', description: 'ID của hợp đồng y tế' })
  @ApiResponse({ status: 201, description: 'Tạo bù khung lịch định kỳ thành công' })
  @ResponseMessage('Tạo bù khung lịch định kỳ thành công')
  backfillCadence(
    @Req() req: AuthenticatedRequest,
    @Param('contractId') contractId: string,
  ) {
    return this.service.generateContractPeriodicCadence(contractId, {
      triggeredBy: req.user.id,
      force: false,
    });
  }
}
