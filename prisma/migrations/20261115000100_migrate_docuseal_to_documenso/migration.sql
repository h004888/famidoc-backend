-- Chuyển đổi hạ tầng ký kết hợp đồng 4 bên sang Documenso v2 Envelopes API (idempotent)

DROP TABLE IF EXISTS "contract_docuseal_signers";

ALTER TABLE "medical_contracts"
  DROP COLUMN IF EXISTS "docuseal_submission_id",
  DROP COLUMN IF EXISTS "docuseal_template_id",
  DROP COLUMN IF EXISTS "docuseal_document_url",
  DROP COLUMN IF EXISTS "docuseal_audit_log_url",
  ADD COLUMN IF NOT EXISTS "documenso_envelope_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "documenso_item_id" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "documenso_signed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "additional_terms" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "medical_contracts_documenso_envelope_id_key"
  ON "medical_contracts" ("documenso_envelope_id")
  WHERE "documenso_envelope_id" IS NOT NULL;

ALTER TABLE "contract_signatures"
  DROP COLUMN IF EXISTS "docuseal_submitter_id",
  ADD COLUMN IF NOT EXISTS "documenso_recipient_id" INTEGER;

CREATE TABLE IF NOT EXISTS "contract_documenso_signers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "signer_role" "SignerRole" NOT NULL,
  "documenso_recipient_id" INTEGER NOT NULL,
  "documenso_token" VARCHAR(128) NOT NULL,
  "documenso_signing_url" TEXT NOT NULL,
  "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING',
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contract_documenso_signers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "contract_documenso_signers_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "medical_contracts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "contract_documenso_signers_documenso_recipient_id_key"
  ON "contract_documenso_signers" ("documenso_recipient_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_contract_documenso_signers_contract_role"
  ON "contract_documenso_signers" ("contract_id", "signer_role");
