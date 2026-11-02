import { Component, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideDownload, lucideFile, lucideFileSpreadsheet, lucideFileText, lucideImage, lucidePresentation } from '@ng-icons/lucide';
import { formatSize } from '../../core/chat-media';
import { fileIcon } from '../../core/helply-files';
import { HelplyAttachment } from '../../core/helply-types';

/** Files on a message, sent by the user or shared by Helply. Click opens the viewer; the arrow downloads. */
@Component({
  selector: 'app-attachment-cards',
  imports: [NgIcon],
  providers: [provideIcons({ lucideDownload, lucideFile, lucideFileSpreadsheet, lucideFileText, lucideImage, lucidePresentation })],
  host: { class: 'block' },
  template: `
    @if (attachments().length) {
      <ul class="flex flex-wrap gap-2" aria-label="Files">
        @for (file of attachments(); track file.id) {
          <li class="bg-background text-foreground flex max-w-full items-center rounded-lg border">
            <button
              type="button"
              class="hover:bg-accent focus-visible:ring-ring/50 flex min-w-0 items-center gap-2 rounded-l-lg px-2.5 py-1.5 text-left text-xs outline-none focus-visible:ring-3"
              [attr.aria-label]="'Open ' + file.fileName"
              (click)="open.emit(file)"
            >
              <ng-icon [name]="icon(file.fileName)" aria-hidden="true" class="shrink-0 text-base" />
              <span class="flex min-w-0 flex-col">
                <span class="max-w-48 truncate font-medium">{{ file.fileName }}</span>
                <span class="text-muted-foreground">{{ size(file.sizeBytes) }}</span>
              </span>
            </button>
            <button
              type="button"
              class="hover:bg-accent focus-visible:ring-ring/50 self-stretch rounded-r-lg border-l px-2 outline-none focus-visible:ring-3"
              [attr.aria-label]="'Download ' + file.fileName"
              (click)="download.emit(file)"
            >
              <ng-icon name="lucideDownload" aria-hidden="true" />
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class AttachmentCards {
  readonly attachments = input.required<HelplyAttachment[]>();
  readonly open = output<HelplyAttachment>();
  readonly download = output<HelplyAttachment>();

  protected icon(name: string): string {
    return fileIcon(name);
  }

  protected size(bytes: number): string {
    return formatSize(bytes);
  }
}
