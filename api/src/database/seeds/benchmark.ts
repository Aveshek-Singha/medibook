import 'reflect-metadata';
import { AppDataSource } from '../data-source';

async function run() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The benchmark seed is disabled in production');
  const rows = Number(process.env.BENCHMARK_ROWS ?? 1_000_000);
  if (!Number.isInteger(rows) || rows < 1 || rows > 1_000_000) {
    throw new Error('BENCHMARK_ROWS must be an integer between 1 and 1000000');
  }
  await AppDataSource.initialize();
  const queryRunner = AppDataSource.createQueryRunner();
  try {
    await queryRunner.connect();
    const [{ doctorCount }] = (await queryRunner.query(
      'SELECT COUNT(*) AS doctorCount FROM doctors',
    )) as [{ doctorCount: string }];
    const [{ patientCount }] = (await queryRunner.query(
      'SELECT COUNT(*) AS patientCount FROM patients',
    )) as [{ patientCount: string }];
    if (Number(doctorCount) < 5 || Number(patientCount) < 10) {
      throw new Error(
        'Run seed:demo first; the benchmark needs 5 doctors and 10 patients',
      );
    }

    await queryRunner.query('SET SESSION cte_max_recursion_depth = 2000000');
    const [{ slotBase }] = (await queryRunner.query(
      'SELECT COALESCE(MAX(id), 0) AS slotBase FROM availability_slots',
    )) as [{ slotBase: string }];

    await queryRunner.query(
      `INSERT INTO availability_slots (id, doctor_id, start_time, end_time, status)
         WITH RECURSIVE seq(n) AS (
           SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?
         ), doctors_ranked AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rank_id FROM doctors
         )
         SELECT CAST(? AS UNSIGNED) + seq.n,
                doctor.id,
                TIMESTAMPADD(MINUTE, seq.n, '2026-01-01 00:00:00'),
                TIMESTAMPADD(MINUTE, seq.n + 30, '2026-01-01 00:00:00'),
                'BOOKED'
           FROM seq
           JOIN doctors_ranked doctor ON doctor.rank_id = MOD(seq.n - 1, 5) + 1`,
      [rows, slotBase],
    );
    await queryRunner.query(
      `INSERT INTO appointments (slot_id, doctor_id, patient_id, start_time, end_time, status, consultation_fee)
         WITH RECURSIVE seq(n) AS (
           SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?
         ), patients_ranked AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rank_id FROM patients
         )
         SELECT CAST(? AS UNSIGNED) + seq.n,
                slot.doctor_id,
                patient.id,
                slot.start_time,
                slot.end_time,
                'CONFIRMED',
                500
           FROM seq
           JOIN availability_slots slot ON slot.id = CAST(? AS UNSIGNED) + seq.n
           JOIN patients_ranked patient ON patient.rank_id = MOD(seq.n - 1, 10) + 1`,
      [rows, slotBase, slotBase],
    );
    const [{ count }] = await queryRunner.query(
      'SELECT COUNT(*) AS count FROM appointments',
    );
    console.info(
      `Inserted ${rows.toLocaleString()} benchmark appointments. Total appointments: ${count}.`,
    );
  } finally {
    await queryRunner.release();
    await AppDataSource.destroy();
  }
}

run().catch((error: unknown) => {
  console.error('Benchmark seed failed:', error);
  process.exitCode = 1;
});
