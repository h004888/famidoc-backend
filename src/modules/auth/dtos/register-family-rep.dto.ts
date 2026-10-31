import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class RegisterFamilyRepDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[0-9]{10,11}$/, {
    message: 'Phone must be a valid 10-11 digit phone number',
  })
  phone!: string;

  @IsEmail({}, { message: 'Email must be a valid email address' })
  @IsNotEmpty()
  email!: string;

  @IsString()
  @Length(8, 64, { message: 'Password must be between 8 and 64 characters' })
  password!: string;

  @IsBoolean()
  acceptedTerms!: boolean;

  @IsOptional()
  @IsString()
  homeAddress?: string;
}
