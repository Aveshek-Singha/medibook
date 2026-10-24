import {
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
import { AppointmentQueryDto } from './dto/appointment-query.dto';
import { BookAppointmentDto } from './dto/book-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { AppointmentsService } from './appointments.service';
import { DoctorAppointmentQueryDto } from './dto/doctor-appointment-query.dto';

@ApiTags('patients')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.PATIENT)
@Controller({ path: 'appointments', version: '1' })
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Book an available slot' })
  book(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: BookAppointmentDto,
  ) {
    return this.appointments.book(user, dto.slotId);
  }

  @Get('me')
  @ApiOperation({ summary: 'List the current patient appointments' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AppointmentQueryDto,
  ) {
    return this.appointments.listForPatient(user, query);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a future appointment' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.appointments.cancel(user, id);
  }

  @Patch(':id/reschedule')
  @ApiOperation({
    summary: 'Move an appointment to another slot with the same doctor',
  })
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointments.reschedule(user, id, dto.newSlotId);
  }
}

@ApiTags('doctor')
@ApiBearerAuth('bearer')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.DOCTOR)
@Controller({ path: 'doctor/appointments', version: '1' })
export class DoctorAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List appointments for the signed-in doctor' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DoctorAppointmentQueryDto,
  ) {
    return this.appointments.listForDoctor(user, query);
  }

  @Patch(':id/complete')
  @ApiOperation({ summary: 'Mark a past appointment as completed' })
  complete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.appointments.complete(user, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancel a future appointment owned by the doctor' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.appointments.cancel(user, id);
  }
}
