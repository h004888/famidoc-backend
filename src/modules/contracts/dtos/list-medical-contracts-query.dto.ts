import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { MedicalContractStatus } from '@prisma/client';

export class ListMedicalContractsQueryDto {
  @ApiPropertyOptional({
    description: 'Trang cần truy vấn (bắt đầu từ 1)',
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Số lượng hợp đồng trên mỗi trang (tối đa 100)',
    default: 10,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái hợp đồng y tế',
    enum: MedicalContractStatus,
    example: MedicalContractStatus.PENDING_APPROVAL,
  })
  @IsOptional()
  @IsEnum(MedicalContractStatus)
  status?: MedicalContractStatus;

  @ApiPropertyOptional({
    description: 'Lọc theo cơ sở y tế (dành cho Admin hoặc đối tác CSYT)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4', { message: 'facilityId phải là UUID hợp lệ' })
  facilityId?: string;
}
