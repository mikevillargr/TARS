export type TaskStatus = "inbox" | "todo" | "in_progress" | "done" | "snoozed"
export type ItemStatus = "raw" | "developing" | "actionable" | "archived"
export type ItemType = "idea" | "project" | "reference" | "research"
export type ItemPriority = "high" | "medium" | "low"
export type TaskPriority = "urgent" | "high" | "normal" | "low"
export type MemoryDomain = string
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

export interface ItemProperties {
  status?: ItemStatus
  type?: ItemType
  priority?: ItemPriority
  custom?: Record<string, string>
}

export interface KnowledgeItem {
  id: string
  user_id?: string
  type: string
  url?: string
  source_title?: string
  source_author?: string
  summary?: string
  personal_note?: string
  tags: string[]
  domain?: string
  access_count: number
  starred: boolean
  properties: ItemProperties
  saved_at: string
  clean_content?: string
  chunk_count?: number
}

export interface Link {
  id: string
  user_id: string
  source_type: string
  source_id: string
  target_type: string
  target_id: string
  relationship: string
  context?: string
  created_at: string
  source_title?: string
  target_title?: string
  target_url?: string
}

export interface MentionSearchResult {
  id: string
  type: "knowledge_item" | "contact" | "task"
  title: string
  subtitle?: string
}

export interface Contact {
  id: string
  google_resource_name?: string
  display_name?: string
  primary_email?: string
  primary_phone?: string
  organization?: string
  job_title?: string
  biography?: string
  tars_context?: string
  emails: { value: string; type?: string }[]
  phones: { value: string; type?: string }[]
  is_directory: boolean
  is_other_contact: boolean
  last_synced_at?: string
  created_at: string
  updated_at: string
}

export interface ContactContext {
  contact: Contact
  link_count: number
  recent_meetings: { id: string; title: string; started_at?: string }[]
  linked_tasks: { id: string; title: string; status: string }[]
  linked_knowledge: { id: string; title: string; type: string }[]
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
