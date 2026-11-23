-- AlterTable
ALTER TABLE "vital_signs"
ADD COLUMN "glucose_context" VARCHAR(30),
ADD COLUMN "measurement_state" VARCHAR(30),
ADD COLUMN "notes" VARCHAR(500);
