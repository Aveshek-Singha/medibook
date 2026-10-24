import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SlotStatus } from '../common/enums';
import { Doctor } from '../doctors/doctor.entity';

@Entity('availability_slots')
@Index('uq_slot_doctor_start', ['doctorId', 'startTime'], { unique: true })
@Index('idx_slots_doctor_status_start', ['doctorId', 'status', 'startTime'])
@Index('idx_slots_doctor_overlap', ['doctorId', 'startTime', 'endTime'])
export class AvailabilitySlot {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'doctor_id' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'doctor_id' })
  doctor: Doctor;

  /**
   * All DATETIME values are stored in UTC. The MySQL connection is configured
   * with `timezone: 'Z'` so mysql2 never shifts them on the way in or out.
   */
  @Column({ type: 'datetime', name: 'start_time' })
  startTime: Date;

  @Column({ type: 'datetime', name: 'end_time' })
  endTime: Date;

  @Column({ type: 'enum', enum: SlotStatus, default: SlotStatus.AVAILABLE })
  status: SlotStatus;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;
}
