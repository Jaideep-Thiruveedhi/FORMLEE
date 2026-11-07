/**
 * Public exports for the Formlee Agent Tool Registry.
 */

export {
  executeTool,
  listToolDefinitions,
  AGENT_SESSION_HEADER,
} from './executor'
export type { ExecuteResult, ExecuteOptions } from './executor'
export { AGENT_TOOL_REGISTRY, getToolDefinition } from './registry'
export type { ToolDefinition, ToolContext, ToolResult, BrowserAction } from './types'
export { AGENT_PERMISSIONS } from './permissions'
export type { AgentPermission } from './permissions'
export * as toolSchemas from './schemas'
export { runAgent } from '@/lib/agent/runner'
export type { RunAgentOptions, RunAgentResult, ToolCallRecord } from '@/lib/agent/runner'
export { callAgentModel } from '@/lib/agent/model'
export type { AgentMessage, AgentToolCall, AgentModelResponse } from '@/lib/agent/model'
export {
  createAgentTask,
  planTask,
  startTask,
  pauseAgentTask,
  resumeAgentTask,
  cancelAgentTask,
  submitTaskBrowserResult,
  getTask,
  listAgentTasks,
  getTaskSteps,
  getTaskEvents,
} from '@/lib/agent/tasks/orchestrator'
export type { TaskExecutionResult } from '@/lib/agent/tasks/orchestrator'
export type { TaskStatus, StepStatus, TaskPlan, TaskPlanStep, TaskContext } from '@/lib/agent/tasks/types'
export { DEFAULT_TASK_LIMITS, isRetryableError, isTerminalApprovalError } from '@/lib/agent/tasks/limits'
