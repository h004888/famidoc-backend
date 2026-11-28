import * as fs from 'fs';
import * as path from 'path';

const BACKEND_ROOT = path.resolve(__dirname, '../../../..');
const SCHEMA_PATH = path.join(BACKEND_ROOT, 'prisma/schema.prisma');
const MIGRATION_PATH = path.join(
  BACKEND_ROOT,
  'prisma/migrations/20261127120000_patient_optional_birthdate_gender/migration.sql',
);

const PLACEHOLDER_RELATIONSHIP = "relationship_to_head = 'SELF'";
const PLACEHOLDER_DOB = "date_of_birth = '1990-01-01'";
const PLACEHOLDER_GENDER = "gender = 'OTHER'";

describe('Patient optional dateOfBirth & gender schema and migration', () => {
  it('makes Patient.dateOfBirth and Patient.gender nullable in schema.prisma', () => {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    const patientBlockMatch = schema.match(/model Patient \{[\s\S]*?\n\}/);
    expect(patientBlockMatch).not.toBeNull();
    const patientBlock = patientBlockMatch![0];

    expect(patientBlock).toMatch(/dateOfBirth\s+DateTime\?/);
    expect(patientBlock).toMatch(/gender\s+Gender\?/);
  });

  it('drops NOT NULL constraints and clears only placeholder SELF records in migration.sql', () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('ALTER COLUMN "date_of_birth" DROP NOT NULL');
    expect(sql).toContain('ALTER COLUMN "gender" DROP NOT NULL');
    expect(sql).toContain('UPDATE "patients"');
    expect(sql.replace(/"/g, '')).toContain(PLACEHOLDER_RELATIONSHIP);
    expect(sql.replace(/"/g, '')).toContain(PLACEHOLDER_DOB);
    expect(sql.replace(/"/g, '')).toContain(PLACEHOLDER_GENDER);
  });
});
