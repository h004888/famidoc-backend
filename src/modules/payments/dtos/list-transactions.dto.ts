import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ListCarePackagesDto } from '../../care-packages/dtos/list-care-packages.dto';
import { TransactionOutcome } from '../entities/payment.entity';

export class ListTransactionsDto extends ListCarePackagesDto {
  @ApiPropertyOptional({
    enum: TransactionOutcome,
    enumName: 'TransactionOutcome',
    description: 'Bộ lọc theo kết quả xử lý giao dịch',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(TransactionOutcome)
  outcome?: TransactionOutcome;

  @ApiPropertyOptional({
    enum: ['in', 'out'],
    description: 'Bộ lọc theo chiều dòng tiền (in / out)',
  })
  @IsOptional()
  @IsIn(['in', 'out'])
  transferType?: 'in' | 'out';

  @ApiPropertyOptional({
    description: 'Từ khóa tìm kiếm theo mã giao dịch, mã hóa đơn, tham chiếu hoặc nội dung CK',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
