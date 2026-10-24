'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { RequireAuth } from '@/components/require-auth';
import { useAuth, useToast } from '@/components/providers';
import { api, getApiError } from '@/lib/api';
import { formatDate, initials } from '@/lib/format';
import type { AdminStats, AdminUser, AuditEntry, Page, UserRole } from '@/lib/types';

type RoleFilter = '' | UserRole;

export default function AdminPage() {
  const { user } = useAuth();
  const notify = useToast();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<Page<AdminUser> | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<RoleFilter>('');
  const [page, setPage] = useState(1);
  const [busyUser, setBusyUser] = useState<string | null>(null);
  const [savingDoctor, setSavingDoctor] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async (targetPage = page, targetRole = role) => {
    try {
      const [statsResult, usersResult, auditResult] = await Promise.all([
        api.get<AdminStats>('/admin/stats'),
        api.get<Page<AdminUser>>('/admin/users', { params: { page: targetPage, limit: 10, ...(targetRole ? { role: targetRole } : {}) } }),
        api.get<AuditEntry[]>('/admin/audit-logs', { params: { limit: 8 } }),
      ]);
      setStats(statsResult.data);
      setUsers(usersResult.data);
      setAudit(auditResult.data);
    } catch (error) {
      const detail = getApiError(error);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
    } finally { setLoading(false); }
  }, [page, role, notify]);

  // The loader commits state only after its parallel API requests resolve.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const createDoctor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setFormError('');
    const form = new FormData(formElement);
    const input = {
      fullName: String(form.get('fullName') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      phone: String(form.get('phone') ?? '') || undefined,
      specialty: String(form.get('specialty') ?? ''),
      bio: String(form.get('bio') ?? '') || undefined,
      consultationFee: Number(form.get('consultationFee')),
    };
    setSavingDoctor(true);
    setLoading(true);
    try {
      await api.post('/admin/doctors', input);
      notify({ kind: 'success', title: 'Doctor account created', detail: `${input.fullName} can now sign in.` });
      formElement.reset();
      setPage(1);
      await load(1, role);
    } catch (error) {
      const detail = getApiError(error);
      setFormError(detail.message);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      setLoading(false);
    } finally { setSavingDoctor(false); }
  };

  const updateStatus = async (target: AdminUser) => {
    setBusyUser(target.id);
    setLoading(true);
    try {
      await api.patch(`/admin/users/${target.id}/status`, { isActive: !target.isActive });
      notify({ kind: 'success', title: target.isActive ? 'Account deactivated' : 'Account activated', detail: target.isActive ? 'Existing sessions have been revoked.' : 'The user can sign in again.' });
      await load();
    } catch (error) {
      const detail = getApiError(error);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      setLoading(false);
    } finally { setBusyUser(null); }
  };

  const statItems = [
    { label: 'Patients', value: stats?.users.PATIENT?.total ?? 0, foot: `${stats?.users.PATIENT?.active ?? 0} active accounts` },
    { label: 'Doctors', value: stats?.users.DOCTOR?.total ?? 0, foot: `${stats?.users.DOCTOR?.active ?? 0} active accounts` },
    { label: 'Confirmed visits', value: stats?.appointments.CONFIRMED ?? 0, foot: `${stats?.appointments.COMPLETED ?? 0} completed` },
    { label: 'Open appointment times', value: stats?.availableSlots ?? 0, foot: 'Available to book' },
  ];

  return (
    <RequireAuth roles={['ADMIN']}>
      <AppShell title="Platform overview" subtitle="People, visits, and account access across MediBook.">
        <div className="stat-grid admin-stat-grid">{statItems.map(({ label, value, foot }) => <article className="stat-card" key={label}><div className="stat-card-label">{label}</div><div className="stat-card-value">{loading ? '…' : value.toLocaleString()}</div><div className="stat-card-foot">{foot}</div></article>)}</div>
        <div className="admin-grid">
          <div className="admin-main-column">
            <section className="panel" id="users">
                <div className="panel-header"><div><h2 className="panel-title">People & access</h2><p className="panel-subtitle">Manage accounts and their access to MediBook.</p></div><span className="pill pill-muted">{users?.meta.total ?? 0} people</span></div>
              <div className="toolbar admin-toolbar"><label className="select-filter-label"><span>Show</span><select className="select-field" value={role} onChange={(event) => { setLoading(true); setRole(event.target.value as RoleFilter); setPage(1); }}><option value="">Everyone</option><option value="PATIENT">Patients</option><option value="DOCTOR">Doctors</option><option value="ADMIN">Admins</option></select></label><span className="toolbar-spacer" /><span className="toolbar-note">Status changes revoke active sessions</span></div>
              {loading ? <div className="skeleton" style={{ height: 250 }} /> : users?.data.length ? <div className="table-wrap admin-user-table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Role</th><th>Contact</th><th>Joined</th><th>Access</th></tr></thead><tbody>{users.data.map((person) => <tr key={person.id}><td><div className="admin-user-name"><span className={`avatar ${person.role === 'DOCTOR' ? 'doctor-mini-avatar' : person.role === 'ADMIN' ? 'admin-mini-avatar' : ''}`}>{initials(person.fullName)}</span><span><strong>{person.fullName}</strong><small>{person.email}</small></span></div></td><td><span className={`role-label role-${person.role.toLowerCase()}`}>{person.role}</span>{person.doctor && <small className="table-subtext">{person.doctor.specialty}</small>}</td><td>{person.phone || 'Not provided'}</td><td>{formatDate(person.createdAt)}</td><td><button className={`access-toggle ${person.isActive ? 'access-on' : 'access-off'}`} disabled={busyUser === person.id || person.id === user?.id} title={person.id === user?.id ? 'You cannot deactivate your own admin account' : person.isActive ? 'Deactivate account' : 'Activate account'} onClick={() => updateStatus(person)}><span />{busyUser === person.id ? 'Saving…' : person.isActive ? 'Active' : 'Inactive'}</button></td></tr>)}</tbody></table></div> : <div className="mini-empty">No accounts match this filter.</div>}
              {!loading && (users?.meta.totalPages ?? 0) > 1 && <div className="admin-pagination"><span>Page {page} of {users?.meta.totalPages}</span><div><button className="button-secondary" disabled={page <= 1} onClick={() => { setLoading(true); setPage((current) => current - 1); }}>Previous</button><button className="button-secondary" disabled={page >= (users?.meta.totalPages ?? 1)} onClick={() => { setLoading(true); setPage((current) => current + 1); }}>Next</button></div></div>}
            </section>
            <section className="panel audit-panel"><div className="panel-header"><div><h2 className="panel-title">Recent activity</h2><p className="panel-subtitle">A short audit trail of important platform events.</p></div></div>{loading ? <div className="skeleton" style={{ height: 160 }} /> : audit.length ? <div className="audit-list">{audit.map((entry) => <div className="audit-row" key={entry.id}><span className="audit-copy"><strong>{entry.action.replaceAll('_', ' ').toLowerCase()}</strong><small>{entry.actor?.fullName ?? 'System'} · {entry.entityType} #{entry.entityId}</small></span><time>{new Intl.DateTimeFormat('en-BD', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(entry.createdAt))}</time></div>)}</div> : <div className="mini-empty">Platform activity will appear here.</div>}</section>
          </div>
          <aside className="admin-side-column">
            <section className="panel create-doctor-panel"><div className="panel-header"><div><h2 className="panel-title">Add a doctor</h2><p className="panel-subtitle">Create a clinician profile and sign-in.</p></div></div>
              <form onSubmit={createDoctor}>
                <div className="form-field"><label className="field-label" htmlFor="doctor-name">Full name</label><input className="field" id="doctor-name" name="fullName" required minLength={2} maxLength={120} placeholder="Dr. Amina Rahman" /></div>
                <div className="form-field"><label className="field-label" htmlFor="doctor-email">Email address</label><input className="field" id="doctor-email" name="email" type="email" required placeholder="doctor@clinic.com" /></div>
                <div className="form-field"><label className="field-label" htmlFor="doctor-password">Temporary password</label><input className="field" id="doctor-password" name="password" type="password" required minLength={12} placeholder="12+ characters" /><small className="password-hint">Include uppercase, lowercase, a number and a symbol.</small></div>
                <div className="form-row"><div className="form-field"><label className="field-label" htmlFor="doctor-specialty">Specialty</label><input className="field" id="doctor-specialty" name="specialty" required minLength={2} maxLength={100} placeholder="Cardiology" /></div><div className="form-field"><label className="field-label" htmlFor="doctor-fee">Fee (BDT)</label><input className="field" id="doctor-fee" name="consultationFee" type="number" required min={0} max={1000000} step="0.01" placeholder="800" /></div></div>
                <div className="form-field"><label className="field-label" htmlFor="doctor-phone">Phone <span className="optional-label">Optional</span></label><input className="field" id="doctor-phone" name="phone" type="tel" pattern="\+?[1-9][0-9]{6,19}" placeholder="+8801XXXXXXXXX" /></div>
                <div className="form-field"><label className="field-label" htmlFor="doctor-bio">Short profile <span className="optional-label">Optional</span></label><textarea className="textarea-field" id="doctor-bio" name="bio" maxLength={5000} placeholder="A short introduction patients will see…" /></div>
                {formError && <div className="alert-inline form-alert">{formError}</div>}
                <button className="button button-dark create-doctor-submit" type="submit" disabled={savingDoctor}>{savingDoctor ? 'Creating profile…' : 'Create doctor account'} <Plus size={15} /></button>
              </form>
            </section>
            <section className="panel account-note"><span className="account-note-icon"><ShieldCheck size={17} /></span><div><strong>Access is protected</strong><p>Deactivating an account immediately revokes its active sessions.</p></div></section>
          </aside>
        </div>
      </AppShell>
    </RequireAuth>
  );
}
