'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, Clock3, Plus, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { RequireAuth } from '@/components/require-auth';
import { useToast } from '@/components/providers';
import { api, getApiError } from '@/lib/api';
import { dhakaLocalToISOString, dhakaToday, formatDate, formatDateTime, formatTime } from '@/lib/format';
import type { Appointment, AppointmentStatus, Page, Slot } from '@/lib/types';

function addDhakaDays(days: number) {
  const [year, month, day] = dhakaToday().split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`; // taste-skill-ignore: ISO calendar dates require two-digit month and day.
}

export default function DoctorWorkspacePage() {
  const notify = useToast();
  const [slots, setSlots] = useState<Page<Slot> | null>(null);
  const [appointments, setAppointments] = useState<Page<Appointment> | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  const [saving, setSaving] = useState(false);
  const [slotDate, setSlotDate] = useState(addDhakaDays(1));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('12:00');
  const [duration, setDuration] = useState(30);
  const [from, setFrom] = useState(dhakaToday());
  const [to, setTo] = useState(addDhakaDays(14));
  const [appliedFrom, setAppliedFrom] = useState(dhakaToday());
  const [appliedTo, setAppliedTo] = useState(addDhakaDays(14));
  const [status, setStatus] = useState<'' | AppointmentStatus>('');
  const [validation, setValidation] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [slotResult, appointmentResult] = await Promise.all([
        api.get<Page<Slot>>('/doctor/slots', { params: { page: 1, limit: 100 } }),
        api.get<Page<Appointment>>('/doctor/appointments', { params: { page: 1, limit: 100, from: appliedFrom, to: appliedTo, ...(status ? { status } : {}) } }),
      ]);
      setSlots(slotResult.data);
      setAppointments(appointmentResult.data);
      setNow(Date.now());
    } catch (error) {
      const detail = getApiError(error);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
    } finally { setLoading(false); }
  }, [appliedFrom, appliedTo, status, notify]);

  // The loader commits state only after its parallel API requests resolve.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadData(); }, [loadData]);

  const createSlots = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidation('');
    const start = new Date(dhakaLocalToISOString(slotDate, startTime)).getTime();
    const end = new Date(dhakaLocalToISOString(slotDate, endTime)).getTime();
    if (end <= start) { setValidation('End time must be after the start time.'); return; }
    const minutes = (end - start) / 60_000;
    if (minutes < duration || minutes % duration !== 0) { setValidation('The time range must fit complete appointment blocks.'); return; }
    const count = minutes / duration;
    if (count > 200) { setValidation('A single request can include up to 200 slots.'); return; }
    const newSlots = Array.from({ length: count }, (_, index) => {
      const slotStart = start + index * duration * 60_000;
      return { startTime: new Date(slotStart).toISOString(), endTime: new Date(slotStart + duration * 60_000).toISOString() };
    });
    setSaving(true);
    setLoading(true);
    try {
      const { data } = await api.post<Slot[]>('/doctor/slots', { slots: newSlots });
      notify({ kind: 'success', title: `${data.length} appointment times added`, detail: 'Patients can now book these times.' });
      await loadData();
    } catch (error) {
      const detail = getApiError(error);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      setLoading(false);
    } finally { setSaving(false); }
  };

  const removeSlot = async (slot: Slot) => {
    setSaving(true);
    setLoading(true);
    try {
      await api.delete(`/doctor/slots/${slot.id}`);
      notify({ kind: 'success', title: 'Availability removed' });
      await loadData();
    } catch (error) {
      const detail = getApiError(error);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      setLoading(false);
    } finally { setSaving(false); }
  };

  const updateAppointment = async (appointment: Appointment, action: 'complete' | 'cancel') => {
    setSaving(true);
    setLoading(true);
    try {
      await api.patch(`/doctor/appointments/${appointment.id}/${action}`);
      notify({ kind: 'success', title: action === 'complete' ? 'Visit marked complete' : 'Appointment cancelled' });
      await loadData();
    } catch (error) {
      const detail = getApiError(error);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      setLoading(false);
    } finally { setSaving(false); }
  };

  const applyAppointmentFilters = () => {
    if (to < from) { setValidation('The end date must be on or after the start date.'); return; }
    setValidation('');
    setLoading(true);
    setAppliedFrom(from);
    setAppliedTo(to);
  };

  return (
    <RequireAuth roles={['DOCTOR']}>
      <AppShell title="Clinic schedule" subtitle="Open appointment times and patient visits in Dhaka time.">
        <div className="stat-grid doctor-stat-grid">
          <article className="stat-card"><div className="stat-card-label">Visits in range</div><div className="stat-card-value">{loading ? '…' : appointments?.meta.total ?? 0}</div><div className="stat-card-foot">Confirmed, completed, and cancelled</div></article>
          <article className="stat-card"><div className="stat-card-label">Open appointment times</div><div className="stat-card-value">{loading ? '…' : slots?.meta.total ?? 0}</div><div className="stat-card-foot">Available to book</div></article>
        </div>

        <div className="doctor-workspace-grid">
          <div className="doctor-workspace-main">
            <section className="panel">
              <div className="panel-header"><div><h2 className="panel-title">Appointments</h2><p className="panel-subtitle">Your patient schedule, shown in Dhaka time.</p></div></div>
              <div className="toolbar appointment-filter-toolbar"><label className="compact-field"><span>From</span><input className="field" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label className="compact-field"><span>To</span><input className="field" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><label className="compact-field"><span>Status</span><select className="select-field" value={status} onChange={(event) => { setLoading(true); setStatus(event.target.value as '' | AppointmentStatus); }}><option value="">All statuses</option><option value="CONFIRMED">Confirmed</option><option value="COMPLETED">Completed</option><option value="CANCELLED">Cancelled</option></select></label><button className="button-secondary apply-filter" onClick={applyAppointmentFilters}>Apply</button></div>
              {validation && <p className="alert-inline filter-alert">{validation}</p>}
              {loading ? <div className="appointment-list">{Array.from({ length: 3 }, (_, index) => <div className="skeleton" style={{ height: 80 }} key={index} />)}</div> : appointments?.data.length ? <div className="doctor-appointment-list">{appointments.data.map((appointment) => <article className="doctor-appointment-row" key={appointment.id}><div className="appointment-date"><span>{new Intl.DateTimeFormat('en-BD', { timeZone: 'Asia/Dhaka', month: 'short' }).format(new Date(appointment.startTime)).toUpperCase()}</span><strong>{new Intl.DateTimeFormat('en-BD', { timeZone: 'Asia/Dhaka', day: 'numeric' }).format(new Date(appointment.startTime))}</strong></div><div className="doctor-appointment-main"><div className="doctor-appointment-title"><strong>{appointment.patient?.fullName ?? 'Patient'}</strong><span className={`status-badge status-${appointment.status.toLowerCase()}`}>{appointment.status}</span></div><p>{formatDateTime(appointment.startTime)} <span>·</span> {appointment.doctor.specialty}</p></div><div className="doctor-appointment-actions">{appointment.status === 'CONFIRMED' && <>{new Date(appointment.endTime).getTime() <= now && <button className="button-secondary" disabled={saving} onClick={() => updateAppointment(appointment, 'complete')}><Check size={13} /> Complete</button>}{new Date(appointment.startTime).getTime() > now && <button className="button-quiet cancel-link" disabled={saving} onClick={() => updateAppointment(appointment, 'cancel')}>Cancel</button>}</>}</div></article>)}</div> : <div className="empty-state compact-empty"><span className="empty-icon"><CalendarDays size={18} /></span><h3>No appointments in this range</h3><p>New bookings will show here as soon as patients choose your open times.</p></div>}
              {!loading && appointments?.meta.totalPages && appointments.meta.totalPages > 1 && <p className="result-count">Showing the first 100 appointments. Narrow the date range to see a shorter schedule.</p>}
            </section>
          </div>
          <aside className="doctor-workspace-side">
            <section className="panel schedule-panel"><div className="panel-header"><div><h2 className="panel-title">Add availability</h2><p className="panel-subtitle">Create patient-ready appointment times.</p></div><span className="schedule-icon"><Plus size={16} /></span></div>
              <form onSubmit={createSlots}>
                <div className="form-field"><label className="field-label" htmlFor="slot-date">Clinic date</label><input className="field" id="slot-date" type="date" min={dhakaToday()} required value={slotDate} onChange={(event) => setSlotDate(event.target.value)} /></div>
                <div className="form-row"><div className="form-field"><label className="field-label" htmlFor="start-time">From</label><input className="field" id="start-time" type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div><div className="form-field"><label className="field-label" htmlFor="end-time">Until</label><input className="field" id="end-time" type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div></div>
                <div className="form-field"><label className="field-label" htmlFor="duration">Appointment length</label><select className="select-field" id="duration" value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option></select></div>
                <p className="schedule-preview"><Clock3 size={13} /> Times will be created in Dhaka local time.</p>
                <button className="button button-dark schedule-submit" type="submit" disabled={saving}>Add times <ArrowRight size={15} /></button>
              </form>
            </section>
            <section className="panel open-slots-panel"><div className="panel-header"><div><h2 className="panel-title">Open appointment times</h2><p className="panel-subtitle">Upcoming times patients can book.</p></div><span className="pill pill-muted">{slots?.meta.total ?? 0}</span></div>
              {loading ? <div className="skeleton" style={{ height: 120 }} /> : slots?.data.length ? <div className="open-slot-list">{slots.data.slice(0, 8).map((slot) => <div className="open-slot-row" key={slot.id}><span className="open-slot-info"><strong>{formatDate(slot.startTime, { weekday: 'short', day: 'numeric', month: 'short' })}</strong><small>{formatTime(slot.startTime)} – {formatTime(slot.endTime)}</small></span><button className="icon-button slot-delete" title="Remove availability" aria-label="Remove availability" disabled={saving} onClick={() => removeSlot(slot)}><Trash2 size={14} /></button></div>)}</div> : <div className="mini-empty">No open times yet. Add your first clinic hours above.</div>}
              {(slots?.meta.total ?? 0) > 8 && <p className="result-count">Showing 8 of {slots?.meta.total} open times.</p>}
            </section>
          </aside>
        </div>
      </AppShell>
    </RequireAuth>
  );
}
