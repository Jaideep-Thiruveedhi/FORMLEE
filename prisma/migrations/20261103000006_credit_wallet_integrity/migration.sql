-- Separate reservation idempotency from the authenticated AgentSession id.
-- The former agentSessionId column has ambiguous historical contents, so its
-- name and values are preserved without classifying or backfilling them.
BEGIN;

ALTER TABLE "credit_reservation"
  RENAME COLUMN "agentSessionId" TO "legacyAgentSessionOrIdempotencyKey";

ALTER INDEX "credit_reservation_agentSessionId_key"
  RENAME TO "credit_reservation_legacyAgentSessionOrIdempotencyKey_key";

ALTER TABLE "credit_reservation"
  ADD COLUMN "agentSessionId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT;

CREATE INDEX "credit_reservation_agentSessionId_idx"
  ON "credit_reservation"("agentSessionId");

CREATE UNIQUE INDEX "credit_reservation_idempotencyKey_key"
  ON "credit_reservation"("idempotencyKey");

ALTER TABLE "agent_tool_approval"
  ADD COLUMN "verificationReceipt" JSONB,
  ALTER COLUMN "status" SET DEFAULT 'APPROVED';

COMMIT;
