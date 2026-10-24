import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UserRole } from '../common/enums';
import { Patient } from '../patients/patient.entity';
import { User } from '../users/user.entity';
import { RefreshToken } from './refresh-token.entity';

export interface PublicUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  phone: string | null;
  doctorId?: string;
  patientId?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  fullName: user.fullName,
  phone: user.phone,
  doctorId: user.doctor?.id,
  patientId: user.patient?.id,
});

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Patient) private readonly patients: Repository<Patient>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async registerPatient(input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
  }): Promise<AuthSession> {
    const email = input.email.trim().toLowerCase();
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });
    try {
      const user = await this.dataSource.transaction(async (manager) => {
        const created = await manager.getRepository(User).save(
          manager.getRepository(User).create({
            email,
            passwordHash,
            fullName: input.fullName.trim(),
            phone: input.phone ?? null,
            role: UserRole.PATIENT,
            isActive: true,
            tokenVersion: 0,
          }),
        );
        await manager
          .getRepository(Patient)
          .save(
            manager
              .getRepository(Patient)
              .create({ userId: created.id, dateOfBirth: null }),
          );
        return manager.getRepository(User).findOneOrFail({
          where: { id: created.id },
          relations: { patient: true },
        });
      });
      return this.createSession(user);
    } catch (error) {
      if (this.isDuplicate(error))
        throw new ConflictException('Email is already registered');
      throw error;
    }
  }

  async login(emailInput: string, password: string): Promise<AuthSession> {
    const user = await this.users.findOne({
      where: { email: emailInput.trim().toLowerCase() },
      relations: { doctor: true, patient: true },
    });
    const passwordMatches = user
      ? await argon2.verify(user.passwordHash, password).catch(() => false)
      : false;
    if (!user || !passwordMatches || !user.isActive) {
      throw new UnauthorizedException('Email or password is incorrect');
    }
    return this.createSession(user);
  }

  async refresh(rawToken: string | undefined): Promise<AuthSession> {
    if (!rawToken) throw new UnauthorizedException('Refresh token is required');
    const tokenHash = this.hashToken(rawToken);
    const result = await this.dataSource.transaction(async (manager) => {
      const token = await manager
        .getRepository(RefreshToken)
        .createQueryBuilder('token')
        .setLock('pessimistic_write')
        .where('token.tokenHash = :tokenHash', { tokenHash })
        .getOne();

      if (!token) return undefined;
      if (token.revokedAt || token.expiresAt <= new Date()) {
        if (token.revokedAt && token.replacedById) {
          await manager
            .getRepository(RefreshToken)
            .update(
              { userId: token.userId, revokedAt: IsNull() },
              { revokedAt: new Date() },
            );
        }
        return undefined;
      }

      const user = await manager
        .getRepository(User)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .leftJoinAndSelect('user.doctor', 'doctor')
        .leftJoinAndSelect('user.patient', 'patient')
        .where('user.id = :userId', { userId: token.userId })
        .getOne();
      if (!user?.isActive) {
        token.revokedAt = new Date();
        await manager.getRepository(RefreshToken).save(token);
        return undefined;
      }

      const successor = manager.getRepository(RefreshToken).create({
        userId: user.id,
        tokenHash: '',
        expiresAt: this.refreshExpiry(),
        revokedAt: null,
        replacedById: null,
      });
      const nextRaw = this.newOpaqueToken();
      successor.tokenHash = this.hashToken(nextRaw);
      const savedSuccessor = await manager
        .getRepository(RefreshToken)
        .save(successor);
      token.revokedAt = new Date();
      token.replacedById = savedSuccessor.id;
      await manager.getRepository(RefreshToken).save(token);
      return { user, refreshToken: nextRaw };
    });

    if (!result) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
    return {
      accessToken: await this.signAccessToken(result.user),
      refreshToken: result.refreshToken,
      user: toPublicUser(result.user),
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    await this.refreshTokens.update(
      { tokenHash: this.hashToken(rawToken), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  toCurrentUser(user: AuthenticatedUser): PublicUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      phone: user.phone,
      doctorId: user.doctorId,
      patientId: user.patientId,
    };
  }

  private async createSession(user: User): Promise<AuthSession> {
    const refreshToken = this.newOpaqueToken();
    await this.refreshTokens.save(
      this.refreshTokens.create({
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: this.refreshExpiry(),
        revokedAt: null,
        replacedById: null,
      }),
    );
    return {
      accessToken: await this.signAccessToken(user),
      refreshToken,
      user: toPublicUser(user),
    };
  }

  private signAccessToken(user: User): Promise<string> {
    return this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
  }

  private newOpaqueToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshExpiry(): Date {
    const ttl = this.config.get<string>('JWT_REFRESH_TTL', '7d');
    const match = /^(\d+)(s|m|h|d)$/i.exec(ttl);
    if (!match)
      throw new Error(
        'JWT_REFRESH_TTL must use a number followed by s, m, h or d',
      );
    const factors: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return new Date(
      Date.now() + Number(match[1]) * factors[match[2].toLowerCase()],
    );
  }

  private isDuplicate(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ER_DUP_ENTRY'
    );
  }
}
