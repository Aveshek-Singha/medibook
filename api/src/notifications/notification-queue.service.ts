import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Job, Queue, Worker } from 'bullmq';
import { formatInTimeZone } from 'date-fns-tz';
import { DataSource, LessThanOrEqual } from 'typeorm';
import {
  AppointmentStatus,
  SmsLogStatus,
  SmsOutboxStatus,
  SmsType,
} from '../common/enums';
import { Appointment } from '../appointments/appointment.entity';
import { SmsLog } from './sms-log.entity';
import { SmsOutbox } from './sms-outbox.entity';
import { SMS_PROVIDER, SmsProvider } from './sms-provider';

interface SmsJobData {
  outboxId: string;
  appointmentId: string;
  slotId: string;
  type: SmsType;
  toPhone: string;
}

@Injectable()
export class NotificationQueueService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue<
    SmsJobData,
    void,
    'send-sms',
    SmsJobData,
    void,
    'send-sms'
  >;
  private worker?: Worker<SmsJobData, void, 'send-sms'>;
  private dispatchTimer?: NodeJS.Timeout;
  private dispatchInProgress = false;
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {
    this.logger.setContext(NotificationQueueService.name);
  }

  async onModuleInit(): Promise<void> {
    this.enabled = this.config.get<boolean>('QUEUE_ENABLED', true);
    if (!this.enabled) return;

    this.queue = new Queue<
      SmsJobData,
      void,
      'send-sms',
      SmsJobData,
      void,
      'send-sms'
    >('medibook-sms', {
      connection: this.redisOptions(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
    this.worker = new Worker<SmsJobData, void, 'send-sms'>(
      'medibook-sms',
      (job) => this.processSms(job),
      { connection: this.redisOptions(), concurrency: 10 },
    );
    this.worker.on('error', (error) =>
      this.logger.error({ err: error }, 'SMS worker error'),
    );

    this.dispatchTimer = setInterval(() => {
      void this.dispatchDueOutbox().catch((error: unknown) =>
        this.logger.error({ err: error }, 'Outbox dispatch failed'),
      );
    }, 5000);
    this.dispatchTimer.unref();
    void this.dispatchDueOutbox().catch((error: unknown) =>
      this.logger.error(
        { err: error },
        'Initial outbox dispatch failed; the timer will retry',
      ),
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    await Promise.allSettled(
      [this.worker?.close(), this.queue?.close()].filter(
        Boolean,
      ) as Promise<unknown>[],
    );
  }

  async isReady(): Promise<boolean> {
    if (!this.enabled || !this.queue || !this.worker?.isRunning()) return false;

    try {
      await this.queue.getJobCounts('active', 'waiting', 'delayed');
      return true;
    } catch {
      return false;
    }
  }

  async removeReminderJobs(
    appointmentId: string,
    slotId: string,
  ): Promise<void> {
    if (!this.enabled || !this.queue) return;
    await Promise.all(
      ([SmsType.REMINDER_24H, SmsType.REMINDER_1H] as const).map(
        async (type) => {
          const job = await this.queue?.getJob(
            this.reminderJobId(type, appointmentId, slotId),
          );
          if (!job) return;
          try {
            await job.remove();
          } catch {
            // Active jobs cannot be removed; the processor checks the appointment version.
          }
        },
      ),
    );
  }

  async dispatchDueOutbox(): Promise<void> {
    if (!this.enabled || !this.queue || this.dispatchInProgress) return;
    this.dispatchInProgress = true;
    try {
      const due = await this.dataSource.getRepository(SmsOutbox).find({
        where: {
          status: SmsOutboxStatus.PENDING,
          sendAt: LessThanOrEqual(new Date()),
        },
        order: { sendAt: 'ASC', id: 'ASC' },
        take: 100,
      });
      for (const item of due) await this.dispatchOne(item.id);
    } finally {
      this.dispatchInProgress = false;
    }
  }

  private async dispatchOne(id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(SmsOutbox);
      const outbox = await repository
        .createQueryBuilder('outbox')
        .setLock('pessimistic_write')
        .where('outbox.id = :id', { id })
        .andWhere('outbox.status = :status', {
          status: SmsOutboxStatus.PENDING,
        })
        .andWhere('outbox.sendAt <= :now', { now: new Date() })
        .getOne();
      if (!outbox) return;

      const appointment = await manager.getRepository(Appointment).findOne({
        where: { id: outbox.appointmentId },
      });
      if (!appointment) {
        outbox.status = SmsOutboxStatus.CANCELLED;
        outbox.lastError = 'Appointment no longer exists';
        await repository.save(outbox);
        return;
      }
      const jobData: SmsJobData = {
        outboxId: outbox.id,
        appointmentId: appointment.id,
        slotId: appointment.slotId,
        type: outbox.type,
        toPhone: outbox.toPhone,
      };
      const jobId = this.jobId(jobData);
      await this.queue?.add('send-sms', jobData, { jobId });
      outbox.status = SmsOutboxStatus.DISPATCHED;
      outbox.dispatchedAt = new Date();
      outbox.lastError = null;
      await repository.save(outbox);
    });
  }

  private async processSms(job: Job<SmsJobData>): Promise<void> {
    const data = job.data;
    const appointment = await this.dataSource
      .getRepository(Appointment)
      .findOne({
        where: { id: data.appointmentId },
        relations: { doctor: { user: true }, patient: { user: true } },
      });
    const versioned =
      data.type === SmsType.REMINDER_24H ||
      data.type === SmsType.REMINDER_1H ||
      data.type === SmsType.CONFIRMATION ||
      data.type === SmsType.RESCHEDULED;
    if (
      !appointment ||
      (versioned &&
        (appointment.status !== AppointmentStatus.CONFIRMED ||
          appointment.slotId !== data.slotId))
    ) {
      await this.writeLog(
        job,
        SmsLogStatus.SKIPPED,
        'Skipped because appointment is no longer current',
      );
      return;
    }

    try {
      await this.smsProvider.send({
        to: data.toPhone,
        body: this.message(data, appointment),
      });
      await this.writeLog(job, SmsLogStatus.SENT, null);
      await this.dataSource
        .getRepository(SmsOutbox)
        .update(
          { id: data.outboxId },
          { attempts: job.attemptsMade + 1, lastError: null },
        );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 1000)
          : 'SMS provider failed';
      await this.writeLog(job, SmsLogStatus.FAILED, message);
      const attempts = job.attemptsMade + 1;
      const finalAttempt = attempts >= Number(job.opts.attempts ?? 1);
      await this.dataSource.getRepository(SmsOutbox).update(
        { id: data.outboxId },
        {
          attempts,
          lastError: message,
          ...(finalAttempt ? { status: SmsOutboxStatus.FAILED } : {}),
        },
      );
      throw error;
    }
  }

  private async writeLog(
    job: Job<SmsJobData>,
    status: SmsLogStatus,
    error: string | null,
  ) {
    await this.dataSource.getRepository(SmsLog).save(
      this.dataSource.getRepository(SmsLog).create({
        appointmentId: job.data.appointmentId,
        type: job.data.type,
        toPhone: job.data.toPhone,
        status,
        attempts: job.attemptsMade + (status === SmsLogStatus.SKIPPED ? 0 : 1),
        error,
      }),
    );
  }

  private message(data: SmsJobData, appointment: Appointment): string {
    const doctor = appointment.doctor?.user.fullName ?? 'your doctor';
    const time = `${formatInTimeZone(
      appointment.startTime,
      this.config.get<string>('APP_TIMEZONE', 'Asia/Dhaka'),
      "EEE, d MMM yyyy 'at' h:mm a",
    )} (Dhaka time)`;
    const messages: Record<SmsType, string> = {
      [SmsType.CONFIRMATION]: `MediBook: your appointment with ${doctor} is confirmed for ${time}.`,
      [SmsType.REMINDER_24H]: `MediBook: reminder for your appointment with ${doctor} at ${time}.`,
      [SmsType.REMINDER_1H]: `MediBook: your appointment with ${doctor} starts in about one hour (${time}).`,
      [SmsType.CANCELLATION]: `MediBook: your appointment has been cancelled.`,
      [SmsType.RESCHEDULED]: `MediBook: your appointment with ${doctor} is rescheduled for ${time}.`,
    };
    return messages[data.type];
  }

  private jobId(data: SmsJobData): string {
    if (
      data.type === SmsType.REMINDER_24H ||
      data.type === SmsType.REMINDER_1H
    ) {
      return this.reminderJobId(data.type, data.appointmentId, data.slotId);
    }
    return `sms-${data.outboxId}`;
  }

  private reminderJobId(
    type: SmsType,
    appointmentId: string,
    slotId: string,
  ): string {
    const prefix =
      type === SmsType.REMINDER_24H ? 'reminder-24h' : 'reminder-1h';
    return `${prefix}-${appointmentId}-${slotId}`;
  }

  private redisOptions() {
    return {
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      username: this.config.get<string>('REDIS_USERNAME', '') || undefined,
      password: this.config.get<string>('REDIS_PASSWORD', '') || undefined,
      db: this.config.get<number>('REDIS_DB', 0),
      connectTimeout: this.config.get<number>(
        'REDIS_CONNECTION_TIMEOUT_MS',
        10000,
      ),
      ...(this.config.get<boolean>('REDIS_TLS', false)
        ? {
            tls: {
              rejectUnauthorized: true,
              ...(this.config.get<string>('REDIS_TLS_CA', '')
                ? { ca: this.config.get<string>('REDIS_TLS_CA') }
                : {}),
            },
          }
        : {}),
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    };
  }
}
