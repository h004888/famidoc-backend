import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DEFAULT_MAX_DOCUMENT_BYTES } from '../../../core/validation/document-file.validator';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import { BypassTransform } from '../../../core/decorators/bypass-transform.decorator';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import {
  PATIENTS_SERVICE_TOKEN,
  type IPatientsService,
} from '../services/interfaces/patients.service.interface';
import { CreatePatientDto } from '../dtos/create-patient.dto';
import { UpdatePatientDto } from '../dtos/update-patient.dto';
import { CreateAllergyDto } from '../dtos/create-allergy.dto';
import { CreateChronicConditionDto } from '../dtos/create-chronic-condition.dto';
import { UpdateChronicConditionDto } from '../dtos/update-chronic-condition.dto';
import { CreatePatientDocumentDto } from '../dtos/create-patient-document.dto';
import { CreateVitalSignDto } from '../dtos/create-vital-sign.dto';
import { UpdateVitalSignDto } from '../dtos/update-vital-sign.dto';

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

  @Delete(':id')
  @ApiOperation({ summary: 'Tách thành viên khỏi danh sách hoạt động của hộ gia đình (soft-deactivate)' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 200, description: 'Đã tách thành viên và hoàn trả suất thành viên trong gói' })
  @ApiResponse({ status: 400, description: 'Không thể tách chủ hộ hoặc thành viên đã tách trước đó' })
  @ApiResponse({ status: 403, description: 'Không có quyền thao tác hồ sơ ngoài gia đình' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy hồ sơ bệnh nhân' })
  detachPatient(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.detachPatient(req.user, id);
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
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: DEFAULT_MAX_DOCUMENT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiOperation({ summary: 'Tải lên tệp/ảnh hoặc liên kết tài liệu y tế (đơn thuốc, xét nghiệm, chẩn đoán hình ảnh...)' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 201, description: 'Đính kèm tài liệu y tế thành công' })
  @ApiResponse({ status: 400, description: 'Tệp không hợp lệ hoặc thiếu thông tin' })
  @ApiResponse({ status: 403, description: 'Không có quyền đính kèm cho bệnh nhân ngoài gia đình' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy hồ sơ bệnh nhân' })
  addDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreatePatientDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.addDocument(req.user, id, dto, file);
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

  @Get(':id/documents/:documentId/file')
  @BypassTransform()
  @ApiOperation({ summary: 'Tải hoặc xem trực tiếp tệp/ảnh tài liệu y tế đã lưu trong kho nội bộ' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiParam({ name: 'documentId', description: 'UUID của tài liệu' })
  @ApiResponse({ status: 200, description: 'Luồng dữ liệu tệp tài liệu' })
  @ApiResponse({ status: 403, description: 'Không có quyền truy cập tài liệu ngoài gia đình' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy tài liệu hoặc tệp trên kho lưu trữ' })
  async getDocumentFile(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, contentType, contentLength } =
      await this.service.getDocumentFileStream(req.user, id, documentId);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (typeof contentLength === 'number') {
      res.setHeader('Content-Length', String(contentLength));
    }
    return new StreamableFile(stream);
  }

  @Delete(':id/documents/:documentId')
  @ApiOperation({ summary: 'Xóa tài liệu y tế của bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiParam({ name: 'documentId', description: 'UUID của tài liệu' })
  @ApiResponse({ status: 200, description: 'Đã xóa tài liệu y tế' })
  @ApiResponse({ status: 403, description: 'Không có quyền xóa tài liệu ngoài gia đình' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy tài liệu' })
  deleteDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.service.deleteDocument(req.user, id, documentId);
  }

  @Delete(':id/allergies/:allergyId')
  @ApiOperation({ summary: 'Xóa một thông tin dị ứng của bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiParam({ name: 'allergyId', description: 'UUID của bản ghi dị ứng' })
  @ApiResponse({ status: 200, description: 'Đã xóa thông tin dị ứng' })
  @ApiResponse({ status: 403, description: 'Không có quyền thao tác hồ sơ ngoài gia đình' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy bản ghi dị ứng' })
  deleteAllergy(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('allergyId') allergyId: string,
  ) {
    return this.service.deleteAllergy(req.user, id, allergyId);
  }

  @Post(':id/chronic-conditions')
  @ApiOperation({ summary: 'Thêm bệnh nền có cấu trúc cho bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 201, description: 'Thêm bệnh nền thành công' })
  addChronicCondition(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreateChronicConditionDto,
  ) {
    return this.service.addChronicCondition(req.user, id, dto);
  }

  @Get(':id/chronic-conditions')
  @ApiOperation({ summary: 'Lấy danh sách bệnh nền có cấu trúc của bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 200, description: 'Danh sách bệnh nền' })
  listChronicConditions(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.service.listChronicConditions(req.user, id);
  }

  @Put(':id/chronic-conditions/:conditionId')
  @ApiOperation({ summary: 'Cập nhật bệnh nền có cấu trúc của bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiParam({ name: 'conditionId', description: 'UUID của bản ghi bệnh nền' })
  @ApiResponse({ status: 200, description: 'Cập nhật bệnh nền thành công' })
  updateChronicCondition(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('conditionId') conditionId: string,
    @Body() dto: UpdateChronicConditionDto,
  ) {
    return this.service.updateChronicCondition(req.user, id, conditionId, dto);
  }

  @Delete(':id/chronic-conditions/:conditionId')
  @ApiOperation({ summary: 'Xóa bệnh nền có cấu trúc của bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiParam({ name: 'conditionId', description: 'UUID của bản ghi bệnh nền' })
  @ApiResponse({ status: 200, description: 'Đã xóa bệnh nền' })
  deleteChronicCondition(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('conditionId') conditionId: string,
  ) {
    return this.service.deleteChronicCondition(req.user, id, conditionId);
  }

  @Get(':id/vital-signs')
  @ApiOperation({ summary: 'Lấy lịch sử chỉ số sinh tồn của bệnh nhân' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiQuery({ name: 'days', required: false, description: 'Số ngày gần nhất (1..90, mặc định 30)' })
  @ApiResponse({ status: 200, description: 'Danh sách chỉ số sinh tồn' })
  listVitalSigns(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    const parsedDays = days !== undefined ? Number(days) : undefined;
    return this.service.listVitalSigns(req.user, id, parsedDays);
  }

  @Post(':id/vital-signs')
  @ApiOperation({ summary: 'Gia đình ghi nhận chỉ số sinh tồn trong ngày cho thành viên' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiResponse({ status: 201, description: 'Lưu chỉ số sinh tồn thành công' })
  addVitalSign(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: CreateVitalSignDto,
  ) {
    return this.service.addVitalSign(req.user, id, dto);
  }

  @Put(':id/vital-signs/:vitalId')
  @ApiOperation({ summary: 'Chỉnh sửa chỉ số sinh tồn do gia đình tự ghi nhận' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiParam({ name: 'vitalId', description: 'UUID của bản ghi chỉ số sinh tồn' })
  @ApiResponse({ status: 200, description: 'Cập nhật chỉ số sinh tồn thành công' })
  updateVitalSign(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('vitalId') vitalId: string,
    @Body() dto: UpdateVitalSignDto,
  ) {
    return this.service.updateVitalSign(req.user, id, vitalId, dto);
  }

  @Delete(':id/vital-signs/:vitalId')
  @ApiOperation({ summary: 'Xóa chỉ số sinh tồn do gia đình tự ghi nhận' })
  @ApiParam({ name: 'id', description: 'UUID của bệnh nhân' })
  @ApiParam({ name: 'vitalId', description: 'UUID của bản ghi chỉ số sinh tồn' })
  @ApiResponse({ status: 200, description: 'Đã xóa chỉ số sinh tồn' })
  deleteVitalSign(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('vitalId') vitalId: string,
  ) {
    return this.service.deleteVitalSign(req.user, id, vitalId);
  }
}
