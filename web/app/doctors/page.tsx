'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, ChevronLeft, ChevronRight, Search, SlidersHorizontal, Stethoscope } from 'lucide-react';
import { AppShell, PageLoading } from '@/components/app-shell';
import { api, getApiError } from '@/lib/api';
import { formatMoney, initials } from '@/lib/format';
import type { Doctor, Page } from '@/lib/types';
import { useToast } from '@/components/providers';

function DoctorCard({ doctor }: { doctor: Doctor }) {
  return (
    <article className="doctor-card">
      <span className="doctor-avatar" aria-hidden="true">{initials(doctor.fullName)}</span>
      <div className="doctor-card-body">
        <span className="doctor-card-specialty">{doctor.specialty}</span>
        <h3>{doctor.fullName}</h3>
        {doctor.bio && <p className="doctor-card-bio">{doctor.bio}</p>}
        <div className="doctor-card-bottom">
          <span><strong>{formatMoney(doctor.consultationFee)}</strong><small>per consultation</small></span>
          <Link className="doctor-card-cta" href={`/doctors/${doctor.id}`} aria-label={`View ${doctor.fullName}`}><ArrowRight size={16} /></Link>
        </div>
      </div>
    </article>
  );
}

function DoctorDirectory() {
  const notify = useToast();
  const searchParams = useSearchParams();
  const [doctors, setDoctors] = useState<Page<Doctor> | null>(null);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [specialty, setSpecialty] = useState(searchParams.get('specialty') ?? '');
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<string[]>('/doctors/specialties').then(({ data }) => setSpecialties(data)).catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    api.get<Page<Doctor>>('/doctors', { params: { page, limit: 12, ...(specialty ? { specialty } : {}), ...(activeSearch ? { q: activeSearch } : {}) } })
      .then(({ data }) => { if (active) setDoctors(data); })
      .catch((error) => {
        const detail = getApiError(error);
        if (active) notify({ kind: 'error', title: detail.message, detail: detail.requestId ? `Reference ${detail.requestId}` : undefined });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, specialty, activeSearch, notify]);

  const visibleDoctors = doctors?.data ?? [];
  const totalPages = doctors?.meta.totalPages ?? 0;

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setPage(1);
    setActiveSearch(search.trim());
  };

  return (
    <AppShell title="Find your doctor" subtitle="Meet specialists and choose a time that works for you.">
      <form className="directory-toolbar" onSubmit={submitSearch}>
        <div className="directory-search"><Search size={16} /><input aria-label="Search doctors" placeholder="Search by doctor name" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="directory-search-submit" type="submit" aria-label="Search"><ArrowRight size={14} /></button></div>
        <label className="specialty-filter"><SlidersHorizontal size={15} /><select aria-label="Filter by specialty" value={specialty} onChange={(event) => { setLoading(true); setSpecialty(event.target.value); setPage(1); }}><option value="">All specialties</option>{specialties.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
        <span className="directory-count">{doctors?.meta.total ?? '…'} specialists</span>
      </form>
      {loading ? <div className="doctor-grid">{Array.from({ length: 6 }, (_, index) => <div className="skeleton skeleton-card" key={index} />)}</div> : visibleDoctors.length ? <div className="doctor-grid">{visibleDoctors.map((doctor) => <DoctorCard doctor={doctor} key={doctor.id} />)}</div> : <div className="empty-state"><h3>No doctors found</h3><p>{activeSearch ? 'Try a different name or clear your search.' : 'There are no doctors listed in this specialty yet.'}</p>{(activeSearch || specialty) && <button className="button-quiet" type="button" onClick={() => { setLoading(true); setSearch(''); setActiveSearch(''); setSpecialty(''); setPage(1); }}>Clear filters</button>}</div>}
      {totalPages > 1 && <nav className="pagination" aria-label="Doctor pages"><button aria-label="Previous page" disabled={page <= 1} onClick={() => { setLoading(true); setPage((value) => value - 1); }}><ChevronLeft size={15} /></button>{Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => <button className={number === page ? 'pagination-active' : ''} key={number} onClick={() => { setLoading(true); setPage(number); }}>{number}</button>)}<button aria-label="Next page" disabled={page >= totalPages} onClick={() => { setLoading(true); setPage((value) => value + 1); }}><ChevronRight size={15} /></button></nav>}
      <div className="directory-footnote"><Stethoscope size={14} /> All consultations are scheduled in Dhaka time <span>·</span> Need help? <Link href="/login">Sign in</Link></div>
    </AppShell>
  );
}

export default function DoctorsPage() {
  return <Suspense fallback={<PageLoading />}><DoctorDirectory /></Suspense>;
}
