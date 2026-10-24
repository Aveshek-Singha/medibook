import {
  IsEmail,
  IsOptional,
  IsString,
  IsStrongPassword,
  Length,
  Matches,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @Length(5, 190)
  email: string;

  @IsStrongPassword({
    minLength: 12,
    minNumbers: 1,
    minSymbols: 1,
    minUppercase: 1,
    minLowercase: 1,
  })
  password: string;

  @IsString()
  @Length(2, 120)
  fullName: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{6,19}$/)
  phone?: string;
}
