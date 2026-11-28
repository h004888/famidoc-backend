-- Clear placeholder dateOfBirth & gender in old prescription snapshots for SELF patients whose DOB was cleared
UPDATE "prescriptions" pr
SET "record_snapshot" = jsonb_set(
      jsonb_set(
        jsonb_set(pr."record_snapshot", '{patient,dateOfBirth}', 'null'::jsonb),
        '{patient,gender}',
        'null'::jsonb
      ),
      '{patient,ageMonths}',
      'null'::jsonb
    ),
    "clinical_context" = CASE
      WHEN pr."clinical_context" IS NULL THEN NULL
      ELSE pr."clinical_context" - 'ageMonths'
    END
FROM "clinical_emr" e
JOIN "patients" p ON p."id" = e."patient_id"
WHERE pr."emr_id" = e."id"
  AND p."relationship_to_head" = 'SELF'
  AND p."date_of_birth" IS NULL
  AND pr."record_snapshot"->'patient'->>'dateOfBirth' = '1990-01-01'
  AND pr."record_snapshot"->'patient'->>'gender' = 'OTHER';
