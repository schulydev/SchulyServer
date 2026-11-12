import { ApprovalRequest, HelplyAttachment, HelplyMessage, StreamErrorCode, StreamEvent, ToolActivity, ToolCode } from './helply-types';

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
  attachments: message.attachments ?? [],
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

/** Adds a step or updates it in place; a finished step keeps the place and detail it started with when its event leaves them out. */
const withTool = (tools: ToolActivity[], tool: ToolActivity): ToolActivity[] =>
  tools.some((t) => t.id === tool.id)
    ? tools.map((t) => (t.id === tool.id ? { ...tool, at: tool.at ?? t.at, detail: tool.detail ?? t.detail, key: tool.key ?? t.key, args: tool.args ?? t.args } : t))
    : [...tools, tool];

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
          attachments: [],
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
        tools: withTool(m.tools, { id: event.id, label: event.label, status: 'running', code: event.code, at: event.at, detail: event.detail, key: event.key, args: event.args }),
      }));
    case 'tool_finished':
      return updateLastAssistant(state, (m) => ({
        ...m,
        tools: withTool(m.tools, { id: event.id, label: event.label, status: event.status, code: event.code, at: event.at, detail: event.detail, key: event.key, args: event.args }),
      }));
    case 'approval_required': {
      if (state.approvals.some((a) => a.approvalId === event.approvalId)) return state;
      const approval: ApprovalRequest = {
        approvalId: event.approvalId,
        toolLabel: event.toolLabel,
        summary: event.summary,
        details: event.details ?? [],
        destructive: event.destructive,
        arguments: event.arguments ?? [],
        risk: event.risk === 'high' ? 'high' : 'normal',
        riskReasons: event.riskReasons ?? [],
      };
      return { ...state, approvals: [...state.approvals, approval] };
    }
    case 'file':
      return updateLastAssistant(state, (m) =>
        m.attachments.some((a) => a.id === event.id)
          ? m
          : { ...m, attachments: [...m.attachments, { id: event.id, fileName: event.fileName, mediaType: event.mediaType, sizeBytes: event.sizeBytes }] },
      );
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
const position = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);
const note = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const args = (value: unknown): Record<string, string> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string');
  return entries.length ? Object.fromEntries(entries) : null;
};
const CODES: StreamErrorCode[] = ['unavailable', 'timeout', 'rate_limited', 'too_long', 'disabled'];

function parseCode(value: unknown): ToolCode | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  return {
    command: text(o['command']),
    output: typeof o['output'] === 'string' ? o['output'] : null,
    exitCode: typeof o['exitCode'] === 'number' ? o['exitCode'] : null,
  };
}

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
      return { type: 'tool_started', id: text(o['id']), label: text(o['label']), code: parseCode(o['code']), at: position(o['at']), detail: note(o['detail']), key: note(o['key']), args: args(o['args']) };
    case 'tool_finished': {
      const status = o['status'] === 'failed' || o['status'] === 'denied' ? o['status'] : 'done';
      return { type: 'tool_finished', id: text(o['id']), label: text(o['label']), status, code: parseCode(o['code']), at: position(o['at']), detail: note(o['detail']), key: note(o['key']), args: args(o['args']) };
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
        arguments: Array.isArray(o['arguments'])
          ? (o['arguments'] as Record<string, unknown>[]).map((d) => ({ label: text(d['label']), value: text(d['value']) }))
          : [],
        risk: o['risk'] === 'high' ? 'high' : 'normal',
        riskReasons: Array.isArray(o['riskReasons']) ? (o['riskReasons'] as unknown[]).map(text) : [],
      };
    case 'file': {
      const id = text(o['id']);
      if (!id) return null;
      const size = Number(o['sizeBytes']);
      return {
        type: 'file',
        messageId: text(o['messageId']),
        id,
        fileName: text(o['fileName']),
        mediaType: text(o['mediaType']),
        sizeBytes: Number.isFinite(size) ? size : 0,
      };
    }
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
    attachments: [],
    failed: false,
    streaming: true,
    error: null,
    retryable: false,
  }));
}

/** Adds the user's message and an empty assistant message that the stream will fill. */
export function beginTurn(state: ChatState, text: string, now: string, key: string, attachments: HelplyAttachment[] = []): ChatState {
  const userMessage: ChatMessage = {
    id: `local-user-${key}`,
    role: 'user',
    text,
    createdAt: now,
    tools: [],
    attachments,
    failed: false,
    streaming: false,
    error: null,
    retryable: false,
  };
  const assistant: ChatMessage = { ...userMessage, id: `local-assistant-${key}`, role: 'assistant', text: '', attachments: [], streaming: true };
  return { ...state, approvals: [], awaitingApproval: false, messages: [...state.messages, userMessage, assistant] };
}
