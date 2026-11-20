CREATE TYPE "SettlementReviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISPUTED');

ALTER TABLE "facility_settlements"
  ADD COLUMN "review_status" "SettlementReviewStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "review_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "reviewed_at" TIMESTAMPTZ,
  ADD COLUMN "review_dispute_reason" TEXT;
