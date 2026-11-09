import {
  Body,
  Controller,
  Inject,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SePayWebhookDto } from '../dtos/sepay-webhook.dto';
import { SePayWebhookGuard } from '../guards/sepay-webhook.guard';
import { paymentsValidationPipe } from '../payments-validation.pipe';
import {
  PAYMENTS_SERVICE_TOKEN,
  type IPaymentsService,
} from '../services/interfaces/payments.service.interface';

@ApiTags('Webhooks')
@Controller()
@UseGuards(SePayWebhookGuard)
@UsePipes(paymentsValidationPipe)
export class SePayWebhookController {
  constructor(
    @Inject(PAYMENTS_SERVICE_TOKEN) private readonly service: IPaymentsService,
  ) {}

  @Post(['webhooks/sepay/test', 'api/v1/payments/webhook/vietqr'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhận và xử lý IPN Webhook tự động từ cổng thanh toán SePay' })
  @ApiBody({ type: SePayWebhookDto })
  @ApiResponse({ status: 200, description: 'Đã nhận và xử lý giao dịch thành công' })
  @ApiResponse({ status: 401, description: 'Xác thực webhook API Key hoặc chữ ký HMAC không hợp lệ' })
  async handleVietQRWebhook(@Body() dto: SePayWebhookDto) {
    // Guard đã xác thực chữ ký hoặc API key. Bản tin gửi thử chỉ cần xác nhận đã nhận.
    if (dto.id === 0) return { success: true };

    // Chỉ ACK sau khi giao dịch cùng trạng thái liên quan đã ghi xong trong transaction.
    // success chỉ nghĩa là đã nhận/xử lý, không có nghĩa mọi giao dịch đều được ghép thanh toán.
    await this.service.handleVietQRWebhook(dto);
    return { success: true };
  }
}
