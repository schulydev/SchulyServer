import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';

export interface DriveTeam {
  id: string;
  displayName: string;
}
export interface DriveChannel {
  id: string;
  displayName: string;
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'failed' | 'unavailable';

export interface ChannelList {
  state: LoadState;
  items: DriveChannel[];
}

/**
 * The teams of the selected account and, once asked for, the channels of each. Entirely separate from the file listing:
 * when this fails, My files keeps working.
 */
@Injectable()
export class DriveTeams {
  private readonly http = inject(HttpClient);
  private readonly accounts = inject(LinkedAccountsStore);

  readonly teams = signal<DriveTeam[]>([]);
  readonly state = signal<LoadState>('idle');
  readonly channels = signal<Record<string, ChannelList>>({});

  constructor() {
    effect(() => {
      this.accounts.selectedId('drive');
      const base = this.accounts.endpoint('drive');
      untracked(() => {
        this.teams.set([]);
        this.channels.set({});
        this.state.set('idle');
        if (base) this.reload();
      });
    });
  }

  reload(): void {
    const base = this.accounts.endpoint('drive');
    if (!base) return;
    this.state.set('loading');
    this.http.get<DriveTeam[]>(`${base}/teams`).subscribe({
      next: (list) => {
        this.teams.set(Array.isArray(list) ? list.filter((t) => t?.id) : []);
        this.state.set('ready');
      },
      error: (error) => this.state.set(error instanceof HttpErrorResponse && error.status === 404 ? 'unavailable' : 'failed'),
    });
  }

  /** Fetches the channels of a team once; a failed attempt is tried again on the next call. */
  loadChannels(teamId: string): void {
    const base = this.accounts.endpoint('drive');
    const known = this.channels()[teamId];
    if (!base || (known && known.state !== 'failed')) return;
    const set = (value: ChannelList) => this.channels.update((all) => ({ ...all, [teamId]: value }));
    set({ state: 'loading', items: [] });
    this.http.get<DriveChannel[]>(`${base}/teams/${encodeURIComponent(teamId)}/channels`).subscribe({
      next: (list) => set({ state: 'ready', items: Array.isArray(list) ? list.filter((c) => c?.id) : [] }),
      error: () => set({ state: 'failed', items: [] }),
    });
  }
}
