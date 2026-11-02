import { ApiProperty } from '@nestjs/swagger';

export class ConsultationRequestResponseDto {
  @ApiProperty({
    example: 'CRQ-L9X4K2-A1B2',
    description: 'Mã hồ sơ tiếp nhận tư vấn (Ticket ID)',
  })
  ticketId!: string;

  @ApiProperty({
    example: 'RECEIVED',
    description: 'Trạng thái tiếp nhận hồ sơ tư vấn',
  })
  status!: string;

  @ApiProperty({
    example:
      'Yêu cầu tư vấn của bạn đã được tiếp nhận thành công. Đội ngũ bác sĩ và nhân viên y tế FamiDoc sẽ liên hệ tư vấn trong thời gian sớm nhất.',
  })
  message!: string;

  @ApiProperty({
    example: '2026-11-02T09:45:00.000Z',
    description: 'Thời điểm tiếp nhận yêu cầu',
  })
  submittedAt!: Date;
}
