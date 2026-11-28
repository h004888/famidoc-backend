-- AlterTable
ALTER TABLE "patients" ALTER COLUMN "date_of_birth" DROP NOT NULL;
ALTER TABLE "patients" ALTER COLUMN "gender" DROP NOT NULL;

-- Clear placeholder dateOfBirth & gender on existing SELF records
UPDATE "patients"
SET "date_of_birth" = NULL,
    "gender" = NULL
WHERE "relationship_to_head" = 'SELF'
  AND "date_of_birth" = '1990-01-01'
  AND "gender" = 'OTHER';
