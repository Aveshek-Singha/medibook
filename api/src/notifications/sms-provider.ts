import { ConfigService } from '@nestjs/config';

export const SMS_PROVIDER = 'SMS_PROVIDER_CLIENT';

export interface SmsMessage {
  to: string;
  body: string;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<void>;
}

export class ConsoleSmsProvider implements SmsProvider {
  async send(message: SmsMessage): Promise<void> {
    // The phone number is masked so a local demo never writes personal data to logs.
    const masked = message.to.replace(/.(?=.{4})/g, '*');
    console.info(`[MediBook SMS] to=${masked} message=${message.body}`);
  }
}

export class TwilioSmsProvider implements SmsProvider {
  constructor(private readonly config: ConfigService) {}

  async send(message: SmsMessage): Promise<void> {
    const accountSid = this.config.getOrThrow<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.getOrThrow<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.getOrThrow<string>('TWILIO_FROM_NUMBER');
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: message.to,
      From: from,
      Body: message.body,
    });
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const result = (await response.json().catch(() => undefined)) as
        { message?: string } | undefined;
      throw new Error(
        `SMS provider rejected the message (${response.status}): ${result?.message ?? 'unknown provider error'}`,
      );
    }
  }
}
