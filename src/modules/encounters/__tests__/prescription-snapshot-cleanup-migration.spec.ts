import * as fs from 'fs';
import * as path from 'path';

const BACKEND_ROOT = path.resolve(__dirname, '../../../..');
const PREV_MIGRATION = '20261127120000_patient_optional_birthdate_gender';
const CURR_MIGRATION =
  '20261127120100_prescription_snapshot_clear_placeholder_dob';
const MIGRATION_PATH = path.join(
  BACKEND_ROOT,
  `prisma/migrations/${CURR_MIGRATION}/migration.sql`,
);

describe('Prescription snapshot placeholder cleanup migration', () => {
  it('orders migration directory after patient_optional_birthdate_gender', () => {
    expect(CURR_MIGRATION > PREV_MIGRATION).toBe(true);
  });

  it('clears only placeholder SELF snapshots and removes ageMonths from clinical_context', () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('UPDATE "prescriptions"');
    expect(sql).toContain("'{patient,dateOfBirth}'");
    expect(sql).toContain("'{patient,gender}'");
    expect(sql).toContain("'{patient,ageMonths}'");
    expect(sql).toContain("- 'ageMonths'");
    expect(sql).toContain('"clinical_emr"');
    expect(sql).toContain('"patients"');
    expect(sql).toContain(`"relationship_to_head" = 'SELF'`);
    expect(sql).toContain(`"date_of_birth" IS NULL`);
    expect(sql).toContain(`'patient'->>'dateOfBirth' = '1990-01-01'`);
    expect(sql).toContain(`'patient'->>'gender' = 'OTHER'`);
  });
});
