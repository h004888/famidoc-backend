import {
  type ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BypassTransform } from '../../../core/decorators/bypass-transform.decorator';
import { StandardApiResponseFilter } from '../../../core/filters/standard-api-response.filter';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { RolesGuard, Roles } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';
import { ProvisionDoctorDto } from '../dtos/provision-doctor.dto';
import {
  ConfirmBulkImportDoctorsDto,
  MAX_BULK_IMPORT_FILE_BYTES,
} from '../dtos/bulk-import-doctors.dto';
import { DoctorResponseDto } from '../dtos/doctor-response.dto';
import { ListDoctorsQueryDto } from '../dtos/list-doctors-query.dto';
import {
  DOCTORS_SERVICE_TOKEN,
  type IDoctorsService,
} from '../services/interfaces/doctors.service.interface';

@Catch(PayloadTooLargeException)
export class ExcelUploadSizeFilter extends StandardApiResponseFilter {
  override catch(_exception: PayloadTooLargeException, host: ArgumentsHost) {
    super.catch(
      new BadRequestException(
        'Dung lượng file Excel vượt quá giới hạn tối đa 2MB',
      ),
      host,
    );
  }
}

@ApiTags('Doctors & Facilities Management')
@ApiBearerAuth('JWT-auth')
@Controller(['api/v1/facilities/doctors', 'api/v1/facilities'])
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
  }),
)
export class FacilitiesDoctorsController {
  constructor(
    @Inject(DOCTORS_SERVICE_TOKEN)
    private readonly service: IDoctorsService,
  ) {}

  @Post(['', ':id/doctors'])
  @Roles('HEALTHCARE_FACILITY')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cơ sở y tế khởi tạo tài khoản Bác sĩ trực thuộc (STT 15 - UC-20)',
    description:
      'Chỉ Cơ sở y tế đối tác mới có quyền tạo tài khoản cho bác sĩ trực thuộc đơn vị mình, thiết lập chuyên khoa, số năm kinh nghiệm và liên kết vào danh sách nhân sự của cơ sở.',
  })
  @ApiBody({ type: ProvisionDoctorDto })
  @ApiResponse({
    status: 201,
    description: 'Khởi tạo tài khoản bác sĩ thành công.',
    type: DoctorResponseDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'Email hoặc số điện thoại của bác sĩ đã tồn tại trên hệ thống.',
  })
  provisionDoctorAccount(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ProvisionDoctorDto,
  ): Promise<DoctorResponseDto> {
    return this.service.provisionDoctorAccount(
      req.user,
      dto,
      req.ip ?? 'unknown',
    );
  }

  @Get(['', ':id/doctors'])
  @Roles('HEALTHCARE_FACILITY')
  @ApiOperation({
    summary: 'Cơ sở y tế xem danh sách Bác sĩ trực thuộc đơn vị mình',
    description:
      'Cơ sở y tế xem danh sách nhân sự bác sĩ trực thuộc để theo dõi tiến độ nộp bằng cấp chứng chỉ (PENDING_SUBMISSION) và thẩm định Cấp 1.',
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách bác sĩ trực thuộc kèm phân trang.',
  })
  listFacilityDoctors(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListDoctorsQueryDto,
  ) {
    return this.service.listFacilityDoctors(req.user, query);
  }

  @Get(['import/template', ':id/doctors/import/template'])
  @Roles('HEALTHCARE_FACILITY')
  @BypassTransform()
  @ApiOperation({
    summary: 'Cơ sở y tế tải file Excel mẫu (.xlsx) để import hàng loạt bác sĩ',
  })
  @ApiResponse({
    status: 200,
    description: 'Tải file Excel mẫu thành công.',
  })
  async downloadDoctorImportTemplate(
    @Req() req: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    const buffer = await this.service.generateDoctorImportTemplate(req.user);
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="mau-import-bac-si-famidoc.xlsx"',
    });
  }

  @Post(['import/preview', ':id/doctors/import/preview'])
  @Roles('HEALTHCARE_FACILITY')
  @HttpCode(HttpStatus.OK)
  @UseFilters(ExcelUploadSizeFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: MAX_BULK_IMPORT_FILE_BYTES * 2,
        files: 1,
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Cơ sở y tế tải file Excel (.xlsx) để kiểm tra xem trước 3 trạng thái trước khi import bác sĩ',
  })
  @ApiResponse({
    status: 200,
    description: 'Phân tích và kiểm tra hợp lệ danh sách bác sĩ thành công.',
  })
  previewDoctorsImport(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.service.previewDoctorsExcelImport(req.user, file);
  }

  @Post(['import/confirm', ':id/doctors/import/confirm'])
  @Roles('HEALTHCARE_FACILITY')
  @HttpCode(HttpStatus.CREATED)
  @ApiBody({ type: ConfirmBulkImportDoctorsDto })
  @ApiOperation({
    summary:
      'Cơ sở y tế xác nhận khởi tạo hàng loạt một phần (tối đa 30 bác sĩ mới/lượt) từ danh sách hợp lệ',
  })
  @ApiResponse({
    status: 201,
    description: 'Thực thi khởi tạo hàng loạt tài khoản bác sĩ.',
  })
  confirmDoctorsImport(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ConfirmBulkImportDoctorsDto,
  ) {
    return this.service.confirmDoctorsBulkImport(
      req.user,
      dto,
      req.ip ?? 'unknown',
    );
  }
}
