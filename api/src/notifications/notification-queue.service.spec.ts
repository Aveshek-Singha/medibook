import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  AppointmentStatus,
  SmsLogStatus,
  SmsOutboxStatus,
  SmsType,
} from '../common/enums';
import { Appointment } from '../appointments/appointment.entity';
import { PinoLogger } from 'nestjs-pino';
import { SmsLog } from './sms-log.entity';
import { SmsOutbox } from './sms-outbox.entity';
import { NotificationQueueService } from './notification-queue.service';
import { SmsProvider } from './sms-provider';

describe('NotificationQueueService', () => {
  const makeService = (
    outbox: SmsOutbox,
    appointment: Partial<Appointment>,
  ) => {
    const add = jest.fn().mockResolvedValue(undefined);
    const queue = { add };
    const smsLogCreate = jest.fn((value) => value);
    const smsLogSave = jest.fn().mockResolvedValue(undefined);
    const outboxSave = jest.fn(async (value) => value);
    const outboxRepository = {
      update: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(async () =>
        outbox.status === SmsOutboxStatus.PENDING ? [outbox] : [],
      ),
      createQueryBuilder: jest.fn(() => {
        const builder = {
          setLock: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn(async () =>
            outbox.status === SmsOutboxStatus.PENDING ? outbox : null,
          ),
        };
        return builder;
      }),
      save: outboxSave,
    };
    const smsLogRepository = { create: smsLogCreate, save: smsLogSave };
    const appointmentRepository = {
      findOne: jest.fn().mockResolvedValue(appointment),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === SmsOutbox) return outboxRepository;
        if (entity === Appointment) return appointmentRepository;
        if (entity === SmsLog) return smsLogRepository;
        return {};
      }),
    };
    const dataSource = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === SmsOutbox) return outboxRepository;
        if (entity === Appointment) return appointmentRepository;
        if (entity === SmsLog) return smsLogRepository;
        return {};
      }),
      transaction: jest.fn((callback: (value: unknown) => unknown) =>
        callback(manager),
      ),
    };
    const logger = { setContext: jest.fn(), error: jest.fn() };
    const provider: SmsProvider = {
      send: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: jest.fn((_key: string, fallback: unknown) => fallback),
    };
    const service = new NotificationQueueService(
      config as unknown as ConfigService,
      dataSource as unknown as DataSource,
      logger as unknown as PinoLogger,
      provider,
    );
    (service as unknown as { enabled: boolean }).enabled = true;
    (service as unknown as { queue: unknown }).queue = queue;
    return {
      service,
      add,
      provider,
      smsLogCreate,
      outboxSave,
      appointmentRepository,
    };
  };

  it('dispatches an immediate outbox row once with its stable job id', async () => {
    const outbox = {
      id: '12',
      appointmentId: '7',
      type: SmsType.CONFIRMATION,
      toPhone: '+8801700000001',
      sendAt: new Date(Date.now() - 1000),
      status: SmsOutboxStatus.PENDING,
      attempts: 0,
      lastError: null,
      dispatchedAt: null,
    } as SmsOutbox;
    const appointment = {
      id: '7',
      slotId: '32',
      status: AppointmentStatus.CONFIRMED,
    };
    const { service, add } = makeService(outbox, appointment);

    await service.dispatchDueOutbox();
    await service.dispatchDueOutbox();

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'send-sms',
      expect.objectContaining({
        outboxId: '12',
        appointmentId: '7',
        slotId: '32',
      }),
      { jobId: 'sms-12' },
    );
    expect(outbox.status).toBe(SmsOutboxStatus.DISPATCHED);
  });

  it('versions reminder jobs by appointment and slot', async () => {
    const outbox = {
      id: '13',
      appointmentId: '7',
      type: SmsType.REMINDER_24H,
      toPhone: '+8801700000001',
      sendAt: new Date(Date.now() - 1000),
      status: SmsOutboxStatus.PENDING,
      attempts: 0,
      lastError: null,
      dispatchedAt: null,
    } as SmsOutbox;
    const { service, add } = makeService(outbox, {
      id: '7',
      slotId: '32',
      status: AppointmentStatus.CONFIRMED,
    });

    await service.dispatchDueOutbox();

    expect(add).toHaveBeenCalledWith(
      'send-sms',
      expect.objectContaining({ type: SmsType.REMINDER_24H, slotId: '32' }),
      { jobId: 'reminder-24h-7-32' },
    );
  });

  it('skips a stale reminder without calling the SMS provider', async () => {
    const outbox = {
      id: '13',
      appointmentId: '7',
      type: SmsType.REMINDER_1H,
      toPhone: '+8801700000001',
      sendAt: new Date(),
      status: SmsOutboxStatus.PENDING,
    } as SmsOutbox;
    const { service, provider, smsLogCreate } = makeService(outbox, {
      id: '7',
      slotId: 'new-slot',
      status: AppointmentStatus.CONFIRMED,
    });
    const job = {
      data: {
        outboxId: '13',
        appointmentId: '7',
        slotId: 'old-slot',
        type: SmsType.REMINDER_1H,
        toPhone: '+8801700000001',
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    await (
      service as unknown as { processSms: (value: unknown) => Promise<void> }
    ).processSms(job);

    expect(provider.send).not.toHaveBeenCalled();
    expect(smsLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SmsLogStatus.SKIPPED,
        error: 'Skipped because appointment is no longer current',
      }),
    );
  });

  it('formats patient-facing SMS appointment times in Dhaka local time', async () => {
    const outbox = {
      id: '14',
      appointmentId: '7',
      type: SmsType.CONFIRMATION,
      toPhone: '+8801700000001',
      status: SmsOutboxStatus.DISPATCHED,
    } as SmsOutbox;
    const { service, provider } = makeService(outbox, {
      id: '7',
      slotId: '32',
      startTime: new Date('2030-01-15T04:00:00.000Z'),
      status: AppointmentStatus.CONFIRMED,
      doctor: {
        user: { fullName: 'Dr. Test' } as Appointment['doctor']['user'],
      } as Appointment['doctor'],
    });
    const job = {
      data: {
        outboxId: '14',
        appointmentId: '7',
        slotId: '32',
        type: SmsType.CONFIRMATION,
        toPhone: '+8801700000001',
      },
      attemptsMade: 0,
      opts: { attempts: 3 },
    };

    await (
      service as unknown as { processSms: (value: unknown) => Promise<void> }
    ).processSms(job);

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('10:00 AM (Dhaka time)'),
      }),
    );
  });
});
