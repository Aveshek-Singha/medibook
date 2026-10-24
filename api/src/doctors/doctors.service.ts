import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { formatInTimeZone } from 'date-fns-tz';
import { Repository } from 'typeorm';
import { normalizePagination, paginate } from '../common/utils/pagination';
import { dhakaDayRange } from '../common/utils/time';
import { AvailabilitySlot } from '../slots/availability-slot.entity';
import { Doctor } from './doctor.entity';

@Injectable()
export class DoctorsService {
  constructor(
    @InjectRepository(Doctor) private readonly doctors: Repository<Doctor>,
    @InjectRepository(AvailabilitySlot)
    private readonly slots: Repository<AvailabilitySlot>,
    private readonly config: ConfigService,
  ) {}

  async list(input: {
    page?: number;
    limit?: number;
    specialty?: string;
    q?: string;
  }) {
    const { page, limit } = normalizePagination(input);
    const query = this.doctors
      .createQueryBuilder('doctor')
      .innerJoinAndSelect('doctor.user', 'user')
      .where('user.isActive = :isActive', { isActive: true });
    if (input.specialty?.trim()) {
      query.andWhere('LOWER(doctor.specialty) = LOWER(:specialty)', {
        specialty: input.specialty.trim(),
      });
    }
    if (input.q?.trim()) {
      query.andWhere('LOWER(user.fullName) LIKE LOWER(:name)', {
        name: `%${input.q.trim()}%`,
      });
    }
    query.orderBy('doctor.specialty', 'ASC').addOrderBy('user.fullName', 'ASC');
    const [rows, total] = await query
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return paginate(
      rows.map((doctor) => this.publicDoctor(doctor)),
      total,
      page,
      limit,
    );
  }

  async get(id: string) {
    const doctor = await this.doctors
      .createQueryBuilder('doctor')
      .innerJoinAndSelect('doctor.user', 'user')
      .where('doctor.id = :id', { id: this.requireId(id) })
      .andWhere('user.isActive = :active', { active: true })
      .getOne();
    if (!doctor) throw new NotFoundException('Doctor was not found');
    return this.publicDoctor(doctor);
  }

  async specialties(): Promise<string[]> {
    const rows = await this.doctors
      .createQueryBuilder('doctor')
      .select('DISTINCT doctor.specialty', 'specialty')
      .innerJoin('doctor.user', 'user')
      .where('user.isActive = :active', { active: true })
      .orderBy('doctor.specialty', 'ASC')
      .getRawMany<{ specialty: string }>();
    return rows.map(({ specialty }) => specialty);
  }

  async availableSlots(id: string, date?: string) {
    const doctorId = this.requireId(id);
    await this.get(doctorId);
    const timeZone = this.config.get<string>('APP_TIMEZONE', 'Asia/Dhaka');
    const today = formatInTimeZone(new Date(), timeZone, 'yyyy-MM-dd');
    const range = date
      ? dhakaDayRange(date, timeZone)
      : {
          start: dhakaDayRange(today, timeZone).start,
          end: new Date(Date.now() + 30 * 86_400_000),
        };
    const slots = await this.slots
      .createQueryBuilder('slot')
      .where('slot.doctorId = :doctorId', { doctorId })
      .andWhere('slot.status = :status', { status: 'AVAILABLE' })
      .andWhere('slot.startTime > :now', { now: new Date() })
      .andWhere('slot.startTime >= :start AND slot.startTime < :end', range)
      .orderBy('slot.startTime', 'ASC')
      .getMany();
    return slots.map((slot) => ({
      id: slot.id,
      doctorId: slot.doctorId,
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
      status: slot.status,
    }));
  }

  private publicDoctor(doctor: Doctor) {
    return {
      id: doctor.id,
      fullName: doctor.user.fullName,
      specialty: doctor.specialty,
      bio: doctor.bio,
      consultationFee: doctor.consultationFee,
    };
  }

  private requireId(value: string): string {
    if (!/^\d+$/.test(value) || value === '0')
      throw new NotFoundException('Doctor was not found');
    return value;
  }
}
