import {
  Body,
  Optional,
  Req,
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
import type { Response, Request } from 'express';
import { PaymentConfigurationTestService } from '../settings/payment-configuration-test.service';
import { PaymentsConfig } from '../payments.config';
import { parseSePayDate } from '../sepay/sepay-transaction.helpers';
import type { VerifiedPaymentContext } from '../guards/sepay-webhook.guard';
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
    @Optional() private readonly tests?: PaymentConfigurationTestService,
    @Optional() private readonly config?: PaymentsConfig,
  ) {}

  @Post(['webhooks/sepay/test', 'api/v1/payments/webhook/vietqr'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nhận và xử lý IPN Webhook tự động từ cổng thanh toán SePay' })
  @ApiBody({ type: SePayWebhookDto })
  @ApiResponse({ status: 200, description: 'Đã nhận và xử lý giao dịch thành công' })
  @ApiResponse({ status: 401, description: 'Xác thực webhook API Key hoặc chữ ký HMAC không hợp lệ' })
  async handleVietQRWebhook(@Body() dto: SePayWebhookDto, @Res({ passthrough: true }) response: Response, @Req() req?: Request & { verifiedPaymentContext?: VerifiedPaymentContext }) {
    const providerTransactionId = String(dto.id);
    response.locals.sepayWebhookTransactionId = providerTransactionId;
    if (dto.id !== 0 && this.tests && this.config) {
      const result = await this.tests.dispatch({ environment: this.config.getEnvironment(), source: 'WEBHOOK', providerTransactionId,
        gateway: dto.gateway, accountNumber: dto.accountNumber, amountVnd: dto.transferAmount, text: `${dto.code ?? ''} ${dto.content}`,
        transactionAt: parseSePayDate(dto.transactionDate), transferType: dto.transferType, verified: req?.verifiedPaymentContext });
      if (result.handled) return { success: Boolean(result.success) };
    }
    const result = dto.id === 0 ? undefined : await this.service.handleVietQRWebhook(dto);
    await this.events.recordDelivery(providerTransactionId, result);
    const success = dto.id === 0 ? true : result?.transaction.outcome === TransactionOutcome.MATCHED;
    return { success };
  }
}
