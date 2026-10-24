import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { formatInTimeZone } from 'date-fns-tz';
import request from 'supertest';
import { AppointmentStatus, UserRole } from '../src/common/enums';
import { Doctor } from '../src/doctors/doctor.entity';
import { Patient } from '../src/patients/patient.entity';
import { User } from '../src/users/user.entity';
import { AvailabilitySlot } from '../src/slots/availability-slot.entity';
import { Appointment } from '../src/appointments/appointment.entity';
import { REDIS_CLIENT } from '../src/redis/redis.module';
import { createE2eApp } from './setup-e2e';

const PASSWORD = 'MediBookTest123!';
const TEST_ORIGIN = 'http://localhost:3001';

describe('MediBook API workflows (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let doctor: Doctor;
  let secondPatient: Patient;
  let doctorToken: string;
  let patientToken: string;
  let secondPatientToken: string;
  let adminToken: string;
  let slots: AvailabilitySlot[];

  const resetTables = async () => {
    await dataSource.query('SET FOREIGN_KEY_CHECKS=0');
    try {
      for (const table of [
        'audit_logs',
        'sms_logs',
        'sms_outbox',
        'appointments',
        'availability_slots',
        'refresh_tokens',
        'doctors',
        'patients',
        'users',
      ])
        await dataSource.query(`TRUNCATE TABLE \`${table}\``);
    } finally {
      await dataSource.query('SET FOREIGN_KEY_CHECKS=1');
    }
  };

  async function createAccount(
    role: UserRole,
    email: string,
    fullName: string,
  ) {
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email,
        passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
        role,
        fullName,
        phone: '+8801700000042',
        isActive: true,
        tokenVersion: 0,
      }),
    );
    if (role === UserRole.DOCTOR) {
      const profile = await dataSource.getRepository(Doctor).save(
        dataSource.getRepository(Doctor).create({
          userId: user.id,
          specialty: 'Cardiology',
          bio: 'Patient-first cardiology care.',
          consultationFee: 1200,
        }),
      );
      return { user, profile };
    }
    if (role === UserRole.PATIENT) {
      const profile = await dataSource
        .getRepository(Patient)
        .save(
          dataSource
            .getRepository(Patient)
            .create({ userId: user.id, dateOfBirth: null }),
        );
      return { user, profile };
    }
    return { user };
  }

  async function login(email: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', TEST_ORIGIN)
      .send({ email, password: PASSWORD });
    expect(response.status).toBe(201);
    return {
      accessToken: response.body.accessToken as string,
      cookie: firstCookie(response).split(';')[0],
    };
  }

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const firstCookie = (response: {
    headers: Record<string, string | string[] | undefined>;
  }) => {
    const value = response.headers['set-cookie'];
    const first = Array.isArray(value) ? value[0] : value;
    if (!first) throw new Error('Refresh cookie was not set');
    return first;
  };

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    const redis = app.get(REDIS_CLIENT);
    if (redis.status !== 'ready') await redis.connect();
    await redis.flushdb();
    await resetTables();

    const doctorFixture = await createAccount(
      UserRole.DOCTOR,
      'doctor.e2e@example.com',
      'Dr. Test',
    );
    await createAccount(
      UserRole.PATIENT,
      'patient.e2e@example.com',
      'Patient One',
    );
    const secondPatientFixture = await createAccount(
      UserRole.PATIENT,
      'patient2.e2e@example.com',
      'Patient Two',
    );
    await createAccount(UserRole.ADMIN, 'admin.e2e@example.com', 'Admin One');
    doctor = doctorFixture.profile as Doctor;
    secondPatient = secondPatientFixture.profile as Patient;

    doctorToken = (await login('doctor.e2e@example.com')).accessToken;
    patientToken = (await login('patient.e2e@example.com')).accessToken;
    secondPatientToken = (await login('patient2.e2e@example.com')).accessToken;
    adminToken = (await login('admin.e2e@example.com')).accessToken;

    const base = new Date();
    base.setUTCDate(base.getUTCDate() + 4);
    base.setUTCHours(8, 0, 0, 0);
    const slotInputs = [0, 1, 2, 3, 4].map((index) => {
      const start = new Date(base.getTime() + index * 86_400_000);
      return {
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 30 * 60_000).toISOString(),
      };
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/doctor/slots')
      .set(bearer(doctorToken))
      .send({ slots: slotInputs });
    expect(response.status).toBe(201);
    slots = (response.body as AvailabilitySlot[]).map((slot) => ({
      ...slot,
      startTime: new Date(slot.startTime),
      endTime: new Date(slot.endTime),
    }));
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await resetTables();
    await app?.close();
  });

  it('limits the sixth login attempt and reports the standard error contract', async () => {
    await app.get(REDIS_CLIENT).flushdb();
    const oldLimit = process.env.LOGIN_THROTTLE_LIMIT;
    process.env.LOGIN_THROTTLE_LIMIT = '5';
    try {
      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          request(app.getHttpServer())
            .post('/api/v1/auth/login')
            .set('Origin', TEST_ORIGIN)
            .send({ email: 'missing@example.com', password: PASSWORD }),
        ),
      );
      expect(
        responses.filter((response) => response.status === 401),
      ).toHaveLength(5);
      const limited = responses.find((response) => response.status === 429);
      expect(limited).toBeDefined();
      expect(limited!.body.requestId).toBe(limited!.headers['x-request-id']);
      expect(limited!.body.path).toContain('/api/v1/auth/login');
    } finally {
      if (oldLimit === undefined) delete process.env.LOGIN_THROTTLE_LIMIT;
      else process.env.LOGIN_THROTTLE_LIMIT = oldLimit;
      await app.get(REDIS_CLIENT).flushdb();
    }
  });

  it('registers, restores, rotates, revokes and rejects refresh-cookie sessions', async () => {
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'new.patient@example.com',
        password: PASSWORD,
        fullName: 'New Patient',
        phone: '+8801700000043',
      });
    expect(registered.status).toBe(201);
    expect(firstCookie(registered)).toContain('Path=/api/v1/auth');
    expect(firstCookie(registered).toLowerCase()).toContain('httponly');
    expect(registered.body.user.role).toBe(UserRole.PATIENT);
    const oldCookie = firstCookie(registered).split(';')[0];

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(registered.body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('new.patient@example.com');

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', oldCookie);
    expect(refreshed.status).toBe(201);
    expect(refreshed.body.accessToken).toBeDefined();
    const newCookie = firstCookie(refreshed).split(';')[0];
    expect(firstCookie(refreshed)).toContain('Path=/api/v1/auth');

    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', oldCookie);
    expect(replay.status).toBe(401);
    const familyRevoked = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', newCookie);
    expect(familyRevoked.status).toBe(401);

    const session = await login('new.patient@example.com');
    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', session.cookie);
    expect(logout.status).toBe(201);
    const afterLogout = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', session.cookie);
    expect(afterLogout.status).toBe(401);
  });

  it('enforces roles and validates request bodies', async () => {
    const denied = await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set(bearer(patientToken));
    expect(denied.status).toBe(403);

    const wrongRole = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(bearer(doctorToken))
      .send({ slotId: slots[0].id });
    expect(wrongRole.status).toBe(403);

    const invalid = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(bearer(patientToken))
      .send({ slotId: '0', extra: true });
    expect(invalid.status).toBe(400);
    expect(invalid.body.requestId).toBe(invalid.headers['x-request-id']);
    expect(invalid.body.timestamp).toBeDefined();
  });

  it('lists doctors and converts a Dhaka date filter to the correct slots', async () => {
    const doctors = await request(app.getHttpServer()).get(
      '/api/v1/doctors?page=1&limit=1',
    );
    expect(doctors.status).toBe(200);
    expect(doctors.body.meta).toMatchObject({
      page: 1,
      limit: 1,
      total: 1,
      totalPages: 1,
    });
    expect(doctors.body.data[0]).toMatchObject({
      id: doctor.id,
      specialty: 'Cardiology',
    });
    const nameSearch = await request(app.getHttpServer()).get(
      '/api/v1/doctors?q=Test',
    );
    expect(nameSearch.status).toBe(200);
    expect(nameSearch.body.data).toHaveLength(1);
    expect(nameSearch.body.data[0].fullName).toBe('Dr. Test');

    const specialties = await request(app.getHttpServer()).get(
      '/api/v1/doctors/specialties',
    );
    expect(specialties.body).toContain('Cardiology');
    const date = formatInTimeZone(
      new Date(slots[0].startTime),
      'Asia/Dhaka',
      'yyyy-MM-dd',
    );
    const slotList = await request(app.getHttpServer()).get(
      `/api/v1/doctors/${doctor.id}/slots?date=${date}`,
    );
    expect(slotList.status).toBe(200);
    expect(slotList.body.map((slot: { id: string }) => slot.id)).toContain(
      slots[0].id,
    );
  });

  it('serializes competing bookings, frees cancelled slots, and preserves state on failed reschedule', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/api/v1/appointments')
          .set(bearer(patientToken))
          .send({ slotId: slots[0].id }),
      ),
    );
    expect(attempts.filter((response) => response.status === 201)).toHaveLength(
      1,
    );
    expect(attempts.filter((response) => response.status === 409)).toHaveLength(
      9,
    );
    const booked = attempts.find((response) => response.status === 201)!.body;

    const patientList = await request(app.getHttpServer())
      .get('/api/v1/appointments/me?page=1&limit=10')
      .set(bearer(patientToken));
    expect(patientList.status).toBe(200);
    expect(patientList.body.meta.total).toBe(1);

    const cancelled = await request(app.getHttpServer())
      .patch(`/api/v1/appointments/${booked.id}/cancel`)
      .set(bearer(patientToken));
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe(AppointmentStatus.CANCELLED);
    const rebooked = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(bearer(patientToken))
      .send({ slotId: slots[0].id });
    expect(rebooked.status).toBe(201);

    const rescheduled = await request(app.getHttpServer())
      .patch(`/api/v1/appointments/${rebooked.body.id}/reschedule`)
      .set(bearer(patientToken))
      .send({ newSlotId: slots[1].id });
    if (rescheduled.status !== 200) {
      throw new Error(`Reschedule failed: ${JSON.stringify(rescheduled.body)}`);
    }
    expect(rescheduled.body.slotId).toBe(slots[1].id);

    const otherBooking = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(bearer(secondPatientToken))
      .send({ slotId: slots[2].id });
    expect(otherBooking.status).toBe(201);
    const failedMove = await request(app.getHttpServer())
      .patch(`/api/v1/appointments/${rebooked.body.id}/reschedule`)
      .set(bearer(patientToken))
      .send({ newSlotId: slots[2].id });
    expect(failedMove.status).toBe(409);
    const stillBooked = await dataSource
      .getRepository(Appointment)
      .findOneByOrFail({ id: rebooked.body.id });
    expect(stillBooked.slotId).toBe(slots[1].id);
    expect(stillBooked.status).toBe(AppointmentStatus.CONFIRMED);

    const doctorCancelled = await request(app.getHttpServer())
      .patch(`/api/v1/doctor/appointments/${otherBooking.body.id}/cancel`)
      .set(bearer(doctorToken));
    expect(doctorCancelled.status).toBe(200);
    expect(doctorCancelled.body.status).toBe(AppointmentStatus.CANCELLED);

    const doctorList = await request(app.getHttpServer())
      .get('/api/v1/doctor/appointments?page=1&limit=10')
      .set(bearer(doctorToken));
    expect(doctorList.status).toBe(200);
    expect(doctorList.body.meta.total).toBe(3);

    const appointmentDate = formatInTimeZone(
      slots[1].startTime,
      'Asia/Dhaka',
      'yyyy-MM-dd',
    );
    const filteredDoctorList = await request(app.getHttpServer())
      .get(
        `/api/v1/doctor/appointments?page=1&limit=10&from=${appointmentDate}&to=${appointmentDate}`,
      )
      .set(bearer(doctorToken));
    expect(filteredDoctorList.status).toBe(200);
    expect(filteredDoctorList.body.meta.total).toBe(1);
    expect(filteredDoctorList.body.data[0].slotId).toBe(slots[1].id);
  });

  it('creates slots atomically, rejects overlaps, and only deletes unused availability', async () => {
    const listed = await request(app.getHttpServer())
      .get('/api/v1/doctor/slots?page=1&limit=100')
      .set(bearer(doctorToken));
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((slot: { id: string }) => slot.id)).toContain(
      slots[4].id,
    );

    const overlapStart = new Date(slots[3].startTime.getTime() + 10 * 60_000);
    const overlapEnd = new Date(overlapStart.getTime() + 30 * 60_000);
    const overlap = await request(app.getHttpServer())
      .post('/api/v1/doctor/slots')
      .set(bearer(doctorToken))
      .send({
        slots: [
          {
            startTime: overlapStart.toISOString(),
            endTime: overlapEnd.toISOString(),
          },
        ],
      });
    expect(overlap.status).toBe(409);

    const invalidDuration = await request(app.getHttpServer())
      .post('/api/v1/doctor/slots')
      .set(bearer(doctorToken))
      .send({
        slots: [
          {
            startTime: slots[4].startTime.toISOString(),
            endTime: slots[4].startTime.toISOString(),
          },
        ],
      });
    expect(invalidDuration.status).toBe(400);

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/doctor/slots/${slots[4].id}`)
      .set(bearer(doctorToken));
    expect(deleted.status).toBe(200);
  });

  it('supports admin doctor creation, metrics, audits, completion and deactivation revocation', async () => {
    const createDoctor = await request(app.getHttpServer())
      .post('/api/v1/admin/doctors')
      .set(bearer(adminToken))
      .send({
        email: 'created.doctor@example.com',
        password: PASSWORD,
        fullName: 'Created Doctor',
        phone: '+8801700000044',
        specialty: 'Neurology',
        consultationFee: 1500,
      });
    expect(createDoctor.status).toBe(201);
    expect(createDoctor.body.specialty).toBe('Neurology');

    const users = await request(app.getHttpServer())
      .get('/api/v1/admin/users?role=PATIENT&page=1&limit=1')
      .set(bearer(adminToken));
    expect(users.status).toBe(200);
    expect(users.body.meta.total).toBe(3);
    expect(users.body.meta.limit).toBe(1);

    const stats = await request(app.getHttpServer())
      .get('/api/v1/admin/stats')
      .set(bearer(adminToken));
    expect(stats.status).toBe(200);
    expect(stats.body.users.ADMIN.total).toBe(1);
    expect(stats.body.appointments.CONFIRMED).toBeGreaterThan(0);

    const audit = await request(app.getHttpServer())
      .get('/api/v1/admin/audit-logs?limit=100')
      .set(bearer(adminToken));
    expect(audit.status).toBe(200);
    expect(
      audit.body.some(
        (item: { action: string }) => item.action === 'APPOINTMENT_RESCHEDULED',
      ),
    ).toBe(true);

    const future = new Date(Date.now() + 11 * 86_400_000);
    future.setUTCHours(8, 0, 0, 0);
    const completionSlot = await request(app.getHttpServer())
      .post('/api/v1/doctor/slots')
      .set(bearer(doctorToken))
      .send({
        slots: [
          {
            startTime: future.toISOString(),
            endTime: new Date(future.getTime() + 30 * 60_000).toISOString(),
          },
        ],
      });
    expect(completionSlot.status).toBe(201);
    const completionBooking = await request(app.getHttpServer())
      .post('/api/v1/appointments')
      .set(bearer(patientToken))
      .send({ slotId: completionSlot.body[0].id });
    expect(completionBooking.status).toBe(201);
    await dataSource.getRepository(Appointment).update(
      { id: completionBooking.body.id },
      {
        startTime: new Date(Date.now() - 60 * 60_000),
        endTime: new Date(Date.now() - 30 * 60_000),
      },
    );
    const completed = await request(app.getHttpServer())
      .patch(
        `/api/v1/doctor/appointments/${completionBooking.body.id}/complete`,
      )
      .set(bearer(doctorToken));
    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe(AppointmentStatus.COMPLETED);

    const secondLogin = await login('patient2.e2e@example.com');
    const deactivated = await request(app.getHttpServer())
      .patch(`/api/v1/admin/users/${secondPatient.userId}/status`)
      .set(bearer(adminToken))
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    const oldAccess = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set(bearer(secondPatientToken));
    expect(oldAccess.status).toBe(401);
    const blockedLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'patient2.e2e@example.com', password: PASSWORD });
    expect(blockedLogin.status).toBe(401);
    const blockedRefresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', secondLogin.cookie);
    expect(blockedRefresh.status).toBe(401);
  });
});
