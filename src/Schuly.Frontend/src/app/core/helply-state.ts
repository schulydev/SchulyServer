import { ApprovalRequest, HelplyMessage, StreamErrorCode, StreamEvent, ToolActivity } from './helply-types';

/** A message as shown in the chat: the server shape plus transient streaming state. */
export interface ChatMessage extends HelplyMessage {
  streaming: boolean;
  /** Friendly error shown under a failed assistant message. */
  error: string | null;
  retryable: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  approvals: ApprovalRequest[];
  title: string | null;
  awaitingApproval: boolean;
}

export const GENERIC_ERROR = "Helply couldn't answer right now.";

export const emptyChat = (): ChatState => ({ messages: [], approvals: [], title: null, awaitingApproval: false });

export const toChatMessage = (message: HelplyMessage): ChatMessage => ({
  ...message,
  tools: message.tools ?? [],
  streaming: false,
  error: message.failed ? GENERIC_ERROR : null,
  retryable: message.failed,
});

const updateLastAssistant = (state: ChatState, change: (message: ChatMessage) => ChatMessage): ChatState => {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    if (state.messages[i].role !== 'assistant') continue;
    const messages = state.messages.slice();
    messages[i] = change(messages[i]);
    return { ...state, messages };
  }
  return state;
};

const withTool = (tools: ToolActivity[], tool: ToolActivity): ToolActivity[] =>
  tools.some((t) => t.id === tool.id) ? tools.map((t) => (t.id === tool.id ? tool : t)) : [...tools, tool];

const stopRunning = (tools: ToolActivity[]): ToolActivity[] =>
  tools.map((t) => (t.status === 'running' ? { ...t, status: 'failed' } : t));

/** Applies one stream event to the chat. Pure: returns a new state and never mutates the input. */
export function applyStreamEvent(state: ChatState, event: StreamEvent, now = ''): ChatState {
  switch (event.type) {
    case 'start': {
      const base: ChatState = { ...state, approvals: [], awaitingApproval: false };
      const last = state.messages[state.messages.length - 1];
      if (last?.role !== 'assistant') {
        const message: ChatMessage = {
          id: event.messageId,
          role: 'assistant',
          text: '',
          createdAt: now,
          tools: [],
          failed: false,
          streaming: true,
          error: null,
          retryable: false,
        };
        return { ...base, messages: [...base.messages, message] };
      }
      return updateLastAssistant(base, (m) => ({
        ...m,
        id: event.messageId,
        streaming: true,
        failed: false,
        error: null,
        retryable: false,
      }));
    }
    case 'delta':
      return updateLastAssistant(state, (m) => ({ ...m, text: m.text + event.text }));
    case 'tool_started':
      return updateLastAssistant(state, (m) => ({
        ...m,
        tools: withTool(m.tools, { id: event.id, label: event.label, status: 'running' }),
      }));
    case 'tool_finished':
      return updateLastAssistant(state, (m) => ({
        ...m,
        tools: withTool(m.tools, { id: event.id, label: event.label, status: event.status }),
      }));
    case 'approval_required': {
      if (state.approvals.some((a) => a.approvalId === event.approvalId)) return state;
      const approval: ApprovalRequest = {
        approvalId: event.approvalId,
        toolLabel: event.toolLabel,
        summary: event.summary,
        details: event.details ?? [],
        destructive: event.destructive,
      };
      return { ...state, approvals: [...state.approvals, approval] };
    }
    case 'done':
      return updateLastAssistant(
        { ...state, title: event.title || state.title, awaitingApproval: event.awaitingApproval },
        (m) => ({ ...m, id: event.messageId || m.id, streaming: false }),
      );
    case 'error':
      return updateLastAssistant(state, (m) => ({
        ...m,
        streaming: false,
        failed: true,
        error: event.message || GENERIC_ERROR,
        retryable: event.retryable,
        tools: stopRunning(m.tools),
      }));
  }
}

/** Ends a locally interrupted stream (Stop button): keeps the text so far and stops spinners. */
export function stopStreaming(state: ChatState): ChatState {
  return updateLastAssistant(state, (m) => ({ ...m, streaming: false, tools: stopRunning(m.tools) }));
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const CODES: StreamErrorCode[] = ['unavailable', 'timeout', 'rate_limited', 'too_long', 'disabled'];

/** Parses a raw SSE event into a typed stream event. Unknown or malformed events return null. */
export function parseStreamEvent(name: string, data: string): StreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  switch (name) {
    case 'start':
      return { type: 'start', messageId: text(o['messageId']) };
    case 'delta':
      return { type: 'delta', text: text(o['text']) };
    case 'tool_started':
      return { type: 'tool_started', id: text(o['id']), label: text(o['label']) };
    case 'tool_finished': {
      const status = o['status'] === 'failed' || o['status'] === 'denied' ? o['status'] : 'done';
      return { type: 'tool_finished', id: text(o['id']), label: text(o['label']), status };
    }
    case 'approval_required':
      return {
        type: 'approval_required',
        approvalId: text(o['approvalId']),
        toolLabel: text(o['toolLabel']),
        summary: text(o['summary']),
        details: Array.isArray(o['details'])
          ? (o['details'] as Record<string, unknown>[]).map((d) => ({ label: text(d['label']), value: text(d['value']) }))
          : [],
        destructive: o['destructive'] === true,
      };
    case 'done':
      return {
        type: 'done',
        messageId: text(o['messageId']),
        awaitingApproval: o['awaitingApproval'] === true,
        title: text(o['title']),
      };
    case 'error': {
      const code = CODES.find((c) => c === o['code']) ?? null;
      return { type: 'error', message: text(o['message']) || GENERIC_ERROR, code, retryable: o['retryable'] === true };
    }
    default:
      return null;
  }
}

/** Resets the failed last assistant message so a retry streams into it afresh. */
export function prepareRetry(state: ChatState): ChatState {
  return updateLastAssistant({ ...state, approvals: [], awaitingApproval: false }, (m) => ({
    ...m,
    text: '',
    tools: [],
    failed: false,
    streaming: true,
    error: null,
    retryable: false,
  }));
}

/** Adds the user's message and an empty assistant message that the stream will fill. */
export function beginTurn(state: ChatState, text: string, now: string, key: string): ChatState {
  const userMessage: ChatMessage = {
    id: `local-user-${key}`,
    role: 'user',
    text,
    createdAt: now,
    tools: [],
    failed: false,
    streaming: false,
    error: null,
    retryable: false,
  };
  const assistant: ChatMessage = { ...userMessage, id: `local-assistant-${key}`, role: 'assistant', text: '', streaming: true };
  return { ...state, approvals: [], awaitingApproval: false, messages: [...state.messages, userMessage, assistant] };
}
