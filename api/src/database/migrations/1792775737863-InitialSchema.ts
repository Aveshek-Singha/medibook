import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for MediBook.
 *
 * NOTE on `appointments.active_slot_id`
 * ------------------------------------
 * This is a STORED generated column that mirrors `slot_id` while the
 * appointment is CONFIRMED, and the UNIQUE index on it is the database-level
 * backstop against double-booking:
 *
 *   - two CONFIRMED rows for the same slot  -> rejected (ER_DUP_ENTRY)
 *   - CANCELLED rows store NULL              -> allowed (MySQL permits
 *     any number of NULLs inside a unique index)
 *
 * TypeORM's own schema builder emits the UNSIGNED attribute AFTER the
 * generated clause:
 *
 *   `active_slot_id` bigint AS (...) STORED UNSIGNED NULL
 *
 * which is invalid MySQL grammar (ER_PARSE_ERROR). The UNSIGNED attribute
 * belongs to the data type, so the correct order is:
 *
 *   `active_slot_id` bigint UNSIGNED AS (...) STORED NULL
 *
 * The CREATE TABLE statement below is therefore written by hand rather than
 * produced by `migration:generate`. The entity metadata still declares
 * `unsigned: true` so that the schema loader reports no drift.
 */
export class InitialSchema1792775737863 implements MigrationInterface {
  name = 'InitialSchema1792775737863';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`users\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`email\` varchar(190) NOT NULL, \`password_hash\` varchar(255) NOT NULL, \`role\` enum ('ADMIN', 'DOCTOR', 'PATIENT') NOT NULL, \`full_name\` varchar(120) NOT NULL, \`phone\` varchar(20) NULL, \`is_active\` tinyint NOT NULL DEFAULT 1, \`token_version\` int NOT NULL DEFAULT '0', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_users_role\` (\`role\`, \`is_active\`), UNIQUE INDEX \`uq_users_email\` (\`email\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `CREATE TABLE \`doctors\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`specialty\` varchar(100) NOT NULL, \`bio\` text NULL, \`consultation_fee\` decimal(10,2) NOT NULL DEFAULT '0.00', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`idx_doctors_specialty\` (\`specialty\`), UNIQUE INDEX \`uq_doctors_user_id\` (\`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `CREATE TABLE \`patients\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`date_of_birth\` date NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE INDEX \`uq_patients_user_id\` (\`user_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `CREATE TABLE \`availability_slots\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`doctor_id\` bigint UNSIGNED NOT NULL, \`start_time\` datetime NOT NULL, \`end_time\` datetime NOT NULL, \`status\` enum ('AVAILABLE', 'BOOKED') NOT NULL DEFAULT 'AVAILABLE', \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`idx_slots_doctor_overlap\` (\`doctor_id\`, \`start_time\`, \`end_time\`), INDEX \`idx_slots_doctor_status_start\` (\`doctor_id\`, \`status\`, \`start_time\`), UNIQUE INDEX \`uq_slot_doctor_start\` (\`doctor_id\`, \`start_time\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );

    // `active_slot_id` must be declared after `slot_id` and `status`, because
    // MySQL only allows a generated column to reference columns declared
    // before it.
    await queryRunner.query(
      `CREATE TABLE \`appointments\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`slot_id\` bigint UNSIGNED NOT NULL, \`doctor_id\` bigint UNSIGNED NOT NULL, \`patient_id\` bigint UNSIGNED NOT NULL, \`start_time\` datetime NOT NULL, \`end_time\` datetime NOT NULL, \`consultation_fee\` decimal(10,2) NOT NULL DEFAULT '0.00', \`status\` enum ('CONFIRMED', 'CANCELLED', 'COMPLETED') NOT NULL DEFAULT 'CONFIRMED', \`active_slot_id\` bigint UNSIGNED AS (IF(status = 'CONFIRMED', slot_id, NULL)) STORED NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`idx_appt_doctor_start_status\` (\`doctor_id\`, \`start_time\`, \`status\`), INDEX \`idx_appt_patient_start\` (\`patient_id\`, \`start_time\`), INDEX \`idx_appt_slot\` (\`slot_id\`), INDEX \`idx_appt_status\` (\`status\`, \`start_time\`), UNIQUE INDEX \`uq_appointment_active_slot\` (\`active_slot_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `CREATE TABLE \`sms_outbox\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`appointment_id\` bigint UNSIGNED NOT NULL, \`type\` enum ('CONFIRMATION', 'REMINDER_24H', 'REMINDER_1H', 'CANCELLATION', 'RESCHEDULED') NOT NULL, \`to_phone\` varchar(20) NOT NULL, \`send_at\` datetime NOT NULL, \`status\` enum ('PENDING', 'DISPATCHED', 'FAILED') NOT NULL DEFAULT 'PENDING', \`attempts\` int NOT NULL DEFAULT '0', \`last_error\` text NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`dispatched_at\` datetime NULL, INDEX \`idx_outbox_pending\` (\`status\`, \`send_at\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `CREATE TABLE \`sms_logs\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`appointment_id\` bigint UNSIGNED NOT NULL, \`type\` enum ('CONFIRMATION', 'REMINDER_24H', 'REMINDER_1H', 'CANCELLATION', 'RESCHEDULED') NOT NULL, \`to_phone\` varchar(20) NOT NULL, \`status\` enum ('SENT', 'FAILED') NOT NULL, \`attempts\` int NOT NULL DEFAULT '1', \`error\` text NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`idx_sms_logs_appointment\` (\`appointment_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `CREATE TABLE \`refresh_tokens\` (\`id\` bigint UNSIGNED NOT NULL AUTO_INCREMENT, \`user_id\` bigint UNSIGNED NOT NULL, \`token_hash\` varchar(128) NOT NULL, \`expires_at\` datetime NOT NULL, \`revoked_at\` datetime NULL, \`replaced_by_id\` bigint UNSIGNED NULL, \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`idx_refresh_user_active\` (\`user_id\`, \`revoked_at\`, \`expires_at\`), UNIQUE INDEX \`uq_refresh_token_hash\` (\`token_hash\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );

    await queryRunner.query(
      `ALTER TABLE \`doctors\` ADD CONSTRAINT \`fk_doctors_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`patients\` ADD CONSTRAINT \`fk_patients_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`availability_slots\` ADD CONSTRAINT \`fk_slots_doctor_id\` FOREIGN KEY (\`doctor_id\`) REFERENCES \`doctors\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` ADD CONSTRAINT \`fk_appointments_slot_id\` FOREIGN KEY (\`slot_id\`) REFERENCES \`availability_slots\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` ADD CONSTRAINT \`fk_appointments_doctor_id\` FOREIGN KEY (\`doctor_id\`) REFERENCES \`doctors\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` ADD CONSTRAINT \`fk_appointments_patient_id\` FOREIGN KEY (\`patient_id\`) REFERENCES \`patients\`(\`id\`) ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sms_outbox\` ADD CONSTRAINT \`fk_outbox_appointment_id\` FOREIGN KEY (\`appointment_id\`) REFERENCES \`appointments\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`sms_logs\` ADD CONSTRAINT \`fk_sms_logs_appointment_id\` FOREIGN KEY (\`appointment_id\`) REFERENCES \`appointments\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`refresh_tokens\` ADD CONSTRAINT \`fk_refresh_tokens_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`refresh_tokens\` ADD CONSTRAINT \`fk_refresh_tokens_replaced_by_id\` FOREIGN KEY (\`replaced_by_id\`) REFERENCES \`refresh_tokens\`(\`id\`) ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // TypeORM keeps the generation expression of a generated column in its own
    // `typeorm_metadata` table, because information_schema renders it in a
    // different format. The schema loader reads the expression from there and
    // compares it with the entity, so a mismatch shows up as schema drift.
    //
    // The current database is resolved at run time instead of being hardcoded,
    // so the same migration applies to both `medibook` and `medibook_test`.
    await this.writeGeneratedColumnExpression(
      queryRunner,
      'appointments',
      'active_slot_id',
      "IF(status = 'CONFIRMED', slot_id, NULL)",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.deleteGeneratedColumnExpression(
      queryRunner,
      'appointments',
      'active_slot_id',
    );

    await queryRunner.query(
      `ALTER TABLE \`refresh_tokens\` DROP FOREIGN KEY \`fk_refresh_tokens_replaced_by_id\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`refresh_tokens\` DROP FOREIGN KEY \`fk_refresh_tokens_user_id\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`sms_logs\` DROP FOREIGN KEY \`fk_sms_logs_appointment_id\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`sms_outbox\` DROP FOREIGN KEY \`fk_outbox_appointment_id\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` DROP FOREIGN KEY \`fk_appointments_patient_id\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` DROP FOREIGN KEY \`fk_appointments_doctor_id\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` DROP FOREIGN KEY \`fk_appointments_slot_id\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`availability_slots\` DROP FOREIGN KEY \`fk_slots_doctor_id\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`patients\` DROP FOREIGN KEY \`fk_patients_user_id\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`doctors\` DROP FOREIGN KEY \`fk_doctors_user_id\``,
    );

    await queryRunner.query(`DROP TABLE \`refresh_tokens\``);
    await queryRunner.query(`DROP TABLE \`sms_logs\``);
    await queryRunner.query(`DROP TABLE \`sms_outbox\``);
    await queryRunner.query(`DROP TABLE \`appointments\``);
    await queryRunner.query(`DROP TABLE \`availability_slots\``);
    await queryRunner.query(`DROP TABLE \`patients\``);
    await queryRunner.query(`DROP TABLE \`doctors\``);
    await queryRunner.query(`DROP TABLE \`users\``);
  }

  /**
   * Stores the generation expression of a generated column in TypeORM's
   * metadata table. The `schema` column holds the database name, which is
   * what the schema loader matches on when it reads the expression back.
   */
  private async writeGeneratedColumnExpression(
    queryRunner: QueryRunner,
    table: string,
    column: string,
    expression: string,
  ): Promise<void> {
    const currentDatabase = await this.currentDatabase(queryRunner);

    await queryRunner.query(
      `INSERT INTO \`typeorm_metadata\` (\`database\`, \`schema\`, \`table\`, \`type\`, \`name\`, \`value\`) VALUES (DEFAULT, ?, ?, ?, ?, ?)`,
      [currentDatabase, table, 'GENERATED_COLUMN', column, expression],
    );
  }

  private async deleteGeneratedColumnExpression(
    queryRunner: QueryRunner,
    table: string,
    column: string,
  ): Promise<void> {
    const currentDatabase = await this.currentDatabase(queryRunner);

    await queryRunner.query(
      `DELETE FROM \`typeorm_metadata\` WHERE \`type\` = ? AND \`name\` = ? AND \`schema\` = ? AND \`table\` = ?`,
      ['GENERATED_COLUMN', column, currentDatabase, table],
    );
  }

  private async currentDatabase(queryRunner: QueryRunner): Promise<string> {
    const rows = await queryRunner.query('SELECT DATABASE() AS `db_name`');
    return rows[0].db_name;
  }
}
