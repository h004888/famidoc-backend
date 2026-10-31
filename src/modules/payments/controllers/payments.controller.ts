import {
  Body,
  Controller,
  Inject,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import { CreatePaymentRequestDto } from '../dtos/create-payment-request.dto';
import { ListTransactionsDto } from '../dtos/list-transactions.dto';
import { paymentsValidationPipe } from '../payments-validation.pipe';
import {
  PAYMENTS_SERVICE_TOKEN,
  type IPaymentsService,
} from '../services/interfaces/payments.service.interface';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../../../core/auth/roles.guard';
import type { AuthenticatedRequest } from '../../../core/auth/authenticated-request';

@Controller('api/v1/payments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('FAMILY_REP', 'ADMIN')
@UsePipes(paymentsValidationPipe)
export class PaymentsController {
  constructor(
    @Inject(PAYMENTS_SERVICE_TOKEN) private readonly service: IPaymentsService,
  ) {}

  // Giữ route cũ để không phá client; route vietqr khớp bảng phân công API của Nam.
  @Post(['vietqr', 'requests'])
  createVietQRPayment(
    @Body() dto: CreatePaymentRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.createVietQRPayment(
      dto.contractId,
      dto.addendumId,
      req.user,
    );
  }
  @Get([':paymentId/status', 'requests/:paymentId'])
  getPaymentStatus(
    @Param('paymentId', new ParseUUIDPipe({ version: '4' })) paymentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.getPaymentStatus(paymentId, req.user);
  }
  @Post('requests/:id/cancel')
  async cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.cancelRequest(id, req.user);
  }
  @Post('requests/:id/recheck-activation')
  @Roles('ADMIN')
  async recheckPaymentActivation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const payment = await this.service.getPaymentStatus(id, req.user);
    return this.service.tryActivate(payment.contractId, payment.addendumId);
  }
  @Get('transactions')
  @Roles('ADMIN')
  listTransactions(@Query() query: ListTransactionsDto) {
    return this.service.listTransactions(query);
  }
}
