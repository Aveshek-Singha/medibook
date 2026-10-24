import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AppointmentStatus } from '../common/enums';
import { decimalTransformer } from '../common/transformers/decimal.transformer';
import { Doctor } from '../doctors/doctor.entity';
import { Patient } from '../patients/patient.entity';
import { AvailabilitySlot } from '../slots/availability-slot.entity';

@Entity('appointments')
@Index('uq_appointment_active_slot', ['activeSlotId'], { unique: true })
@Index('idx_appt_doctor_start_status', ['doctorId', 'startTime', 'status'])
@Index('idx_appt_patient_start', ['patientId', 'startTime'])
@Index('idx_appt_slot', ['slotId'])
@Index('idx_appt_status', ['status', 'startTime'])
export class Appointment {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'slot_id' })
  slotId: string;

  @ManyToOne(() => AvailabilitySlot, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'slot_id' })
  slot: AvailabilitySlot;

  @Column({ type: 'bigint', unsigned: true, name: 'doctor_id' })
  doctorId: string;

  @ManyToOne(() => Doctor, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'doctor_id' })
  doctor: Doctor;

  @Column({ type: 'bigint', unsigned: true, name: 'patient_id' })
  patientId: string;

  @ManyToOne(() => Patient, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'patient_id' })
  patient: Patient;

  @Column({ type: 'datetime', name: 'start_time' })
  startTime: Date;

  @Column({ type: 'datetime', name: 'end_time' })
  endTime: Date;

  /**
   * Fee captured at booking time. The doctor's current fee may change later;
   * the historical appointment must keep the amount it was booked with.
   */
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'consultation_fee',
    default: 0,
    transformer: decimalTransformer,
  })
  consultationFee: number;

  @Column({
    type: 'enum',
    enum: AppointmentStatus,
    default: AppointmentStatus.CONFIRMED,
  })
  status: AppointmentStatus;

  /**
   * Generated column that mirrors `slot_id` only while the appointment is
   * CONFIRMED.
   *
   * The UNIQUE index on it is the database-level backstop against
   * double-booking: two CONFIRMED rows for the same slot are rejected by
   * MySQL, while CANCELLED rows store NULL and do not conflict (MySQL
   * allows any number of NULLs in a unique index).
   *
   * TypeORM needs `asExpression` + `generatedType` explicitly — it cannot
   * infer a generated column. `insert: false, update: false` is required as
   * well: TypeORM only auto-excludes columns it considers generated, and a
   * generated column must never appear in an INSERT or UPDATE payload.
   */
  @Column({
    type: 'bigint',
    unsigned: true,
    nullable: true,
    name: 'active_slot_id',
    asExpression: "IF(status = 'CONFIRMED', slot_id, NULL)",
    generatedType: 'STORED',
    insert: false,
    update: false,
    select: true,
  })
  activeSlotId: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt: Date;
}
