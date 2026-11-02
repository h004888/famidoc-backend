import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, ValidateIf } from 'class-validator';
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
}
