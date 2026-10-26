import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Req,
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

  @Get()
  findAll() {
    return this.authService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.authService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateAuthDto) {
    return this.authService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAuthDto) {
    return this.authService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.authService.remove(id);
  }

  @Post('register')
  registerFamilyRep(@Body() dto: RegisterFamilyRepDto) {
    return this.authService.registerFamilyRep(dto);
  }

  @Post('verify-email-otp')
  verifyEmailOtp(@Body() dto: VerifyEmailOtpDto) {
    return this.authService.verifyEmailOtp(dto);
  }

  @Post('resend-email-otp')
  resendEmailOtp(@Body() dto: ResendEmailOtpDto) {
    return this.authService.resendEmailOtp(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.authService.login(dto, req?.ip);
  }

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

  @Put('change-password')
  changePassword(@Req() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req?.user?.id, dto);
  }
}
