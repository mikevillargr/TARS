export type TaskStatus = "inbox" | "todo" | "in_progress" | "done" | "snoozed"
export type TaskPriority = "urgent" | "high" | "normal" | "low"
export type MemoryDomain = "work" | "personal" | "health" | "cycling" | "client"
export type MemorySource = "conversation" | "meeting" | "email" | "manual"
export type ConnectorStatus = "connected" | "disconnected" | "error"
export type AgentJobStatus = "pending" | "running" | "needs_input" | "done" | "failed"
export type CronJobStatus = "active" | "paused" | "failed" | "running"
export type ArtifactType = "document" | "code" | "report" | "spreadsheet" | "transcript"
export type ArtifactSource = "chat" | "agent_job" | "cron" | "meeting" | "upload"

export interface Task {
  id: string
  user_id: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  due_at?: string
  source?: string
  source_id?: string
  assigned_to?: string
  connector_ref?: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: string
  conversation_id: string
  role: "user" | "assistant" | "system"
  content: string
  model_used?: string
  tokens_used: number
  tool_calls: unknown[]
  created_at: string
}

export interface Conversation {
  id: string
  user_id: string
  title?: string
  created_at: string
}

export interface Memory {
  id: string
  user_id: string
  content: string
  domain: MemoryDomain
  source: MemorySource
  importance: number
  expires_at?: string
  created_at: string
  updated_at: string
}
