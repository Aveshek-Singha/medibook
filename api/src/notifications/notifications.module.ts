import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Appointment } from '../appointments/appointment.entity';
import { SmsLog } from './sms-log.entity';
import { SmsOutbox } from './sms-outbox.entity';
import { NotificationQueueService } from './notification-queue.service';
import {
  ConsoleSmsProvider,
  SMS_PROVIDER,
  SmsProvider,
  TwilioSmsProvider,
} from './sms-provider';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Appointment, SmsLog, SmsOutbox]),
  ],
  providers: [
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): SmsProvider =>
        config.get<string>('SMS_PROVIDER', 'console') === 'twilio'
          ? new TwilioSmsProvider(config)
          : new ConsoleSmsProvider(),
    },
    NotificationQueueService,
  ],
  exports: [NotificationQueueService],
})
export class NotificationsModule {}
