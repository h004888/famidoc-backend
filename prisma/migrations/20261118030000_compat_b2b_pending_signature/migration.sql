-- Ensure B2bContractStatus keeps PENDING_SIGNATURE alongside PENDING_FACILITY_SIGNATURE for cross-branch compatibility
ALTER TYPE "B2bContractStatus" ADD VALUE IF NOT EXISTS 'PENDING_SIGNATURE';
