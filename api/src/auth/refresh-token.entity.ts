import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

/**
 * Opaque refresh tokens, stored as a SHA-256 hash.
 *
 * The raw token only ever exists in the httpOnly cookie; a database leak
 * therefore does not hand out usable sessions. Rotation links each token to
 * its successor through `replacedById`, which makes replay of an already used
 * token detectable.
 */
@Entity('refresh_tokens')
@Index('idx_refresh_user_active', ['userId', 'revokedAt', 'expiresAt'])
export class RefreshToken {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /**
   * SHA-256 of the opaque token. UNIQUE — the lookup on every refresh must hit
   * exactly one row.
   */
  @Column({ type: 'varchar', length: 128, name: 'token_hash', unique: true })
  tokenHash: string;

  @Column({ type: 'datetime', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'datetime', name: 'revoked_at', nullable: true })
  revokedAt: Date | null;

  @Column({
    type: 'bigint',
    unsigned: true,
    name: 'replaced_by_id',
    nullable: true,
  })
  replacedById: string | null;

  /**
   * Self-referencing link to the token that replaced this one.
   *
   * Declared explicitly because the migration creates the
   * `fk_refresh_tokens_replaced_by_id` constraint. `onDelete: SET NULL` keeps
   * the chain intact if the successor row is deleted.
   */
  @ManyToOne(() => RefreshToken, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'replaced_by_id' })
  replacedBy?: RefreshToken;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;
}
