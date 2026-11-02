import { describe, expect, it } from 'vitest';
import { ChatState, applyStreamEvent, beginTurn, emptyChat, parseStreamEvent, stopStreaming, toChatMessage } from './helply-state';
import { StreamEvent } from './helply-types';

const user = { id: 'u1', role: 'user' as const, text: 'Hi', createdAt: '', tools: [], failed: false, streaming: false, error: null, retryable: false, attachments: [] };
const base = (): ChatState => ({ ...emptyChat(), messages: [user] });
const run = (events: StreamEvent[], state = base()) => events.reduce((s, e) => applyStreamEvent(s, e), state);

describe('applyStreamEvent', () => {
  it('start creates the assistant message and delta appends text', () => {
    const state = run([{ type: 'start', messageId: 'a1' }, { type: 'delta', text: 'Hel' }, { type: 'delta', text: 'lo' }]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({ id: 'a1', role: 'assistant', text: 'Hello', streaming: true });
  });

  it('does not mutate the input state', () => {
    const state = base();
    applyStreamEvent(state, { type: 'start', messageId: 'a1' });
    expect(state.messages).toHaveLength(1);
  });

  it('tracks tool start and finish by id', () => {
    const state = run([
      { type: 'start', messageId: 'a1' },
      { type: 'tool_started', id: 't1', label: 'Looking up your grades', code: null },
      { type: 'tool_finished', id: 't1', label: 'Looked up your grades', status: 'done', code: null },
    ]);
    expect(state.messages[1].tools).toEqual([{ id: 't1', label: 'Looked up your grades', status: 'done', code: null }]);
  });

  it('collects approvals and clears them when the continuation starts, reusing the message', () => {
    const paused = run([
      { type: 'start', messageId: 'a1' },
      { type: 'delta', text: 'Sure.' },
      { type: 'approval_required', approvalId: 'p1', toolLabel: 'Send mail', summary: 's', details: [], destructive: false, arguments: [], risk: 'normal', riskReasons: [] },
      { type: 'done', messageId: 'a1', awaitingApproval: true, title: 'Mail' },
    ]);
    expect(paused.approvals).toHaveLength(1);
    expect(paused.awaitingApproval).toBe(true);
    expect(paused.title).toBe('Mail');
    const resumed = run([{ type: 'start', messageId: 'a1' }, { type: 'delta', text: ' Sent.' }], paused);
    expect(resumed.approvals).toHaveLength(0);
    expect(resumed.messages).toHaveLength(2);
    expect(resumed.messages[1].text).toBe('Sure. Sent.');
  });

  it('error marks the message failed and stops running tools', () => {
    const state = run([
      { type: 'start', messageId: 'a1' },
      { type: 'tool_started', id: 't1', label: 'Looking', code: null },
      { type: 'error', message: "Helply couldn't answer right now.", code: 'unavailable', retryable: true },
    ]);
    expect(state.messages[1]).toMatchObject({ failed: true, streaming: false, retryable: true, error: "Helply couldn't answer right now." });
    expect(state.messages[1].tools[0].status).toBe('failed');
  });

  it('stopStreaming keeps the text', () => {
    const state = stopStreaming(run([{ type: 'start', messageId: 'a1' }, { type: 'delta', text: 'Part' }]));
    expect(state.messages[1]).toMatchObject({ text: 'Part', streaming: false });
  });
});

describe('parseStreamEvent', () => {
  it('parses known events and ignores unknown or malformed ones', () => {
    expect(parseStreamEvent('delta', '{"text":"x"}')).toEqual({ type: 'delta', text: 'x' });
    expect(parseStreamEvent('nope', '{}')).toBeNull();
    expect(parseStreamEvent('delta', 'not json')).toBeNull();
  });
});

describe('code and files', () => {
  const code = { command: 'python -c "print(2+2)"', output: '4\n', exitCode: 0 };

  it('keeps code on tool events, filled in when the tool finishes', () => {
    const state = run([
      { type: 'start', messageId: 'a1' },
      { type: 'tool_started', id: 't1', label: 'Running code', code: { command: code.command, output: null, exitCode: null } },
      { type: 'tool_finished', id: 't1', label: 'Ran code', status: 'done', code },
    ]);
    expect(state.messages[1].tools).toEqual([{ id: 't1', label: 'Ran code', status: 'done', code }]);
  });

  it('appends a file event to the last assistant message once', () => {
    const file = { type: 'file' as const, messageId: 'a1', id: 'f1', fileName: 'chart.png', mediaType: 'image/png', sizeBytes: 10 };
    const state = run([{ type: 'start', messageId: 'a1' }, file, file]);
    expect(state.messages[1].attachments).toEqual([{ id: 'f1', fileName: 'chart.png', mediaType: 'image/png', sizeBytes: 10 }]);
  });

  it('beginTurn puts attachments on the user message only', () => {
    const a = { id: 'f1', fileName: 'notes.pdf', mediaType: 'application/pdf', sizeBytes: 5 };
    const state = beginTurn(emptyChat(), '', 'now', '1', [a]);
    expect(state.messages[0].attachments).toEqual([a]);
    expect(state.messages[1].attachments).toEqual([]);
  });

  it('toChatMessage defaults missing attachments', () => {
    const { attachments: _a, ...rest } = user;
    expect(toChatMessage(rest as never).attachments).toEqual([]);
  });

  it('parses code and file events', () => {
    expect(parseStreamEvent('tool_finished', JSON.stringify({ id: 't', label: 'Ran code', status: 'done', code }))).toMatchObject({ code });
    expect(parseStreamEvent('tool_started', '{"id":"t","label":"x","code":null}')).toMatchObject({ code: null });
    expect(parseStreamEvent('file', '{"messageId":"m","id":"f","fileName":"a.csv","mediaType":"text/csv","sizeBytes":3}')).toEqual({
      type: 'file', messageId: 'm', id: 'f', fileName: 'a.csv', mediaType: 'text/csv', sizeBytes: 3,
    });
    expect(parseStreamEvent('file', '{"messageId":"m"}')).toBeNull();
  });
});
