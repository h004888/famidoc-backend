ALTER TABLE "medical_contracts"
ADD COLUMN "signing_deadline_at" TIMESTAMPTZ;

CREATE INDEX "idx_medical_contracts_signing_deadline"
ON "medical_contracts" ("contract_status", "signing_deadline_at");

CREATE TABLE "contract_signing_notices" (
  "contract_id" UUID NOT NULL REFERENCES "medical_contracts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "role" "SignerRole" NOT NULL,
  "kind" TEXT NOT NULL,
  "next_attempt_at" TIMESTAMPTZ NOT NULL,
  "finished_at" TIMESTAMPTZ,
  PRIMARY KEY ("contract_id", "role", "kind")
);
CREATE INDEX "contract_signing_notices_finished_at_next_attempt_at_idx"
ON "contract_signing_notices" ("finished_at", "next_attempt_at");
