import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { B2bContractStatus } from '@prisma/client';

export class CreateStaffingContractDto {
  @ApiPropertyOptional({
    description:
      'UUID của cơ sở y tế đối tác (bắt buộc đối với Admin; nếu CSYT gọi thì hệ thống tự động suy diễn theo tài khoản)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4', { message: 'facilityId phải là UUID hợp lệ' })
  facilityId?: string;

  @ApiPropertyOptional({
    description: 'Tỷ lệ hoa hồng nền tảng (%) - Mặc định 15.00',
    example: 15.0,
    default: 15.0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  platformCommissionRate?: number = 15.0;

  @ApiPropertyOptional({
    description:
      'Tỷ lệ doanh thu của cơ sở y tế (%) - Mặc định 85.00 (Tổng tỷ lệ phải bằng 100%)',
    example: 85.0,
    default: 85.0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  facilityRevenueRate?: number = 85.0;

  @ApiProperty({
    description: 'Ngày bắt đầu hợp đồng (định dạng YYYY-MM-DD hoặc ISO8601)',
    example: '2026-01-01',
  })
  @IsISO8601(
    { strict: false },
    { message: 'startDate phải theo định dạng ngày ISO8601 hợp lệ' },
  )
  startDate!: string;

  @ApiProperty({
    description: 'Ngày kết thúc hợp đồng (định dạng YYYY-MM-DD hoặc ISO8601)',
    example: '2026-12-31',
  })
  @IsISO8601(
    { strict: false },
    { message: 'endDate phải theo định dạng ngày ISO8601 hợp lệ' },
  )
  endDate!: string;

  @ApiPropertyOptional({
    description: 'Đường dẫn file văn bản hợp đồng số hóa (PDF)',
    example: 'https://cdn.famidoc.vn/contracts/staffing/draft-contract.pdf',
  })
  @IsOptional()
  @IsString()
  signedPdfUrl?: string;
}

export class SignStaffingContractDto {
  @ApiPropertyOptional({
    description: 'Đường dẫn file hợp đồng đã ký số điện tử (PDF)',
    example: 'https://cdn.famidoc.vn/contracts/staffing/signed-contract.pdf',
  })
  @IsOptional()
  @IsString()
  signedPdfUrl?: string;

  @ApiPropertyOptional({
    description: 'Mã băm chữ ký số điện tử (Digital Signature Hash)',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  @IsOptional()
  @IsString()
  signatureHash?: string;
}

export class ListStaffingContractsDto {
  @ApiPropertyOptional({
    description: 'Lọc theo ID cơ sở y tế',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsOptional()
  @IsUUID('4')
  facilityId?: string;

  @ApiPropertyOptional({
    description: 'Lọc theo trạng thái hợp đồng',
    enum: B2bContractStatus,
  })
  @IsOptional()
  @IsEnum(B2bContractStatus)
  status?: B2bContractStatus;

  @ApiPropertyOptional({
    description: 'Trang hiện tại (bắt đầu từ 1)',
    default: 1,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Số lượng hợp đồng mỗi trang (tối đa 50)',
    default: 10,
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit: number = 10;
}

export class StaffingFacilitySummaryDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Phòng khám Đa khoa Quốc tế FamiDoc Hà Nội' })
  facilityName!: string;

  @ApiProperty({ example: 'GPHN-01234/BYT' })
  licenseNumber!: string;

  @ApiProperty({ example: 'Số 10 Phố Huế, Quận Hai Bà Trưng, Hà Nội' })
  address!: string;

  @ApiProperty({ example: '1900 6868' })
  hotline!: string;
}

export class StaffingContractResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'STF-2026-A1B2C3D4' })
  contractCode!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  facilityId!: string;

  @ApiProperty({ example: 15.0, description: 'Tỷ lệ hoa hồng nền tảng (%)' })
  platformCommissionRate!: number;

  @ApiProperty({ example: 85.0, description: 'Tỷ lệ doanh thu CSYT (%)' })
  facilityRevenueRate!: number;

  @ApiProperty({ example: '2026-01-01' })
  startDate!: Date;

  @ApiProperty({ example: '2026-12-31' })
  endDate!: Date;

  @ApiProperty({
    example: 'https://cdn.famidoc.vn/contracts/staffing/STF-2026-signed.pdf',
    nullable: true,
  })
  signedPdfUrl!: string | null;

  @ApiProperty({
    enum: B2bContractStatus,
    example: B2bContractStatus.ACTIVE,
  })
  status!: B2bContractStatus;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: Date;

  @ApiPropertyOptional({ type: StaffingFacilitySummaryDto })
  facility?: StaffingFacilitySummaryDto;
}
