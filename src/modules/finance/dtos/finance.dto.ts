import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
  IsISO8601,
} from 'class-validator';
export class RevenueAnalyticsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @IsUUID('4') facilityId?: string;
  @IsOptional() @IsIn(['TEST', 'LIVE']) environment: 'TEST' | 'LIVE' = 'LIVE';
}
export class MonthlySettlementDto extends RevenueAnalyticsQueryDto {
  @IsIn(['PREPARE', 'CONFIRM_TRANSFER', 'MARK_FAILED']) action:
    'PREPARE' | 'CONFIRM_TRANSFER' | 'MARK_FAILED' = 'PREPARE';
  @ValidateIf((o) => o.action !== 'PREPARE') @IsUUID('4') settlementId?: string;
  @ValidateIf((o) => o.action === 'CONFIRM_TRANSFER')
  @IsString()
  @Length(3, 100)
  bankTransferOrderId?: string;
  @ValidateIf((o) => o.action === 'CONFIRM_TRANSFER')
  @IsInt()
  @Min(1)
  @Max(999999999999)
  amountPaidVnd?: number;
  @ValidateIf((o) => o.action === 'CONFIRM_TRANSFER')
  @IsISO8601({ strict: true })
  paidAt?: string;
  @ValidateIf((o) => o.action === 'CONFIRM_TRANSFER')
  @IsString()
  @Length(5, 300)
  evidenceKey?: string;
  @ValidateIf((o) => o.action === 'MARK_FAILED')
  @IsString()
  @Length(10, 1000)
  failureReason?: string;
}
