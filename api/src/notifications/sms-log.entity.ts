import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SmsLogStatus, SmsType } from '../common/enums';
import { Appointment } from '../appointments/appointment.entity';

/**
 * Append-only log of every SMS attempt, written by the queue processor.
 * Useful for support ("did the patient get the reminder?") and for tests.
 */
@Entity('sms_logs')
@Index('idx_sms_logs_appointment', ['appointmentId'])
export class SmsLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'appointment_id' })
  appointmentId: string;

  @ManyToOne(() => Appointment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'appointment_id' })
  appointment: Appointment;

  @Column({ type: 'enum', enum: SmsType })
  type: SmsType;

  @Column({ type: 'varchar', length: 20, name: 'to_phone' })
  toPhone: string;

  @Column({ type: 'enum', enum: SmsLogStatus })
  status: SmsLogStatus;

  @Column({ type: 'int', default: 1 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;
}
