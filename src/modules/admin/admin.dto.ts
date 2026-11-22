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

export class AdminOverviewQuery {
  @ApiPropertyOptional({ enum: ['weekly', 'monthly', 'yearly'] })
  @IsOptional()
  @IsIn(['weekly', 'monthly', 'yearly'])
  period: 'weekly' | 'monthly' | 'yearly' = 'monthly';

  @ApiPropertyOptional({ enum: ['LIVE', 'TEST'] })
  @IsOptional()
  @IsIn(['LIVE', 'TEST'])
  environment: 'LIVE' | 'TEST' = 'LIVE';
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
