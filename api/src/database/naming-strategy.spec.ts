import { MediBookNamingStrategy } from './naming-strategy';

describe('MediBookNamingStrategy', () => {
  const strategy = new MediBookNamingStrategy();

  it('matches the migration names for generated foreign keys and one-to-one indexes', () => {
    expect(
      strategy.foreignKeyName(
        'appointments',
        ['slot_id'],
        'availability_slots',
        ['id'],
      ),
    ).toBe('fk_appointments_slot_id');
    expect(strategy.relationConstraintName('doctors', ['user_id'])).toBe(
      'uq_doctors_user_id',
    );
    expect(strategy.relationConstraintName('patients', ['user_id'])).toBe(
      'uq_patients_user_id',
    );
  });

  it('matches explicit unique index names for the login and refresh-token lookup columns', () => {
    expect(strategy.uniqueConstraintName('users', ['email'])).toBe(
      'uq_users_email',
    );
    expect(
      strategy.uniqueConstraintName('refresh_tokens', ['token_hash']),
    ).toBe('uq_refresh_token_hash');
  });
});
