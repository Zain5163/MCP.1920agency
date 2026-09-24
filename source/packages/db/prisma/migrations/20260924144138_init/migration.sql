-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('facebook_page', 'instagram', 'threads', 'mastodon', 'telegram', 'discord', 'youtube', 'tiktok', 'linkedin', 'x');

-- CreateEnum
CREATE TYPE "CredentialSource" AS ENUM ('platform_app', 'tenant_byo');

-- CreateEnum
CREATE TYPE "TargetState" AS ENUM ('pending', 'scheduled', 'publishing', 'published', 'failed', 'needs_reauth', 'cancelled');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('queued', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "credential_source" "CredentialSource" NOT NULL DEFAULT 'platform_app',
    "secret_ciphertext" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3),
    "needs_reauth" BOOLEAN NOT NULL DEFAULT false,
    "reauth_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "overrides" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL DEFAULT 'mcp',

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_media" (
    "post_id" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "post_media_pkey" PRIMARY KEY ("post_id","media_id")
);

-- CreateTable
CREATE TABLE "targets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "state" "TargetState" NOT NULL DEFAULT 'pending',
    "scheduled_for" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "platform_post_id" TEXT,
    "platform_url" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "failure_class" TEXT,
    "error_code" TEXT,
    "platform_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'queued',
    "run_after" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "r2_key" TEXT NOT NULL,
    "public_url" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_seconds" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heartbeat" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "beat_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'keepalive',

    CONSTRAINT "heartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "connections_tenant_id_needs_reauth_idx" ON "connections"("tenant_id", "needs_reauth");

-- CreateIndex
CREATE UNIQUE INDEX "connections_tenant_id_platform_platform_account_id_key" ON "connections"("tenant_id", "platform", "platform_account_id");

-- CreateIndex
CREATE INDEX "posts_tenant_id_created_at_idx" ON "posts"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "post_media_post_id_position_idx" ON "post_media"("post_id", "position");

-- CreateIndex
CREATE INDEX "post_media_media_id_idx" ON "post_media"("media_id");

-- CreateIndex
CREATE UNIQUE INDEX "targets_idempotency_key_key" ON "targets"("idempotency_key");

-- CreateIndex
CREATE INDEX "targets_tenant_id_state_idx" ON "targets"("tenant_id", "state");

-- CreateIndex
CREATE INDEX "targets_state_scheduled_for_idx" ON "targets"("state", "scheduled_for");

-- CreateIndex
CREATE INDEX "targets_post_id_idx" ON "targets"("post_id");

-- CreateIndex
CREATE INDEX "targets_connection_id_idx" ON "targets"("connection_id");

-- CreateIndex
CREATE INDEX "jobs_state_run_after_idx" ON "jobs"("state", "run_after");

-- CreateIndex
CREATE INDEX "jobs_tenant_id_idx" ON "jobs"("tenant_id");

-- CreateIndex
CREATE INDEX "jobs_target_id_idx" ON "jobs"("target_id");

-- CreateIndex
CREATE INDEX "media_assets_tenant_id_created_at_idx" ON "media_assets"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "targets" ADD CONSTRAINT "targets_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
