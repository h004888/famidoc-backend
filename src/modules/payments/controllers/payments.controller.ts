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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
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

@ApiTags('Payments')
@ApiBearerAuth('JWT-auth')
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
  @ApiOperation({ summary: 'Tạo mã QR thanh toán VietQR cho hợp đồng hoặc phụ lục' })
  @ApiBody({ type: CreatePaymentRequestDto })
  @ApiResponse({ status: 201, description: 'Tạo yêu cầu thanh toán VietQR thành công, trả về qrUrl và transferContent' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ hoặc trạng thái hợp đồng không được phép thanh toán' })
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
  @ApiOperation({ summary: 'Kiểm tra trạng thái thanh toán của hóa đơn/yêu cầu' })
  @ApiParam({ name: 'paymentId', description: 'UUID của yêu cầu thanh toán (invoice id)' })
  @ApiResponse({ status: 200, description: 'Trạng thái thanh toán (PENDING, PAID, EXPIRED, CANCELLED)' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy yêu cầu thanh toán' })
  getPaymentStatus(
    @Param('paymentId', new ParseUUIDPipe({ version: '4' })) paymentId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.getPaymentStatus(paymentId, req.user);
  }

  @Post('requests/:id/cancel')
  @ApiOperation({ summary: 'Hủy yêu cầu thanh toán' })
  @ApiParam({ name: 'id', description: 'UUID của yêu cầu thanh toán' })
  @ApiResponse({ status: 200, description: 'Hủy yêu cầu thanh toán thành công' })
  @ApiResponse({ status: 400, description: 'Yêu cầu thanh toán không ở trạng thái cho phép hủy' })
  async cancel(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.cancelRequest(id, req.user);
  }

  @Post('requests/:id/recheck-activation')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Admin kích hoạt bù hợp đồng/phụ lục nếu webhook bị sót' })
  @ApiParam({ name: 'id', description: 'UUID của yêu cầu thanh toán' })
  @ApiResponse({ status: 200, description: 'Kích hoạt lại dịch vụ thành công' })
  @ApiResponse({ status: 403, description: 'Chỉ ADMIN mới có quyền thực hiện' })
  async recheckPaymentActivation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const payment = await this.service.getPaymentStatus(id, req.user);
    return this.service.tryActivate(payment.contractId, payment.addendumId);
  }

  @Get('transactions')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Admin tra cứu danh sách các giao dịch thanh toán' })
  @ApiResponse({ status: 200, description: 'Danh sách lịch sử giao dịch' })
  @ApiResponse({ status: 403, description: 'Chỉ ADMIN mới có quyền truy cập' })
  listTransactions(@Query() query: ListTransactionsDto) {
    return this.service.listTransactions(query);
  }
}
