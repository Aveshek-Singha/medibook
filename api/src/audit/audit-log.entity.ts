import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AuditAction } from '../common/enums';
import { User } from '../users/user.entity';

@Entity('audit_logs')
@Index('idx_audit_actor_created', ['actorUserId', 'createdAt'])
@Index('idx_audit_entity_created', ['entityType', 'entityId', 'createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({
    type: 'bigint',
    unsigned: true,
    name: 'actor_user_id',
    nullable: true,
  })
  actorUserId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_user_id' })
  actor?: User | null;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ type: 'varchar', length: 32, name: 'entity_type' })
  entityType: string;

  @Column({ type: 'bigint', unsigned: true, name: 'entity_id' })
  entityId: string;

  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;
}
