import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserRole } from '../common/enums';
import { CreateSlotsDto } from './dto/create-slots.dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { SlotsService } from './slots.service';

@ApiTags('doctor')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.DOCTOR)
@Controller({ path: 'doctor/slots', version: '1' })
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Get()
  @ApiOperation({ summary: 'List upcoming available slots for the doctor' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.slots.listForDoctor(user, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create up to 200 non-overlapping slots' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSlotsDto) {
    return this.slots.create(user, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an unused available slot' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.slots.remove(user, id);
  }
}
