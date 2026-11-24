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
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
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
  RequestTerminationDto,
  DecideTerminationDto,
} from '../dtos/contract-change.dto';
import {
  CreateStaffingContractDto,
  UpdateStaffingContractDto,
  SignStaffingContractDto,
  RejectStaffingContractDto,
  RequestStaffingTerminationDto,
  TerminateStaffingContractDto,
  StaffingTerminationImpactDto,
  ListStaffingContractsDto,
  StaffingContractResponseDto,
} from '../dtos/staffing-contract.dto';
import {
  CreateMedicalContractDto,
  CreateFourPartyContractDto,
  CancelDraftContractDto,
} from '../dtos/create-medical-contract.dto';
import { AssignDoctorToPackageDto } from '../dtos/assign-doctor.dto';
import { ListMedicalContractsQueryDto } from '../dtos/list-medical-contracts-query.dto';
import { CareNeedsSummaryDto } from '../dtos/care-needs-summary.dto';
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

  @Post(['four-party', 'medical'])
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'ADMIN')
  @ApiOperation({
    summary:
      'Khởi tạo hợp đồng dịch vụ y tế 4 bên ban đầu (STT 28 - UC-16, SD-16)',
    description:
      'Đại diện gia đình (hoặc Admin) tạo bản thảo hợp đồng y tế ban đầu ràng buộc 4 bên (Family, Facility, Doctor, Platform), snapshot quyền lợi gói và khởi tạo trạng thái PENDING_APPROVAL.',
  })
  @ApiBody({ type: CreateFourPartyContractDto })
  @ApiResponse({
    status: 201,
    description: 'Tạo bản thảo hợp đồng dịch vụ y tế 4 bên thành công.',
  })
  initiateFourPartyContract(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMedicalContractDto,
  ) {
    return this.service.initiateFourPartyContract(req.user, dto);
  }

  createInitialMedicalContract(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMedicalContractDto,
  ) {
    return this.initiateFourPartyContract(req, dto);
  }

  @Post('medical/:id/cancel-draft')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'ADMIN')
  @ApiOperation({
    summary:
      'Hủy bản nháp hợp đồng y tế 4 bên chưa thanh toán (tránh bản nháp trùng lặp)',
    description:
      'Đại diện hộ gia đình (hoặc Admin) hủy hợp đồng đang PENDING_APPROVAL/PENDING_PAYMENT chưa có hoá đơn PAID: chuyển hợp đồng sang TERMINATED và hủy các yêu cầu thanh toán VietQR PENDING kèm phong bì Documenso nếu còn mở.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng y tế' })
  @ApiBody({ type: CancelDraftContractDto, required: false })
  @ApiResponse({
    status: 201,
    description: 'Hủy bản nháp hợp đồng thành công.',
  })
  @ApiResponse({ status: 403, description: 'Không có quyền hủy hợp đồng này.' })
  @ApiResponse({
    status: 409,
    description: 'Hợp đồng đã ACTIVE/TERMINATED hoặc đã có giao dịch PAID.',
  })
  cancelDraftMedicalContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CancelDraftContractDto,
  ) {
    return this.service.cancelDraftMedicalContract(req.user, id, dto?.reason);
  }

  @Put(['four-party/:id/sign', 'medical/:id/sign', 'medical/:id/signatures'])
  @Post(['four-party/:id/sign', 'medical/:id/sign'])
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'ADMIN', 'HEALTHCARE_FACILITY', 'DOCTOR')
  @ApiOperation({
    summary:
      'Ký số điện tử hợp đồng y tế 4 bên ban đầu (STT 29 - UC-16, SD-16)',
    description:
      'Tuần tự ký số 4 bên: FAMILY_REP -> ADMIN -> HEALTHCARE_FACILITY -> ASSIGNED_DOCTOR. Sau khi đủ 4 chữ ký sẽ chuyển sang PENDING_PAYMENT.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng y tế' })
  @ApiBody({ type: SignContractChangeDto })
  @ApiResponse({
    status: 200,
    description: 'Ký số thành công.',
  })
  signFourPartyContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SignContractChangeDto,
  ) {
    return this.service.signFourPartyContract(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  signInitialMedicalContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SignContractChangeDto,
  ) {
    return this.signFourPartyContract(req, id, dto);
  }

  @Get('family/gate-status')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP')
  @ApiOperation({
    summary:
      'Kiểm tra trạng thái gói ACTIVE và hợp đồng đang chờ của hộ gia đình',
    description:
      'Dùng cho cổng bảo vệ khu vực quản trị gia đình (/family/*): chỉ mở khóa quản lý thành viên/đặt lịch/telemedicine khi có hợp đồng ACTIVE.',
  })
  getFamilyGateStatus(@Req() req: AuthenticatedRequest) {
    return this.service.getFamilyGateStatus(req.user);
  }

  @Post('four-party/preview-pdf')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP')
  @ApiOperation({
    summary:
      'Xem trước bản nháp PDF hợp đồng 4 bên (stateless, có watermark BẢN NHÁP)',
  })
  async previewFourPartyDraftPdf(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateMedicalContractDto,
    @Res() res: Response,
  ) {
    const pdfBuffer = await this.service.previewFourPartyDraftPdf(req.user, dto);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'inline; filename="hop-dong-ban-nhap.pdf"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(pdfBuffer);
  }

  @Get('medical/:id/signing-session')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'HEALTHCARE_FACILITY', 'DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Lấy phiên ký Documenso nhúng theo vai trò của người dùng hiện tại',
    description:
      'Bên A (FAMILY_REP) nhận signingToken ngay sau khi tạo; Bên B/C/D nhận signingToken song song sau khi Bên A hoàn tất ký (HTTP 409 nếu Bên A chưa ký).',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng y tế' })
  getSigningSession(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getSigningSession(req.user, id);
  }

  @Post('four-party/:id/sync-documenso')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'HEALTHCARE_FACILITY', 'DOCTOR', 'ADMIN')
  @ApiOperation({
    summary:
      'Đồng bộ trạng thái chữ ký trực tiếp từ Documenso sau khi ký trên giao diện nhúng',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng y tế' })
  syncDocumensoEnvelope(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.syncDocumensoEnvelope(
      req.user,
      id,
      req.ip ?? 'documenso-sync',
    );
  }

  @Post('four-party/:id/reject')
  @UseGuards(RolesGuard)
  @Roles('HEALTHCARE_FACILITY', 'DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Từ chối tiếp nhận hợp đồng đang chờ duyệt (PAID_PENDING_APPROVAL)',
  })
  rejectEscrowContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { reason?: string },
  ) {
    return this.service.rejectEscrowContract(req.user, id, body?.reason ?? '');
  }

  @Post('four-party/:id/replace-doctor')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP')
  @ApiOperation({
    summary: 'Đổi bác sĩ thay thế & bảo lưu 100% tiền tạm giữ (credit transfer)',
  })
  replaceDoctorWithCredit(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: { doctorId: string },
  ) {
    return this.service.replaceDoctorWithCredit(req.user, id, body.doctorId);
  }

  @Post('four-party/:id/refund-request')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP')
  @ApiOperation({
    summary: 'Gửi yêu cầu hoàn tiền 100% cho hợp đồng bị từ chối hoặc quá hạn 24h',
  })
  createRefundRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body()
    body: { bankName: string; accountNumber: string; accountHolder: string },
  ) {
    return this.service.createRefundRequest(req.user, id, body);
  }

  @Get('four-party/:id/refund-request')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'ADMIN')
  @ApiOperation({
    summary: 'Xem trạng thái yêu cầu hoàn tiền 100% của hợp đồng',
  })
  getRefundRequest(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getRefundRequest(req.user, id);
  }

  @Get('medical/:id/signed-pdf')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'HEALTHCARE_FACILITY', 'DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Tải hoặc xem tệp PDF hợp đồng đã ký qua proxy Documenso (bảo mật API key)',
    description:
      'Chỉ trả tệp PDF đã được Documenso đóng dấu khi hợp đồng có documensoItemId và đã hoàn tất đủ 4/4 chữ ký (FAMILY_REP, HEALTHCARE_FACILITY, ASSIGNED_DOCTOR, ADMIN) hoặc đã ở trạng thái PENDING_PAYMENT/ACTIVE.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng y tế' })
  @ApiResponse({
    status: 200,
    description:
      'Trả luồng dữ liệu application/pdf của hợp đồng đã ký đủ 4 bên.',
  })
  @ApiResponse({
    status: 404,
    description:
      'Không tìm thấy hợp đồng hoặc hợp đồng chưa có tệp trên Documenso.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Hợp đồng chưa hoàn tất đủ 4/4 chữ ký nên chưa thể xuất bản PDF đã ký.',
  })
  async downloadSignedPdf(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.downloadSignedPdf(
      req.user,
      id,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }

  @Patch(':id/assign-doctor')
  @UseGuards(RolesGuard)
  @Roles('HEALTHCARE_FACILITY', 'ADMIN')
  @ApiOperation({
    summary:
      'Phân công / Điều chuyển bác sĩ gia đình phụ trách hợp đồng (STT 30 - UC-23, SD-23)',
    description:
      'Cơ sở y tế (hoặc Admin) chỉ định hoặc điều chuyển bác sĩ gia đình chăm sóc cho hộ gia đình theo hợp đồng, kiểm soát giới hạn định biên tối đa 30 hộ/bác sĩ (BR-04, CFG-01).',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng y tế' })
  @ApiBody({ type: AssignDoctorToPackageDto })
  @ApiResponse({
    status: 200,
    description: 'Phân công bác sĩ cho hợp đồng thành công.',
  })
  @ApiResponse({
    status: 400,
    description: 'Bác sĩ không hợp lệ hoặc không thuộc cơ sở y tế này.',
  })
  @ApiResponse({
    status: 403,
    description:
      'Không có quyền phân công bác sĩ cho hợp đồng của cơ sở y tế khác.',
  })
  @ApiResponse({
    status: 409,
    description:
      'Bác sĩ đã đạt giới hạn tối đa 30 hộ gia đình (CFG-01, BR-04) hoặc hợp đồng đã kết thúc.',
  })
  assignDoctorToPackage(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AssignDoctorToPackageDto,
  ) {
    return this.service.assignDoctorToPackage(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get('medical')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'HEALTHCARE_FACILITY', 'DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Xem danh sách hợp đồng dịch vụ y tế 4 bên theo vai trò',
    description:
      'Lấy danh sách hợp đồng y tế phân quyền tự động theo vai trò (FAMILY_REP: hộ gia đình, HEALTHCARE_FACILITY: cơ sở y tế, DOCTOR: bác sĩ phụ trách, ADMIN: toàn bộ).',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách hợp đồng y tế phân trang thành công.',
  })
  listMedicalContracts(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListMedicalContractsQueryDto,
  ) {
    return this.service.listMedicalContracts(req.user, query);
  }

  @Get('medical/:id')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'HEALTHCARE_FACILITY', 'DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Xem chi tiết hợp đồng dịch vụ y tế 4 bên',
    description:
      'Lấy thông tin chi tiết hợp đồng gồm các bên liên quan, gói dịch vụ, danh sách thành viên gia đình được bảo trợ, chữ ký số và hóa đơn thanh toán.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng y tế' })
  @ApiResponse({
    status: 200,
    description: 'Chi tiết hợp đồng y tế 4 bên.',
  })
  @ApiResponse({
    status: 403,
    description: 'Không có quyền truy cập hợp đồng này.',
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy hợp đồng y tế.',
  })
  findMedicalContractById(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query('forceSync') forceSync?: string,
  ) {
    return this.service.findMedicalContractById(
      req.user,
      id,
      {
        forceSync: forceSync === '1' || forceSync === 'true',
      },
      req.ip ?? 'unknown',
    );
  }

  @Get('medical/:id/care-summary')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN', 'HEALTHCARE_FACILITY', 'FAMILY_REP')
  @ApiOperation({
    summary:
      'Tóm tắt nhu cầu chăm sóc sức khỏe của các thành viên trong hợp đồng',
    description:
      'Tổng hợp hồ sơ nhân khẩu, tiền sử dị ứng và tài liệu y tế bệnh án của các thành viên gia đình được bảo trợ trong hợp đồng y tế phục vụ bác sĩ gia đình thẩm định chuyên môn trước khi ký tiếp nhận.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng y tế' })
  @ApiResponse({
    status: 200,
    description: 'Báo cáo tổng hợp nhu cầu chăm sóc sức khỏe.',
    type: CareNeedsSummaryDto,
  })
  @ApiResponse({
    status: 403,
    description:
      'Bác sĩ không được phân công hoặc không có quyền truy cập hợp đồng này.',
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy hợp đồng y tế.',
  })
  getCareNeedsSummary(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getCareNeedsSummary(req.user, id);
  }

  @Get('medical/:id/document')
  @UseGuards(RolesGuard)
  @Roles('FAMILY_REP', 'HEALTHCARE_FACILITY', 'DOCTOR', 'ADMIN')
  @ApiOperation({
    summary: 'Kết xuất văn bản bản sao hợp đồng dịch vụ y tế điện tử 4 bên',
    description:
      'Kết xuất văn bản hợp đồng hoàn chỉnh (HTML/formatted view) kèm điều khoản snapshot và đầy đủ 4 chữ ký số điện tử của các bên tham gia.',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng y tế' })
  @ApiResponse({
    status: 200,
    description: 'Bản sao văn bản hợp đồng điện tử 4 bên kèm chữ ký số.',
  })
  @ApiResponse({
    status: 403,
    description: 'Không có quyền truy cập văn bản hợp đồng này.',
  })
  @ApiResponse({
    status: 404,
    description: 'Không tìm thấy hợp đồng y tế.',
  })
  getContractDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getContractDocument(req.user, id);
  }

  @Post('staffing')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Thiết lập hợp đồng cung ứng nhân lực y tế B2B (STT 13 - UC-15)',
    description:
      'Quản trị viên khởi tạo hợp đồng khung cung ứng nhân lực y tế với Cơ sở y tế đã ACTIVE, tự động kết xuất PDF và khởi tạo Envelope Documenso ký tuần tự 2 bên.',
  })
  @ApiBody({ type: CreateStaffingContractDto })
  @ApiResponse({
    status: 201,
    description: 'Tạo hợp đồng nhân lực B2B thành công, chờ CSYT xem xét và ký số.',
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

  @Patch('staffing/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Chỉnh sửa trực tiếp hợp đồng B2B và gửi lại CSYT xem xét ký lại',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  @ApiBody({ type: UpdateStaffingContractDto })
  @ApiResponse({ status: 200, type: StaffingContractResponseDto })
  updateStaffingContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateStaffingContractDto,
  ) {
    return this.service.updateStaffingContract(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Put('staffing/:id/sign')
  @Post('staffing/:id/sign')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'Ký số điện tử hợp đồng cung ứng nhân lực B2B (tuần tự CSYT -> Admin)',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  @ApiBody({ type: SignStaffingContractDto })
  @ApiResponse({
    status: 200,
    description: 'Ký số thành công.',
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

  @Patch('staffing/:id/request-revision')
  @UseGuards(RolesGuard)
  @Roles('HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'CSYT yêu cầu chỉnh sửa hợp đồng B2B (chuyển sang REVISION_REQUESTED)',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  @ApiBody({ type: RejectStaffingContractDto })
  @ApiResponse({ status: 200, type: StaffingContractResponseDto })
  requestStaffingRevision(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RejectStaffingContractDto,
  ) {
    return this.service.requestStaffingRevision(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Patch('staffing/:id/reject')
  @UseGuards(RolesGuard)
  @Roles('HEALTHCARE_FACILITY')
  @ApiOperation({
    summary:
      'Alias yêu cầu chỉnh sửa hợp đồng cung ứng nhân lực B2B (chuyển REVISION_REQUESTED)',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  @ApiBody({ type: RejectStaffingContractDto })
  @ApiResponse({
    status: 200,
    description: 'Đã chuyển trạng thái hợp đồng sang REVISION_REQUESTED và gửi lý do cho Admin.',
    type: StaffingContractResponseDto,
  })
  rejectStaffingContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RejectStaffingContractDto,
  ) {
    return this.service.rejectStaffingContract(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get('staffing/:id/signing-session')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'Lấy phiên ký Documenso nhúng cho hợp đồng B2B (ký tuần tự CSYT -> Admin)',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  getStaffingSigningSession(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getStaffingSigningSession(req.user, id);
  }

  @Post('staffing/:id/sync-documenso')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'Đồng bộ trạng thái chữ ký Documenso của hợp đồng B2B',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  syncStaffingDocumensoEnvelope(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.syncStaffingDocumensoEnvelope(
      req.user,
      id,
      req.ip ?? 'documenso-sync',
    );
  }

  @Get('staffing/:id/signed-pdf')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'Tải hoặc xem PDF hợp đồng B2B đã ký đủ 2 bên qua proxy Documenso',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  async downloadStaffingSignedPdf(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.service.downloadStaffingSignedPdf(
      req.user,
      id,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('staffing/:id/termination-impact')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'HEALTHCARE_FACILITY')
  @ApiOperation({
    summary:
      'Kiểm tra danh sách phụ thuộc đang hoạt động trước khi chấm dứt hợp đồng B2B',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  @ApiResponse({ status: 200, type: StaffingTerminationImpactDto })
  getStaffingTerminationImpact(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.service.getStaffingTerminationImpact(req.user, id);
  }

  @Post('staffing/:id/termination-request')
  @UseGuards(RolesGuard)
  @Roles('HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'CSYT gửi yêu cầu đề nghị chấm dứt hợp đồng B2B đang ACTIVE',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  @ApiBody({ type: RequestStaffingTerminationDto })
  @ApiResponse({ status: 200, type: StaffingContractResponseDto })
  requestStaffingTermination(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RequestStaffingTerminationDto,
  ) {
    return this.service.requestStaffingTermination(
      req.user,
      id,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Patch('staffing/:id/terminate')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary:
      'Admin hủy dự thảo hoặc chấm dứt hợp đồng B2B có kiểm tra ràng buộc vận hành',
  })
  @ApiParam({ name: 'id', description: 'UUID của hợp đồng cung ứng nhân lực' })
  @ApiBody({ type: TerminateStaffingContractDto })
  @ApiResponse({ status: 200, type: StaffingContractResponseDto })
  terminateStaffingContract(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: TerminateStaffingContractDto,
  ) {
    return this.service.terminateStaffingContract(
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
  @ApiBody({ type: RequestTerminationDto })
  @ApiResponse({
    status: 200,
    description: 'Tiếp nhận yêu cầu chấm dứt hợp đồng',
  })
  requestTermination(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: RequestTerminationDto,
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
  @ApiBody({ type: DecideTerminationDto })
  @ApiResponse({
    status: 200,
    description: 'Quyết định chấm dứt hợp đồng thành công',
  })
  decideTermination(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: DecideTerminationDto,
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
