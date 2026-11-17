ALTER TABLE "audit_logs" ADD COLUMN "details" JSONB;
ALTER TABLE "healthcare_facilities"
  ADD COLUMN "legal_documents_url" TEXT,
  ADD COLUMN "legal_document_key" TEXT,
  ADD COLUMN "license_issuer" VARCHAR(255),
  ADD COLUMN "license_date" DATE,
  ADD COLUMN "legal_rejection_reason" TEXT;
