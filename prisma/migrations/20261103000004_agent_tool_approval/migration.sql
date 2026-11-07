-- Phase 5 — Agent Tool Registry durable approval and audit tables.
--
-- This is an additive migration. It depends on the base tables created by
-- 20261103000000_initial_migration and the credit tables created by the
-- 20241103... additive family, so it must execute AFTER them. The existing
-- out-of-order timestamp family is a separate, pre-existing deployment blocker
-- and must be repaired independently; this file intentionally does not touch
-- those names or contents.

-- CreateTable
CREATE TABLE "agent_tool_approval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSessionId" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "pageFingerprint" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "tabRef" TEXT,
    "proposedMapping" JSONB NOT NULL,
    "approvedFieldIds" TEXT[],
    "valueFingerprint" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_tool_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_audit" (
    "id" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSessionId" TEXT,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "permissionDecision" JSONB,
    "errorCategory" TEXT,
    "resourceRefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_tool_approval_workspaceId_status_idx" ON "agent_tool_approval"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "agent_tool_approval_agentSessionId_status_idx" ON "agent_tool_approval"("agentSessionId", "status");

-- CreateIndex
CREATE INDEX "agent_tool_approval_expiresAt_idx" ON "agent_tool_approval"("expiresAt");

-- CreateIndex
CREATE INDEX "agent_tool_audit_workspaceId_createdAt_idx" ON "agent_tool_audit"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_tool_audit_toolName_createdAt_idx" ON "agent_tool_audit"("toolName", "createdAt");
