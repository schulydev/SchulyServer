import { describe, expect, it } from 'vitest';
import { SseParser } from './sse';

const collect = (chunks: string[]) => {
  const parser = new SseParser();
  return [...chunks.flatMap((chunk) => parser.push(chunk)), ...parser.flush()];
};

describe('SseParser', () => {
  it('parses a single event', () => {
    expect(collect(['event: delta\ndata: {"text":"Hi"}\n\n'])).toEqual([{ event: 'delta', data: '{"text":"Hi"}' }]);
  });

  it('parses several events in one chunk', () => {
    expect(collect(['event: a\ndata: 1\n\nevent: b\ndata: 2\n\n'])).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('handles chunks split mid-line and mid-event', () => {
    expect(collect(['eve', 'nt: de', 'lta\nda', 'ta: {"x":', '1}\n', '\nevent: b\ndata: 2', '\n\n'])).toEqual([
      { event: 'delta', data: '{"x":1}' },
      { event: 'b', data: '2' },
    ]);
  });

  it('handles CRLF, including a CRLF split between chunks', () => {
    expect(collect(['event: a\r\ndata: 1\r', '\n\r\nevent: b\r\ndata: 2\r\n\r\n'])).toEqual([
      { event: 'a', data: '1' },
      { event: 'b', data: '2' },
    ]);
  });

  it('joins multi-line data and ignores comments', () => {
    expect(collect([': keep-alive\n\nevent: a\ndata: one\ndata: two\n\n'])).toEqual([{ event: 'a', data: 'one\ntwo' }]);
  });

  it('defaults the event name to message and accepts data without a space', () => {
    expect(collect(['data:x\n\n'])).toEqual([{ event: 'message', data: 'x' }]);
  });

  it('flushes an event that was not terminated by a blank line', () => {
    expect(collect(['event: done\ndata: {}'])).toEqual([{ event: 'done', data: '{}' }]);
  });

  it('works one character at a time', () => {
    const text = 'event: a\ndata: héllo\n\nevent: b\ndata: 2\n\n';
    expect(collect([...text])).toEqual([
      { event: 'a', data: 'héllo' },
      { event: 'b', data: '2' },
    ]);
  });
});
