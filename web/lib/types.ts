export type UserRole = 'ADMIN' | 'DOCTOR' | 'PATIENT';
export type AppointmentStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  phone: string | null;
  doctorId?: string;
  patientId?: string;
}

export interface Doctor {
  id: string;
  fullName: string;
  specialty: string;
  bio: string | null;
  consultationFee: number;
}

export interface Slot {
  id: string;
  doctorId?: string;
  startTime: string;
  endTime: string;
  status: 'AVAILABLE' | 'BOOKED';
}

export interface Appointment {
  id: string;
  slotId: string;
  doctor: { id: string; fullName: string; specialty: string };
  patient?: { id: string; fullName: string };
  startTime: string;
  endTime: string;
  consultationFee: number;
  status: AppointmentStatus;
}

export interface Page<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface AdminUser extends User {
  isActive: boolean;
  createdAt: string;
  doctor?: {
    id: string;
    specialty: string;
    consultationFee: number;
  };
}

export interface AdminStats {
  users: Record<string, { total: number; active: number }>;
  appointments: Record<string, number>;
  availableSlots: number;
}

export interface AuditEntry {
  id: string;
  actor: { id: string; fullName: string } | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuthSessionResponse {
  accessToken: string;
  user: User;
}
