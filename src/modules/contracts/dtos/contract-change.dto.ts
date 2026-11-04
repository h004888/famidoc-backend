import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
export class CreateContractAddendumDto {
  @IsUUID('4') requestKey: string;
  @IsIn(['QUOTA_EXPANSION', 'MEMBER_EXTENSION']) type:
    'QUOTA_EXPANSION' | 'MEMBER_EXTENSION';
  @ValidateIf((o) => o.type === 'QUOTA_EXPANSION')
  @IsInt()
  @Min(1)
  @Max(100)
  extraHomeVisits?: number;
  @ValidateIf((o) => o.type === 'MEMBER_EXTENSION')
  @IsInt()
  @Min(1)
  @Max(5)
  additionalMembers?: number;
}
export class CreatePackageUpgradeDto {
  @IsUUID('4') packageId: string;
  @IsIn(['UPGRADE', 'RENEWAL']) kind: 'UPGRADE' | 'RENEWAL' = 'UPGRADE';
  // Backend đếm toàn bộ hồ sơ ACTIVE trong gia đình để tính gói; không chọn người lẻ.
}
export class SignContractChangeDto {
  @IsString() @Length(64, 64) termsHash: string;
  @IsBoolean() acceptedTerms: boolean;
}
export class TerminateContractDto {
  @IsIn(['REQUEST', 'CONSENT', 'APPROVE', 'REJECT']) action:
    'REQUEST' | 'CONSENT' | 'APPROVE' | 'REJECT' = 'REQUEST';
  @ValidateIf((o) => o.action === 'REQUEST' || o.action === 'REJECT')
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 2000)
  reason?: string;
  @ValidateIf((o) => o.action !== 'REQUEST') @IsUUID('4') requestId?: string;
  @ValidateIf((o) => o.action === 'CONSENT' || o.action === 'APPROVE')
  @IsString()
  @Length(64, 64)
  termsHash?: string;
}
