import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '../common/enums';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { AdminService } from './admin.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

@ApiTags('admin')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('doctors')
  @ApiOperation({ summary: 'Create a doctor account and profile' })
  createDoctor(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDoctorDto,
  ) {
    return this.admin.createDoctor(user, dto);
  }

  @Get('users')
  @ApiOperation({ summary: 'List users and profile summaries' })
  users(@Query() query: AdminUserQueryDto) {
    return this.admin.listUsers(query);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Activate or deactivate a user account' })
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.admin.updateUserStatus(user, id, dto.isActive);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Read platform counts by role and appointment status',
  })
  stats() {
    return this.admin.stats();
  }

  @Get('audit-logs')
  @ApiOperation({
    summary: 'Read recent security and appointment audit events',
  })
  audit(@Query('limit') limit?: string) {
    const value = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      throw new BadRequestException('limit must be between 1 and 100');
    }
    return this.admin.recentAudit(value);
  }
}
