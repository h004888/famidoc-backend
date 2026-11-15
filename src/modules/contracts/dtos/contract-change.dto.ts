import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { FieldFor } from '../../../core/validation/field-for.decorator';

const sha256Hex = /^[0-9a-fA-F]{64}$/;

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
  @FieldFor('type', ['QUOTA_EXPANSION'])
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
  @FieldFor('type', ['MEMBER_EXTENSION'])
  @IsInt()
  @Min(1)
  @Max(9)
  additionalMembers?: number;
}

export class CreatePackageUpgradeDto {
  @ApiPropertyOptional({
    description: 'Số lượt video thỏa thuận, bắt buộc với gói có hạn mức theo hợp đồng',
    example: 20,
    minimum: 1,
    maximum: 100000,
  })
  @ValidateIf((_o, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(100_000)
  videoConsultations?: number;

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
  @Matches(sha256Hex)
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
  @FieldFor('action', ['REQUEST', 'REJECT'])
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
  @FieldFor('action', ['CONSENT', 'APPROVE', 'REJECT'])
  @IsUUID('4')
  requestId?: string;

  @ApiPropertyOptional({
    description: 'Mã băm điều khoản chấm dứt (bắt buộc khi action là CONSENT hoặc APPROVE)',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  @FieldFor('action', ['CONSENT', 'APPROVE'])
  @IsString()
  @Matches(sha256Hex)
  termsHash?: string;
}

export class RequestTerminationDto {
  @ApiProperty({
    description: 'Lý do gửi yêu cầu chấm dứt hợp đồng y tế',
    example: 'Gia đình chuyển địa điểm sinh sống sang khu vực khác',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 2000)
  reason!: string;
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
    description: 'Lý do từ chối, bắt buộc khi action là REJECT',
    example: 'Hợp đồng còn nghĩa vụ chưa hoàn tất',
  })
  @FieldFor('action', ['REJECT'])
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(10, 2000)
  reason?: string;

  @ApiPropertyOptional({
    description: 'Mã băm điều khoản (SHA-256), bắt buộc khi đồng thuận hoặc duyệt',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  @FieldFor('action', ['CONSENT', 'APPROVE'])
  @IsString()
  @Matches(sha256Hex)
  termsHash?: string;
}
