import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateContractAddendumDto {
  @ApiProperty({
    description: 'Khóa định danh yêu cầu phụ lục (Idempotency Key / Request Key)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  requestKey!: string;

  @ApiProperty({
    enum: ['QUOTA_EXPANSION', 'MEMBER_EXTENSION'],
    description: 'Loại phụ lục hợp đồng (QUOTA_EXPANSION: mở rộng lượt khám, MEMBER_EXTENSION: thêm thành viên)',
    example: 'QUOTA_EXPANSION',
  })
  @IsIn(['QUOTA_EXPANSION', 'MEMBER_EXTENSION'])
  type!: 'QUOTA_EXPANSION' | 'MEMBER_EXTENSION';

  @ApiPropertyOptional({
    description: 'Số lượt khám tại nhà bổ sung (bắt buộc khi type là QUOTA_EXPANSION)',
    example: 2,
    minimum: 1,
    maximum: 100,
  })
  @ValidateIf((o) => o.type === 'QUOTA_EXPANSION')
  @IsInt()
  @Min(1)
  @Max(100)
  extraHomeVisits?: number;

  @ApiPropertyOptional({
    description: 'Số lượng thành viên bảo trợ thêm (bắt buộc khi type là MEMBER_EXTENSION)',
    example: 1,
    minimum: 1,
    maximum: 9,
  })
  @ValidateIf((o) => o.type === 'MEMBER_EXTENSION')
  @IsInt()
  @Min(1)
  @Max(9)
  additionalMembers?: number;
}

export class CreatePackageUpgradeDto {
  @ApiPropertyOptional({
    description: 'Số lượt tư vấn video điều chỉnh',
    example: 20,
    minimum: 1,
    maximum: 100000,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(100_000)
  videoConsultations?: number;

  @ApiPropertyOptional({
    description: 'Số lượt khám tại nhà bổ sung điều chỉnh',
    example: 6,
    minimum: 0,
    maximum: 100,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(0)
  @Max(100)
  extraHomeVisits?: number;

  @ApiProperty({
    description: 'ID gói dịch vụ chăm sóc sức khỏe muốn nâng cấp tới',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  packageId!: string;

  @ApiPropertyOptional({
    enum: ['UPGRADE', 'RENEWAL'],
    description: 'Hình thức thay đổi gói (UPGRADE: nâng cấp, RENEWAL: gia hạn)',
    default: 'UPGRADE',
    example: 'UPGRADE',
  })
  @IsIn(['UPGRADE', 'RENEWAL'])
  kind: 'UPGRADE' | 'RENEWAL' = 'UPGRADE';
}

export class SignContractChangeDto {
  @ApiProperty({
    description: 'Mã băm SHA-256 các điều khoản hợp đồng được ký xác nhận',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  @IsString()
  @Length(64, 64)
  termsHash!: string;

  @ApiProperty({
    description: 'Xác nhận chấp thuận và đồng ý toàn bộ điều khoản',
    example: true,
  })
  @IsBoolean()
  acceptedTerms!: boolean;
}

export class TerminateContractDto {
  @ApiProperty({
    enum: ['REQUEST', 'CONSENT', 'APPROVE', 'REJECT'],
    description: 'Hành động chấm dứt hợp đồng (REQUEST: gửi yêu cầu, CONSENT: CSYT đồng thuận, APPROVE: Admin duyệt, REJECT: từ chối)',
    default: 'REQUEST',
    example: 'REQUEST',
  })
  @IsIn(['REQUEST', 'CONSENT', 'APPROVE', 'REJECT'])
  action: 'REQUEST' | 'CONSENT' | 'APPROVE' | 'REJECT' = 'REQUEST';

  @ApiPropertyOptional({
    description: 'Lý do chấm dứt hợp đồng (bắt buộc khi action là REQUEST hoặc REJECT)',
    example: 'Gia đình chuyển nơi sinh sống sang tỉnh thành khác',
  })
  @ValidateIf((o) => o.action === 'REQUEST' || o.action === 'REJECT')
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 2000)
  reason?: string;

  @ApiPropertyOptional({
    description: 'UUID của yêu cầu chấm dứt (bắt buộc khi action khác REQUEST)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @ValidateIf((o) => o.action !== 'REQUEST')
  @IsUUID('4')
  requestId?: string;

  @ApiPropertyOptional({
    description: 'Mã băm điều khoản chấm dứt (bắt buộc khi action là CONSENT hoặc APPROVE)',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  @ValidateIf((o) => o.action === 'CONSENT' || o.action === 'APPROVE')
  @IsString()
  @Length(64, 64)
  termsHash?: string;
}

export class RequestTerminationDto {
  @ApiPropertyOptional({
    description: 'Lý do gửi yêu cầu chấm dứt hợp đồng y tế',
    example: 'Gia đình chuyển địa điểm sinh sống sang khu vực khác',
  })
  @IsOptional()
  @IsString()
  @Length(10, 2000)
  reason?: string;
}

export class DecideTerminationDto {
  @ApiProperty({
    description: 'UUID của hợp đồng y tế',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  contractId!: string;

  @ApiProperty({
    enum: ['APPROVE', 'REJECT', 'CONSENT'],
    description: 'Hành động quyết định (APPROVE: Admin phê duyệt, REJECT: Admin từ chối, CONSENT: CSYT đồng thuận)',
    example: 'CONSENT',
  })
  @IsIn(['APPROVE', 'REJECT', 'CONSENT'])
  action!: 'APPROVE' | 'REJECT' | 'CONSENT';

  @ApiPropertyOptional({
    description: 'Lý do từ chối hoặc giải trình',
    example: 'Đã hoàn tất kiểm tra và đồng thuận chấm dứt',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: 'Mã băm điều khoản (SHA-256)',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  @IsOptional()
  @IsString()
  termsHash?: string;
}
