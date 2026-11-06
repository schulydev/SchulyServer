import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { McpPermissionSet } from './mcp-permissions';

/** The separate opt-in for connecting an AI app. The server refuses a new connection without it. */
/** A translation key: the consent sentence for sharing data with an AI app. */
export const AI_APP_OPT_IN = 'mcp.optIn';

export interface McpAuthorizationParameters {
  responseType: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
}

export interface McpAuthorizationRequestResult {
  valid: boolean;
  error?: string | null;
  errorDescription?: string | null;
  clientName?: string | null;
  clientUri?: string | null;
  redirectHost?: string | null;
  requested: McpPermissionSet;
  redirectUrl?: string | null;
}

export interface McpAuthorizationDecision {
  parameters: McpAuthorizationParameters;
  approve: boolean;
  permissions: McpPermissionSet | null;
  aiAppSharingConfirmed: boolean;
}

export interface McpConnection {
  id: string;
  clientName: string;
  clientUri?: string | null;
  redirectHosts: string[];
  permissions: McpPermissionSet;
  createdAt: string;
  lastUsedAt?: string | null;
}

export interface McpKey {
  id: string;
  name: string;
  prefix: string;
  permissions: McpPermissionSet;
  createdAt: string;
  expiresAt?: string | null;
  lastUsedAt?: string | null;
}

export interface McpActivity {
  toolName: string;
  allowed: boolean;
  at: string;
}

export interface McpCreatedKey {
  key: McpKey;
  secret: string;
}

export interface McpCreateKey {
  name: string;
  permissions: McpPermissionSet;
  expiresAt: string | null;
  aiAppSharingConfirmed: boolean;
}

export interface LinkedAccount {
  id: string;
  provider: string;
  email?: string | null;
  displayName?: string | null;
}

/** Query parameter names of the OAuth authorize request, mapped to the API body. */
export function authorizationParameters(query: (name: string) => string | null | undefined): McpAuthorizationParameters {
  const get = (name: string) => query(name) ?? '';
  return {
    responseType: get('response_type'),
    clientId: get('client_id'),
    redirectUri: get('redirect_uri'),
    scope: get('scope'),
    state: get('state'),
    codeChallenge: get('code_challenge'),
    codeChallengeMethod: get('code_challenge_method'),
    resource: get('resource'),
  };
}

export function mcpErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body: unknown = error.error;
    if (typeof body === 'string' && body.trim()) return body;
    if (body && typeof body === 'object') {
      const { detail, title, message } = body as Record<string, unknown>;
      for (const value of [detail, message, title]) if (typeof value === 'string' && value) return value;
    }
  }
  return fallback;
}

@Injectable({ providedIn: 'root' })
export class McpApi {
  private readonly http = inject(HttpClient);

  authorizationRequest(parameters: McpAuthorizationParameters): Observable<McpAuthorizationRequestResult> {
    return this.http.post<McpAuthorizationRequestResult>('/api/mcp/authorization-request', parameters);
  }

  authorizationDecision(decision: McpAuthorizationDecision): Observable<{ redirectUrl: string }> {
    return this.http.post<{ redirectUrl: string }>('/api/mcp/authorization-decision', decision);
  }

  connections(): Observable<McpConnection[]> {
    return this.http.get<McpConnection[]>('/api/mcp/connections');
  }

  updateConnection(id: string, permissions: McpPermissionSet): Observable<McpConnection> {
    return this.http.put<McpConnection>(`/api/mcp/connections/${encodeURIComponent(id)}/permissions`, permissions);
  }

  connectionActivity(id: string): Observable<McpActivity[]> {
    return this.http.get<McpActivity[]>(`/api/mcp/connections/${encodeURIComponent(id)}/activity`);
  }

  revokeConnection(id: string): Observable<void> {
    return this.http.delete<void>(`/api/mcp/connections/${encodeURIComponent(id)}`);
  }

  keys(): Observable<McpKey[]> {
    return this.http.get<McpKey[]>('/api/mcp/keys');
  }

  createKey(request: McpCreateKey): Observable<McpCreatedKey> {
    return this.http.post<McpCreatedKey>('/api/mcp/keys', request);
  }

  updateKey(id: string, permissions: McpPermissionSet): Observable<McpKey> {
    return this.http.put<McpKey>(`/api/mcp/keys/${encodeURIComponent(id)}/permissions`, permissions);
  }

  keyActivity(id: string): Observable<McpActivity[]> {
    return this.http.get<McpActivity[]>(`/api/mcp/keys/${encodeURIComponent(id)}/activity`);
  }

  revokeKey(id: string): Observable<void> {
    return this.http.delete<void>(`/api/mcp/keys/${encodeURIComponent(id)}`);
  }

  microsoftAccounts(): Observable<LinkedAccount[]> {
    return this.http.get<LinkedAccount[]>('/api/me/linked-accounts', { params: { provider: 'microsoft' } });
  }
}
