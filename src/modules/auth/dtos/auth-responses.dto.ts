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
