import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMedicalContractDto {
  @ApiProperty({
    description: 'ID gói dịch vụ chăm sóc sức khỏe',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsNotEmpty()
  packageId!: string;

  @ApiPropertyOptional({
    description:
      'ID cơ sở y tế đảm trách (tùy chọn khi đã chọn bác sĩ; máy chủ tự suy ra từ doctor.facilityId)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsOptional()
  facilityId?: string;

  @ApiPropertyOptional({
    description: 'ID bác sĩ gia đình phân công',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsOptional()
  doctorId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Danh sách ID thành viên gia đình (tùy chọn; luồng mới chốt theo memberCount và bổ sung hồ sơ thành viên sau khi hợp đồng ACTIVE)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  patientIds?: string[];

  @ApiPropertyOptional({
    description:
      'ID hộ gia đình (bắt buộc nếu Admin tạo, tự động lấy nếu đại diện gia đình tạo)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsOptional()
  familyId?: string;

  @ApiPropertyOptional({
    description: 'Số lượng suất thành viên đăng ký cho hợp đồng',
    default: 1,
  })
  @IsInt()
  @Min(1)
  @IsOptional()
  memberCount?: number;

  @ApiPropertyOptional({
    description:
      'Điều khoản bổ sung hoặc thỏa thuận đặc thù cho hợp đồng (nếu có)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalTerms?: string;

  @ApiPropertyOptional({
    description:
      'ID hợp đồng nháp chưa thanh toán cần hủy nguyên tử trước khi tạo hợp đồng mới (thay đổi gói hoặc số thành viên)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsOptional()
  replaceContractId?: string;

  @ApiPropertyOptional({
    description:
      'ID phiên gợi ý bác sĩ tự động (Track B) đã khớp thành công để xác nhận tạo hợp đồng',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsOptional()
  matchingSessionId?: string;

  @ApiPropertyOptional({
    description:
      'ID yêu cầu hàng chờ điều phối Admin đã được gán bác sĩ (status = ASSIGNED)',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID('4')
  @IsOptional()
  queueRequestId?: string;

  @ApiPropertyOptional({
    description: 'Địa chỉ thăm khám tại nhà của hộ gia đình (tùy chọn, có thể bổ sung sau)',
    example: 'Số 12, Phố ABC, Quận XYZ, Hà Nội',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  homeVisitAddress?: string;
}

export class CreateFourPartyContractDto extends CreateMedicalContractDto {}

export class CancelDraftContractDto {
  @ApiPropertyOptional({
    description: 'Lý do hủy bản nháp hợp đồng (tùy chọn)',
    example: 'Đổi gói chăm sóc khác',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
