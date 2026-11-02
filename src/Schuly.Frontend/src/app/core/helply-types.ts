import { McpPermissionSet } from './mcp-permissions';

export interface HelplySettings {
  permissions: McpPermissionSet;
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
}

export interface Conversation extends ConversationSummary {
  messages: HelplyMessage[];
  pendingApprovals: ApprovalRequest[];
}

export type StreamErrorCode = 'unavailable' | 'timeout' | 'rate_limited' | 'too_long' | 'disabled';

export type StreamEvent =
  | { type: 'start'; messageId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool_started'; id: string; label: string }
  | { type: 'tool_finished'; id: string; label: string; status: Exclude<ToolStatus, 'running'> }
  | ({ type: 'approval_required' } & ApprovalRequest)
  | { type: 'done'; messageId: string; awaitingApproval: boolean; title: string }
  | { type: 'error'; message: string; code: StreamErrorCode | null; retryable: boolean };

export interface ApprovalDecision {
  approvalId: string;
  approved: boolean;
}
