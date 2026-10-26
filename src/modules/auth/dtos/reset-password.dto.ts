import { IsEmail, IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  @Matches(/^[0-9]{6}$/)
  otp!: string;

  @IsString()
  @Length(8, 64)
  newPassword!: string;
}
