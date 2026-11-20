import {
  ArgumentsHost,
  Catch,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../../../core/database/prisma.service';
import { StandardApiResponseFilter } from '../../../core/filters/standard-api-response.filter';
import type { PaymentTransactionResult } from '../entities/payment.entity';

const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

export class SePayWebhookEventsQuery {
  @IsIn(['TEST', 'LIVE'])
  environment: 'TEST' | 'LIVE' = 'LIVE';

  @IsOptional()
  @IsIn(['SUCCESS', 'ERROR'])
  status?: 'SUCCESS' | 'ERROR';

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page = 1;

  @Transform(toNumber)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

interface WebhookEvent {
  status: 'SUCCESS' | 'ERROR';
  httpStatus: number;
  resultCode: string;
  providerTransactionId?: string;
  transactionId?: string;
}

@Injectable()
export class SePayWebhookEvents {
  private readonly logger = new Logger(SePayWebhookEvents.name);

  constructor(private readonly db: PrismaService) {}

  async list({ environment, status, page, limit }: SePayWebhookEventsQuery) {
    const where = { environment, status };
    const [items, total] = await Promise.all([
      this.db.sePayWebhookEvent.findMany({
        where, skip: (page - 1) * limit, take: limit,
        orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
      }),
      this.db.sePayWebhookEvent.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async record(event: WebhookEvent) {
    try {
      await this.db.sePayWebhookEvent.create({
        data: { ...event, environment: process.env.PAYMENTS_MODE === 'live' ? 'LIVE' : 'TEST' },
      });
    } catch {
      // Tiền đã xử lý hoặc bị từ chối theo kết quả gốc. Giữ nguyên phản hồi SePay khi lỗi ghi nhật ký.
      this.logger.error(`Không ghi được sự kiện webhook ${event.resultCode}`);
    }
  }

  recordDelivery(providerTransactionId: string, result?: PaymentTransactionResult) {
    const transaction = result?.transaction;
    const review = transaction?.outcome === 'REVIEW_REQUIRED';
    let resultCode: string = transaction?.reason ?? transaction?.outcome ?? 'PING';
    if (result?.duplicate && !review) resultCode = 'DUPLICATE_DELIVERY';
    return this.record({
      providerTransactionId,
      transactionId: transaction?.id,
      httpStatus: 200,
      status: review ? 'ERROR' : 'SUCCESS',
      resultCode,
    });
  }
}

@Catch()
@Injectable()
export class SePayWebhookExceptionFilter extends StandardApiResponseFilter {
  constructor(private readonly events: SePayWebhookEvents) {
    super();
  }

  async catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const failure = describeFailure(error);
    await this.events.record({
      status: 'ERROR',
      ...failure,
      providerTransactionId: response.locals.sepayWebhookTransactionId as string | undefined,
    });
    super.catch(error, host);
  }
}

function describeFailure(error: unknown): Pick<WebhookEvent, 'httpStatus' | 'resultCode'> {
  if (!(error instanceof HttpException)) return { httpStatus: 500, resultCode: 'PROCESSING_FAILED' };
  const body = error.getResponse();
  if (typeof body === 'object' && 'message' in body && Array.isArray(body.message)) {
    return { httpStatus: 422, resultCode: 'INVALID_PAYLOAD' };
  }
  const httpStatus = error.getStatus();
  const codes: Record<string, string> = {
    'Invalid webhook API key': 'INVALID_API_KEY',
    'Invalid webhook signature': 'INVALID_SIGNATURE',
    'Webhook timestamp is outside the allowed window': 'SIGNATURE_EXPIRED',
    'Local test route is disabled': 'TEST_ROUTE_DISABLED',
    'Use application/json for this webhook': 'UNSUPPORTED_CONTENT_TYPE',
    'Invalid SePay transactionDate': 'INVALID_TRANSACTION_DATE',
    'Provider transaction ID reused with different data': 'TRANSACTION_ID_CONFLICT',
  };
  const fallback = httpStatus === 503 ? 'SERVICE_UNAVAILABLE' : httpStatus >= 500 ? 'PROCESSING_FAILED' : 'REQUEST_REJECTED';
  return { httpStatus, resultCode: codes[error.message] ?? fallback };
}
