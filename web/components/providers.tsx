'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { api, refreshSession, setAccessToken } from '@/lib/api';
import type { AuthSessionResponse, User } from '@/lib/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  register: (input: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
  }) => Promise<User>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface ToastMessage {
  id: number;
  title: string;
  detail?: string;
  kind: 'success' | 'error' | 'info';
}

interface ToastContextValue {
  notify: (toast: Omit<ToastMessage, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  }, []);

  useEffect(() => {
    let active = true;
    const handleExpiredSession = () => {
      setAccessToken(null);
      setUser(null);
      if (!['/login', '/register'].includes(window.location.pathname)) {
        router.replace('/login');
      }
    };
    window.addEventListener('medibook:auth-expired', handleExpiredSession);
    refreshSession()
      .then((session) => {
        if (active) setUser(session.user);
      })
      .catch(() => {
        setAccessToken(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.removeEventListener('medibook:auth-expired', handleExpiredSession);
    };
  }, [router]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<AuthSessionResponse>('/auth/login', {
      email,
      password,
    });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(
    async (input: {
      email: string;
      password: string;
      fullName: string;
      phone?: string;
    }) => {
      const { data } = await api.post<AuthSessionResponse>(
        '/auth/register',
        input,
      );
      setAccessToken(data.accessToken);
      setUser(data.user);
      return data.user;
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const authValue = useMemo(
    () => ({ user, loading, signIn, register, signOut }),
    [user, loading, signIn, register, signOut],
  );
  const toastValue = useMemo(() => ({ notify }), [notify]);

  return (
    <AuthContext.Provider value={authValue}>
      <ToastContext.Provider value={toastValue}>
        {children}
        <div className="toast-stack" aria-live="polite" aria-atomic="false">
          {toasts.map((toast) => (
            <div className={`toast toast-${toast.kind}`} key={toast.id}>
              <span className="toast-mark" aria-hidden="true" />
              <div>
                <strong>{toast.title}</strong>
                {toast.detail && <small>{toast.detail}</small>}
              </div>
              <button
                aria-label="Dismiss notification"
                onClick={() =>
                  setToasts((current) =>
                    current.filter((item) => item.id !== toast.id),
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </ToastContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside Providers');
  return value;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside Providers');
  return value.notify;
}
