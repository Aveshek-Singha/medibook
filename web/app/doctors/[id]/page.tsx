'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, HeartPulse, ShieldCheck, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppShell, PageLoading } from '@/components/app-shell';
import { useAuth, useToast } from '@/components/providers';
import { api, getApiError } from '@/lib/api';
import { dhakaToday, formatDate, formatMoney, formatTime, initials } from '@/lib/format';
import type { Doctor, Slot } from '@/lib/types';

export default function DoctorProfilePage() {
  const params = useParams<{ id: string }>();
  const doctorId = params.id;
  const { user, loading: authLoading } = useAuth();
  const notify = useToast();
  const router = useRouter();
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [date, setDate] = useState(dhakaToday());
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    let active = true;
    api.get<Doctor>(`/doctors/${doctorId}`)
      .then(({ data }) => { if (active) setDoctor(data); })
      .catch((error) => {
        const detail = getApiError(error);
        if (active) notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [doctorId, notify]);

  useEffect(() => {
    let active = true;
    api.get<Slot[]>(`/doctors/${doctorId}/slots`, { params: { date } })
      .then(({ data }) => { if (active) setSlots(data); })
      .catch((error) => {
        const detail = getApiError(error);
        if (active) notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      })
      .finally(() => { if (active) setSlotsLoading(false); });
    return () => { active = false; };
  }, [date, doctorId, notify]);

  const book = async () => {
    if (!selectedSlot) return;
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(`/doctors/${doctorId}`)}`);
      return;
    }
    if (user.role !== 'PATIENT') {
      notify({ kind: 'info', title: 'Patient account needed', detail: 'Sign in with a patient account to book a visit.' });
      return;
    }
    setBooking(true);
    try {
      await api.post('/appointments', { slotId: selectedSlot });
      notify({ kind: 'success', title: 'Your appointment is confirmed', detail: 'We’ve added it to your appointments.' });
      router.push('/appointments');
    } catch (error) {
      const detail = getApiError(error);
      notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      if (detail.message.toLowerCase().includes('available')) setSelectedSlot(null);
    } finally {
      setBooking(false);
    }
  };

  if ((loading && !doctor) || (doctor && doctor.id !== doctorId)) return <PageLoading />;

  return (
    <AppShell title={doctor?.fullName ?? 'Doctor profile'} subtitle="Get to know your doctor and find a time that works.">
      <Link className="back-link" href="/doctors"><ArrowLeft size={15} /> Back to doctors</Link>
      {!doctor ? <div className="empty-state"><span className="empty-icon"><Stethoscope size={19} /></span><h3>We couldn’t find this doctor</h3><p>The profile may no longer be available.</p></div> : <div className="doctor-detail-grid">
        <div className="main-column">
          <section className="panel doctor-profile-card">
            <div className="doctor-profile-head"><div className="doctor-profile-avatar">{initials(doctor.fullName)}</div><div><span className={`pill ${slots.length ? '' : 'pill-muted'}`}><span className="pill-dot" /> {slots.length ? 'Appointments available' : 'Check another date'}</span><h2>{doctor.fullName}</h2><p>{doctor.specialty} <span>·</span> Dhaka, Bangladesh</p></div></div>
            <div className="doctor-profile-metrics"><div><strong>{formatMoney(doctor.consultationFee)}</strong><small>Consultation fee</small></div><div><strong>{slotsLoading ? '…' : slots.length}</strong><small>Times on selected date</small></div><div><strong>Dhaka time</strong><small>Local appointment times</small></div></div>
            {doctor.bio ? <><h3 className="panel-title">About {doctor.fullName.replace(/^Dr\.?\s+/i, '').split(' ')[0]}</h3><p className="doctor-bio">{doctor.bio}</p></> : <p className="doctor-bio">No profile summary has been added yet.</p>}
            <div className="doctor-value-row"><span><CalendarDays size={15} /> Only available times are listed</span><span><ShieldCheck size={15} /> Your appointments are private</span></div>
          </section>
          <section className="panel availability-panel">
            <div className="panel-header"><div><h2 className="panel-title">Choose a date</h2><p className="panel-subtitle">Available appointment times in Dhaka time.</p></div><span className="pill"><CalendarDays size={13} /> Live availability</span></div>
            <label className="field-label" htmlFor="appointment-date">Appointment date</label><input className="field date-input" id="appointment-date" type="date" min={dhakaToday()} value={date} onChange={(event) => { setSlotsLoading(true); setSelectedSlot(null); setDate(event.target.value); }} />
            <div className="divider" />
            <div className="slot-section-heading"><strong>Available times</strong><span>{date ? formatDate(`${date}T12:00:00+06:00`, { weekday: 'long' }) : ''}</span></div>
            {slotsLoading ? <div className="slot-grid">{Array.from({ length: 6 }, (_, index) => <div className="skeleton" style={{ height: 39 }} key={index} />)}</div> : slots.length ? <div className="slot-grid">{slots.map((slot) => <button className={`slot-button ${selectedSlot === slot.id ? 'slot-button-selected' : ''}`} key={slot.id} onClick={() => setSelectedSlot(slot.id)}>{selectedSlot === slot.id && <Check size={13} />} {formatTime(slot.startTime)}</button>)}</div> : <div className="slots-empty"><Clock3 size={17} /><span>No openings on this date. Try another day.</span></div>}
          </section>
        </div>
        <aside className="side-column">
          <section className="panel booking-summary"><div className="panel-header"><div><h2 className="panel-title">Your visit</h2><p className="panel-subtitle">Review before confirming.</p></div><span className="booking-summary-icon"><CalendarDays size={17} /></span></div>
            <div className="summary-doctor"><span className="avatar avatar-forest">{initials(doctor.fullName)}</span><span><strong>{doctor.fullName}</strong><small>{doctor.specialty}</small></span></div>
            <div className="summary-line"><span>Date</span><strong>{formatDate(`${date}T12:00:00+06:00`, { weekday: 'short', day: 'numeric', month: 'long' })}</strong></div>
            <div className="summary-line"><span>Time</span><strong>{slots.find((slot) => slot.id === selectedSlot) ? formatTime(slots.find((slot) => slot.id === selectedSlot)!.startTime) : 'Choose a time'}</strong></div>
            <div className="summary-line summary-total"><span>Consultation</span><strong>{formatMoney(doctor.consultationFee)}</strong></div>
            <button className="button button-dark booking-button" disabled={!selectedSlot || booking || authLoading} onClick={book}>{booking ? 'Confirming…' : 'Confirm appointment'} <ArrowRight size={16} /></button>
            <p className="booking-security"><ShieldCheck size={13} /> No payment is collected online</p>
          </section>
          <section className="care-note"><span className="care-note-icon"><HeartPulse size={17} /></span><div><strong>Before your visit</strong><p>Bring any recent prescriptions or reports that may help your doctor.</p></div></section>
        </aside>
      </div>}
    </AppShell>
  );
}
