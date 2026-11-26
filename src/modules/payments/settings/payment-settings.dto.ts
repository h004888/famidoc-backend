import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { PaymentEnvironment } from '../sepay/sepay-api.types';

export class PaymentSettingsDraftDto {
  @IsIn(['TEST', 'LIVE']) environment!: PaymentEnvironment;
  @IsInt() @Min(0) expectedRevision!: number;
  @IsString() @Matches(/^\d{5,19}$/) accountNumber!: string;
  @IsString() @MaxLength(100) gateway!: string;
  @IsUUID() bankAccountId!: string;
  @IsIn(['hmac', 'apikey']) authMethod!: 'hmac' | 'apikey';
  @IsOptional() @IsString() @MaxLength(4096) apiToken?: string;
  @IsOptional() @IsString() @MaxLength(4096) webhookSecret?: string;
  @IsOptional() @IsString() @MaxLength(4096) webhookApiKey?: string;
}
export class PaymentSettingsEnvironmentDto {
  @IsIn(['TEST', 'LIVE']) environment!: PaymentEnvironment;
}
export class PaymentTestSessionDto extends PaymentSettingsEnvironmentDto {
  @IsInt() @Min(1) revision!: number;
  @IsUUID() requestId!: string;
  @IsInt() @Min(1000) @Max(100000) amountVnd!: number;
  @IsOptional() @IsIn([true]) confirmRealMoney?: boolean;
}
export interface PaymentSettingsSnapshot {
  environment: PaymentEnvironment;
  revision: number;
  revisionId: string | null;
  monitoredAccountId: string | null;
  accountNumber: string;
  gateway: string;
  bankAccountId: string;
  authMethod: 'hmac' | 'apikey';
  apiToken: string;
  webhookSecret?: string;
  webhookApiKey?: string;
  ttlMinutes: number;
}
export const normalizeGateway = (gateway: string) =>
  gateway.trim().toLowerCase();
