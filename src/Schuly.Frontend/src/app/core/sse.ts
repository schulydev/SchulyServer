export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Incremental Server-Sent Events parser. Feed it decoded text chunks as they arrive; chunks may split
 * a line or an event anywhere. Handles LF, CRLF and CR line endings, comments and multi-line data.
 */
export class SseParser {
  private buffer = '';
  private event = '';
  private data: string[] = [];

  push(chunk: string): SseEvent[] {
    let text = this.buffer + chunk;
    // A trailing CR may be the first half of a CRLF split across chunks, so wait for the next chunk.
    let held = '';
    if (text.endsWith('\r')) {
      held = '\r';
      text = text.slice(0, -1);
    }
    const lines = text.split(/\r\n|\r|\n/);
    this.buffer = (lines.pop() ?? '') + held;

    const events: SseEvent[] = [];
    for (const line of lines) {
      const parsed = this.line(line);
      if (parsed) events.push(parsed);
    }
    return events;
  }

  /** Ends the stream: processes a final unterminated line and dispatches an event left without a blank line. */
  flush(): SseEvent[] {
    const events: SseEvent[] = [];
    const rest = this.buffer.replace(/\r$/, '');
    this.buffer = '';
    if (rest) {
      const parsed = this.line(rest);
      if (parsed) events.push(parsed);
    }
    const last = this.line('');
    if (last) events.push(last);
    return events;
  }

  private line(line: string): SseEvent | null {
    if (line === '') {
      if (!this.data.length && !this.event) return null;
      const result: SseEvent = { event: this.event || 'message', data: this.data.join('\n') };
      this.event = '';
      this.data = [];
      return result;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    return null;
  }
}
