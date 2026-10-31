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
import { SePayWebhookDto } from '../dtos/sepay-webhook.dto';
import { SePayWebhookGuard } from '../guards/sepay-webhook.guard';
import { paymentsValidationPipe } from '../payments-validation.pipe';
import {
  PAYMENTS_SERVICE_TOKEN,
  type IPaymentsService,
} from '../services/interfaces/payments.service.interface';

@Controller()
@UseGuards(SePayWebhookGuard)
@UsePipes(paymentsValidationPipe)
export class SePayWebhookController {
  constructor(
    @Inject(PAYMENTS_SERVICE_TOKEN) private readonly service: IPaymentsService,
  ) {}

  @Post(['webhooks/sepay/test', 'api/v1/payments/webhook/vietqr'])
  @HttpCode(HttpStatus.OK)
  // Xác thực theo tài liệu SePay. Chỉ ACK sau khi transaction DB đã commit.
  async handleVietQRWebhook(@Body() dto: SePayWebhookDto) {
    // Chỉ ACK sau khi giao dịch cùng trạng thái liên quan đã ghi xong trong transaction.
    // success chỉ nghĩa là đã nhận/xử lý, không có nghĩa mọi giao dịch đều được ghép thanh toán.
    await this.service.handleVietQRWebhook(dto);
    return { success: true };
  }
}
