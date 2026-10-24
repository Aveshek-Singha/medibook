import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('patients')
export class Patient {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  /**
   * Uniqueness comes from the `@OneToOne` below, which TypeORM turns into a
   * unique index. Adding `unique: true` here as well would create a second,
   * redundant unique index over the same column.
   */
  @Column({ type: 'bigint', unsigned: true, name: 'user_id' })
  userId: string;

  @OneToOne(() => User, (user) => user.patient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'date', name: 'date_of_birth', nullable: true })
  dateOfBirth: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;
}
