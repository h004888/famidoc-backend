import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import { CreateTelehealthMessageDto, ReportTelemetryDto } from '../dto/telehealth.dto';
import { TelehealthService } from '../services/telehealth.service';
import type { TelehealthActor } from '../services/telehealth.service';

@ApiTags('Telehealth')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('FAMILY_REP', 'DOCTOR')
@Controller('api/v1/telehealth/sessions')
export class TelehealthController {
  constructor(private readonly telehealthService: TelehealthService) {}

  @Post(':encounterId/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cấp LiveKit token và khởi tạo/tái sử dụng phiên khám Telehealth' })
  issueToken(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Req() req: { user: TelehealthActor },
  ) {
    return this.telehealthService.issueSessionToken(encounterId, req.user);
  }

  @Post(':encounterId/telemetry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cập nhật chất lượng mạng và trạng thái fallback chat của phiên' })
  reportTelemetry(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Req() req: { user: TelehealthActor },
    @Body() dto: ReportTelemetryDto,
  ) {
    return this.telehealthService.reportTelemetry(encounterId, req.user, dto);
  }

  @Post(':encounterId/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Kết thúc phiên khám Telehealth và lưu thời lượng' })
  endSession(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Req() req: { user: TelehealthActor },
  ) {
    return this.telehealthService.endSession(encounterId, req.user);
  }

  @Get(':encounterId/messages')
  @ApiOperation({ summary: 'Lấy danh sách tin nhắn y tế trong phiên khám' })
  listMessages(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Req() req: { user: TelehealthActor },
    @Query('after') afterMessageId?: string,
  ) {
    return this.telehealthService.listMessages(encounterId, req.user, afterMessageId);
  }

  @Post(':encounterId/messages')
  @ApiOperation({ summary: 'Gửi tin nhắn văn bản trong phiên khám' })
  sendMessage(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Req() req: { user: TelehealthActor },
    @Body() dto: CreateTelehealthMessageDto,
  ) {
    return this.telehealthService.sendMessage(encounterId, req.user, dto.content);
  }

  @Post(':encounterId/messages/attachment')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  @ApiOperation({ summary: 'Tải lên ảnh máy đo hoặc tài liệu y tế trong phiên khám' })
  uploadAttachment(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Req() req: { user: TelehealthActor },
    @UploadedFile() file?: Express.Multer.File,
    @Body('caption') caption?: string,
  ) {
    return this.telehealthService.uploadAttachment(encounterId, req.user, file, caption);
  }

  @Get(':encounterId/messages/:messageId/attachment')
  @ApiOperation({ summary: 'Tải hoặc xem trước tệp đính kèm trong phiên khám' })
  async downloadAttachment(
    @Param('encounterId', ParseUUIDPipe) encounterId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Req() req: { user: TelehealthActor },
    @Res() res: Response,
  ) {
    const result = await this.telehealthService.downloadAttachment(encounterId, messageId, req.user);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(result.fileName)}"`,
    );
    res.send(result.buffer);
  }
}
