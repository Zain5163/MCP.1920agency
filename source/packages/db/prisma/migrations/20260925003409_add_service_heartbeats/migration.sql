-- CreateTable
CREATE TABLE "service_heartbeats" (
    "name" TEXT NOT NULL,
    "beat_at" TIMESTAMP(3) NOT NULL,
    "detail" JSONB,

    CONSTRAINT "service_heartbeats_pkey" PRIMARY KEY ("name")
);
