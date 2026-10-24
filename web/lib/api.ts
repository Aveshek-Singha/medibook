import axios, { AxiosHeaders, type AxiosError } from 'axios';
import type { AuthSessionResponse } from './types';

declare module 'axios' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  interface InternalAxiosRequestConfig<D = any> {
    _refreshAttempted?: boolean;
  }
}

function getApiBaseUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_API_URL;
  const production = process.env.NODE_ENV === 'production';
  if (!configuredUrl && production) {
    throw new Error(
      'NEXT_PUBLIC_API_URL must be set to the production API URL at build time.',
    );
  }

  const baseUrl = configuredUrl ?? 'http://localhost:3000/api/v1';
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('NEXT_PUBLIC_API_URL must be an absolute URL.');
  }

  if (
    production &&
    (parsed.protocol !== 'https:' ||
      !parsed.pathname.replace(/\/$/, '').endsWith('/api/v1') ||
      Boolean(parsed.username || parsed.password || parsed.search || parsed.hash) ||
      ['localhost', '[::1]', '0.0.0.0'].includes(parsed.hostname) ||
      parsed.hostname.startsWith('127.') ||
      parsed.hostname.endsWith('.localhost'))
  ) {
    throw new Error(
      'NEXT_PUBLIC_API_URL must use HTTPS and end with /api/v1 in production.',
    );
  }

  return baseUrl;
}

const baseURL = getApiBaseUrl();

export const api = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

let accessToken: string | null = null;
let refreshInFlight: Promise<AuthSessionResponse> | null = null;

export function setAccessToken(value: string | null) {
  accessToken = value;
}

export function refreshSession(): Promise<AuthSessionResponse> {
  if (!refreshInFlight) {
    refreshInFlight = api
      .post<AuthSessionResponse>('/auth/refresh')
      .then(({ data }) => {
        setAccessToken(data.accessToken);
        return data;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers = AxiosHeaders.from(config.headers);
    config.headers.set('Authorization', `Bearer ${accessToken}`);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config;
    const url = original?.url ?? '';
    const authRequest = /\/auth\/(login|register|refresh|logout)$/.test(url);
    if (
      error.response?.status !== 401 ||
      !original ||
      original._refreshAttempted ||
      authRequest
    ) {
      return Promise.reject(error);
    }

    original._refreshAttempted = true;
    try {
      const session = await refreshSession();
      original.headers = AxiosHeaders.from(original.headers);
      original.headers.set('Authorization', `Bearer ${session.accessToken}`);
      return api(original);
    } catch (refreshError) {
      setAccessToken(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('medibook:auth-expired'));
      }
      return Promise.reject(refreshError);
    }
  },
);

export function getApiError(error: unknown) {
  const axiosError = error as AxiosError<{
    message?: string | string[];
    requestId?: string;
  }>;
  const payload = axiosError.response?.data;
  const message = Array.isArray(payload?.message)
    ? payload.message[0]
    : payload?.message;
  return {
    message: message ?? axiosError.message ?? 'Something went wrong. Please try again.',
    requestId: payload?.requestId,
  };
}
