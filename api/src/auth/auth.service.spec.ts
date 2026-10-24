import * as argon2 from 'argon2';
import { createHash } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RefreshToken } from './refresh-token.entity';
import { User } from '../users/user.entity';
import { UserRole } from '../common/enums';

describe('AuthService', () => {
  const password = 'UnitTestPass123!';
  let passwordHash: string;
  let user: User;
  let refreshRepository: Record<string, jest.Mock>;
  let users: Record<string, jest.Mock>;
  let patients: Record<string, jest.Mock>;
  let jwt: { signAsync: jest.Mock };
  let config: { get: jest.Mock };
  let service: AuthService;

  beforeAll(async () => {
    passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  });

  beforeEach(() => {
    user = {
      id: '42',
      email: 'patient@example.com',
      passwordHash,
      role: UserRole.PATIENT,
      fullName: 'Test Patient',
      phone: '+8801700000011',
      isActive: true,
      tokenVersion: 3,
      doctor: undefined,
      patient: { id: '70' } as User['patient'],
    } as User;
    refreshRepository = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: '100', ...value })),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    users = { findOne: jest.fn() };
    patients = {};
    jwt = { signAsync: jest.fn().mockResolvedValue('signed-access-token') };
    config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === 'JWT_REFRESH_TTL' ? '7d' : fallback,
      ),
    };
    const dataSource = { transaction: jest.fn() };
    service = new AuthService(
      users as never,
      patients as never,
      refreshRepository as never,
      dataSource as never,
      jwt as never,
      config as never,
    );
  });

  it('authenticates with Argon2 and stores only a SHA-256 refresh-token hash', async () => {
    users.findOne.mockResolvedValue(user);

    const result = await service.login(' PATIENT@example.com ', password);

    expect(result.accessToken).toBe('signed-access-token');
    expect(result.user).toMatchObject({ id: '42', role: UserRole.PATIENT });
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.refreshToken).not.toBe(
      refreshRepository.save.mock.calls[0][0].tokenHash,
    );
    expect(refreshRepository.save.mock.calls[0][0].tokenHash).toBe(
      createHash('sha256').update(result.refreshToken).digest('hex'),
    );
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: '42',
      role: UserRole.PATIENT,
      tokenVersion: 3,
    });
  });

  it('rejects invalid credentials and inactive accounts with one generic response', async () => {
    users.findOne.mockResolvedValue(user);
    await expect(
      service.login(user.email, 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    users.findOne.mockResolvedValue({ ...user, isActive: false });
    await expect(service.login(user.email, password)).rejects.toMatchObject({
      message: 'Email or password is incorrect',
    });
  });

  it('rotates a refresh token once and revokes the family when an old token is replayed', async () => {
    const currentRefresh = {
      id: '90',
      userId: user.id,
      tokenHash: createHash('sha256')
        .update('opaque-current-token')
        .digest('hex'),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      replacedById: null,
    } as RefreshToken;
    let consumed = false;
    const refreshQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => {
        if (consumed) {
          currentRefresh.revokedAt = new Date();
          currentRefresh.replacedById = '100';
        }
        return currentRefresh;
      }),
    };
    refreshRepository.createQueryBuilder.mockReturnValue(refreshQuery);
    const userQuery = {
      setLock: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(user),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === RefreshToken
          ? refreshRepository
          : entity === User
            ? { createQueryBuilder: jest.fn(() => userQuery) }
            : {},
      ),
    };
    const dataSource = (
      service as unknown as { dataSource: { transaction: jest.Mock } }
    ).dataSource;
    dataSource.transaction.mockImplementation(
      (callback: (manager: unknown) => unknown) => callback(manager),
    );

    const rotated = await service.refresh('opaque-current-token');
    expect(rotated.refreshToken).not.toBe('opaque-current-token');
    expect(currentRefresh.revokedAt).toBeInstanceOf(Date);
    expect(currentRefresh.replacedById).toBe('100');
    expect(refreshRepository.update).not.toHaveBeenCalled();

    consumed = true;
    await expect(
      service.refresh('opaque-current-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(refreshRepository.update).toHaveBeenCalledWith(
      { userId: user.id, revokedAt: expect.anything() },
      { revokedAt: expect.any(Date) },
    );
  });
});
