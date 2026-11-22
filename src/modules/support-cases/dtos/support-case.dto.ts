import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const trimStringArray = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : item))
    : value;

export const SUPPORT_CASE_TYPES = [
  'COMPLAINT_APPEAL',
  'COMPLAINT_QUESTION',
  'PAYMENT_ISSUE',
] as const;

export const SUPPORT_CASE_STATUSES = [
  'OPEN',
  'IN_REVIEW',
  'NEED_MORE_INFO',
  'RESOLVED',
  'CLOSED',
] as const;

export const ADMIN_TARGET_SUPPORT_STATUSES = [
  'IN_REVIEW',
  'NEED_MORE_INFO',
  'RESOLVED',
  'CLOSED',
] as const;

export class CreateComplaintSupportCaseDto {
  @IsUUID('4', { message: 'Mã hồ sơ khiếu nại không hợp lệ.' })
  complaintId!: string;

  @IsIn(['APPEAL', 'QUESTION'], {
    message: 'Loại yêu cầu phải là xem xét lại hoặc gửi câu hỏi.',
  })
  mode!: 'APPEAL' | 'QUESTION';

  @Transform(trimString)
  @IsString({ message: 'Nội dung gửi không hợp lệ.' })
  @Length(10, 2000, {
    message: 'Nội dung phải có độ dài từ 10 đến 2.000 ký tự.',
  })
  message!: string;

  @IsOptional()
  @Transform(trimStringArray)
  @IsArray({ message: 'Danh sách tệp đính kèm không hợp lệ.' })
  @ArrayMaxSize(5, { message: 'Chỉ được đính kèm tối đa 5 tệp mỗi lượt.' })
  @IsString({ each: true, message: 'Đường dẫn tệp đính kèm không hợp lệ.' })
  attachmentKeys?: string[];
}

export class CreatePaymentIssueCaseDto {
  @IsUUID('4', { message: 'Mã hợp đồng không hợp lệ.' })
  contractId!: string;

  @IsOptional()
  @IsUUID('4', { message: 'Mã yêu cầu thanh toán không hợp lệ.' })
  invoiceId?: string;

  @Transform(trimString)
  @IsString({ message: 'Mô tả sự cố chuyển khoản không hợp lệ.' })
  @Length(10, 2000, {
    message: 'Mô tả sự cố chuyển khoản phải có độ dài từ 10 đến 2.000 ký tự.',
  })
  message!: string;

  @IsOptional()
  @Transform(trimStringArray)
  @IsArray({ message: 'Danh sách tệp biên lai không hợp lệ.' })
  @ArrayMaxSize(5, { message: 'Chỉ được đính kèm tối đa 5 tệp biên lai.' })
  @IsString({ each: true, message: 'Đường dẫn tệp biên lai không hợp lệ.' })
  attachmentKeys?: string[];
}

export class PostSupportMessageDto {
  @Transform(trimString)
  @IsString({ message: 'Nội dung tin nhắn không hợp lệ.' })
  @Length(2, 2000, {
    message: 'Nội dung trao đổi phải có độ dài từ 2 đến 2.000 ký tự.',
  })
  body!: string;

  @IsOptional()
  @Transform(trimStringArray)
  @IsArray({ message: 'Danh sách tệp đính kèm không hợp lệ.' })
  @ArrayMaxSize(5, { message: 'Chỉ được đính kèm tối đa 5 tệp mỗi lượt.' })
  @IsString({ each: true, message: 'Đường dẫn tệp đính kèm không hợp lệ.' })
  attachmentKeys?: string[];
}

export class UpdateSupportCaseStatusDto {
  @IsIn(ADMIN_TARGET_SUPPORT_STATUSES, {
    message:
      'Trạng thái chuyển đổi phải là IN_REVIEW, NEED_MORE_INFO, RESOLVED hoặc CLOSED.',
  })
  status!: (typeof ADMIN_TARGET_SUPPORT_STATUSES)[number];

  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'Kết luận xử lý không hợp lệ.' })
  @Length(10, 2000, {
    message: 'Kết luận xử lý phải có độ dài từ 10 đến 2.000 ký tự.',
  })
  resolutionSummary?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'Nội dung phản hồi không hợp lệ.' })
  @Length(2, 2000, {
    message: 'Nội dung phản hồi phải có độ dài từ 2 đến 2.000 ký tự.',
  })
  replyMessage?: string;
}

export class ListSupportCasesQueryDto {
  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'Bộ lọc loại hồ sơ không hợp lệ.' })
  type?: string;

  @IsOptional()
  @IsIn(SUPPORT_CASE_STATUSES, {
    message: 'Bộ lọc trạng thái hồ sơ không hợp lệ.',
  })
  status?: (typeof SUPPORT_CASE_STATUSES)[number];

  @IsOptional()
  @IsIn(['true'], { message: 'Bộ lọc hồ sơ đang mở không hợp lệ.' })
  onlyOpen?: 'true';

  @IsOptional()
  @IsUUID('4', { message: 'Mã khiếu nại không hợp lệ.' })
  complaintId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Mã yêu cầu thanh toán không hợp lệ.' })
  invoiceId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Mã hợp đồng không hợp lệ.' })
  contractId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Trang phải là số nguyên dương.' })
  @Min(1, { message: 'Trang phải lớn hơn hoặc bằng 1.' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số lượng mỗi trang phải là số nguyên.' })
  @Min(1, { message: 'Số lượng mỗi trang tối thiểu là 1.' })
  @Max(50, { message: 'Số lượng mỗi trang tối đa là 50.' })
  limit?: number;
}

export class DownloadSupportAttachmentQueryDto {
  @Transform(trimString)
  @IsString({ message: 'Đường dẫn tệp đính kèm không hợp lệ.' })
  @Length(3, 500, { message: 'Đường dẫn tệp đính kèm không hợp lệ.' })
  key!: string;
}
