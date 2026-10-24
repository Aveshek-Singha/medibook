import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { decimalTransformer } from '../common/transformers/decimal.transformer';

@Entity('doctors')
@Index('idx_doctors_specialty', ['specialty'])
export class Doctor {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  /**
   * Uniqueness comes from the `@OneToOne` below, which TypeORM turns into a
   * unique index. Adding `unique: true` here as well would create a second,
   * redundant unique index over the same column.
   */
  @Column({ type: 'bigint', unsigned: true, name: 'user_id' })
  userId: string;

  @OneToOne(() => User, (user) => user.doctor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 100 })
  specialty: string;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  /**
   * Current fee of the doctor. The actual charged amount is copied onto the
   * appointment at booking time, so changing this later never rewrites
   * historical bookings.
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

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;
}
