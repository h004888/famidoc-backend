import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import { BypassTransform } from '../../../core/decorators/bypass-transform.decorator';
import { DEFAULT_MAX_DOCUMENT_BYTES } from '../../../core/validation/document-file.validator';
import {
  ConfirmVisitRecordDto,
  FamilyPrescriptionsDto,
  FamilyPrescriptionDateQuery,
  PrescriptionPageQuery,
  SaveVisitDraftDto,
  UploadBookDocumentDto,
} from '../dtos/share-prescription.dto';
import { MedicalBooksService } from '../services/medical-books.service';
import { PrescriptionsService } from '../services/prescriptions.service';

@ApiTags('Medical Books')
@ApiBearerAuth('JWT-auth')
@ApiExtraModels(UploadBookDocumentDto)
@Controller('api/v1/medical-books')
@Roles('DOCTOR', 'FAMILY_REP')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MedicalBooksController {
  constructor(
    private readonly books: MedicalBooksService,
    private readonly prescriptions: PrescriptionsService,
  ) {}

  @Get('families')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Danh sách sổ gia đình và thành viên theo quyền truy cập',
  })
  families(
    @Req() req: AuthenticatedRequest,
    @Query() query: PrescriptionPageQuery,
  ) {
    return this.books.families(req.user, query.page);
  }

  @Get('families/:familyId/prescription-visits')
  @Roles('DOCTOR')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Tổng hợp sổ khám của gia đình trong một ngày để kê đơn',
  })
  familyPrescriptionVisits(
    @Req() req: AuthenticatedRequest,
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Query() query: FamilyPrescriptionDateQuery,
  ) {
    return this.books.familyPrescriptionVisits(req.user, familyId, query.date);
  }

  @Post('families/:familyId/prescriptions')
  @Roles('DOCTOR')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Gửi đồng thời đơn gia đình, lưu thuốc riêng cho từng người và lần khám',
  })
  prescribeFamily(
    @Req() req: AuthenticatedRequest,
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Body() dto: FamilyPrescriptionsDto,
  ) {
    return this.prescriptions.prescribeFamily(req.user, familyId, dto);
  }

  @Get('families/:familyId/patients/:patientId/visits')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Lịch sử khám của từng thành viên' })
  patientVisits(
    @Req() req: AuthenticatedRequest,
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Query() query: PrescriptionPageQuery,
  ) {
    return this.books.patientVisits(req.user, familyId, patientId, query.page);
  }

  @Get('families/:familyId/patients/:patientId/documents')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Tài liệu y tế do gia đình cung cấp cho từng thành viên',
  })
  patientDocuments(
    @Req() req: AuthenticatedRequest,
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
  ) {
    return this.books.patientDocuments(req.user, familyId, patientId);
  }

  @Post('families/:familyId/patients/:patientId/documents')
  @Roles('FAMILY_REP')
  @Header('Cache-Control', 'private, no-store')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: DEFAULT_MAX_DOCUMENT_BYTES, files: 1, fields: 3 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      allOf: [
        { $ref: getSchemaPath(UploadBookDocumentDto) },
        {
          type: 'object',
          properties: { file: { type: 'string', format: 'binary' } },
          required: ['file'],
        },
      ],
    },
  })
  @ApiOperation({
    summary: 'Gia đình tải tài liệu lên sổ khám của từng thành viên',
  })
  uploadDocument(
    @Req() req: AuthenticatedRequest,
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Body() dto: UploadBookDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.books.uploadDocument(req.user, familyId, patientId, dto, file);
  }

  @Get('families/:familyId/patients/:patientId/documents/:id/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @BypassTransform()
  @ApiOperation({
    summary: 'Tải tệp hồ sơ y tế theo quyền truy cập của thành viên',
  })
  async downloadDocument(
    @Req() req: AuthenticatedRequest,
    @Param('familyId', ParseUUIDPipe) familyId: string,
    @Param('patientId', ParseUUIDPipe) patientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { bytes, extension } = await this.books.downloadDocument(
      req.user,
      familyId,
      patientId,
      id,
    );
    const type =
      extension === 'pdf'
        ? 'application/pdf'
        : extension === 'png'
          ? 'image/png'
          : 'image/jpeg';
    return new StreamableFile(bytes, {
      type,
      disposition: `attachment; filename="document.${extension}"`,
    });
  }

  @Get('visits/:id')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Nội dung trang khám, xác nhận và đơn thuốc nếu có',
  })
  visitDetail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('patientId') patientId?: string,
  ) {
    return this.books.visitDetail(req.user, id, patientId);
  }

  @Put('visits/:id/draft')
  @Roles('DOCTOR')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Bác sĩ lưu nháp nội dung khám từng bước cho một thành viên',
  })
  saveDraft(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveVisitDraftDto,
  ) {
    return this.prescriptions.saveVisitDraft(req.user, id, dto);
  }

  @Post('visits/:id/confirm')
  @Roles('DOCTOR')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Bác sĩ xác nhận nội bộ một trang khám và có thể gửi kèm đơn thuốc',
  })
  confirm(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmVisitRecordDto,
  ) {
    return this.prescriptions.confirmVisitRecord(req.user, id, dto);
  }
}
