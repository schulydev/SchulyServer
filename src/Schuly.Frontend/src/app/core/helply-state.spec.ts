import { describe, expect, it } from 'vitest';
import { ChatState, applyStreamEvent, emptyChat, parseStreamEvent, stopStreaming } from './helply-state';
import { StreamEvent } from './helply-types';

const user = { id: 'u1', role: 'user' as const, text: 'Hi', createdAt: '', tools: [], failed: false, streaming: false, error: null, retryable: false };
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
      { type: 'tool_started', id: 't1', label: 'Looking up your grades' },
      { type: 'tool_finished', id: 't1', label: 'Looked up your grades', status: 'done' },
    ]);
    expect(state.messages[1].tools).toEqual([{ id: 't1', label: 'Looked up your grades', status: 'done' }]);
  });

  it('collects approvals and clears them when the continuation starts, reusing the message', () => {
    const paused = run([
      { type: 'start', messageId: 'a1' },
      { type: 'delta', text: 'Sure.' },
      { type: 'approval_required', approvalId: 'p1', toolLabel: 'Send mail', summary: 's', details: [], destructive: false },
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
      { type: 'tool_started', id: 't1', label: 'Looking' },
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
