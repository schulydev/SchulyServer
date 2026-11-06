import { TranslatePipe } from '@ngx-translate/core';
import { SyncingNotice } from '../shared/syncing-notice';
import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload, lucideEye, lucideFileText } from '@ng-icons/lucide';
import { HlmAlertImports } from '@spartan-ng/helm/alert';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmSpinner } from '@spartan-ng/helm/spinner';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { EmptyState } from '../shared/empty-state';
import { FileViewer, ViewerFile } from '../shared/file-viewer';
import { StudentDocumentDto } from '../api';
import { DocumentsStore } from '../stores/documents.store';
import { AppDatePipe } from '../core/date-format';

@Component({
  selector: 'app-documents',
  imports: [TranslatePipe, SyncingNotice, HlmAlertImports, HlmTableImports, HlmBadge, HlmButton, HlmSkeletonImports, HlmSpinner, NgIcon, AppDatePipe, EmptyState, FileViewer],
  providers: [provideIcons({ lucideDownload, lucideEye, lucideFileText })],
  template: `
    <div class="flex flex-col gap-4 p-4 lg:p-6">
      <app-syncing-notice />
      @if (documents.downloadError()) {
        <div hlmAlert variant="destructive">
          <p hlmAlertDescription>{{ documents.downloadError() }}</p>
        </div>
      }
      @if (documents.loading()) {
        <div class="flex flex-col gap-2">
          @for (i of [1, 2, 3]; track i) {
            <hlm-skeleton class="h-10 w-full" />
          }
        </div>
      } @else if (documents.items().length) {
        <div class="overflow-hidden rounded-lg border">
          <div hlmTableContainer>
            <table hlmTable>
              <thead hlmTHead class="bg-muted">
                <tr hlmTr>
                  <th hlmTh>{{ 'documents.document' | translate }}</th>
                  <th hlmTh class="hidden sm:table-cell">{{ 'documents.category' | translate }}</th>
                  <th hlmTh class="hidden md:table-cell">{{ 'documents.added' | translate }}</th>
                  <th hlmTh class="hidden lg:table-cell">{{ 'documents.followUp' | translate }}</th>
                  <th hlmTh class="w-24"><span class="sr-only">{{ 'documents.actions' | translate }}</span></th>
                </tr>
              </thead>
              <tbody hlmTBody>
                @for (document of documents.sorted(); track document.id) {
                  <tr hlmTr [class.cursor-pointer]="!!document.fileName" (click)="view(document)">
                    <td hlmTd>
                      <div class="font-medium">{{ document.title }}</div>
                      @if (document.comment) {
                        <div class="text-muted-foreground max-w-md truncate text-xs">
                          {{ document.comment }}
                        </div>
                      }
                    </td>
                    <td hlmTd class="hidden sm:table-cell">
                      @if (document.category) {
                        <span hlmBadge variant="outline">{{ document.category }}</span>
                      }
                    </td>
                    <td hlmTd class="text-muted-foreground hidden tabular-nums md:table-cell">
                      {{ document.createdAt | appDate: 'date' }}
                    </td>
                    <td hlmTd class="text-muted-foreground hidden lg:table-cell">
                      {{ document.followUpAction || '-' }}
                      @if (document.followUpDate) {
                        <span class="tabular-nums"
                          >({{ document.followUpDate | appDate: 'dayMonth' }})</span
                        >
                      }
                    </td>
                    <td hlmTd class="whitespace-nowrap">
                      @if (document.fileName) {
                        <button
                          hlmBtn
                          variant="ghost"
                          size="icon-sm"
                          (click)="view(document); $event.stopPropagation()"
                          [attr.aria-label]="'View ' + document.title"
                        >
                          <ng-icon name="lucideEye" />
                        </button>
                        <button
                          hlmBtn
                          variant="ghost"
                          size="icon-sm"
                          (click)="documents.download(document); $event.stopPropagation()"
                          [disabled]="documents.isDownloading(document.id)"
                          [attr.aria-busy]="documents.isDownloading(document.id)"
                          [attr.aria-label]="
                            (documents.isDownloading(document.id) ? 'Downloading ' : 'Download ') +
                            document.title
                          "
                        >
                          @if (documents.isDownloading(document.id)) {
                            <hlm-spinner />
                          } @else {
                            <ng-icon name="lucideDownload" />
                          }
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        <app-empty-state
          icon="lucideFileText"
          [title]="'documents.empty.title' | translate"
          [description]="'documents.empty.description' | translate"
        />
      }
    </div>
    <app-file-viewer [file]="viewing()" [files]="viewerFiles()" (closed)="viewing.set(null)" />
  `,
})
export class Documents {
  protected readonly documents = inject(DocumentsStore);
  protected readonly viewing = signal<ViewerFile | null>(null);

  /** The listed documents that have a file, in list order. */
  protected readonly viewerFiles = computed<ViewerFile[]>(() =>
    this.documents
      .sorted()
      .filter((d) => !!d.fileName)
      .map((d) => ({ name: d.fileName ?? d.title ?? 'document', key: `document:${d.id}`, load: () => this.documents.fetchBlob(d) })),
  );

  protected view(document: StudentDocumentDto): void {
    if (!document.fileName) return;
    this.viewing.set(this.viewerFiles().find((f) => f.key === `document:${document.id}`) ?? null);
  }
}
