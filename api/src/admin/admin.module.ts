import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AuditLog } from '../audit/audit-log.entity';
import { Doctor } from '../doctors/doctor.entity';
import { Patient } from '../patients/patient.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { User } from '../users/user.entity';
import { Appointment } from '../appointments/appointment.entity';
import { AvailabilitySlot } from '../slots/availability-slot.entity';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      User,
      Doctor,
      Patient,
      RefreshToken,
      Appointment,
      AvailabilitySlot,
      AuditLog,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
