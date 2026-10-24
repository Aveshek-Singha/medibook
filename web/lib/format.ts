const dhaka = 'Asia/Dhaka';

export function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-BD', {
    timeZone: dhaka,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  }).format(new Date(value));
}

export function formatTime(value: string | Date) {
  return new Intl.DateTimeFormat('en-BD', {
    timeZone: dhaka,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

export function formatDateTime(value: string | Date) {
  return `${formatDate(value, { weekday: 'short' })} · ${formatTime(value)}`;
}

export function formatMoney(value: number | string) {
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function dhakaToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: dhaka,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function dhakaLocalToISOString(date: string, time: string) {
  return new Date(`${date}T${time}:00+06:00`).toISOString();
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function roleHome(role: string) {
  if (role === 'ADMIN') return '/admin';
  if (role === 'DOCTOR') return '/doctor';
  return '/appointments';
}
