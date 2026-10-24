import { BadRequestException } from '@nestjs/common';
import { addDays, format, isValid, parseISO } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';

export interface UtcRange {
  start: Date;
  end: Date;
}

export function dhakaDayRange(date: string, timeZone = 'Asia/Dhaka'): UtcRange {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestException('date must use YYYY-MM-DD format');
  }

  const parsed = parseISO(date);
  if (!isValid(parsed) || format(parsed, 'yyyy-MM-dd') !== date) {
    throw new BadRequestException('date is not a valid calendar day');
  }

  const nextDay = format(addDays(parsed, 1), 'yyyy-MM-dd');
  return {
    start: fromZonedTime(`${date}T00:00:00`, timeZone),
    end: fromZonedTime(`${nextDay}T00:00:00`, timeZone),
  };
}

export function dhakaDateRange(
  from: string,
  to: string,
  timeZone = 'Asia/Dhaka',
) {
  const start = dhakaDayRange(from, timeZone).start;
  const end = dhakaDayRange(to, timeZone).end;
  if (end <= start) {
    throw new BadRequestException('to must be the same day or after from');
  }
  return { start, end };
}

export function requireOffsetDateTime(value: string, field: string): Date {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    throw new BadRequestException(`${field} must include a UTC offset`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new BadRequestException(`${field} must be a valid ISO date-time`);
  }
  return date;
}
