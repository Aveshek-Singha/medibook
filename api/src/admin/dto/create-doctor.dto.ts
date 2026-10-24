import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  IsStrongPassword,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDoctorDto {
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

  @IsString()
  @Length(2, 100)
  specialty: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  bio?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  consultationFee: number;
}
