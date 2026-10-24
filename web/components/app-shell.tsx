'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Compass,
  HeartHandshake,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useAuth, useToast } from './providers';
import { initials, roleHome } from '@/lib/format';
import { getApiError } from '@/lib/api';

const patientLinks = [
  { href: '/appointments', label: 'My appointments', icon: CalendarDays },
  { href: '/doctors', label: 'Find a doctor', icon: Search },
];
const doctorLinks = [
  { href: '/doctor', label: 'Workspace', icon: LayoutDashboard },
  { href: '/doctors', label: 'Public directory', icon: Compass },
];
const adminLinks = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/doctors', label: 'Public directory', icon: Compass },
];

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link className={`brand ${inverse ? 'brand-inverse' : ''}`} href="/">
      <span className="brand-symbol"><Activity size={18} strokeWidth={2.6} /></span>
      <span>MediBook</span>
    </Link>
  );
}

export function PublicHeader({ landing = false }: { landing?: boolean }) {
  const { user, loading } = useAuth();
  return (
    <header className="public-header">
      {!landing && <Brand />}
      <nav className="public-nav" aria-label="Main navigation">
        <Link href="/doctors">Find care</Link>
        <Link href="/#how-it-works">How it works</Link>
        <Link href="/#for-clinicians">For clinicians</Link>
      </nav>
      <div className="public-actions">
        {!loading && user ? (
          <Link className="button button-dark button-small" href={roleHome(user.role)}>
            My workspace <ArrowUpRight size={15} />
          </Link>
        ) : (
          <>
            <Link className={`public-login ${landing ? 'landing-public-login' : ''}`} href="/login">Log in</Link>
            {!landing && <Link className="button button-dark button-small" href="/register">
              Get started <ArrowUpRight size={15} />
            </Link>}
          </>
        )}
      </div>
    </header>
  );
}

export function AppShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}) {
  const { user, signOut } = useAuth();
  const notify = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const links =
    user?.role === 'ADMIN'
      ? adminLinks
      : user?.role === 'DOCTOR'
        ? doctorLinks
        : patientLinks;

  if (!user) {
    return (
      <div className="public-workspace-page">
        <PublicHeader />
        <main className="public-workspace-content">
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          {children}
        </main>
      </div>
    );
  }

  const handleSignOut = async () => {
    try {
      await signOut();
      router.push('/login');
    } catch (error) {
      const detail = getApiError(error);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      router.push('/login');
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand-row">
          <Brand />
          <button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
            <X size={19} />
          </button>
        </div>
        <div className="workspace-label">Workspace</div>
        <div className="workspace-switcher">
          <span className="workspace-icon"><HeartHandshake size={17} /></span>
          <span><strong>{user?.role === 'DOCTOR' ? 'Care workspace' : user?.role === 'ADMIN' ? 'MediBook team' : 'Personal care'}</strong><small>Dhaka, Bangladesh</small></span>
          <Settings2 size={15} className="switcher-settings" />
        </div>
        <nav className="side-nav" aria-label="Workspace navigation">
          <span className="nav-caption">Navigation</span>
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              className={`side-link ${pathname === href || (href !== '/doctors' && pathname.startsWith(`${href}/`)) ? 'side-link-active' : ''}`}
              href={href}
              key={href}
              onClick={() => setMenuOpen(false)}
            >
              <Icon size={18} strokeWidth={1.9} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="profile-row">
            <span className="avatar avatar-small avatar-forest">{initials(user?.fullName ?? 'MediBook')}</span>
            <span className="profile-text"><strong>{user?.fullName ?? 'MediBook member'}</strong><small>{user?.role?.toLowerCase() ?? 'guest'} account</small></span>
            <button className="icon-button signout-button" onClick={handleSignOut} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>
      {menuOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
      <main className="main-panel">
        <div className="mobile-topbar">
          <button className="icon-button" aria-label="Open menu" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
          <Brand />
          <Link className="avatar avatar-small avatar-forest" href={roleHome(user?.role ?? 'PATIENT')}>{initials(user?.fullName ?? 'M')}</Link>
        </div>
        <div className="main-content">
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <div className="heading-actions">
              <span className="secure-note"><ShieldCheck size={15} /> Private & secure</span>
              <span className="heading-avatar avatar avatar-small avatar-sand">{initials(user?.fullName ?? 'M')}</span>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

export function PageLoading() {
  return <div className="page-loading"><span className="spinner" /><span>Getting your workspace ready…</span></div>;
}

export function AuthPageFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="auth-layout">
      <section className="auth-visual">
        <Brand inverse />
        <div className="auth-visual-content">
          <h2>Care choices, clearly together.</h2>
          <p>Compare specialists and consultation fees, choose an open time, and keep every booked visit in your workspace.</p>
          <ul className="auth-workflow-list">
            <li><strong>Specialist search</strong><span>Find doctors by name or specialty</span></li>
            <li><strong>Real availability</strong><span>Choose a time the doctor has opened</span></li>
            <li><strong>Visit details</strong><span>Review and manage appointments in one place</span></li>
          </ul>
        </div>
        <div className="auth-visual-foot"><span>Appointments shown in Dhaka time</span><span>Asia/Dhaka</span></div>
      </section>
      <section className="auth-form-side">
        <div className="auth-mobile-brand"><Brand /></div>
        {children}
        <p className="auth-footer">Your account and appointment details stay private.</p>
      </section>
    </main>
  );
}
