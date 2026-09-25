-- AlterTable
ALTER TABLE "connections" ADD COLUMN     "provider_auth_id" TEXT;

-- CreateTable
CREATE TABLE "provider_auths" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "external_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "secret_ciphertext" TEXT NOT NULL,
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3),
    "needs_reauth" BOOLEAN NOT NULL DEFAULT false,
    "reauth_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_auths_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_auths_tenant_id_idx" ON "provider_auths"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_auths_tenant_id_provider_external_user_id_key" ON "provider_auths"("tenant_id", "provider", "external_user_id");

-- CreateIndex
CREATE INDEX "connections_provider_auth_id_idx" ON "connections"("provider_auth_id");

-- AddForeignKey
ALTER TABLE "provider_auths" ADD CONSTRAINT "provider_auths_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_provider_auth_id_fkey" FOREIGN KEY ("provider_auth_id") REFERENCES "provider_auths"("id") ON DELETE SET NULL ON UPDATE CASCADE;
