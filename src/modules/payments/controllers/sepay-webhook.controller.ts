import {
  Body,
  Controller,
  Inject,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseFilters,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { BypassTransform } from '../../../core/decorators/bypass-transform.decorator';
import { SePayWebhookDto } from '../dtos/sepay-webhook.dto';
import { TransactionOutcome } from '../entities/payment.entity';
import { SePayWebhookGuard } from '../guards/sepay-webhook.guard';
import { SePayWebhookEvents, SePayWebhookExceptionFilter } from '../sepay/sepay-webhook-events';
import {
  PAYMENTS_SERVICE_TOKEN,
  type IPaymentsService,
} from '../services/interfaces/payments.service.interface';

const sepayWebhookValidationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: false,
  transform: true,
});

@ApiTags('Webhooks')
@Controller()
@BypassTransform()
@UseGuards(SePayWebhookGuard)
@UseFilters(SePayWebhookExceptionFilter)
@UsePipes(sepayWebhookValidationPipe)
export class SePayWebhookController {
  constructor(
    @Inject(PAYMENTS_SERVICE_TOKEN) private readonly service: IPaymentsService,
    private readonly events: SePayWebhookEvents,
  ) {}

  @Post(['webhooks/sepay/test', 'api/v1/payments/webhook/vietqr'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhận và xử lý IPN Webhook tự động từ cổng thanh toán SePay' })
  @ApiBody({ type: SePayWebhookDto })
  @ApiResponse({ status: 200, description: 'Đã nhận và xử lý giao dịch thành công' })
  @ApiResponse({ status: 401, description: 'Xác thực webhook API Key hoặc chữ ký HMAC không hợp lệ' })
  async handleVietQRWebhook(@Body() dto: SePayWebhookDto, @Res({ passthrough: true }) response: Response) {
    const providerTransactionId = String(dto.id);
    response.locals.sepayWebhookTransactionId = providerTransactionId;
    const result = dto.id === 0 ? undefined : await this.service.handleVietQRWebhook(dto);
    await this.events.recordDelivery(providerTransactionId, result);
    const success = dto.id === 0 ? true : result?.transaction.outcome === TransactionOutcome.MATCHED;
    return { success };
  }
}
