'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { AuthPageFrame, PageLoading } from '@/components/app-shell';
import { useAuth, useToast } from '@/components/providers';
import { getApiError } from '@/lib/api';
import { roleHome } from '@/lib/format';

export default function LoginPage() {
  const { signIn, user, loading } = useAuth();
  const notify = useToast();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!loading && user) router.replace(roleHome(user.role));
  }, [loading, user, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage('');
    try {
      const next = new URLSearchParams(window.location.search).get('next');
      const signedIn = await signIn(email, password);
      const destination = next?.startsWith('/') && !next.startsWith('//') ? next : roleHome(signedIn.role);
      notify({ kind: 'success', title: `Welcome back, ${signedIn.fullName.split(' ')[0]}` });
      router.replace(destination);
    } catch (error) {
      const detail = getApiError(error);
      setErrorMessage(detail.message);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (role: 'patient' | 'doctor' | 'admin') => {
    setEmail(role === 'admin' ? 'admin@example.com' : role === 'doctor' ? 'doctor1@example.com' : 'patient1@example.com'); // taste-skill-ignore: exact accounts created by the local seed and documented in HANDOFF.md.
    setPassword('MediBookDemo123!');
  };

  if (loading) return <PageLoading />;

  return (
    <AuthPageFrame>
      <div className="auth-card">
        <div className="auth-card-top">
          <span className="auth-icon"><LockKeyhole size={21} /></span>
          <h1>Welcome back</h1>
          <p>Sign in to continue to your care.</p>
        </div>
        <form onSubmit={submit}>
          <div className="form-field">
            <label className="field-label" htmlFor="email">Email address</label>
            <div className="input-icon-wrap"><Mail size={15} /><input className="field" id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          </div>
          <div className="form-field">
            <div className="password-label-row"><label className="field-label" htmlFor="password">Password</label><span className="password-help">Need a reset? Contact your clinic team.</span></div>
            <div className="input-icon-wrap"><LockKeyhole size={15} /><input className="field" id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /><button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>
          </div>
          {errorMessage && <div className="alert-inline" role="alert">{errorMessage}</div>}
          <button className="button button-dark" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} /></button>
          <div className="auth-safe"><ShieldCheck size={14} /> Your health information stays private</div>
        </form>
        {process.env.NODE_ENV !== 'production' && <div className="demo-access"><div className="auth-divider">LOCAL DEMO ACCESS</div><div className="demo-buttons"><button type="button" onClick={() => fillDemo('patient')}>Patient</button><button type="button" onClick={() => fillDemo('doctor')}>Doctor</button><button type="button" onClick={() => fillDemo('admin')}>Admin</button></div><p>Demo accounts use the local seed password.</p></div>}
        <p className="auth-switch">New to MediBook? <Link href="/register">Create an account</Link></p>
      </div>
    </AuthPageFrame>
  );
}
