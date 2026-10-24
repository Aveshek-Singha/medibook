import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLog } from '../audit/audit-log.entity';
import { Appointment } from './appointment.entity';
import { AvailabilitySlot } from '../slots/availability-slot.entity';
import { Doctor } from '../doctors/doctor.entity';
import { Patient } from '../patients/patient.entity';
import { SmsOutbox } from '../notifications/sms-outbox.entity';
import {
  AppointmentsController,
  DoctorAppointmentsController,
} from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      Appointment,
      AvailabilitySlot,
      Doctor,
      Patient,
      SmsOutbox,
      AuditLog,
    ]),
  ],
  controllers: [AppointmentsController, DoctorAppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
