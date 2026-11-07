-- CreateTable
CREATE TABLE "credit_account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_package" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_reservation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "applicationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "agentSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "credit_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_order" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "packageId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_ledger_entry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reservationId" TEXT,
    "paymentOrderId" TEXT,
    "applicationId" TEXT,
    "idempotencyKey" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_ledger_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_account_userId_key" ON "credit_account"("userId");

-- CreateIndex
CREATE INDEX "credit_account_userId_idx" ON "credit_account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "credit_package_code_key" ON "credit_package"("code");

-- CreateIndex
CREATE INDEX "credit_package_isActive_sortOrder_idx" ON "credit_package"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "credit_reservation_agentSessionId_key" ON "credit_reservation"("agentSessionId");

-- CreateIndex
CREATE INDEX "credit_reservation_accountId_status_idx" ON "credit_reservation"("accountId", "status");

-- CreateIndex
CREATE INDEX "credit_reservation_workspaceId_status_idx" ON "credit_reservation"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "credit_reservation_applicationId_idx" ON "credit_reservation"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_providerOrderId_key" ON "payment_order"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_order_idempotencyKey_key" ON "payment_order"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_order_accountId_status_idx" ON "payment_order"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_ledger_entry_idempotencyKey_key" ON "credit_ledger_entry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "credit_ledger_entry_accountId_createdAt_idx" ON "credit_ledger_entry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "credit_ledger_entry_type_idx" ON "credit_ledger_entry"("type");

-- AddForeignKey
ALTER TABLE "credit_account" ADD CONSTRAINT "credit_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_reservation" ADD CONSTRAINT "credit_reservation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "credit_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "credit_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_entry" ADD CONSTRAINT "credit_ledger_entry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "credit_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_entry" ADD CONSTRAINT "credit_ledger_entry_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "credit_reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_entry" ADD CONSTRAINT "credit_ledger_entry_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES "payment_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
