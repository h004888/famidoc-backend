import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DoctorCredentialType, DoctorOnboardingStatus } from '@prisma/client';

export class DoctorCredentialResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({
    enum: DoctorCredentialType,
    example: DoctorCredentialType.PRACTICE_LICENSE_CCHN,
  })
  credentialType!: DoctorCredentialType;

  @ApiProperty({ example: 'CCHN-001234/BYT' })
  certificateNumber!: string;

  @ApiProperty({ example: '2020-05-15' })
  issueDate!: Date;

  @ApiProperty({ example: 'Bộ Y tế' })
  issuingAuthority!: string;

  @ApiProperty({ example: 'https://cdn.famidoc.vn/cchn.pdf' })
  fileUrl!: string;

  @ApiProperty({ example: true, description: 'Đã được CSYT thẩm định cấp 1' })
  facilityVerified!: boolean;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z', nullable: true })
  facilityVerifiedAt!: Date | null;

  @ApiProperty({
    example: true,
    description: 'Đã được Quản trị viên duyệt cấp 2',
  })
  platformApproved!: boolean;

  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z', nullable: true })
  platformApprovedAt!: Date | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  rejectionReason!: string | null;
}

export class DoctorFacilityResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: 'Bệnh viện Đa khoa Quốc tế Hoàn Mỹ' })
  facilityName!: string;

  @ApiProperty({ example: 'Số 100 Trần Hưng Đạo, Hà Nội' })
  address!: string;

  @ApiProperty({ example: '1900 8888' })
  hotline!: string;
}

export class DoctorResponseDto {
  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  id!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  userId!: string;

  @ApiProperty({ example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' })
  facilityId!: string;

  @ApiProperty({ example: 'BS. CKI Nguyễn Văn An' })
  doctorName!: string;

  @ApiProperty({ example: 'Y học gia đình' })
  specialty!: string;

  @ApiPropertyOptional({ example: 'BS.CKI', nullable: true })
  academicTitle!: string | null;

  @ApiProperty({ example: 8 })
  experienceYears!: number;

  @ApiPropertyOptional({
    example: 'Chuyên gia Y học gia đình với 8 năm kinh nghiệm.',
    nullable: true,
  })
  bio!: string | null;

  @ApiProperty({ example: 0, description: 'Số hộ gia đình đang phụ trách' })
  activePanelCount!: number;

  @ApiProperty({ example: 30, description: 'Hạn mức tối đa số hộ gia đình' })
  maxPanelCapacity!: number;

  @ApiProperty({ example: 5.0, description: 'Điểm đánh giá trung bình' })
  ratingAvg!: number;

  @ApiProperty({ example: 0, description: 'Tổng số lượt đánh giá' })
  totalReviews!: number;

  @ApiProperty({
    enum: DoctorOnboardingStatus,
    example: DoctorOnboardingStatus.PENDING_SUBMISSION,
  })
  onboardingStatus!: DoctorOnboardingStatus;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  createdAt!: Date;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  updatedAt!: Date;

  @ApiPropertyOptional({ type: DoctorFacilityResponseDto })
  facility?: DoctorFacilityResponseDto;

  @ApiPropertyOptional({ type: [DoctorCredentialResponseDto] })
  credentials?: DoctorCredentialResponseDto[];
}
