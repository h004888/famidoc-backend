import {
  ProblemDetails,
  ApiResponse as CoreApiResponse,
  ApiSuccessResponse,
  ApiErrorResponse,
  InvalidParamItem,
} from '../../../core/types/api-response.interface';

export type StandardApiErrorDetails = ProblemDetails;
export type StandardApiResponse<T = any> = CoreApiResponse<T>;
export type { ApiSuccessResponse, ApiErrorResponse, InvalidParamItem };

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterInitiateDataDto {
  @ApiProperty({
    example: 'vana.nguyen@example.com',
    description: 'Email người dùng đăng ký nhận OTP',
  })
  email!: string;

  @ApiProperty({
    example: 300,
    description: 'Thời gian hiệu lực của mã OTP tính bằng giây',
  })
  expiresInSeconds!: number;

  @ApiPropertyOptional({
    example: '123456',
    description: 'Mã OTP thử nghiệm (chỉ xuất hiện trong môi trường test/development)',
  })
  devOtp?: string;
}

export type RegisterInitiateData = RegisterInitiateDataDto;
export type RegisterInitiateResponse = RegisterInitiateData;

export class AuthUserDto {
  @ApiProperty({
    example: '10000000-0000-4000-8000-000000000001',
    description: 'ID người dùng',
  })
  id!: string;

  @ApiProperty({
    example: 'vana.nguyen@example.com',
    description: 'Email người dùng',
  })
  email!: string;

  @ApiPropertyOptional({
    example: '0987654321',
    description: 'Số điện thoại',
  })
  phone?: string | null;

  @ApiProperty({
    example: 'Nguyễn Văn A',
    description: 'Họ và tên người dùng',
  })
  fullName!: string;

  @ApiProperty({
    example: 'FAMILY_REP',
    description: 'Vai trò người dùng trong hệ thống',
  })
  role!: string;

  @ApiProperty({
    example: 'ACTIVE',
    description: 'Trạng thái hoạt động của tài khoản',
  })
  status!: string;

  @ApiPropertyOptional({
    example: null,
    description: 'Đường dẫn ảnh đại diện',
  })
  avatarUrl?: string | null;
}

export class LoginDataDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT Access Token dùng cho các request tiếp theo',
  })
  accessToken!: string;

  @ApiProperty({
    example: 'FAMILY_REP',
    description: 'Vai trò của tài khoản',
  })
  role!: string;

  @ApiProperty({
    type: () => AuthUserDto,
    description: 'Thông tin tài khoản đã đăng nhập',
  })
  user!: AuthUserDto;
}

export type LoginResponseDto = LoginDataDto;

export interface LoginSuccessResponse {
  accessToken: string;
  role: string;
  user: {
    id: string;
    email: string;
    phone?: string | null;
    fullName: string;
    role: string;
    status: string;
    avatarUrl?: string | null;
  };
}

export interface ApiResponseMessage {
  message: string;
  success: boolean;
}
