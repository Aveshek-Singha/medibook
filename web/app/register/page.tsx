'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, HeartPulse, LockKeyhole, Mail, Phone, UserRound } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { AuthPageFrame, PageLoading } from '@/components/app-shell';
import { useAuth, useToast } from '@/components/providers';
import { getApiError } from '@/lib/api';
import { roleHome } from '@/lib/format';

export default function RegisterPage() {
  const { register, user, loading } = useAuth();
  const notify = useToast();
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
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
      const created = await register({ fullName, email, password, ...(phone ? { phone } : {}) });
      notify({ kind: 'success', title: 'Your account is ready', detail: 'Welcome to MediBook.' });
      router.replace(roleHome(created.role));
    } catch (error) {
      const detail = getApiError(error);
      setErrorMessage(detail.message);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageLoading />;

  return (
    <AuthPageFrame>
      <div className="auth-card auth-card-register">
        <div className="auth-card-top">
          <span className="auth-icon"><HeartPulse size={21} /></span>
          <h1>Your care, in one place</h1>
          <p>Create a free patient account and find a doctor who feels right.</p>
        </div>
        <form onSubmit={submit}>
          <div className="form-field"><label className="field-label" htmlFor="fullName">Full name</label><div className="input-icon-wrap"><UserRound size={15} /><input className="field" id="fullName" autoComplete="name" required minLength={2} maxLength={120} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" /></div></div>
          <div className="form-field"><label className="field-label" htmlFor="email">Email address</label><div className="input-icon-wrap"><Mail size={15} /><input className="field" id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div></div>
          <div className="form-field"><label className="field-label" htmlFor="phone">Phone number <span className="optional-label">Optional</span></label><div className="input-icon-wrap"><Phone size={15} /><input className="field" id="phone" type="tel" autoComplete="tel" pattern="\+?[1-9][0-9]{6,19}" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+8801XXXXXXXXX" /></div></div>
          <div className="form-field"><label className="field-label" htmlFor="password">Create password</label><div className="input-icon-wrap"><LockKeyhole size={15} /><input className="field" id="password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /><button className="password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div><p className="password-rule">Use 12+ characters with uppercase, lowercase, a number and a symbol.</p></div>
          {errorMessage && <div className="alert-inline" role="alert">{errorMessage}</div>}
          <button className="button button-dark" type="submit" disabled={submitting}>{submitting ? 'Creating your account…' : 'Create account'} <ArrowRight size={16} /></button>
        </form>
        <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
      </div>
    </AuthPageFrame>
  );
}
