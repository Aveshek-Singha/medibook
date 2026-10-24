import { UserRole } from '../enums';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  phone: string | null;
  tokenVersion: number;
  doctorId?: string;
  patientId?: string;
}
