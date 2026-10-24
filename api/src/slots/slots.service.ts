import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Appointment } from '../appointments/appointment.entity';
import { Doctor } from '../doctors/doctor.entity';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { SlotStatus } from '../common/enums';
import { requireOffsetDateTime } from '../common/utils/time';
import { normalizePagination, paginate } from '../common/utils/pagination';
import { AvailabilitySlot } from './availability-slot.entity';

@Injectable()
export class SlotsService {
  constructor(
    @InjectRepository(AvailabilitySlot)
    private readonly slots: Repository<AvailabilitySlot>,
    @InjectRepository(Appointment)
    private readonly appointments: Repository<Appointment>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  async listForDoctor(
    user: AuthenticatedUser,
    input: { page?: number; limit?: number },
  ) {
    const doctorId = user.doctorId;
    if (!doctorId) throw new NotFoundException('Doctor profile was not found');
    const { page, limit } = normalizePagination(input);
    const query = this.slots
      .createQueryBuilder('slot')
      .where('slot.doctorId = :doctorId', { doctorId })
      .andWhere('slot.status = :status', { status: SlotStatus.AVAILABLE })
      .andWhere('slot.startTime > :now', { now: new Date() })
      .orderBy('slot.startTime', 'ASC');
    const [rows, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return paginate(
      rows.map((slot) => ({
        id: slot.id,
        startTime: slot.startTime.toISOString(),
        endTime: slot.endTime.toISOString(),
        status: slot.status,
      })),
      total,
      page,
      limit,
    );
  }

  async create(
    user: AuthenticatedUser,
    input: { slots: { startTime: string; endTime: string }[] },
  ) {
    const doctorId = user.doctorId;
    if (!doctorId) throw new NotFoundException('Doctor profile was not found');
    const cap = this.config.get<number>('MAX_SLOTS_PER_REQUEST', 200);
    if (input.slots.length > Math.min(cap, 200)) {
      throw new BadRequestException(
        `At most ${Math.min(cap, 200)} slots may be created at once`,
      );
    }

    const normalized = input.slots.map((slot) => {
      const startTime = requireOffsetDateTime(slot.startTime, 'startTime');
      const endTime = requireOffsetDateTime(slot.endTime, 'endTime');
      const duration = (endTime.getTime() - startTime.getTime()) / 60_000;
      if (duration < 15 || duration > 120) {
        throw new BadRequestException(
          'Slot duration must be between 15 and 120 minutes',
        );
      }
      if (startTime <= new Date())
        throw new BadRequestException('Slots must be in the future');
      return { startTime, endTime };
    });
    const sorted = [...normalized].sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime(),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].startTime < sorted[i - 1].endTime) {
        throw new ConflictException('Requested slots overlap each other');
      }
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        const doctor = await manager
          .getRepository(Doctor)
          .createQueryBuilder('doctor')
          .setLock('pessimistic_write')
          .where('doctor.id = :doctorId', { doctorId })
          .getOne();
        if (!doctor)
          throw new NotFoundException('Doctor profile was not found');

        const repository = manager.getRepository(AvailabilitySlot);
        for (const requested of normalized) {
          const overlap = await repository
            .createQueryBuilder('slot')
            .setLock('pessimistic_write')
            .where('slot.doctorId = :doctorId', { doctorId })
            .andWhere('slot.startTime < :endTime', {
              endTime: requested.endTime,
            })
            .andWhere('slot.endTime > :startTime', {
              startTime: requested.startTime,
            })
            .getOne();
          if (overlap)
            throw new ConflictException(
              'A slot already occupies part of this time',
            );
        }

        const created = normalized.map((slot) =>
          repository.create({
            doctorId,
            ...slot,
            status: SlotStatus.AVAILABLE,
          }),
        );
        return repository.save(created);
      });
    } catch (error) {
      if (this.isDuplicate(error))
        throw new ConflictException('A slot already exists at this time');
      throw error;
    }
  }

  async remove(user: AuthenticatedUser, id: string) {
    if (!/^\d+$/.test(id) || id === '0')
      throw new NotFoundException('Slot was not found');
    const slot = await this.dataSource.transaction(async (manager) => {
      const current = await manager
        .getRepository(AvailabilitySlot)
        .createQueryBuilder('slot')
        .setLock('pessimistic_write')
        .where('slot.id = :id', { id })
        .andWhere('slot.doctorId = :doctorId', { doctorId: user.doctorId })
        .getOne();
      if (!current) throw new NotFoundException('Slot was not found');
      if (current.status !== SlotStatus.AVAILABLE) {
        throw new ConflictException('A booked slot cannot be deleted');
      }
      const hasHistory = await manager
        .getRepository(Appointment)
        .exist({ where: { slotId: id } });
      if (hasHistory)
        throw new ConflictException(
          'A slot with appointment history cannot be deleted',
        );
      await manager.getRepository(AvailabilitySlot).delete({ id });
      return current;
    });
    return { id: slot.id, message: 'Slot deleted' };
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
