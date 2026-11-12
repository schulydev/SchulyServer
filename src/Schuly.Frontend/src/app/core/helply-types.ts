import { McpPermissionSet } from './mcp-permissions';

/** How hard Helply thinks before it answers. */
export type HelplyReasoningEffort = 'Low' | 'Medium' | 'High';

export interface HelplySettings {
  permissions: McpPermissionSet;
  /** Whether Helply may run code in the sandbox workspace. */
  workspace: boolean;
  /** False when the server has no sandbox configured. */
  workspaceAvailable: boolean;
  /** Higher is more thorough but slower. High unless the user lowers it. */
  reasoningEffort: HelplyReasoningEffort;
}

export interface HelplyAttachment {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
}

/** What a sandbox command did. On a started tool, output and exitCode are null. */
export interface ToolCode {
  command: string;
  output: string | null;
  exitCode: number | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export type ToolStatus = 'running' | 'done' | 'failed' | 'denied';

export interface ToolActivity {
  id: string;
  label: string;
  status: ToolStatus;
  code?: ToolCode | null;
  /** How much of the reply's text came before this step; absent on steps stored before steps kept their place. */
  at?: number | null;
  /** A short harmless note from the server, such as "page 2" or "unread only". */
  detail?: string | null;
  /** The stable key the label is translated by (the tool's name, or "generic"); absent on steps stored before labels followed the language. */
  key?: string | null;
  /** Structured facts for that label: page, unreadOnly, folder, withSearch, terms, sources, name. */
  args?: Record<string, string> | null;
}

export interface ApprovalDetail {
  label: string;
  value: string;
}

export interface ApprovalRequest {
  approvalId: string;
  toolLabel: string;
  summary: string;
  details: ApprovalDetail[];
  destructive: boolean;
  /** Every argument that will run, in full and labelled. */
  arguments: ApprovalDetail[];
  risk: 'normal' | 'high';
  riskReasons: string[];
}

export interface HelplyMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  tools: ToolActivity[];
  failed: boolean;
  attachments: HelplyAttachment[];
}

export interface Conversation extends ConversationSummary {
  messages: HelplyMessage[];
  pendingApprovals: ApprovalRequest[];
}

export type StreamErrorCode = 'unavailable' | 'timeout' | 'rate_limited' | 'too_long' | 'disabled';

export type StreamEvent =
  | { type: 'start'; messageId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool_started'; id: string; label: string; code: ToolCode | null; at?: number | null; detail?: string | null; key?: string | null; args?: Record<string, string> | null }
  | { type: 'tool_finished'; id: string; label: string; status: Exclude<ToolStatus, 'running'>; code: ToolCode | null; at?: number | null; detail?: string | null; key?: string | null; args?: Record<string, string> | null }
  | ({ type: 'approval_required' } & ApprovalRequest)
  | ({ type: 'file'; messageId: string } & HelplyAttachment)
  | { type: 'done'; messageId: string; awaitingApproval: boolean; title: string }
  | { type: 'error'; message: string; code: StreamErrorCode | null; retryable: boolean };

export interface ApprovalDecision {
  approvalId: string;
  approved: boolean;
}
