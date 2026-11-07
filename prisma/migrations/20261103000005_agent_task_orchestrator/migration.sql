-- Migration: 20261103000005_agent_task_orchestrator
-- Depends on: 20261103000004_agent_tool_approval
-- Additive migration: creates durable task orchestration tables.
-- No existing tables, records or migration directories are modified.
-- The outstanding migration-ordering issue (20241103... preceding
-- 20261103000000_initial_migration on fresh deployments) is not addressed here.

CREATE TABLE "agent_task" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentSessionId" TEXT,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "plan" JSONB,
    "currentStepIndex" INTEGER NOT NULL DEFAULT -1,
    "context" JSONB,
    "pendingAction" JSONB,
    "pendingActionId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_task_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_task_ref_key" ON "agent_task"("ref");
CREATE INDEX "agent_task_workspaceId_status_createdAt_idx" ON "agent_task"("workspaceId", "status", "createdAt");
CREATE INDEX "agent_task_userId_status_createdAt_idx" ON "agent_task"("userId", "status", "createdAt");
CREATE INDEX "agent_task_ref_idx" ON "agent_task"("ref");

CREATE TABLE "agent_task_step" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "toolName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "args" JSONB,
    "dependsOn" INTEGER,
    "requiresStudentApproval" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_task_step_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_task_step_idempotencyKey_key" ON "agent_task_step"("idempotencyKey");
CREATE UNIQUE INDEX "agent_task_step_taskId_stepIndex_key" ON "agent_task_step"("taskId", "stepIndex");
CREATE INDEX "agent_task_step_taskId_status_idx" ON "agent_task_step"("taskId", "status");

ALTER TABLE "agent_task_step" ADD CONSTRAINT "agent_task_step_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "agent_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "agent_task_event" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "stepIndex" INTEGER,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_task_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "agent_task_event_taskId_createdAt_idx" ON "agent_task_event"("taskId", "createdAt");

ALTER TABLE "agent_task_event" ADD CONSTRAINT "agent_task_event_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "agent_task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
