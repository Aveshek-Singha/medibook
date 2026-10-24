import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  AppointmentStatus,
  AuditAction,
  SmsOutboxStatus,
  SmsType,
  SlotStatus,
  UserRole,
} from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { normalizePagination, paginate } from '../common/utils/pagination';
import { dhakaDateRange } from '../common/utils/time';
import { AuditLog } from '../audit/audit-log.entity';
import { Doctor } from '../doctors/doctor.entity';
import { Patient } from '../patients/patient.entity';
import { AvailabilitySlot } from '../slots/availability-slot.entity';
import { NotificationQueueService } from '../notifications/notification-queue.service';
import { SmsOutbox } from '../notifications/sms-outbox.entity';
import { Appointment } from './appointment.entity';

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    @InjectRepository(AvailabilitySlot)
    private readonly slots: Repository<AvailabilitySlot>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly notifications: NotificationQueueService,
  ) {}

  async book(user: AuthenticatedUser, slotId: string) {
    if (!user.patientId)
      throw new NotFoundException('Patient profile was not found');
    try {
      const created = await this.dataSource.transaction(async (manager) => {
        const slot = await manager
          .getRepository(AvailabilitySlot)
          .createQueryBuilder('slot')
          .setLock('pessimistic_write')
          .where('slot.id = :slotId', { slotId })
          .getOne();
        if (!slot) throw new NotFoundException('Slot was not found');
        if (slot.status !== SlotStatus.AVAILABLE) {
          throw new ConflictException('Slot is no longer available');
        }
        this.assertBookable(slot.startTime);

        const doctor = await manager.getRepository(Doctor).findOne({
          where: { id: slot.doctorId },
          relations: { user: true },
        });
        if (!doctor || !doctor.user.isActive) {
          throw new NotFoundException('Doctor is unavailable');
        }
        const patient = await manager.getRepository(Patient).findOne({
          where: { id: user.patientId },
          relations: { user: true },
        });
        if (!patient?.user.isActive)
          throw new ForbiddenException('Patient account is unavailable');

        slot.status = SlotStatus.BOOKED;
        await manager.getRepository(AvailabilitySlot).save(slot);
        const appointment = await manager.getRepository(Appointment).save(
          manager.getRepository(Appointment).create({
            slotId: slot.id,
            doctorId: doctor.id,
            patientId: patient.id,
            startTime: slot.startTime,
            endTime: slot.endTime,
            consultationFee: doctor.consultationFee,
            status: AppointmentStatus.CONFIRMED,
          }),
        );
        await this.addOutbox(
          manager,
          appointment,
          patient.user.phone,
          SmsType.CONFIRMATION,
          new Date(),
        );
        await this.addReminderOutbox(manager, appointment, patient.user.phone);
        await this.addAudit(
          manager,
          user.id,
          AuditAction.APPOINTMENT_BOOKED,
          appointment.id,
          {
            slotId: slot.id,
          },
        );
        return appointment;
      });
      return this.getOne(created.id);
    } catch (error) {
      if (this.isDuplicate(error))
        throw new ConflictException('Slot is no longer available');
      throw error;
    }
  }

  async listForPatient(
    user: AuthenticatedUser,
    input: {
      page?: number;
      limit?: number;
      status?: AppointmentStatus;
    },
  ) {
    if (!user.patientId)
      throw new NotFoundException('Patient profile was not found');
    const { page, limit } = normalizePagination(input);
    const query = this.appointmentQuery().where(
      'appointment.patientId = :patientId',
      { patientId: user.patientId },
    );
    if (input.status)
      query.andWhere('appointment.status = :status', { status: input.status });
    query.orderBy('appointment.startTime', 'DESC');
    const [rows, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return paginate(
      rows.map((appointment) => this.publicAppointment(appointment)),
      total,
      page,
      limit,
    );
  }

  async listForDoctor(
    user: AuthenticatedUser,
    input: {
      page?: number;
      limit?: number;
      status?: AppointmentStatus;
      from?: string;
      to?: string;
    },
  ) {
    if (!user.doctorId)
      throw new NotFoundException('Doctor profile was not found');
    const { page, limit } = normalizePagination(input);
    const query = this.appointmentQuery().where(
      'appointment.doctorId = :doctorId',
      { doctorId: user.doctorId },
    );
    if (input.status)
      query.andWhere('appointment.status = :status', { status: input.status });
    if (input.from || input.to) {
      const from = input.from ?? input.to!;
      const to = input.to ?? input.from!;
      const range = dhakaDateRange(
        from,
        to,
        this.config.get<string>('APP_TIMEZONE', 'Asia/Dhaka'),
      );
      query.andWhere(
        'appointment.startTime >= :from AND appointment.startTime < :to',
        { from: range.start, to: range.end },
      );
    }
    query.orderBy('appointment.startTime', 'ASC');
    const [rows, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return paginate(
      rows.map((appointment) => this.publicAppointment(appointment)),
      total,
      page,
      limit,
    );
  }

  async cancel(user: AuthenticatedUser, id: string) {
    const appointmentId = this.requireId(id);
    const outcome = await this.dataSource.transaction(async (manager) => {
      const appointment = await this.lockAppointment(manager, appointmentId);
      this.assertOwner(user, appointment);
      if (appointment.status !== AppointmentStatus.CONFIRMED) {
        throw new ConflictException(
          'Only confirmed appointments can be cancelled',
        );
      }
      if (appointment.startTime <= new Date()) {
        throw new BadRequestException('A past appointment cannot be cancelled');
      }
      const slot = await manager
        .getRepository(AvailabilitySlot)
        .createQueryBuilder('slot')
        .setLock('pessimistic_write')
        .where('slot.id = :slotId', { slotId: appointment.slotId })
        .getOne();
      if (!slot)
        throw new ConflictException(
          'The appointment slot is no longer available',
        );

      const patient = await manager.getRepository(Patient).findOne({
        where: { id: appointment.patientId },
        relations: { user: true },
      });
      slot.status = SlotStatus.AVAILABLE;
      appointment.status = AppointmentStatus.CANCELLED;
      await manager.getRepository(AvailabilitySlot).save(slot);
      await manager.getRepository(Appointment).save(appointment);
      await this.cancelPendingReminders(manager, appointment.id);
      await this.addOutbox(
        manager,
        appointment,
        patient?.user.phone ?? null,
        SmsType.CANCELLATION,
        new Date(),
      );
      await this.addAudit(
        manager,
        user.id,
        AuditAction.APPOINTMENT_CANCELLED,
        appointment.id,
        {
          slotId: appointment.slotId,
        },
      );
      return { appointmentId: appointment.id, slotId: appointment.slotId };
    });
    await this.notifications.removeReminderJobs(
      outcome.appointmentId,
      outcome.slotId,
    );
    return this.getOne(outcome.appointmentId);
  }

  async reschedule(user: AuthenticatedUser, id: string, newSlotId: string) {
    if (user.role !== UserRole.PATIENT || !user.patientId) {
      throw new ForbiddenException('Only patients may reschedule appointments');
    }
    const appointmentId = this.requireId(id);
    const destinationId = this.requireId(newSlotId);

    try {
      const outcome = await this.dataSource.transaction(async (manager) => {
        const appointment = await this.lockAppointment(manager, appointmentId);
        this.assertOwner(user, appointment);
        if (appointment.status !== AppointmentStatus.CONFIRMED) {
          throw new ConflictException(
            'Only confirmed appointments can be rescheduled',
          );
        }
        if (appointment.slotId === destinationId) {
          throw new BadRequestException('Choose a different slot');
        }
        if (appointment.startTime <= new Date()) {
          throw new BadRequestException(
            'A past appointment cannot be rescheduled',
          );
        }

        const slotIds = [appointment.slotId, destinationId].sort((a, b) =>
          BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0,
        );
        const lockedSlots = await manager
          .getRepository(AvailabilitySlot)
          .createQueryBuilder('slot')
          .setLock('pessimistic_write')
          .where('slot.id IN (:...slotIds)', { slotIds })
          .orderBy('slot.id', 'ASC')
          .getMany();
        const oldSlot = lockedSlots.find(
          (slot) => slot.id === appointment.slotId,
        );
        const newSlot = lockedSlots.find((slot) => slot.id === destinationId);
        if (!oldSlot || !newSlot || newSlot.doctorId !== appointment.doctorId) {
          throw new ConflictException(
            'Choose another slot with the same doctor',
          );
        }
        if (newSlot.status !== SlotStatus.AVAILABLE) {
          throw new ConflictException('Slot is no longer available');
        }
        this.assertBookable(newSlot.startTime);

        const patient = await manager.getRepository(Patient).findOne({
          where: { id: appointment.patientId },
          relations: { user: true },
        });
        const previousSlotId = appointment.slotId;
        oldSlot.status = SlotStatus.AVAILABLE;
        newSlot.status = SlotStatus.BOOKED;
        appointment.slotId = newSlot.id;
        appointment.startTime = newSlot.startTime;
        appointment.endTime = newSlot.endTime;
        await manager.getRepository(AvailabilitySlot).save([oldSlot, newSlot]);
        await manager.getRepository(Appointment).save(appointment);
        await this.cancelPendingReminders(manager, appointment.id);
        await this.addOutbox(
          manager,
          appointment,
          patient?.user.phone ?? null,
          SmsType.RESCHEDULED,
          new Date(),
        );
        await this.addReminderOutbox(
          manager,
          appointment,
          patient?.user.phone ?? null,
        );
        await this.addAudit(
          manager,
          user.id,
          AuditAction.APPOINTMENT_RESCHEDULED,
          appointment.id,
          {
            previousSlotId,
            newSlotId: newSlot.id,
          },
        );
        return { appointmentId: appointment.id, previousSlotId };
      });
      await this.notifications.removeReminderJobs(
        outcome.appointmentId,
        outcome.previousSlotId,
      );
      return this.getOne(outcome.appointmentId);
    } catch (error) {
      if (this.isDuplicate(error))
        throw new ConflictException('Slot is no longer available');
      throw error;
    }
  }

  async complete(user: AuthenticatedUser, id: string) {
    if (!user.doctorId)
      throw new NotFoundException('Doctor profile was not found');
    const appointmentId = this.requireId(id);
    await this.dataSource.transaction(async (manager) => {
      const appointment = await this.lockAppointment(manager, appointmentId);
      if (appointment.doctorId !== user.doctorId)
        throw new ForbiddenException('Appointment belongs to another doctor');
      if (appointment.status !== AppointmentStatus.CONFIRMED) {
        throw new ConflictException(
          'Only confirmed appointments can be completed',
        );
      }
      if (appointment.endTime > new Date()) {
        throw new BadRequestException(
          'An appointment can be completed after its scheduled end time',
        );
      }
      appointment.status = AppointmentStatus.COMPLETED;
      await manager.getRepository(Appointment).save(appointment);
      await this.cancelPendingReminders(manager, appointment.id);
      await this.addAudit(
        manager,
        user.id,
        AuditAction.APPOINTMENT_COMPLETED,
        appointment.id,
        null,
      );
    });
    return this.getOne(appointmentId);
  }

  private async getOne(id: string) {
    const appointment = await this.appointmentQuery()
      .where('appointment.id = :id', { id })
      .getOne();
    if (!appointment) throw new NotFoundException('Appointment was not found');
    return this.publicAppointment(appointment);
  }

  private appointmentQuery() {
    return this.appointments
      .createQueryBuilder('appointment')
      .leftJoinAndSelect('appointment.doctor', 'doctor')
      .leftJoinAndSelect('doctor.user', 'doctorUser')
      .leftJoinAndSelect('appointment.patient', 'patient')
      .leftJoinAndSelect('patient.user', 'patientUser')
      .leftJoinAndSelect('appointment.slot', 'slot');
  }

  private publicAppointment(appointment: Appointment) {
    return {
      id: appointment.id,
      slotId: appointment.slotId,
      doctor: appointment.doctor
        ? {
            id: appointment.doctor.id,
            fullName: appointment.doctor.user?.fullName,
            specialty: appointment.doctor.specialty,
          }
        : undefined,
      patient: appointment.patient
        ? {
            id: appointment.patient.id,
            fullName: appointment.patient.user?.fullName,
          }
        : undefined,
      startTime: appointment.startTime.toISOString(),
      endTime: appointment.endTime.toISOString(),
      consultationFee: appointment.consultationFee,
      status: appointment.status,
    };
  }

  private async lockAppointment(manager: EntityManager, id: string) {
    const appointment = await manager
      .getRepository(Appointment)
      .createQueryBuilder('appointment')
      .setLock('pessimistic_write')
      .where('appointment.id = :id', { id })
      .getOne();
    if (!appointment) throw new NotFoundException('Appointment was not found');
    return appointment;
  }

  private assertOwner(user: AuthenticatedUser, appointment: Appointment) {
    if (
      user.role === UserRole.PATIENT &&
      appointment.patientId !== user.patientId
    ) {
      throw new ForbiddenException('Appointment belongs to another patient');
    }
    if (
      user.role === UserRole.DOCTOR &&
      appointment.doctorId !== user.doctorId
    ) {
      throw new ForbiddenException('Appointment belongs to another doctor');
    }
  }

  private assertBookable(startTime: Date) {
    const minimumLead =
      this.config.get<number>('MIN_BOOKING_LEAD_MINUTES', 30) * 60_000;
    if (startTime <= new Date())
      throw new BadRequestException('A past slot cannot be booked');
    if (startTime.getTime() < Date.now() + minimumLead) {
      throw new BadRequestException(
        'Slot does not meet the minimum booking lead time',
      );
    }
  }

  private async addReminderOutbox(
    manager: EntityManager,
    appointment: Appointment,
    phone: string | null,
  ) {
    if (!phone) return;
    const now = new Date();
    const reminders = [
      {
        type: SmsType.REMINDER_24H,
        sendAt: new Date(appointment.startTime.getTime() - 24 * 60 * 60 * 1000),
      },
      {
        type: SmsType.REMINDER_1H,
        sendAt: new Date(appointment.startTime.getTime() - 60 * 60 * 1000),
      },
    ].filter((reminder) => reminder.sendAt > now);
    for (const reminder of reminders) {
      await manager.getRepository(SmsOutbox).save(
        manager.getRepository(SmsOutbox).create({
          appointmentId: appointment.id,
          type: reminder.type,
          toPhone: phone,
          sendAt: reminder.sendAt,
          status: SmsOutboxStatus.PENDING,
          attempts: 0,
          lastError: null,
          dispatchedAt: null,
        }),
      );
    }
  }

  private async addOutbox(
    manager: EntityManager,
    appointment: Appointment,
    phone: string | null,
    type: SmsType,
    sendAt: Date,
  ) {
    if (!phone) return;
    await manager.getRepository(SmsOutbox).save(
      manager.getRepository(SmsOutbox).create({
        appointmentId: appointment.id,
        type,
        toPhone: phone,
        sendAt,
        status: SmsOutboxStatus.PENDING,
        attempts: 0,
        lastError: null,
        dispatchedAt: null,
      }),
    );
  }

  private async cancelPendingReminders(
    manager: EntityManager,
    appointmentId: string,
  ) {
    await manager
      .getRepository(SmsOutbox)
      .createQueryBuilder()
      .update(SmsOutbox)
      .set({
        status: SmsOutboxStatus.CANCELLED,
        lastError: 'Appointment schedule changed',
      })
      .where('appointment_id = :appointmentId', { appointmentId })
      .andWhere('type IN (:...types)', {
        types: [
          SmsType.CONFIRMATION,
          SmsType.RESCHEDULED,
          SmsType.REMINDER_24H,
          SmsType.REMINDER_1H,
        ],
      })
      .andWhere('status = :status', { status: SmsOutboxStatus.PENDING })
      .execute();
  }

  private async addAudit(
    manager: EntityManager,
    actorUserId: string,
    action: AuditAction,
    entityId: string,
    metadata: Record<string, unknown> | null,
  ) {
    await manager.getRepository(AuditLog).save(
      manager.getRepository(AuditLog).create({
        actorUserId,
        action,
        entityType: 'appointment',
        entityId,
        metadata,
      }),
    );
  }

  private requireId(value: string): string {
    if (!/^[1-9]\d{0,19}$/.test(value))
      throw new BadRequestException('Invalid id');
    return value;
  }

  private isDuplicate(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ER_DUP_ENTRY'
    );
  }
}
