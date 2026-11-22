-- CreateTable
CREATE TABLE "telehealth_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "session_id" UUID NOT NULL,
    "sender_user_id" UUID NOT NULL,
    "sender_role" VARCHAR(20) NOT NULL,
    "sender_name" VARCHAR(150) NOT NULL,
    "content" TEXT,
    "attachment_key" VARCHAR(500),
    "attachment_name" VARCHAR(255),
    "attachment_mime_type" VARCHAR(100),
    "attachment_size_bytes" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telehealth_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_telehealth_messages_session_created" ON "telehealth_messages"("session_id", "created_at");

-- AddForeignKey
ALTER TABLE "telehealth_messages" ADD CONSTRAINT "telehealth_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "telehealth_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
