import * as fs from 'fs';
import * as path from 'path';

const BACKEND_ROOT = path.resolve(__dirname, '../../../..');
const PREV_MIGRATION =
  '20261127120100_prescription_snapshot_clear_placeholder_dob';
const CURR_MIGRATION = '20261128090000_home_visit_record';
const MIGRATION_PATH = path.join(
  BACKEND_ROOT,
  `prisma/migrations/${CURR_MIGRATION}/migration.sql`,
);
const SCHEMA_PATH = path.join(BACKEND_ROOT, 'prisma/schema.prisma');

describe('Home visit record schema and migration', () => {
  it('orders migration directory after prescription_snapshot_clear_placeholder_dob', () => {
    expect(CURR_MIGRATION > PREV_MIGRATION).toBe(true);
  });

  it('creates home visit record tables and columns without dropping columns', () => {
    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('CREATE TABLE "icd10_codes"');
    expect(sql).toContain('CREATE TABLE "clinical_emr_diagnoses"');
    expect(sql).toContain('CREATE TABLE "home_medications"');
    expect(sql).toContain('CREATE TABLE "encounter_home_environments"');
    expect(sql).toContain('ADD COLUMN "height_cm"');
    expect(sql).toContain('ADD COLUMN "change_type"');
    expect(sql).toContain('ADD COLUMN "follow_up_date"');
    expect(sql).toContain('ADD COLUMN "discontinued_medications"');
    expect(sql).not.toContain('DROP COLUMN');
  });

  it('defines Icd10Code model and new fields in schema.prisma', () => {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');

    expect(schema).toContain('model Icd10Code');
    expect(schema).toContain('longTermEligible');
    expect(schema).toContain('allowedAsPrimary');
  });
});
