-- AlterTable
ALTER TABLE "sepay_reconciliation_runs" ADD COLUMN     "batchId" UUID,
ADD COLUMN     "monitoredAccountId" UUID;

-- CreateTable
CREATE TABLE "PaymentSettingsHead" (
    "environment" VARCHAR(10) NOT NULL,
    "revisionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,

    CONSTRAINT "PaymentSettingsHead_pkey" PRIMARY KEY ("environment")
);

-- CreateTable
CREATE TABLE "PaymentSettingsRevision" (
    "id" UUID NOT NULL,
    "environment" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "monitoredAccountId" UUID NOT NULL,
    "accountNumber" VARCHAR(19) NOT NULL,
    "gateway" VARCHAR(100) NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "authMethod" VARCHAR(10) NOT NULL,
    "encryptedSecrets" JSONB NOT NULL,
    "createdBy" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentSettingsRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMonitoredAccount" (
    "id" UUID NOT NULL,
    "environment" VARCHAR(10) NOT NULL,
    "normalizedGateway" VARCHAR(100) NOT NULL,
    "accountNumber" VARCHAR(19) NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "latestRevisionId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMonitoredAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAccountReconciliationState" (
    "environment" VARCHAR(10) NOT NULL,
    "monitoredAccountId" UUID NOT NULL,
    "cursor" UUID,
    "lastSuccessfulAt" TIMESTAMPTZ,
    "lastRunId" UUID,
    "lockedUntil" TIMESTAMPTZ,
    "leaseOwner" UUID,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAccountReconciliationState_pkey" PRIMARY KEY ("environment","monitoredAccountId")
);

-- CreateTable
CREATE TABLE "PaymentWebhookCredentialWindow" (
    "id" UUID NOT NULL,
    "monitoredAccountId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "retiredAt" TIMESTAMPTZ,
    "acceptUntil" TIMESTAMPTZ,

    CONSTRAINT "PaymentWebhookCredentialWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReconciliationBatch" (
    "id" UUID NOT NULL,
    "environment" VARCHAR(10) NOT NULL,
    "trigger" VARCHAR(20) NOT NULL,
    "requestedByUserId" UUID,
    "status" VARCHAR(20) NOT NULL,
    "rangeFrom" TIMESTAMPTZ,
    "rangeTo" TIMESTAMPTZ,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "PaymentReconciliationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentConfigurationTestSession" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "environment" VARCHAR(10) NOT NULL,
    "code" VARCHAR(27) NOT NULL,
    "amountVnd" INTEGER NOT NULL,
    "account" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "finalizeAt" TIMESTAMPTZ NOT NULL,
    "status" VARCHAR(25) NOT NULL,
    "webhookMatchedAt" TIMESTAMPTZ,
    "apiSeenAt" TIMESTAMPTZ,

    CONSTRAINT "PaymentConfigurationTestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentConfigurationTestDelivery" (
    "id" UUID NOT NULL,
    "sessionId" UUID,
    "environment" VARCHAR(10) NOT NULL,
    "source" VARCHAR(10) NOT NULL,
    "providerTransactionId" VARCHAR(100) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "accountMatch" BOOLEAN NOT NULL,
    "amountMatch" BOOLEAN NOT NULL,
    "evidence" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentConfigurationTestDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentConfigurationCheckWindow" (
    "actorId" UUID NOT NULL,
    "windowStart" TIMESTAMPTZ NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PaymentConfigurationCheckWindow_pkey" PRIMARY KEY ("actorId","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSettingsHead_revisionId_key" ON "PaymentSettingsHead"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSettingsRevision_environment_version_key" ON "PaymentSettingsRevision"("environment", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMonitoredAccount_environment_normalizedGateway_accou_key" ON "PaymentMonitoredAccount"("environment", "normalizedGateway", "accountNumber", "bankAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookCredentialWindow_monitoredAccountId_revisionI_key" ON "PaymentWebhookCredentialWindow"("monitoredAccountId", "revisionId", "method");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentConfigurationTestSession_code_key" ON "PaymentConfigurationTestSession"("code");

-- CreateIndex
CREATE INDEX "PaymentConfigurationTestSession_actorId_environment_finaliz_idx" ON "PaymentConfigurationTestSession"("actorId", "environment", "finalizeAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentConfigurationTestSession_actorId_requestId_key" ON "PaymentConfigurationTestSession"("actorId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentConfigurationTestDelivery_environment_source_provide_key" ON "PaymentConfigurationTestDelivery"("environment", "source", "providerTransactionId");

-- CreateIndex
CREATE INDEX "sepay_reconciliation_runs_environment_monitoredAccountId_st_idx" ON "sepay_reconciliation_runs"("environment", "monitoredAccountId", "started_at");

-- CreateIndex
CREATE INDEX "sepay_reconciliation_runs_batchId_idx" ON "sepay_reconciliation_runs"("batchId");

-- AddForeignKey
ALTER TABLE "sepay_reconciliation_runs" ADD CONSTRAINT "sepay_reconciliation_runs_monitoredAccountId_fkey" FOREIGN KEY ("monitoredAccountId") REFERENCES "PaymentMonitoredAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sepay_reconciliation_runs" ADD CONSTRAINT "sepay_reconciliation_runs_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PaymentReconciliationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettingsHead" ADD CONSTRAINT "PaymentSettingsHead_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PaymentSettingsRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettingsRevision" ADD CONSTRAINT "PaymentSettingsRevision_monitoredAccountId_fkey" FOREIGN KEY ("monitoredAccountId") REFERENCES "PaymentMonitoredAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAccountReconciliationState" ADD CONSTRAINT "PaymentAccountReconciliationState_monitoredAccountId_fkey" FOREIGN KEY ("monitoredAccountId") REFERENCES "PaymentMonitoredAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentWebhookCredentialWindow" ADD CONSTRAINT "PaymentWebhookCredentialWindow_monitoredAccountId_fkey" FOREIGN KEY ("monitoredAccountId") REFERENCES "PaymentMonitoredAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentWebhookCredentialWindow" ADD CONSTRAINT "PaymentWebhookCredentialWindow_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PaymentSettingsRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentConfigurationTestSession" ADD CONSTRAINT "PaymentConfigurationTestSession_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "PaymentSettingsRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentConfigurationTestDelivery" ADD CONSTRAINT "PaymentConfigurationTestDelivery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PaymentConfigurationTestSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- Settings accepts gateways up to 100 characters; preserve existing invoice snapshots.
ALTER TABLE "invoices" ALTER COLUMN "expected_gateway" TYPE VARCHAR(100);

-- Aliases preserve retries when a second request resumes an already open session.
ALTER TABLE "PaymentConfigurationTestSession" ADD COLUMN "requestIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

