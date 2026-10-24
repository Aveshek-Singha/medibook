'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Brand, PublicHeader } from '@/components/app-shell';
import { useAuth } from '@/components/providers';
import { roleHome } from '@/lib/format';

const appointmentSteps = [
  { title: 'Choose a specialty', copy: 'Start with the kind of care you are looking for.' },
  { title: 'Review your options', copy: 'Compare doctor profiles and consultation fees in BDT.' },
  { title: 'Pick an open time', copy: 'Book a real slot and manage the visit from your appointments.' },
];

const appointmentScenes = [
  '/images/appointment-scene-1.jpg',
  '/images/appointment-scene-2.jpg',
  '/images/appointment-scene-3.jpg',
];

export default function HomePage() {
  const { user, loading: authLoading } = useAuth();
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialty, setSpecialty] = useState('');
  const [activeScene, setActiveScene] = useState(0);

  useEffect(() => {
    api.get<string[]>('/doctors/specialties').then(({ data }) => setSpecialties(data)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        const frame = Number((entry.target as HTMLElement).dataset.stageFrame);
        if (Number.isInteger(frame)) setActiveScene(frame);
      });
    }, { threshold: 0.3, rootMargin: '-8% 0px -34% 0px' });

    document.querySelectorAll('.landing-reveal').forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const doctorsHref = specialty ? `/doctors?specialty=${encodeURIComponent(specialty)}` : '/doctors';

  return (
    <main className="marketing-page landing-layout">
      <figure className="landing-stage" aria-label="Appointment times in a calm clinic setting">
        <div className="landing-stage-brand"><Brand /></div>
        <div className="landing-stage-images" aria-hidden="true">
          {appointmentScenes.map((src, index) => (
            <Image
              className={`landing-stage-image ${index === activeScene ? 'landing-stage-image-active' : ''}`}
              src={src}
              alt=""
              fill
              priority={index === 0}
              unoptimized
              sizes="(max-width: 820px) 100vw, 43vw"
              key={src}
            />
          ))}
        </div>
      </figure>

      <div className="landing-reading">
        <PublicHeader landing />

        <section className="landing-hero landing-reveal" data-stage-frame="0">
          <h1>Care in Dhaka, on your time.</h1>
          <p>Find specialists, compare consultation fees in BDT, and book from the appointment times doctors have opened.</p>
          <div className="landing-hero-actions">
            <Link className="button button-dark" href="/doctors">Find a specialist <ArrowRight size={16} /></Link>
            <Link className="text-link" href="#how-it-works">How MediBook works <ArrowRight size={15} /></Link>
          </div>
          <p className="landing-time-note"><Clock3 size={15} /> Appointments are shown in Dhaka time.</p>
          {!authLoading && <p className="landing-signin-note">{user ? 'Already signed in?' : 'Already have an account?'} <Link href={user ? roleHome(user.role) : '/login'}>{user ? 'Open your workspace' : 'Log in'}</Link></p>}
        </section>

        <section className="landing-search landing-reveal" data-stage-frame="0" data-ui="app">
          <div className="landing-search-copy">
            <h2>Start with a specialty</h2>
            <p>See listed doctors and their consultation fees.</p>
          </div>
          <label className="landing-specialty-field">
            <span>Specialty</span>
            <select value={specialty} onChange={(event) => setSpecialty(event.target.value)}>
              <option value="">All specialties</option>
              {specialties.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
          <Link className="button button-secondary" href={doctorsHref}>Explore doctors <ArrowRight size={15} /></Link>
        </section>

        <section className="itinerary-section landing-reveal" id="how-it-works" data-stage-frame="1">
          <div className="itinerary-intro">
            <h2>From search to visit</h2>
            <p>Each step stays clear, from the first profile to the confirmed appointment.</p>
          </div>
          <div className="itinerary-slip" data-ui="app">
            <h3>Your booking, step by step</h3>
            <ol>
              {appointmentSteps.map((step) => (
                <li key={step.title}>
                  <div><strong>{step.title}</strong><p>{step.copy}</p></div>
                  <ArrowRight size={15} aria-hidden="true" />
                </li>
              ))}
            </ol>
            <div className="itinerary-result">
              <span>After booking</span>
              <strong>Your visit appears in My appointments.</strong>
            </div>
          </div>
        </section>

        <section className="clinician-section landing-reveal" id="for-clinicians" data-stage-frame="2">
          <div className="clinician-copy">
            <h2>A clearer clinic day</h2>
            <p>Clinicians set the appointment times patients can book, then manage visits from one workspace.</p>
            <Link className="text-link" href="/login">Clinician sign in <ArrowRight size={15} /></Link>
          </div>
          <div className="clinic-preview" data-ui="app" aria-label="Example doctor schedule">
            <div className="clinic-preview-heading">
              <strong>Doctor workspace</strong>
              <span>Example schedule</span>
            </div>
            <div className="clinic-preview-row">
              <time>09:00</time>
              <span>Open appointment</span>
              <span className="clinic-preview-state">Bookable</span>
            </div>
            <div className="clinic-preview-row">
              <time>09:30</time>
              <span>Confirmed visit</span>
              <span className="clinic-preview-state">Scheduled</span>
            </div>
            <p>Sample times shown in Dhaka time.</p>
          </div>
        </section>

        <footer className="landing-footer">
          <Brand />
          <span>Care appointments, made easier to manage.</span>
          <div>
            <Link href="/doctors">Find care</Link>
            <Link href="/register">Create an account</Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
