'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, Clock3, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/providers';
import { api, getApiError } from '@/lib/api';
import { dhakaToday, formatDate, formatMoney, formatTime } from '@/lib/format';
import type { Appointment, AppointmentStatus, Page, Slot } from '@/lib/types';

type StatusFilter = 'ALL' | AppointmentStatus;

function AppointmentCard({
  appointment,
  now,
  onCancel,
  onReschedule,
}: {
  appointment: Appointment;
  now: number;
  onCancel: (appointment: Appointment) => void;
  onReschedule: (appointment: Appointment) => void;
}) {
  const date = new Date(appointment.startTime);
  const month = new Intl.DateTimeFormat('en-BD', { timeZone: 'Asia/Dhaka', month: 'short' }).format(date).toUpperCase();
  const day = new Intl.DateTimeFormat('en-BD', { timeZone: 'Asia/Dhaka', day: 'numeric' }).format(date);
  const upcoming = appointment.status === 'CONFIRMED' && date.getTime() > now;
  return (
    <article className="appointment-card">
      <div className="appointment-date"><span>{month}</span><strong>{day}</strong></div>
      <div className="appointment-main">
        <h3>{appointment.doctor.fullName}</h3>
        <p>{appointment.doctor.specialty}</p>
        <div className="appointment-meta"><span className="icon-text"><Clock3 size={13} /> {formatTime(appointment.startTime)} – {formatTime(appointment.endTime)}</span><span className="icon-text"><span className="meta-dot" />{formatMoney(appointment.consultationFee)}</span><span className={`status-badge status-${appointment.status.toLowerCase()}`}>{appointment.status}</span></div>
      </div>
      <div className="appointment-actions">
        {upcoming && <><button className="button-quiet" onClick={() => onReschedule(appointment)}><RefreshCw size={13} /> Reschedule</button><button className="button-quiet cancel-link" onClick={() => onCancel(appointment)}><X size={14} /> Cancel</button></>}
      </div>
    </article>
  );
}

export default function AppointmentsPage() {
  const notify = useToast();
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [appointments, setAppointments] = useState<Page<Appointment> | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState(dhakaToday());
  const [rescheduleSlots, setRescheduleSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState('');
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadAppointments = useCallback(() => {
    api.get<Page<Appointment>>('/appointments/me', { params: { page: 1, limit: 50, ...(filter !== 'ALL' ? { status: filter } : {}) } })
      .then(({ data }) => { setAppointments(data); setNow(Date.now()); })
      .catch((error) => {
        const detail = getApiError(error);
        notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      })
      .finally(() => setLoading(false));
  }, [filter, notify]);

  useEffect(() => { void loadAppointments(); }, [loadAppointments]);

  useEffect(() => {
    if (!rescheduleTarget) return;
    let active = true;
    api.get<Slot[]>(`/doctors/${rescheduleTarget.doctor.id}/slots`, { params: { date: rescheduleDate } })
      .then(({ data }) => { if (active) setRescheduleSlots(data); })
      .catch((error) => {
        const detail = getApiError(error);
        if (active) notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [rescheduleTarget, rescheduleDate, notify]);

  const cancelAppointment = async () => {
    if (!cancelTarget) return;
    setSaving(true);
    try {
      await api.patch(`/appointments/${cancelTarget.id}/cancel`);
      notify({ kind: 'success', title: 'Appointment cancelled', detail: 'Your doctor’s availability has been updated.' });
      setCancelTarget(null);
      setLoading(true);
      loadAppointments();
    } catch (error) {
      const detail = getApiError(error);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
    } finally { setSaving(false); }
  };

  const saveReschedule = async () => {
    if (!rescheduleTarget || !selectedSlot) return;
    setSaving(true);
    try {
      await api.patch(`/appointments/${rescheduleTarget.id}/reschedule`, { newSlotId: selectedSlot });
      notify({ kind: 'success', title: 'Appointment rescheduled', detail: 'Your updated visit is ready.' });
      setRescheduleTarget(null);
      setLoading(true);
      loadAppointments();
    } catch (error) {
      const detail = getApiError(error);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
    } finally { setSaving(false); }
  };

  const filters: StatusFilter[] = ['ALL', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];

  return (
    <RequireAuth roles={['PATIENT']}>
      <AppShell title="My appointments" subtitle="Keep track of what’s coming up and the care you’ve received.">
        <div className="appointment-top-row"><div className="filter-tabs" aria-label="Filter appointments">{filters.map((item) => <button className={`filter-tab ${filter === item ? 'filter-tab-active' : ''}`} key={item} onClick={() => { setLoading(true); setFilter(item); }}>{item === 'ALL' ? 'All visits' : item.charAt(0) + item.slice(1).toLowerCase()}</button>)}</div><Link className="button button-dark button-small" href="/doctors">Book a visit <ArrowRight size={15} /></Link></div>
        <section className="appointments-content">
          <div className="appointments-section-heading"><div><h2 className="panel-title">{filter === 'ALL' ? 'All your visits' : `${filter.charAt(0)}${filter.slice(1).toLowerCase()} visits`}</h2><p className="panel-subtitle">{appointments?.meta.total ?? '…'} appointment{appointments?.meta.total === 1 ? '' : 's'} in your care timeline.</p></div><span className="secure-note"><ShieldCheck size={14} /> Only you can see this</span></div>
          {loading ? <div className="appointment-list">{Array.from({ length: 3 }, (_, index) => <div className="skeleton" style={{ height: 92 }} key={index} />)}</div> : appointments?.data.length ? <div className="appointment-list">{appointments.data.map((appointment) => <AppointmentCard appointment={appointment} now={now} key={appointment.id} onCancel={setCancelTarget} onReschedule={(target) => { setSlotsLoading(true); setSelectedSlot(''); setRescheduleDate(dhakaToday()); setRescheduleTarget(target); }} />)}</div> : <div className="empty-state"><span className="empty-icon"><CalendarDays size={19} /></span><h3>{filter === 'ALL' ? 'Your care journey starts here' : 'No visits in this view'}</h3><p>{filter === 'ALL' ? 'Book your first visit with a doctor who feels right for you.' : 'Try another filter to see more of your appointments.'}</p>{filter === 'ALL' && <Link className="button button-dark button-small empty-cta" href="/doctors">Find a doctor <ArrowRight size={14} /></Link>}</div>}
          {!loading && appointments?.meta.totalPages && appointments.meta.totalPages > 1 ? <p className="result-count">Showing {appointments.data.length} of {appointments.meta.total} appointments</p> : null}
        </section>
        <div className="privacy-callout"><span><ShieldCheck size={16} /></span><p><strong>Your health information is private.</strong> Appointment details are visible only to you and your care team.</p></div>

        {cancelTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCancelTarget(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title"><div className="modal-header"><div><h2 id="cancel-title">Cancel this visit?</h2><p>{cancelTarget.doctor.fullName} · {formatDate(cancelTarget.startTime, { weekday: 'long' })}, {formatTime(cancelTarget.startTime)}</p></div><button className="icon-button" aria-label="Close" onClick={() => setCancelTarget(null)}><X size={18} /></button></div><div className="cancel-info"><span className="cancel-info-icon"><CalendarDays size={17} /></span><p>This appointment will be cancelled and the time will be released for another patient. You can book a new time whenever you’re ready.</p></div><div className="modal-actions"><button className="button-secondary" onClick={() => setCancelTarget(null)}>Keep appointment</button><button className="button-secondary button-danger" disabled={saving} onClick={cancelAppointment}>{saving ? 'Cancelling…' : 'Cancel appointment'}</button></div></section></div>}

        {rescheduleTarget && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRescheduleTarget(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title"><div className="modal-header"><div><h2 id="reschedule-title">Find a new time</h2><p>Choose another available time with {rescheduleTarget.doctor.fullName}.</p></div><button className="icon-button" aria-label="Close" onClick={() => setRescheduleTarget(null)}><X size={18} /></button></div><div className="form-field"><label className="field-label" htmlFor="reschedule-date">New appointment date</label><input className="field" id="reschedule-date" type="date" min={dhakaToday()} value={rescheduleDate} onChange={(event) => { setSlotsLoading(true); setSelectedSlot(''); setRescheduleDate(event.target.value); }} /></div><div className="slot-section-heading"><strong>Available times</strong><span>Dhaka time</span></div>{slotsLoading ? <div className="slot-grid">{Array.from({ length: 4 }, (_, index) => <div className="skeleton" style={{ height: 39 }} key={index} />)}</div> : rescheduleSlots.length ? <div className="slot-grid">{rescheduleSlots.map((slot) => <button className={`slot-button ${selectedSlot === slot.id ? 'slot-button-selected' : ''}`} key={slot.id} onClick={() => setSelectedSlot(slot.id)}>{selectedSlot === slot.id && <Check size={13} />} {formatTime(slot.startTime)}</button>)}</div> : <div className="slots-empty"><Clock3 size={16} /><span>No available times on this date.</span></div>}<div className="modal-actions"><button className="button-secondary" onClick={() => setRescheduleTarget(null)}>Go back</button><button className="button button-dark button-small" disabled={!selectedSlot || saving} onClick={saveReschedule}>{saving ? 'Updating…' : 'Confirm new time'} <ArrowRight size={14} /></button></div></section></div>}
      </AppShell>
    </RequireAuth>
  );
}
