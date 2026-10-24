import { DefaultNamingStrategy, Table } from 'typeorm';

const nameOf = (table: Table | string) =>
  typeof table === 'string' ? table : table.name;
const keyOf = (table: Table | string, columns: string[]) =>
  `${nameOf(table)}:${[...columns].sort().join(',')}`;

/** Keeps TypeORM metadata and the hand-written, readable migration names aligned. */
export class MediBookNamingStrategy extends DefaultNamingStrategy {
  override indexName(
    table: Table | string,
    columns: string[],
    where?: string,
  ): string {
    const known: Record<string, string> = {
      'users:email': 'uq_users_email',
      'refresh_tokens:token_hash': 'uq_refresh_token_hash',
    };
    return (
      known[keyOf(table, columns)] ?? super.indexName(table, columns, where)
    );
  }

  override uniqueConstraintName(
    table: Table | string,
    columns: string[],
  ): string {
    const known: Record<string, string> = {
      'users:email': 'uq_users_email',
      'refresh_tokens:token_hash': 'uq_refresh_token_hash',
    };
    return (
      known[keyOf(table, columns)] ?? super.uniqueConstraintName(table, columns)
    );
  }

  override relationConstraintName(
    table: Table | string,
    columns: string[],
    where?: string,
  ): string {
    const known: Record<string, string> = {
      'doctors:user_id': 'uq_doctors_user_id',
      'patients:user_id': 'uq_patients_user_id',
    };
    return (
      known[keyOf(table, columns)] ??
      super.relationConstraintName(table, columns, where)
    );
  }

  override foreignKeyName(
    table: Table | string,
    columns: string[],
    referencedTablePath?: string,
    referencedColumnNames?: string[],
  ): string {
    const known: Record<string, string> = {
      'doctors:user_id': 'fk_doctors_user_id',
      'patients:user_id': 'fk_patients_user_id',
      'availability_slots:doctor_id': 'fk_slots_doctor_id',
      'appointments:slot_id': 'fk_appointments_slot_id',
      'appointments:doctor_id': 'fk_appointments_doctor_id',
      'appointments:patient_id': 'fk_appointments_patient_id',
      'sms_outbox:appointment_id': 'fk_outbox_appointment_id',
      'sms_logs:appointment_id': 'fk_sms_logs_appointment_id',
      'refresh_tokens:user_id': 'fk_refresh_tokens_user_id',
      'refresh_tokens:replaced_by_id': 'fk_refresh_tokens_replaced_by_id',
      'audit_logs:actor_user_id': 'fk_audit_logs_actor_user_id',
    };
    return (
      known[keyOf(table, columns)] ??
      super.foreignKeyName(
        table,
        columns,
        referencedTablePath,
        referencedColumnNames,
      )
    );
  }
}
