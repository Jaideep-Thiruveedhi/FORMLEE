-- Add role column to user for admin checks.
ALTER TABLE "user" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER';

-- CreateTable
CREATE TABLE "referral_partner" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'STUDENT_AMBASSADOR',
    "commissionBasisPoints" INTEGER NOT NULL DEFAULT 500,
    "holdingDays" INTEGER NOT NULL DEFAULT 7,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_code" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_click" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "source" TEXT,
    "landingPath" TEXT,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_click_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_attribution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "referral_attribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_commission" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "paymentOrderId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "basisPoints" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "holdingUntil" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "payoutId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_commission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_commission_reversal" (
    "id" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_commission_reversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_payout" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_payout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "referral_partner_userId_key" ON "referral_partner"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_partner_email_key" ON "referral_partner"("email");

-- CreateIndex
CREATE INDEX "referral_partner_isActive_tier_idx" ON "referral_partner"("isActive", "tier");

-- CreateIndex
CREATE UNIQUE INDEX "referral_code_code_key" ON "referral_code"("code");

-- CreateIndex
CREATE INDEX "referral_code_partnerId_isActive_idx" ON "referral_code"("partnerId", "isActive");

-- CreateIndex
CREATE INDEX "referral_click_codeId_clickedAt_idx" ON "referral_click"("codeId", "clickedAt");

-- CreateIndex
CREATE UNIQUE INDEX "referral_attribution_userId_key" ON "referral_attribution"("userId");

-- CreateIndex
CREATE INDEX "referral_attribution_partnerId_attributedAt_idx" ON "referral_attribution"("partnerId", "attributedAt");

-- CreateIndex
CREATE INDEX "referral_attribution_userId_idx" ON "referral_attribution"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_commission_paymentOrderId_key" ON "referral_commission"("paymentOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_commission_idempotencyKey_key" ON "referral_commission"("idempotencyKey");

-- CreateIndex
CREATE INDEX "referral_commission_partnerId_status_idx" ON "referral_commission"("partnerId", "status");

-- CreateIndex
CREATE INDEX "referral_commission_status_holdingUntil_idx" ON "referral_commission"("status", "holdingUntil");

-- CreateIndex
CREATE UNIQUE INDEX "referral_commission_reversal_commissionId_key" ON "referral_commission_reversal"("commissionId");

-- CreateIndex
CREATE INDEX "referral_commission_reversal_partnerId_createdAt_idx" ON "referral_commission_reversal"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "referral_payout_partnerId_status_idx" ON "referral_payout"("partnerId", "status");

-- AddForeignKey
ALTER TABLE "referral_partner" ADD CONSTRAINT "referral_partner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_code" ADD CONSTRAINT "referral_code_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "referral_partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_click" ADD CONSTRAINT "referral_click_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "referral_code"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_attribution" ADD CONSTRAINT "referral_attribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_attribution" ADD CONSTRAINT "referral_attribution_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "referral_partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_attribution" ADD CONSTRAINT "referral_attribution_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "referral_code"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_commission" ADD CONSTRAINT "referral_commission_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "referral_partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_commission" ADD CONSTRAINT "referral_commission_paymentOrderId_fkey" FOREIGN KEY ("paymentOrderId") REFERENCES "payment_order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_commission" ADD CONSTRAINT "referral_commission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "referral_payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_commission_reversal" ADD CONSTRAINT "referral_commission_reversal_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "referral_commission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_commission_reversal" ADD CONSTRAINT "referral_commission_reversal_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "referral_partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_payout" ADD CONSTRAINT "referral_payout_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "referral_partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
