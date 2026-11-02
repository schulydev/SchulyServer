import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { PdfConverter } from '../shared/file-viewer';
import { LinkedAccountsStore } from './linked-accounts.store';

/**
 * Converts Office files the app only has the bytes of (school documents) to PDF through the selected drive account's
 * `<endpoint>/convert/pdf`. Unavailable without a linked account that offers a drive; a provider without the route answers 404
 * and the viewer falls back to its own renderers.
 */
@Injectable()
export class DrivePdfConverter implements PdfConverter {
  private readonly http = inject(HttpClient);
  private readonly accounts = inject(LinkedAccountsStore);

  async available(): Promise<boolean> {
    if (!this.accounts.loaded()) await this.accounts.load();
    return this.accounts.endpoint('drive') !== null;
  }

  convert(blob: Blob, name: string): Promise<Blob> {
    const endpoint = this.accounts.endpoint('drive');
    if (!endpoint) return Promise.reject(new Error('no drive account'));
    return firstValueFrom(
      this.http.post(`${endpoint}/convert/pdf`, blob, {
        params: { name },
        headers: { 'Content-Type': 'application/octet-stream' },
        responseType: 'blob',
      }),
    );
  }
}
