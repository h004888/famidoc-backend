import { Module } from '@nestjs/common';
import { AuthAccessModule } from '../../core/auth/auth-access.module';
import { ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { AuthController } from './controllers/auth.controller';
import { AUTH_REPOSITORY_TOKEN } from './repositories/interfaces/auth.repository.interface';
import { AuthRepositoryImpl } from './repositories/impl/auth.repository.impl';
import { AUTH_SERVICE_TOKEN } from './services/interfaces/auth.service.interface';
import { AuthServiceImpl } from './services/impl/auth.service.impl';

@Module({
  imports: [AuthAccessModule],
  controllers: [AuthController],
  providers: [
    { provide: AUTH_REPOSITORY_TOKEN, useClass: AuthRepositoryImpl },
    { provide: AUTH_SERVICE_TOKEN, useClass: AuthServiceImpl },
    {
      provide: 'MAILER_SERVICE',
      // Không trả thành công giả khi chưa cấu hình máy chủ gửi OTP.
      useFactory: () => ({
        sendMail: async (options: Record<string, unknown>) => {
          if (!process.env.SMTP_URL || !process.env.MAIL_FROM)
            throw new ServiceUnavailableException(
              'Configure SMTP_URL and MAIL_FROM to send email',
            );
          return nodemailer
            .createTransport(process.env.SMTP_URL)
            .sendMail({ ...options, from: process.env.MAIL_FROM });
        },
      }),
    },
  ],
  exports: [AUTH_SERVICE_TOKEN],
})
export class AuthModule {}
