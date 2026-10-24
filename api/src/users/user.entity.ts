import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../common/enums';
import { Doctor } from '../doctors/doctor.entity';
import { Patient } from '../patients/patient.entity';

@Entity('users')
@Index('idx_users_role', ['role', 'isActive'])
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 190, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'enum', enum: UserRole })
  role: UserRole;

  @Column({ type: 'varchar', length: 120, name: 'full_name' })
  fullName: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /**
   * Bumped whenever the account is deactivated. It is embedded in the access
   * token, so incrementing it invalidates every previously issued token
   * without needing a token blacklist.
   */
  @Column({ type: 'int', name: 'token_version', default: 0 })
  tokenVersion: number;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt: Date;

  @OneToOne(() => Doctor, (doctor: Doctor) => doctor.user)
  doctor?: Doctor;

  @OneToOne(() => Patient, (patient: Patient) => patient.user)
  patient?: Patient;
}
