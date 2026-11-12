import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FacilityVerificationStatus } from '@prisma/client';

export class FacilityUserSummaryDto {
  @ApiProperty({ example: 'u1b2c3d4-5678-90ab-cdef-1234567890ab' })
  id!: string;

  @ApiProperty({ example: 'contact@ansinhhospital.vn' })
  email!: string;

  @ApiProperty({ example: '0987654321' })
  phone!: string;

  @ApiProperty({ example: 'Nguyễn Văn Tuấn' })
  fullName!: string;

  @ApiProperty({ example: 'HEALTHCARE_FACILITY' })
  role!: string;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;
}

export class FacilityResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'u1b2c3d4-5678-90ab-cdef-1234567890ab' })
  userId!: string;

  @ApiProperty({ example: 'Bệnh viện Đa khoa Quốc tế An Sinh' })
  facilityName!: string;

  @ApiProperty({ example: '01293/BYT-GPHĐ' })
  licenseNumber!: string;

  @ApiProperty({ example: '0102030405' })
  taxCode!: string;

  @ApiProperty({
    example: '123 Giải Phóng, Phường Đồng Tâm, Quận Hai Bà Trưng, Hà Nội',
  })
  address!: string;

  @ApiProperty({ example: '19001234' })
  hotline!: string;

  @ApiProperty({ example: 'Vietcombank' })
  bankName!: string;

  @ApiProperty({ example: '0011002233445' })
  bankAccountNumber!: string;

  @ApiProperty({ example: 'CONG TY CO PHAN BENH VIEN AN SINH' })
  bankAccountHolder!: string;

  @ApiProperty({
    enum: FacilityVerificationStatus,
    example: FacilityVerificationStatus.PENDING,
  })
  verificationStatus!: FacilityVerificationStatus;

  @ApiPropertyOptional({ type: () => FacilityUserSummaryDto })
  user?: FacilityUserSummaryDto;

  @ApiPropertyOptional({
    example: 'https://cdn.famidoc.vn/facilities/legal/gphd-ansinh-signed.pdf',
  })
  legalDocumentsUrl?: string | null;

  @ApiProperty({ example: '2026-11-12T07:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-11-12T07:00:00.000Z' })
  updatedAt!: string;
}
