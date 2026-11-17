import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplaintStatus, UserRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
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
}

export class AdminComplaintsQuery extends ListCarePackagesDto {
  @ApiPropertyOptional({ enum: ComplaintStatus })
  @IsOptional()
  @IsEnum(ComplaintStatus)
  status?: ComplaintStatus;
}

export class AdminOverviewQuery {
  @ApiPropertyOptional({ enum: ['weekly', 'monthly', 'yearly'] })
  @IsIn(['weekly', 'monthly', 'yearly'])
  period: 'weekly' | 'monthly' | 'yearly' = 'monthly';
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
