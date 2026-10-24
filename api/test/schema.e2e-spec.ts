import { DataSource } from 'typeorm';
import { AppointmentStatus } from '../src/common/enums';
import { Appointment } from '../src/appointments/appointment.entity';
import { Doctor } from '../src/doctors/doctor.entity';
import { Patient } from '../src/patients/patient.entity';
import { AvailabilitySlot } from '../src/slots/availability-slot.entity';
import { User } from '../src/users/user.entity';
import { UserRole } from '../src/common/enums';

/**
 * Schema contract tests.
 *
 * These run against the real test database and assert the properties the
 * booking logic depends on. They are deliberately written against raw SQL
 * rather than the ORM, because the point is to verify what MySQL actually
 * stores, not what TypeORM believes it stored.
 */
describe('Schema contract (e2e)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE,
      timezone: 'Z',
      entities: [__dirname + '/../src/**/*.entity{.ts,.js}'],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  const tables = [
    'users',
    'doctors',
    'patients',
    'availability_slots',
    'appointments',
    'sms_outbox',
    'sms_logs',
    'refresh_tokens',
    'audit_logs',
  ];

  it('creates all 9 tables', async () => {
    const rows = await dataSource.query(
      'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
      [process.env.DB_DATABASE],
    );
    const created = rows.map((row: { TABLE_NAME: string }) => row.TABLE_NAME);

    for (const table of tables) {
      expect(created).toContain(table);
    }
  });

  it('declares active_slot_id as a STORED generated column', async () => {
    const rows = await dataSource.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA, GENERATION_EXPRESSION
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'appointments' AND COLUMN_NAME = 'active_slot_id'`,
      [process.env.DB_DATABASE],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].EXTRA).toContain('STORED GENERATED');
    expect(rows[0].IS_NULLABLE).toBe('YES');
    // It must be unsigned, otherwise it cannot hold the full range of the
    // unsigned slot_id it mirrors.
    expect(rows[0].COLUMN_TYPE).toBe('bigint unsigned');
  });

  it('stores the generation expression in typeorm_metadata (no schema drift)', async () => {
    const rows = await dataSource.query(
      `SELECT \`value\` FROM typeorm_metadata
        WHERE \`type\` = 'GENERATED_COLUMN' AND \`name\` = 'active_slot_id'
          AND \`schema\` = ? AND \`table\` = 'appointments'`,
      [process.env.DB_DATABASE],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("IF(status = 'CONFIRMED', slot_id, NULL)");
  });

  it('has a unique index on active_slot_id', async () => {
    const rows = await dataSource.query(
      `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'appointments' AND COLUMN_NAME = 'active_slot_id'`,
      [process.env.DB_DATABASE],
    );

    expect(rows.length).toBeGreaterThan(0);
    // NON_UNIQUE is a BIGINT in information_schema, and the MySQL driver
    // enables `bigNumberStrings`, so it arrives as a string.
    expect(
      rows.every((row: { NON_UNIQUE: string }) => Number(row.NON_UNIQUE) === 0),
    ).toBe(true);
  });

  it('creates every index named in the plan', async () => {
    const expected: Record<string, string[]> = {
      users: ['uq_users_email', 'idx_users_role'],
      doctors: ['uq_doctors_user_id', 'idx_doctors_specialty'],
      patients: ['uq_patients_user_id'],
      availability_slots: [
        'uq_slot_doctor_start',
        'idx_slots_doctor_status_start',
        'idx_slots_doctor_overlap',
      ],
      appointments: [
        'uq_appointment_active_slot',
        'idx_appt_doctor_start_status',
        'idx_appt_patient_start',
        'idx_appt_slot',
        'idx_appt_status',
      ],
      sms_outbox: ['idx_outbox_pending'],
      sms_logs: ['idx_sms_logs_appointment'],
      refresh_tokens: ['uq_refresh_token_hash', 'idx_refresh_user_active'],
    };

    for (const [table, indexNames] of Object.entries(expected)) {
      const rows = await dataSource.query(
        `SELECT DISTINCT INDEX_NAME FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [process.env.DB_DATABASE, table],
      );
      const present = rows.map((row: { INDEX_NAME: string }) => row.INDEX_NAME);

      for (const indexName of indexNames) {
        expect(present).toContain(indexName);
      }
    }
  });

  it('rejects two CONFIRMED appointments for the same slot', async () => {
    const { doctor, patient, slot } = await seedFixture();

    try {
      const first = await dataSource.getRepository(Appointment).save({
        slotId: slot.id,
        doctorId: doctor.id,
        patientId: patient.id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        consultationFee: 500,
        status: AppointmentStatus.CONFIRMED,
      });

      const firstLoaded = await dataSource
        .getRepository(Appointment)
        .findOneByOrFail({
          id: first.id,
        });
      expect(firstLoaded.activeSlotId).toBe(slot.id);

      await expect(
        dataSource.getRepository(Appointment).save({
          slotId: slot.id,
          doctorId: doctor.id,
          patientId: patient.id,
          startTime: slot.startTime,
          endTime: slot.endTime,
          consultationFee: 500,
          status: AppointmentStatus.CONFIRMED,
        }),
      ).rejects.toThrow(/ER_DUP_ENTRY|Duplicate entry/);
    } finally {
      await cleanupFixture(doctor.userId, patient.userId);
    }
  });

  it('allows a CANCELLED appointment for a slot and frees the unique slot', async () => {
    const { doctor, patient, slot } = await seedFixture();

    try {
      const appointment = await dataSource.getRepository(Appointment).save({
        slotId: slot.id,
        doctorId: doctor.id,
        patientId: patient.id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        consultationFee: 500,
        status: AppointmentStatus.CONFIRMED,
      });

      await dataSource.getRepository(Appointment).update(appointment.id, {
        status: AppointmentStatus.CANCELLED,
      });

      const cancelled = await dataSource
        .getRepository(Appointment)
        .findOneByOrFail({ id: appointment.id });
      expect(cancelled.activeSlotId).toBeNull();

      // The slot is free again, so a new CONFIRMED booking is accepted.
      const rebooked = await dataSource.getRepository(Appointment).save({
        slotId: slot.id,
        doctorId: doctor.id,
        patientId: patient.id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        consultationFee: 500,
        status: AppointmentStatus.CONFIRMED,
      });

      expect(rebooked.id).toBeDefined();
    } finally {
      await cleanupFixture(doctor.userId, patient.userId);
    }
  });

  it('does not leak the generated column into INSERT statements', async () => {
    const { doctor, patient, slot } = await seedFixture();

    try {
      // If `active_slot_id` were part of the insert payload, MySQL would
      // reject it with "The value specified for generated column ... is not
      // allowed".
      const appointment = await dataSource.getRepository(Appointment).save({
        slotId: slot.id,
        doctorId: doctor.id,
        patientId: patient.id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        consultationFee: 500,
        status: AppointmentStatus.CONFIRMED,
      });

      expect(appointment.id).toBeDefined();
    } finally {
      await cleanupFixture(doctor.userId, patient.userId);
    }
  });

  async function seedFixture() {
    const suffix = Math.random().toString(36).slice(2, 10);

    const doctorUser = await dataSource.getRepository(User).save({
      email: `doctor-${suffix}@medibook.test`,
      passwordHash: 'hash',
      role: UserRole.DOCTOR,
      fullName: 'Dr Fixture',
      phone: '01700000000',
      isActive: true,
      tokenVersion: 0,
    });

    const doctor = await dataSource.getRepository(Doctor).save({
      userId: doctorUser.id,
      specialty: 'Cardiology',
      bio: null,
      consultationFee: 500,
    });

    const patientUser = await dataSource.getRepository(User).save({
      email: `patient-${suffix}@medibook.test`,
      passwordHash: 'hash',
      role: UserRole.PATIENT,
      fullName: 'Patient Fixture',
      phone: '01800000000',
      isActive: true,
      tokenVersion: 0,
    });

    const patient = await dataSource.getRepository(Patient).save({
      userId: patientUser.id,
      dateOfBirth: null,
    });

    const start = new Date('2030-01-01T10:00:00.000Z');
    const slot = await dataSource.getRepository(AvailabilitySlot).save({
      doctorId: doctor.id,
      startTime: start,
      endTime: new Date('2030-01-01T10:30:00.000Z'),
      status: 'BOOKED' as never,
    });

    return { doctor, patient, slot, doctorUser, patientUser };
  }

  async function cleanupFixture(doctorUserId: string, patientUserId: string) {
    // Appointments cascade from the outbox/logs; delete them explicitly
    // because the fixture rows reference them via RESTRICT on the parents.
    await dataSource.query(
      'DELETE FROM appointments WHERE doctor_id IN (SELECT id FROM doctors WHERE user_id = ?)',
      [doctorUserId],
    );
    await dataSource.query(
      'DELETE FROM availability_slots WHERE doctor_id IN (SELECT id FROM doctors WHERE user_id = ?)',
      [doctorUserId],
    );
    await dataSource.query('DELETE FROM doctors WHERE user_id = ?', [
      doctorUserId,
    ]);
    await dataSource.query('DELETE FROM patients WHERE user_id = ?', [
      patientUserId,
    ]);
    await dataSource.query('DELETE FROM users WHERE id IN (?, ?)', [
      doctorUserId,
      patientUserId,
    ]);
  }
});
