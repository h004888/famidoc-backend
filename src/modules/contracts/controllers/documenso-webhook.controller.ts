import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  DocumensoSyncService,
  type DocumensoWebhookBody,
} from '../services/documenso-sync.service';

@ApiTags('Webhooks')
@Controller('api/v1/webhooks/documenso')
export class DocumensoWebhookController {
  constructor(private readonly documensoSyncService: DocumensoSyncService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Nhận webhook ký kết hợp đồng 4 bên từ self-hosted Documenso',
    description:
      'Xác thực hằng thời gian qua header X-Documenso-Secret (timingSafeEqual), ghi nhận chữ ký idempotent và kích hoạt PENDING_PAYMENT khi đủ 4 bên.',
  })
  @ApiResponse({
    status: 200,
    description: 'Đã xử lý hoặc bỏ qua sự kiện webhook hợp lệ.',
  })
  @ApiResponse({
    status: 401,
    description: 'Thiếu hoặc sai secret xác thực X-Documenso-Secret.',
  })
  handleDocumensoWebhook(
    @Req() req: Request,
    @Headers('x-documenso-secret') secretHeader: string | undefined,
    @Body() payload: DocumensoWebhookBody,
  ) {
    return this.documensoSyncService.handleWebhook(
      secretHeader,
      payload,
      req.ip ?? 'documenso-webhook',
    );
  }
}
