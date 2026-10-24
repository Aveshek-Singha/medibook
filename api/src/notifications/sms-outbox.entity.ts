import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SmsOutboxStatus, SmsType } from '../common/enums';
import { Appointment } from '../appointments/appointment.entity';

/**
 * Transactional outbox for SMS jobs.
 *
 * Booking, cancelling and rescheduling write their SMS intent into this table
 * inside the same transaction as the appointment change. A dispatcher later
 * moves pending rows into BullMQ. Because the row is committed atomically with
 * the appointment, a crash between COMMIT and enqueue cannot lose the message.
 */
@Entity('sms_outbox')
@Index('idx_outbox_pending', ['status', 'sendAt'])
export class SmsOutbox {
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

  /**
   * Earliest time the message may be sent. Immediate messages use the time of
   * booking; reminders use the reminder moment.
   */
  @Column({ type: 'datetime', name: 'send_at' })
  sendAt: Date;

  @Column({
    type: 'enum',
    enum: SmsOutboxStatus,
    default: SmsOutboxStatus.PENDING,
  })
  status: SmsOutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;

  @Column({ type: 'datetime', name: 'dispatched_at', nullable: true })
  dispatchedAt: Date | null;
}
