import { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds audit history and explicit outbox/log states used by cancellation. */
export class BackendWork1792828800000 implements MigrationInterface {
  name = 'BackendWork1792828800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE `sms_outbox` MODIFY `status` enum ('PENDING', 'DISPATCHED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING'",
    );
    await queryRunner.query(
      "ALTER TABLE `sms_logs` MODIFY `status` enum ('SENT', 'FAILED', 'SKIPPED') NOT NULL",
    );
    await queryRunner.query(
      "CREATE TABLE `audit_logs` (`id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, `actor_user_id` bigint UNSIGNED NULL, `action` enum ('APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_COMPLETED', 'USER_STATUS_CHANGED', 'DOCTOR_CREATED') NOT NULL, `entity_type` varchar(32) NOT NULL, `entity_id` bigint UNSIGNED NOT NULL, `metadata` json NULL, `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX `idx_audit_actor_created` (`actor_user_id`, `created_at`), INDEX `idx_audit_entity_created` (`entity_type`, `entity_id`, `created_at`), PRIMARY KEY (`id`)) ENGINE=InnoDB",
    );
    await queryRunner.query(
      'ALTER TABLE `audit_logs` ADD CONSTRAINT `fk_audit_logs_actor_user_id` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE `audit_logs` DROP FOREIGN KEY `fk_audit_logs_actor_user_id`',
    );
    await queryRunner.query('DROP TABLE `audit_logs`');
    await queryRunner.query(
      "ALTER TABLE `sms_logs` MODIFY `status` enum ('SENT', 'FAILED') NOT NULL",
    );
    await queryRunner.query(
      "ALTER TABLE `sms_outbox` MODIFY `status` enum ('PENDING', 'DISPATCHED', 'FAILED') NOT NULL DEFAULT 'PENDING'",
    );
  }
}
