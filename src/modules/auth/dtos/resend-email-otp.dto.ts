import { IsEmail, IsNotEmpty } from 'class-validator';

export class ResendEmailOtpDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
