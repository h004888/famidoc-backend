import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DecideRescheduleRequestDto {
  @ApiProperty({
    description: 'Quyết định phê duyệt (APPROVE) hoặc từ chối (REJECT) yêu cầu đổi lịch',
    enum: ['APPROVE', 'REJECT'],
    example: 'APPROVE',
  })
  @IsIn(['APPROVE', 'REJECT'])
  @IsNotEmpty()
  decision!: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({
    description: 'Ghi chú hoặc lý do từ chối yêu cầu đổi lịch',
    example: 'Cơ sở y tế xác nhận điều phối được lịch mới',
  })
  @IsString()
  @IsOptional()
  note?: string;
}
