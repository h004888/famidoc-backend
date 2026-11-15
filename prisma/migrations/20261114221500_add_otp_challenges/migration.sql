-- Tạo bảng tạm lưu challenge OTP trước khi kích hoạt tài khoản chính thức vào users
DO $$
BEGIN
  CREATE TYPE "OtpChallengePurpose" AS ENUM ('REGISTER_FAMILY_REP', 'RESET_PASSWORD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "otp_challenges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "purpose" "OtpChallengePurpose" NOT NULL,
  "email" VARCHAR(150) NOT NULL,
  "phone" VARCHAR(15),
  "payload" JSONB,
  "otp_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "cooldown_until" TIMESTAMPTZ NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "otp_challenges_purpose_email_key"
  ON "otp_challenges" ("purpose", "email");

CREATE INDEX IF NOT EXISTS "otp_challenges_expires_at_idx"
  ON "otp_challenges" ("expires_at");
