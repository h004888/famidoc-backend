import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import {
  Body,
  Controller,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
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
  registerFamilyRepresentative(@Body() dto: RegisterFamilyRepDto) {
    return this.authService.registerFamilyRepresentative(dto);
  }

  @Post('register')
  registerFamilyRep(@Body() dto: RegisterFamilyRepDto) {
    return this.authService.registerFamilyRepresentative(dto);
  }

  @Post('verify-email-otp')
  async verifyEmailOtp(@Body() dto: VerifyEmailOtpDto) {
    const { passwordHash: _hash, ...user } =
      await this.authService.verifyEmailOtp(dto);
    return user;
  }

  @Post('resend-email-otp')
  resendEmailOtp(@Body() dto: ResendEmailOtpDto) {
    return this.authService.resendEmailOtp(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.authService.login(dto, req?.ip);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  logout(@Req() req: any) {
    const authHeader = req?.headers?.authorization || '';
    return this.authService.logout(req?.user?.id, authHeader);
  }

  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Put('change-password')
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req?.user?.id, dto);
  }
}
