import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ViewerFile } from '../shared/file-viewer';
import { DriveEntry } from '../stores/capability-data.store';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { openMediaStream } from './media-stream';

/** Bytes of drive files for the viewer and for saving. Own OneDrive files use their pre-authenticated link, all others the plugin's drive item routes. */
@Injectable()
export class DriveContent {
  private readonly http = inject(HttpClient);
  private readonly accounts = inject(LinkedAccountsStore);

  key(entry: Pick<DriveEntry, 'id' | 'modified' | 'driveId'>): string {
    return `drive:${this.accounts.selectedId('drive')}:${entry.driveId ?? ''}:${entry.id}:${entry.modified ?? ''}`;
  }

  /** The viewer's description of a file, or null when its bytes cannot be reached. */
  viewerFile(entry: DriveEntry): ViewerFile | null {
    const endpoint = this.accounts.endpoint('drive');
    if (!endpoint || entry.isFolder || !entry.openable) return null;
    const key = this.key(entry);
    if (entry.driveId) {
      const item = `${endpoint}/drives/${encodeURIComponent(entry.driveId)}/items/${encodeURIComponent(entry.id)}`;
      return {
        name: entry.name,
        key,
        load: () => firstValueFrom(this.http.get(`${item}/content`, { responseType: 'blob' })),
        pdf: () => firstValueFrom(this.http.get(`${item}/pdf`, { responseType: 'blob' })),
        stream: () => openMediaStream(this.http, `${item}/stream`),
      };
    }
    const url = entry.download as string;
    return {
      name: entry.name,
      key,
      load: async () => {
        const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error('download failed');
        return response.blob();
      },
      pdf: () => firstValueFrom(this.http.get(`${endpoint}/files/${encodeURIComponent(entry.id)}/pdf`, { responseType: 'blob' })),
    };
  }

  /** Saves a file through the browser's download. */
  async save(entry: DriveEntry): Promise<void> {
    const click = (href: string) => {
      const link = document.createElement('a');
      link.href = href;
      link.download = entry.name;
      link.rel = 'noopener';
      link.click();
    };
    if (!entry.driveId) {
      if (entry.download) click(entry.download);
      return;
    }
    const file = this.viewerFile(entry);
    if (!file) return;
    const url = URL.createObjectURL(await file.load());
    click(url);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
