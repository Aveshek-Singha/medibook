import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import * as argon2 from 'argon2';
import { DataSource, IsNull, Repository } from 'typeorm';
import {
  AuditAction,
  AppointmentStatus,
  SlotStatus,
  UserRole,
} from '../common/enums';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { normalizePagination, paginate } from '../common/utils/pagination';
import { AuditLog } from '../audit/audit-log.entity';
import { Doctor } from '../doctors/doctor.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { User } from '../users/user.entity';
import { Appointment } from '../appointments/appointment.entity';
import { AvailabilitySlot } from '../slots/availability-slot.entity';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    @InjectRepository(AvailabilitySlot)
    private readonly slots: Repository<AvailabilitySlot>,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminService.name);
  }

  async createDoctor(
    actor: AuthenticatedUser,
    input: {
      email: string;
      password: string;
      fullName: string;
      phone?: string;
      specialty: string;
      bio?: string;
      consultationFee: number;
    },
  ) {
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    try {
      const doctor = await this.dataSource.transaction(async (manager) => {
        const user = await manager.getRepository(User).save(
          manager.getRepository(User).create({
            email: input.email.trim().toLowerCase(),
            passwordHash,
            role: UserRole.DOCTOR,
            fullName: input.fullName.trim(),
            phone: input.phone ?? null,
            isActive: true,
            tokenVersion: 0,
          }),
        );
        const profile = await manager.getRepository(Doctor).save(
          manager.getRepository(Doctor).create({
            userId: user.id,
            specialty: input.specialty.trim(),
            bio: input.bio?.trim() || null,
            consultationFee: input.consultationFee,
          }),
        );
        await manager.getRepository(AuditLog).save(
          manager.getRepository(AuditLog).create({
            actorUserId: actor.id,
            action: AuditAction.DOCTOR_CREATED,
            entityType: 'doctor',
            entityId: profile.id,
            metadata: { userId: user.id, specialty: profile.specialty },
          }),
        );
        return {
          id: profile.id,
          userId: user.id,
          fullName: user.fullName,
          specialty: profile.specialty,
          bio: profile.bio,
          consultationFee: profile.consultationFee,
        };
      });
      return doctor;
    } catch (error) {
      if (this.isDuplicate(error))
        throw new ConflictException('Email is already registered');
      throw error;
    }
  }

  async listUsers(input: { page?: number; limit?: number; role?: UserRole }) {
    const { page, limit } = normalizePagination(input);
    const query = this.users
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.doctor', 'doctor')
      .leftJoinAndSelect('user.patient', 'patient');
    if (input.role) query.andWhere('user.role = :role', { role: input.role });
    const [rows, total] = await query
      .orderBy('user.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return paginate(
      rows.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        phone: user.phone,
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
        doctor: user.doctor
          ? {
              id: user.doctor.id,
              specialty: user.doctor.specialty,
              consultationFee: user.doctor.consultationFee,
            }
          : undefined,
        patientId: user.patient?.id,
      })),
      total,
      page,
      limit,
    );
  }

  async updateUserStatus(
    actor: AuthenticatedUser,
    id: string,
    isActive: boolean,
  ) {
    if (!/^[1-9]\d{0,19}$/.test(id))
      throw new NotFoundException('User was not found');
    const user = await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(User);
      const current = await repository
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :id', { id })
        .getOne();
      if (!current) throw new NotFoundException('User was not found');
      if (current.id === actor.id && !isActive) {
        throw new ConflictException(
          'An administrator cannot deactivate their own account',
        );
      }
      if (current.isActive === isActive) return current;

      current.isActive = isActive;
      current.tokenVersion += 1;
      await repository.save(current);
      await manager
        .getRepository(RefreshToken)
        .update(
          { userId: current.id, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
      await manager.getRepository(AuditLog).save(
        manager.getRepository(AuditLog).create({
          actorUserId: actor.id,
          action: AuditAction.USER_STATUS_CHANGED,
          entityType: 'user',
          entityId: current.id,
          metadata: { isActive },
        }),
      );
      return current;
    });
    return {
      id: user.id,
      isActive: user.isActive,
      tokenVersion: user.tokenVersion,
    };
  }

  async stats() {
    const [users, appointments, slots] = await Promise.all([
      this.users
        .createQueryBuilder('user')
        .select('user.role', 'role')
        .addSelect('COUNT(*)', 'count')
        .addSelect(
          'SUM(CASE WHEN user.isActive = 1 THEN 1 ELSE 0 END)',
          'activeCount',
        )
        .groupBy('user.role')
        .getRawMany<{ role: UserRole; count: string; activeCount: string }>(),
      this.appointments
        .createQueryBuilder('appointment')
        .select('appointment.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('appointment.status')
        .getRawMany<{ status: AppointmentStatus; count: string }>(),
      this.slots.count({ where: { status: SlotStatus.AVAILABLE } }),
    ]);
    const mapCount = <T extends string>(
      rows: { [key: string]: string | T }[],
      key: string,
    ) =>
      Object.fromEntries(
        rows.map((row) => [row[key] as string, Number(row.count)]),
      );
    return {
      users: Object.fromEntries(
        users.map((row) => [
          row.role,
          { total: Number(row.count), active: Number(row.activeCount) },
        ]),
      ),
      appointments: mapCount(appointments, 'status'),
      availableSlots: slots,
    };
  }

  async recentAudit(limit = 50) {
    const entries = await this.dataSource
      .getRepository(AuditLog)
      .createQueryBuilder('audit')
      .leftJoinAndSelect('audit.actor', 'actor')
      .orderBy('audit.createdAt', 'DESC')
      .take(Math.min(100, Math.max(1, limit)))
      .getMany();
    return entries.map((entry) => ({
      id: entry.id,
      actor: entry.actor
        ? { id: entry.actor.id, fullName: entry.actor.fullName }
        : null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata,
      createdAt: entry.createdAt.toISOString(),
    }));
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
