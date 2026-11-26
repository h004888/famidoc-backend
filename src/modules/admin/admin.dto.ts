import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplaintStatus, UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { ListCarePackagesDto } from '../care-packages/dtos/list-care-packages.dto';

function trim({ value }: { value: unknown }) {
  return typeof value === 'string' ? value.trim() : value;
}

export class AdminUsersQuery extends ListCarePackagesDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  q?: string;
}

export class AdminAuditQuery extends ListCarePackagesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  resourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  resourceName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(150)
  q?: string;
}

export class ComplaintsQuery extends ListCarePackagesDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;
}

const complaintSenderRoles = [UserRole.FAMILY_REP, UserRole.DOCTOR];

export class AdminComplaintsQuery extends ComplaintsQuery {
  @ApiPropertyOptional({ enum: complaintSenderRoles })
  @IsOptional()
  @IsIn(complaintSenderRoles)
  complainantRole?: 'FAMILY_REP' | 'DOCTOR';
}

class AdminEnvironmentQuery {
  @ApiPropertyOptional({ enum: ['LIVE', 'TEST'] })
  @IsOptional()
  @IsIn(['LIVE', 'TEST'])
  environment: 'LIVE' | 'TEST' = 'LIVE';
}

export class AdminOverviewQuery extends AdminEnvironmentQuery {
  @ApiPropertyOptional({ enum: ['weekly', 'monthly', 'yearly'] })
  @IsOptional()
  @IsIn(['weekly', 'monthly', 'yearly'])
  period: 'weekly' | 'monthly' | 'yearly' = 'monthly';
}

export class AdminFinanceReportQuery extends AdminEnvironmentQuery {
  @ApiPropertyOptional({ minimum: 2000, maximum: 2200, description: 'Mặc định là năm hiện tại theo giờ Việt Nam.' })
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' && /^\d{4}$/.test(value) ? Number(value) : value)
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;
}

export class AdminAccountStatusDto {
  @ApiProperty({ enum: ['SUSPENDED', 'ACTIVE'] })
  @IsIn(['SUSPENDED', 'ACTIVE'])
  status!: 'SUSPENDED' | 'ACTIVE';

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(5, 500)
  reason!: string;
}

// Tỷ lệ chia doanh thu mặc định cho hợp đồng B2B mới: CSYT + nền tảng luôn bằng 100%.
export class AdminUpdateRevenueConfigDto {
  @ApiProperty({ minimum: 50, maximum: 95, example: 85, description: 'Phần trăm doanh thu thuộc cơ sở y tế' })
  @IsInt()
  @Min(50)
  @Max(95)
  facilityRevenueRate!: number;

  @ApiProperty({ minimum: 5, maximum: 50, example: 15, description: 'Phần trăm hoa hồng nền tảng' })
  @IsInt()
  @Min(5)
  @Max(50)
  platformCommissionRate!: number;
}

export class AdminUpdateDoctorPanelCapacityDto {
  @ApiProperty({ minimum: 1, maximum: 100, example: 5 })
  @IsInt()
  @Min(1)
  @Max(100)
  maxPanelCapacity!: number;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @Length(5, 500)
  reason!: string;
}
