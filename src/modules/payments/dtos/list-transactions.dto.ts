import { IsEnum, ValidateIf } from 'class-validator';
import { ListCarePackagesDto } from '../../care-packages/dtos/list-care-packages.dto';
import { TransactionOutcome } from '../entities/payment.entity';

export class ListTransactionsDto extends ListCarePackagesDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEnum(TransactionOutcome)
  outcome?: TransactionOutcome;
}
