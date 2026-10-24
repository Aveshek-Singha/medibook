import 'reflect-metadata';
import * as argon2 from 'argon2';
import { addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { AppDataSource } from '../data-source';
import { AppointmentStatus, SlotStatus, UserRole } from '../../common/enums';
import { Appointment } from '../../appointments/appointment.entity';
import { Doctor } from '../../doctors/doctor.entity';
import { AvailabilitySlot } from '../../slots/availability-slot.entity';
import { Patient } from '../../patients/patient.entity';
import { User } from '../../users/user.entity';

const specialties = [
  'Cardiology',
  'Dermatology',
  'Family medicine',
  'Neurology',
  'Pediatrics',
];
const zone = process.env.APP_TIMEZONE ?? 'Asia/Dhaka';

async function run() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed is disabled in production');
  }
  const password = process.env.DEMO_SEED_PASSWORD ?? 'MediBookDemo123!';
  if (password.length < 12)
    throw new Error('DEMO_SEED_PASSWORD must contain at least 12 characters');
  await AppDataSource.initialize();
  try {
    const users = AppDataSource.getRepository(User);
    const doctors = AppDataSource.getRepository(Doctor);
    const patients = AppDataSource.getRepository(Patient);
    const slots = AppDataSource.getRepository(AvailabilitySlot);
    const appointments = AppDataSource.getRepository(Appointment);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const ensureUser = async (
      email: string,
      role: UserRole,
      fullName: string,
      phone: string,
    ) => {
      let user = await users.findOne({ where: { email } });
      if (!user) {
        user = await users.save(
          users.create({
            email,
            passwordHash,
            role,
            fullName,
            phone,
            isActive: true,
            tokenVersion: 0,
          }),
        );
      }
      return user;
    };

    await ensureUser(
      'admin@example.com',
      UserRole.ADMIN,
      'MediBook Admin',
      '+8801700000001',
    );

    const doctorProfiles: Doctor[] = [];
    for (let index = 0; index < specialties.length; index += 1) {
      const user = await ensureUser(
        `doctor${index + 1}@example.com`,
        UserRole.DOCTOR,
        [
          'Dr. Amina Rahman',
          'Dr. Farhan Karim',
          'Dr. Nadia Islam',
          'Dr. Tanvir Hasan',
          'Dr. Samira Chowdhury',
        ][index],
        `+88017000000${10 + index}`,
      );
      let profile = await doctors.findOne({ where: { userId: user.id } });
      if (!profile) {
        profile = await doctors.save(
          doctors.create({
            userId: user.id,
            specialty: specialties[index],
            bio: `Experienced ${specialties[index].toLowerCase()} physician focused on thoughtful, patient-first care.`,
            consultationFee: 800 + index * 100,
          }),
        );
      }
      doctorProfiles.push(profile);
    }

    const patientProfiles: Patient[] = [];
    for (let index = 0; index < 10; index += 1) {
      const user = await ensureUser(
        `patient${index + 1}@example.com`,
        UserRole.PATIENT,
        [
          'Sadia Akter',
          'Imran Hossain',
          'Nusrat Jahan',
          'Rafi Ahmed',
          'Maliha Sultana',
          'Arif Rahman',
          'Tania Islam',
          'Raihan Chowdhury',
          'Anika Das',
          'Fahim Uddin',
        ][index],
        `+88018000000${10 + index}`,
      );
      let profile = await patients.findOne({ where: { userId: user.id } });
      if (!profile)
        profile = await patients.save(
          patients.create({ userId: user.id, dateOfBirth: null }),
        );
      patientProfiles.push(profile);
    }

    const now = new Date();
    const futureSlots: AvailabilitySlot[] = [];
    for (const doctor of doctorProfiles) {
      for (let day = 1; day <= 7; day += 1) {
        const date = formatInTimeZone(addDays(now, day), zone, 'yyyy-MM-dd');
        for (const hour of [10, 14]) {
          const localStart = `${date}T${String(hour).padStart(2, '0')}:00:00`;
          const startTime = fromZonedTime(localStart, zone);
          const endTime = new Date(startTime.getTime() + 30 * 60_000);
          const existing = await slots.findOne({
            where: { doctorId: doctor.id, startTime },
          });
          if (!existing) {
            futureSlots.push(
              slots.create({
                doctorId: doctor.id,
                startTime,
                endTime,
                status: SlotStatus.AVAILABLE,
              }),
            );
          }
        }
      }
    }
    if (futureSlots.length) await slots.save(futureSlots, { chunk: 200 });

    let seededAppointments = 0;
    for (let index = 0; index < doctorProfiles.length; index += 1) {
      const doctor = doctorProfiles[index];
      const patient = patientProfiles[index];
      const existingDemoAppointment = await appointments.findOne({
        where: { doctorId: doctor.id, patientId: patient.id },
      });
      if (existingDemoAppointment) continue;
      const candidate = await slots.findOne({
        where: { doctorId: doctor.id, status: SlotStatus.AVAILABLE },
        order: { startTime: 'ASC' },
      });
      if (!candidate) continue;
      const existing = await appointments.findOne({
        where: { slotId: candidate.id },
      });
      if (existing) continue;
      await AppDataSource.transaction(async (manager) => {
        candidate.status = SlotStatus.BOOKED;
        await manager.getRepository(AvailabilitySlot).save(candidate);
        await manager.getRepository(Appointment).save(
          manager.getRepository(Appointment).create({
            slotId: candidate.id,
            doctorId: doctor.id,
            patientId: patient.id,
            startTime: candidate.startTime,
            endTime: candidate.endTime,
            consultationFee: doctor.consultationFee,
            status: AppointmentStatus.CONFIRMED,
          }),
        );
      });
      seededAppointments += 1;
    }

    console.info(
      `Demo data ready: 1 admin, ${doctorProfiles.length} doctors, ${patientProfiles.length} patients, ${futureSlots.length} new slots, ${seededAppointments} new appointments.`,
    );
    console.info(
      'Local demo accounts use the DEMO_SEED_PASSWORD value. Do not use these accounts in a public deployment.',
    );
  } finally {
    await AppDataSource.destroy();
  }
}

run().catch((error: unknown) => {
  console.error('Demo seed failed:', error);
  process.exitCode = 1;
});
