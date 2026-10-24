import { IsOptional, IsString, Length } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class DoctorQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  specialty?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;
}
