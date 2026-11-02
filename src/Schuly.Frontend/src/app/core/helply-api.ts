import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthStore } from '../stores/auth.store';
import { parseStreamEvent } from './helply-state';
import {
  ApprovalDecision,
  Conversation,
  ConversationSummary,
  HelplySettings,
  StreamEvent,
} from './helply-types';
import { McpPermissionSet } from './mcp-permissions';
import { SseParser } from './sse';

/** A failed request before the stream started. Carries only the HTTP status, never server text. */
export class HelplyHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number | null = null,
  ) {
    super(`Helply request failed (${status})`);
  }
}

const BASE = '/api/helply';

@Injectable({ providedIn: 'root' })
export class HelplyApi {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthStore);

  status(): Promise<{ enabled: boolean }> {
    return firstValueFrom(this.http.get<{ enabled: boolean }>(`${BASE}/status`));
  }

  settings(): Promise<HelplySettings> {
    return firstValueFrom(this.http.get<HelplySettings>(`${BASE}/settings`));
  }

  updatePermissions(permissions: McpPermissionSet): Promise<HelplySettings> {
    return firstValueFrom(this.http.put<HelplySettings>(`${BASE}/settings/permissions`, permissions));
  }

  conversations(): Promise<ConversationSummary[]> {
    return firstValueFrom(this.http.get<ConversationSummary[]>(`${BASE}/conversations`));
  }

  createConversation(title?: string): Promise<ConversationSummary> {
    return firstValueFrom(this.http.post<ConversationSummary>(`${BASE}/conversations`, title ? { title } : {}));
  }

  renameConversation(id: string, title: string): Promise<ConversationSummary> {
    return firstValueFrom(this.http.patch<ConversationSummary>(`${BASE}/conversations/${encodeURIComponent(id)}`, { title }));
  }

  deleteConversation(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${BASE}/conversations/${encodeURIComponent(id)}`));
  }

  deleteAllConversations(): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`${BASE}/conversations`));
  }

  conversation(id: string): Promise<Conversation> {
    return firstValueFrom(this.http.get<Conversation>(`${BASE}/conversations/${encodeURIComponent(id)}`));
  }

  sendMessage(id: string, text: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
    return this.stream(`${BASE}/conversations/${encodeURIComponent(id)}/messages`, { text }, signal);
  }

  decide(id: string, decisions: ApprovalDecision[], signal: AbortSignal): AsyncGenerator<StreamEvent> {
    return this.stream(`${BASE}/conversations/${encodeURIComponent(id)}/approvals`, { decisions }, signal);
  }

  retry(id: string, signal: AbortSignal): AsyncGenerator<StreamEvent> {
    return this.stream(`${BASE}/conversations/${encodeURIComponent(id)}/retry`, null, signal);
  }

  /**
   * POSTs and reads the Server-Sent Events response. EventSource cannot POST, so this uses fetch with the same
   * bearer token as the HttpClient interceptor and, like it, refreshes the session once on a 401 and retries.
   */
  private async *stream(url: string, body: unknown, signal: AbortSignal): AsyncGenerator<StreamEvent> {
    let response = await this.post(url, body, this.auth.accessToken(), signal);
    if (response.status === 401) {
      const token = await firstValueFrom(this.auth.refresh());
      if (!token) {
        this.auth.signedOutElsewhere();
        throw new HelplyHttpError(401);
      }
      response = await this.post(url, body, token, signal);
    }
    if (!response.ok || !response.body) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      await response.body?.cancel().catch(() => undefined);
      throw new HelplyHttpError(response.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const raw of parser.push(decoder.decode(value, { stream: true }))) {
          const event = parseStreamEvent(raw.event, raw.data);
          if (event) yield event;
        }
      }
      for (const raw of [...parser.push(decoder.decode()), ...parser.flush()]) {
        const event = parseStreamEvent(raw.event, raw.data);
        if (event) yield event;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  private post(url: string, body: unknown, token: string | null, signal: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'text/event-stream', 'X-Schuly-Client': 'web' };
    if (body !== null) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(url, {
      method: 'POST',
      headers,
      body: body === null ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  }
}
