import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import {
  PATIENTS_SERVICE_TOKEN,
  type IPatientsService,
} from '../services/interfaces/patients.service.interface';
import { CreatePatientDto } from '../dtos/create-patient.dto';
import { UpdatePatientDto } from '../dtos/update-patient.dto';
import { CreateAllergyDto } from '../dtos/create-allergy.dto';
import { CreatePatientDocumentDto } from '../dtos/create-patient-document.dto';

@ApiTags('Patients')
@ApiBearerAuth('JWT-auth')
@Controller('api/v1/patients')
@Roles('FAMILY_REP', 'ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class PatientsController {
  constructor(
    @Inject(PATIENTS_SERVICE_TOKEN)
    private readonly service: IPatientsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Thêm hồ sơ thành viên gia đình (bệnh nhân)' })
  @ApiResponse({ status: 201, description: 'Tạo hồ sơ bệnh nhân thành công' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  @ApiResponse({ status: 403, description: 'Không có quyền thao tác' })
  createPatient(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreatePatientDto,
  ) {
    return this.service.createPatient(req.user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách thành viên trong hộ gia đình' })
  @ApiResponse({ status: 200, description: 'Danh sách thành viên' })
  @ApiResponse({ status: 403, description: 'Không có quyền truy cập' })
  listFamilyMembers(@Req() req: AuthenticatedRequest) {
    return this.service.listFamilyMembers(req.user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Xem chi tiết hồ sơ bệnh nhân kèm tiền sử dị ứng và tài liệu' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 200, description: 'Chi tiết hồ sơ bệnh nhân' })
  @ApiResponse({ status: 403, description: 'Không có quyền truy cập hồ sơ của gia đình khác' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy hồ sơ bệnh nhân' })
  getPatientById(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.getPatientById(req.user, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Cập nhật thông tin hồ sơ bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 200, description: 'Cập nhật hồ sơ bệnh nhân thành công' })
  @ApiResponse({ status: 403, description: 'Không có quyền chỉnh sửa hồ sơ ngoài gia đình' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy hồ sơ bệnh nhân' })
  updatePatient(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
  ) {
    return this.service.updatePatient(req.user, id, dto);
  }

  @Post(':id/allergies')
  @ApiOperation({ summary: 'Khai báo dị ứng thuốc, thực phẩm hoặc môi trường cho bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 201, description: 'Khai báo dị ứng thành công' })
  @ApiResponse({ status: 403, description: 'Không có quyền khai báo cho bệnh nhân ngoài gia đình' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy hồ sơ bệnh nhân' })
  addAllergy(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreateAllergyDto,
  ) {
    return this.service.addAllergy(req.user, id, dto);
  }

  @Get(':id/allergies')
  @ApiOperation({ summary: 'Lấy danh sách tiền sử dị ứng của bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 200, description: 'Danh sách tiền sử dị ứng' })
  @ApiResponse({ status: 403, description: 'Không có quyền xem dị ứng ngoài gia đình' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy hồ sơ bệnh nhân' })
  listAllergies(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.listAllergies(req.user, id);
  }

  @Post(':id/documents')
  @ApiOperation({ summary: 'Đính kèm tài liệu y tế ban đầu (xét nghiệm, kết quả chẩn đoán hình ảnh...)' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 201, description: 'Đính kèm tài liệu y tế thành công' })
  @ApiResponse({ status: 403, description: 'Không có quyền đính kèm cho bệnh nhân ngoài gia đình' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy hồ sơ bệnh nhân' })
  addDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreatePatientDocumentDto,
  ) {
    return this.service.addDocument(req.user, id, dto);
  }

  @Get(':id/documents')
  @ApiOperation({ summary: 'Lấy danh sách tài liệu y tế của bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 200, description: 'Danh sách tài liệu y tế' })
  @ApiResponse({ status: 403, description: 'Không có quyền xem tài liệu ngoài gia đình' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy hồ sơ bệnh nhân' })
  listDocuments(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.listDocuments(req.user, id);
  }
}
