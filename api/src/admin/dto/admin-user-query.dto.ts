import { IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '../../common/enums';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class AdminUserQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
