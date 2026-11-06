import { t } from '../core/i18n';
import { HttpClient } from '@angular/common/http';
import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { StudentDocumentDto, StudentDocumentsService } from '../api';
import { withCollection } from './with-collection';

export const DocumentsStore = signalStore(
  withCollection<StudentDocumentDto>(() => {
    const api = inject(StudentDocumentsService);
    return () => api.apiDocumentsGet();
  }),
  withState<{ downloading: string[]; downloadError: string | null }>({ downloading: [], downloadError: null }),
  withComputed((store) => ({
    sorted: computed(() => [...store.items()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))),
  })),
  withMethods((store, http = inject(HttpClient)) => ({
    isDownloading(id: string | null | undefined): boolean {
      return !!id && store.downloading().includes(id);
    },
    /** The file's bytes, fetched with the signed-in session like a download. */
    fetchBlob(document: StudentDocumentDto): Promise<Blob> {
      return firstValueFrom(http.get(`/api/documents/${encodeURIComponent(document.id ?? '')}`, { responseType: 'blob' }));
    },
    download(document: StudentDocumentDto): void {
      const id = document.id;
      if (!id || store.downloading().includes(id)) return;
      patchState(store, { downloading: [...store.downloading(), id], downloadError: null });
      const done = () => patchState(store, { downloading: store.downloading().filter((d) => d !== id) });
      // Raw HttpClient with responseType blob: the generated client asks for JSON here, so it fails to parse the file bytes.
      http.get(`/api/documents/${encodeURIComponent(id)}`, { responseType: 'blob' }).subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const link = Object.assign(window.document.createElement('a'), { href: url, download: document.fileName ?? document.title ?? 'document' });
          link.click();
          // Revoking right after click() cancels the download in some browsers.
          setTimeout(() => URL.revokeObjectURL(url), 60_000);
          done();
        },
        error: () => {
          patchState(store, { downloadError: t('documents.downloadFailed', { name: document.title ?? t('documents.theDocument') }) });
          done();
        },
      });
    },
  })),
);
