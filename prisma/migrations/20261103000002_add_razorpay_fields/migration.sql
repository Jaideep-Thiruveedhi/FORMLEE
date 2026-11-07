-- Add Razorpay-specific columns to PaymentOrder for audit and verification.
ALTER TABLE "payment_order" ADD COLUMN "providerPaymentId" TEXT;
ALTER TABLE "payment_order" ADD COLUMN "paidAmountPaise" INTEGER;
ALTER TABLE "payment_order" ADD COLUMN "receipt" TEXT;
ALTER TABLE "payment_order" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "payment_order" ADD COLUMN "verifiedAt" TIMESTAMP(3);

-- Create index for providerOrderId lookups (verification + webhook handling).
CREATE INDEX "payment_order_providerOrderId_idx" ON "payment_order"("providerOrderId");

-- CreateTable
CREATE TABLE "razorpay_webhook_event" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "razorpay_webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "razorpay_webhook_event_eventId_key" ON "razorpay_webhook_event"("eventId");

-- CreateIndex
CREATE INDEX "razorpay_webhook_event_processed_createdAt_idx" ON "razorpay_webhook_event"("processed", "createdAt");
