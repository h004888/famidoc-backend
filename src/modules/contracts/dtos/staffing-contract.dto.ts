import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { B2bContractStatus } from '@prisma/client';

export class CreateStaffingContractDto {
  @ApiProperty({
    description: 'UUID của cơ sở y tế đối tác đã kích hoạt ACTIVE',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsNotEmpty({ message: 'Vui lòng chỉ định cơ sở y tế đối tác (facilityId)' })
  @IsUUID('4', { message: 'facilityId phải là UUID hợp lệ' })
  facilityId!: string;

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
    description: 'Điều khoản bổ sung hoặc thỏa thuận đặc thù cho hợp đồng B2B (tùy chọn)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  contractTerms?: string;

  @ApiPropertyOptional({
    description: 'Đường dẫn file văn bản hợp đồng số hóa (PDF)',
    example: 'https://cdn.famidoc.vn/contracts/staffing/draft-contract.pdf',
  })
  @IsOptional()
  @IsString()
  signedPdfUrl?: string;
}

export class UpdateStaffingContractDto {
  @ApiPropertyOptional({
    description: 'Tỷ lệ hoa hồng nền tảng (%)',
    example: 15.0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  platformCommissionRate?: number;

  @ApiPropertyOptional({
    description: 'Tỷ lệ doanh thu của cơ sở y tế (%)',
    example: 85.0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  facilityRevenueRate?: number;

  @ApiPropertyOptional({
    description: 'Ngày bắt đầu hiệu lực (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsISO8601({ strict: false })
  startDate?: string;

  @ApiPropertyOptional({
    description: 'Ngày kết thúc hiệu lực (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsISO8601({ strict: false })
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Điều khoản bổ sung hoặc thỏa thuận đặc thù sau khi chỉnh sửa (tùy chọn)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  contractTerms?: string;
}

export class SignStaffingContractDto {
  @ApiPropertyOptional({
    description: 'Đường dẫn file hợp đồng đã ký số điện tử (PDF)',
    example: 'https://cdn.famidoc.vn/contracts/staffing/signed-contract.pdf',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  signedPdfUrl?: string;

  @ApiPropertyOptional({
    description: 'Mã băm chữ ký số điện tử (Digital Signature Hash)',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  @IsOptional()
  @IsString()
  signatureHash?: string;
}

export class RejectStaffingContractDto {
  @ApiPropertyOptional({
    description: 'Lý do yêu cầu chỉnh sửa / từ chối dự thảo hợp đồng',
    example: 'Đề xuất điều chỉnh tỷ lệ hoa hồng nền tảng thành 10% và thời hạn bắt đầu từ ngày 01/03/2026.',
    minLength: 5,
    maxLength: 500,
  })
  @IsOptional()
  @IsString({ message: 'rejectionReason phải là chuỗi ký tự' })
  @MinLength(5, { message: 'rejectionReason phải có ít nhất 5 ký tự' })
  @MaxLength(500, { message: 'rejectionReason không được vượt quá 500 ký tự' })
  rejectionReason?: string;

  @ApiPropertyOptional({
    description: 'Lý do yêu cầu chỉnh sửa hợp đồng (alias của rejectionReason)',
    minLength: 5,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MinLength(5, { message: 'reason phải có ít nhất 5 ký tự' })
  @MaxLength(500, { message: 'reason không được vượt quá 500 ký tự' })
  reason?: string;
}

export class RequestStaffingTerminationDto {
  @ApiProperty({
    description: 'Lý do cơ sở y tế đề nghị chấm dứt hợp đồng B2B đang hiệu lực',
    minLength: 5,
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng cung cấp lý do yêu cầu chấm dứt hợp đồng' })
  @MinLength(5, { message: 'Lý do phải có ít nhất 5 ký tự' })
  @MaxLength(1000)
  reason!: string;
}

export class TerminateStaffingContractDto {
  @ApiProperty({
    description: 'Lý do hủy dự thảo hoặc chấm dứt hợp đồng B2B',
    minLength: 5,
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng cung cấp lý do hủy / chấm dứt hợp đồng' })
  @MinLength(5, { message: 'Lý do phải có ít nhất 5 ký tự' })
  @MaxLength(1000)
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Xác nhận cưỡng chế chấm dứt khi vẫn còn hợp đồng 4 bên hoặc lịch khám đang mở',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    description: 'Ghi chú kế hoạch bàn giao hộ gia đình / bác sĩ nếu chấm dứt cưỡng chế',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  handoverNotes?: string;
}

export class StaffingTerminationImpactDto {
  @ApiProperty()
  contractId!: string;

  @ApiProperty()
  facilityId!: string;

  @ApiProperty({ enum: B2bContractStatus })
  status!: B2bContractStatus;

  @ApiProperty()
  activeMedicalContracts!: number;

  @ApiProperty()
  pendingMedicalContracts!: number;

  @ApiProperty()
  openEncounters!: number;

  @ApiProperty()
  unsettledSettlements!: number;

  @ApiProperty()
  unsettledPaidInvoices!: number;

  @ApiProperty()
  activeOrOnboardingDoctors!: number;

  @ApiProperty()
  openComplaints!: number;

  @ApiProperty()
  hasBlockingDependencies!: boolean;

  @ApiProperty({ type: [String] })
  warnings!: string[];
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

  @ApiPropertyOptional({ nullable: true })
  licenseIssuer?: string | null;

  @ApiPropertyOptional({ nullable: true })
  licenseDate?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  taxCode?: string | null;

  @ApiProperty({ example: 'Số 10 Phố Huế, Quận Hai Bà Trưng, Hà Nội' })
  address!: string;

  @ApiProperty({ example: '1900 6868' })
  hotline!: string;
}

export class StaffingPlatformLegalDto {
  @ApiProperty({ example: 'Nền tảng Y tế Gia đình FamiDoc' })
  companyName!: string;

  @ApiProperty({ example: '0109998888' })
  taxCode!: string;

  @ApiProperty({ example: 'Việt Nam (Vận hành trực tuyến tại https://famidoc.online)' })
  address!: string;

  @ApiProperty({ example: 'Ban Quản trị Nền tảng FamiDoc' })
  representative!: string;

  @ApiProperty({ example: 'support@famidoc.online' })
  supportContact!: string;
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

  @ApiPropertyOptional({ nullable: true })
  contractTerms?: string | null;

  @ApiPropertyOptional({ nullable: true })
  revisionReason?: string | null;

  @ApiPropertyOptional({ nullable: true })
  documensoEnvelopeId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  documensoItemId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  facilitySignedAt?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  adminSignedAt?: Date | null;

  @ApiPropertyOptional()
  facilitySigned?: boolean;

  @ApiPropertyOptional()
  adminSigned?: boolean;

  @ApiPropertyOptional({ nullable: true })
  terminationRequestStatus?: string | null;

  @ApiPropertyOptional({ nullable: true })
  terminationRequestReason?: string | null;

  @ApiPropertyOptional({ nullable: true })
  terminationRequestedAt?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  terminatedReason?: string | null;

  @ApiPropertyOptional({ nullable: true })
  terminatedAt?: Date | null;

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

  @ApiPropertyOptional({ type: StaffingPlatformLegalDto })
  platformLegal?: StaffingPlatformLegalDto;
}
