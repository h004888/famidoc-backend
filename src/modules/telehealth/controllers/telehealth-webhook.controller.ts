import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { TelehealthService } from '../services/telehealth.service';

@ApiTags('Webhooks')
@Controller('api/v1/webhooks/livekit')
export class TelehealthWebhookController {
  constructor(private readonly telehealthService: TelehealthService) {}

  @Post()
  @SetMetadata('isPublic', true)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhận webhook vòng đời phòng LiveKit' })
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('authorization') authHeader?: string,
  ) {
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    try {
      return await this.telehealthService.handleWebhookEvent(rawBody, authHeader);
    } catch {
      throw new UnauthorizedException('Chữ ký webhook LiveKit không hợp lệ.');
    }
  }
}
