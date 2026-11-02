import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CreateAuthDto } from '../dtos/create-auth.dto';
import { UpdateAuthDto } from '../dtos/update-auth.dto';
import { RegisterFamilyRepDto } from '../dtos/register-family-rep.dto';
import { VerifyEmailOtpDto } from '../dtos/verify-email-otp.dto';
import { ResendEmailOtpDto } from '../dtos/resend-email-otp.dto';
import { LoginDto } from '../dtos/login.dto';
import { ForgotPasswordDto } from '../dtos/forgot-password.dto';
import { ResetPasswordDto } from '../dtos/reset-password.dto';
import { ChangePasswordDto } from '../dtos/change-password.dto';
import { AUTH_SERVICE_TOKEN } from '../services/interfaces/auth.service.interface';
import type { IAuthService } from '../services/interfaces/auth.service.interface';

@ApiTags('Auth')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    @Inject(AUTH_SERVICE_TOKEN)
    private readonly authService: IAuthService,
  ) {}

  findAll() {
    return this.authService.findAll();
  }

  findOne(@Param('id') id: string) {
    return this.authService.findOne(id);
  }

  create(@Body() dto: CreateAuthDto) {
    return this.authService.create(dto);
  }

  update(@Param('id') id: string, @Body() dto: UpdateAuthDto) {
    return this.authService.update(id, dto);
  }

  remove(@Param('id') id: string) {
    return this.authService.remove(id);
  }

  @Post('register-representative')
  @ApiOperation({ summary: 'Đăng ký tài khoản Người đại diện gia đình (Family Representative)' })
  @ApiBody({ type: RegisterFamilyRepDto })
  @ApiResponse({ status: 201, description: 'Gửi OTP thành công đến email đăng ký' })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ hoặc đã tồn tại' })
  registerFamilyRepresentative(@Body() dto: RegisterFamilyRepDto) {
    return this.authService.registerFamilyRepresentative(dto);
  }

  @Post('register')
  @ApiOperation({ summary: 'Alias đăng ký tài khoản Người đại diện gia đình' })
  @ApiBody({ type: RegisterFamilyRepDto })
  @ApiResponse({ status: 201, description: 'Gửi OTP thành công đến email đăng ký' })
  registerFamilyRep(@Body() dto: RegisterFamilyRepDto) {
    return this.authService.registerFamilyRepresentative(dto);
  }

  @Post('verify-email-otp')
  @ApiOperation({ summary: 'Xác thực OTP đăng ký tài khoản qua email' })
  @ApiBody({ type: VerifyEmailOtpDto })
  @ApiResponse({ status: 201, description: 'Xác thực OTP thành công, tài khoản đã được kích hoạt' })
  @ApiResponse({ status: 401, description: 'OTP không hợp lệ hoặc đã hết hạn' })
  async verifyEmailOtp(@Body() dto: VerifyEmailOtpDto) {
    const { passwordHash: _hash, ...user } =
      await this.authService.verifyEmailOtp(dto);
    return user;
  }

  @Post('resend-email-otp')
  @ApiOperation({ summary: 'Gửi lại OTP qua email (có cooldown 60s)' })
  @ApiBody({ type: ResendEmailOtpDto })
  @ApiResponse({ status: 201, description: 'Đã gửi lại mã OTP thành công' })
  @ApiResponse({ status: 429, description: 'Vui lòng chờ hết thời gian giãn cách trước khi gửi lại' })
  resendEmailOtp(@Body() dto: ResendEmailOtpDto) {
    return this.authService.resendEmailOtp(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập hệ thống (Email/SĐT và mật khẩu)' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'Đăng nhập thành công, trả về JWT Access Token' })
  @ApiResponse({ status: 401, description: 'Sai tên đăng nhập hoặc mật khẩu' })
  @ApiResponse({ status: 403, description: 'Tài khoản bị tạm khóa 30 phút do sai quá 5 lần' })
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.authService.login(dto, req?.ip);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Đăng xuất và thu hồi Access Token' })
  @ApiResponse({ status: 200, description: 'Đăng xuất thành công' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực hoặc token không hợp lệ' })
  logout(@Req() req: any) {
    const authHeader = req?.headers?.authorization || '';
    return this.authService.logout(req?.user?.id, authHeader);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Yêu cầu OTP đặt lại mật khẩu' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiResponse({ status: 201, description: 'Đã gửi OTP khôi phục mật khẩu nếu email tồn tại' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Đặt lại mật khẩu mới bằng OTP' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({ status: 201, description: 'Đặt lại mật khẩu thành công' })
  @ApiResponse({ status: 401, description: 'OTP không hợp lệ hoặc đã hết hạn' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('change-password')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Đổi mật khẩu cho người dùng hiện tại' })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({ status: 200, description: 'Đổi mật khẩu thành công' })
  @ApiResponse({ status: 400, description: 'Mật khẩu hiện tại không đúng hoặc trùng mật khẩu cũ' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req?.user?.id, dto);
  }
}
