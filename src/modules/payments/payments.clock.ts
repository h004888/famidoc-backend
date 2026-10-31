import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentsClock {
  // Tách đồng hồ để test thời hạn mà không phải chờ thật hoặc đổi giờ toàn máy.
  now(): Date {
    return new Date();
  }
}
