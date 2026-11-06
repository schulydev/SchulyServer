import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, ElementRef, Injector, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucidePaperclip, lucideSend, lucideX } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { RecipientInput } from '../shared/recipient-input';
import { ActionResult, MAX_ATTACHMENT_BYTES, MailClient, MailDetail, OutgoingMail, safeFileName } from '../stores/mail-client';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

interface Picked {
  name: string;
  contentType: string;
  size: number;
  contentBase64: string;
}

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const toBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

/** New message, reply, reply all or forward. Replies only need a comment; the server quotes the original. */
@Component({
  selector: 'app-mail-compose',
  imports: [TranslatePipe, HlmButton, NgIcon, RecipientInput],
  providers: [provideIcons({ lucidePaperclip, lucideSend, lucideX })],
  template: `
    <form class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 lg:p-6" (submit)="submit($event)" aria-labelledby="compose-title">
      <div class="flex items-center justify-between gap-2">
        <h3 id="compose-title" #title tabindex="-1" class="min-w-0 truncate text-lg font-semibold outline-none">{{ heading() }}</h3>
        <button hlmBtn type="button" variant="ghost" size="sm" (click)="cancel.emit()">
          <ng-icon name="lucideX" aria-hidden="true" />
          {{ 'chat.discard' | translate }}
        </button>
      </div>

      @if (isReply()) {
        <p class="text-muted-foreground min-w-0 truncate text-sm">
          {{ 'mail.toList' | translate: { list: replyTo() } }}
        </p>
      } @else {
        <div class="flex flex-col gap-1">
          <div class="flex items-start gap-2">
            <label for="compose-to" class="w-12 shrink-0 pt-2 text-sm font-medium">{{ 'mail.to' | translate }}</label>
            <app-recipient-input #toField class="min-w-0 flex-1" inputId="compose-to" [label]="'mail.to' | translate" [(value)]="to" />
            @if (mode() === 'new') {
              <button hlmBtn type="button" variant="ghost" size="sm" [attr.aria-expanded]="showCc()" (click)="showCc.set(!showCc())">Cc / Bcc</button>
            }
          </div>
          @if (showCc()) {
            <div class="flex items-start gap-2">
              <label for="compose-cc" class="w-12 shrink-0 pt-2 text-sm font-medium">Cc</label>
              <app-recipient-input #ccField class="min-w-0 flex-1" inputId="compose-cc" label="Cc" [(value)]="cc" />
            </div>
            <div class="flex items-start gap-2">
              <label for="compose-bcc" class="w-12 shrink-0 pt-2 text-sm font-medium">Bcc</label>
              <app-recipient-input #bccField class="min-w-0 flex-1" inputId="compose-bcc" label="Bcc" [(value)]="bcc" />
            </div>
          }
        </div>
      }

      @if (mode() === 'new') {
        <div class="flex items-center gap-2">
          <label for="compose-subject" class="w-12 shrink-0 text-sm font-medium">{{ 'mail.subject' | translate }}</label>
          <input
            id="compose-subject"
            type="text"
            maxlength="255"
            class="bg-background focus-visible:border-ring focus-visible:ring-ring/30 h-9 min-w-0 flex-1 rounded-md border px-3 text-sm outline-none focus-visible:ring-3"
            [value]="subject()"
            (input)="subject.set($any($event.target).value)"
          />
        </div>
      }

      <label for="compose-body" class="sr-only">{{ isReply() ? ('mail.yourReply' | translate) : ('mail.message' | translate) }}</label>
      <textarea
        id="compose-body"
        class="bg-background focus-visible:border-ring focus-visible:ring-ring/30 min-h-48 w-full min-w-0 flex-1 resize-y rounded-md border p-3 text-sm leading-6 outline-none focus-visible:ring-3"
        [attr.placeholder]="isReply() ? ('mail.writeReply' | translate) : ('mail.writeMessage' | translate)"
        [value]="body()"
        (input)="body.set($any($event.target).value)"
      ></textarea>

      @if (mode() === 'new') {
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap items-center gap-3">
            <input #files id="compose-files" type="file" multiple [attr.aria-label]="'chat.composer.attach' | translate" class="sr-only" tabindex="-1" (change)="pick($event)" />
            <button hlmBtn type="button" variant="outline" size="sm" (click)="files.click()">
              <ng-icon name="lucidePaperclip" aria-hidden="true" />
              {{ 'chat.composer.attach' | translate }}
            </button>
            <span class="text-muted-foreground text-xs">{{ 'mail.sizeOf' | translate: { size: sizeLabel() } }}</span>
          </div>
          @if (attachments().length) {
            <ul class="flex flex-wrap gap-2" [attr.aria-label]="'mail.attachments' | translate">
              @for (file of attachments(); track file.name + file.size) {
                <li class="bg-muted flex max-w-full items-center gap-1 rounded-md py-1 ps-2.5 pe-1 text-sm">
                  <span class="min-w-0 truncate">{{ file.name }}</span>
                  <span class="text-muted-foreground shrink-0 text-xs">{{ size(file.size) }}</span>
                  <button type="button" class="hover:bg-foreground/10 focus-visible:outline-ring flex size-6 shrink-0 items-center justify-center rounded focus-visible:outline-2" (click)="removeFile(file)">
                    <ng-icon name="lucideX" class="text-xs" aria-hidden="true" />
                    <span class="sr-only">{{ 'common.removeName' | translate: { name: file.name } }}</span>
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      }

      @if (error(); as text) {
        <p class="text-destructive text-sm" role="alert">{{ text }}</p>
      }

      <div class="flex flex-wrap items-center gap-2">
        <button hlmBtn type="submit" [disabled]="busy()">
          <ng-icon name="lucideSend" aria-hidden="true" />
          {{ busy() ? ('chat.composer.sending' | translate) : ('common.send' | translate) }}
        </button>
        @if (mode() === 'new') {
          <button hlmBtn type="button" variant="outline" [disabled]="busy()" (click)="draft()">{{ 'mail.saveDraft' | translate }}</button>
        }
      </div>
    </form>
  `,
  host: { class: 'flex min-h-0 min-w-0 flex-1 flex-col' },
})
export class MailCompose {
  private readonly client = inject(MailClient);
  private readonly injector = inject(Injector);

  readonly mode = input.required<ComposeMode>();
  readonly source = input<MailDetail | null>(null);
  readonly done = output<string>();
  readonly cancel = output<void>();

  private readonly titleEl = viewChild<ElementRef<HTMLElement>>('title');
  private readonly toField = viewChild<RecipientInput>('toField');
  private readonly ccField = viewChild<RecipientInput>('ccField');
  private readonly bccField = viewChild<RecipientInput>('bccField');

  protected readonly to = signal<string[]>([]);
  protected readonly cc = signal<string[]>([]);
  protected readonly bcc = signal<string[]>([]);
  protected readonly showCc = signal(false);
  protected readonly subject = signal('');
  protected readonly body = signal('');
  protected readonly attachments = signal<Picked[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly size = formatSize;
  protected readonly isReply = computed(() => this.mode() === 'reply' || this.mode() === 'replyAll');
  protected readonly total = computed(() => this.attachments().reduce((sum, f) => sum + f.size, 0));
  protected readonly sizeLabel = computed(() => formatSize(this.total()));
  protected readonly replyTo = computed(() => {
    const s = this.source();
    if (!s) return '';
    const all = this.mode() === 'replyAll' ? [...s.to, ...s.cc].map((p) => p.name) : [];
    return [s.from?.name ?? t('mail.sender'), ...all].join(', ');
  });
  protected readonly heading = computed(() => {
    const subject = this.source()?.subject ?? '';
    switch (this.mode()) {
      case 'reply':
        return t('mail.heading.reply', { subject });
      case 'replyAll':
        return t('mail.heading.replyAll', { subject });
      case 'forward':
        return t('mail.heading.forward', { subject });
      default:
        return t('mail.newMessage');
    }
  });

  constructor() {
    afterNextRender(() => this.titleEl()?.nativeElement.focus(), { injector: this.injector });
  }

  protected async pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    let total = this.total();
    const added: Picked[] = [];
    for (const file of files) {
      if (total + file.size > MAX_ATTACHMENT_BYTES) {
        this.error.set(`${file.name} was not added: attachments can be 3 MB in total.`);
        continue;
      }
      total += file.size;
      added.push({ name: safeFileName(file.name), contentType: file.type || 'application/octet-stream', size: file.size, contentBase64: await toBase64(file) });
      this.error.set(null);
    }
    if (added.length) this.attachments.set([...this.attachments(), ...added]);
  }

  protected removeFile(file: Picked): void {
    this.attachments.set(this.attachments().filter((f) => f !== file));
    this.error.set(null);
  }

  private commitFields(): void {
    this.toField()?.commit();
    this.ccField()?.commit();
    this.bccField()?.commit();
  }

  private outgoing(): OutgoingMail {
    return {
      to: this.to(),
      cc: this.cc(),
      bcc: this.bcc(),
      subject: this.subject().trim(),
      body: this.body(),
      attachments: this.attachments().map(({ name, contentType, contentBase64 }) => ({ name, contentType, contentBase64 })),
    };
  }

  private report(result: ActionResult, success: string): void {
    this.busy.set(false);
    if (result === 'ok') this.done.emit(success);
    else this.error.set(result === 'unavailable' ? t('mail.serverUnavailable') : t('mail.couldNotComplete'));
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    this.commitFields();
    const source = this.source();
    const mode = this.mode();
    if (this.isReply()) {
      if (!source || !this.body().trim()) return this.error.set(t('mail.writeReplyFirst'));
      this.busy.set(true);
      this.report(await this.client.reply(source.id, this.body(), mode === 'replyAll'), t('mail.replySent'));
      return;
    }
    if (!this.to().length) return this.error.set(t('mail.needRecipient'));
    if (mode === 'forward') {
      if (!source) return;
      this.busy.set(true);
      this.report(await this.client.forward(source.id, this.to(), this.body()), t('mail.forwarded'));
      return;
    }
    if (!this.subject().trim() && !this.body().trim()) return this.error.set(t('mail.needContent'));
    this.busy.set(true);
    this.report(await this.client.send(this.outgoing()), t('mail.sent'));
  }

  protected async draft(): Promise<void> {
    this.commitFields();
    if (!this.to().length && !this.cc().length && !this.bcc().length) return this.error.set(t('mail.needRecipientDraft'));
    this.busy.set(true);
    this.report(await this.client.saveDraft(this.outgoing()), t('mail.draftSaved'));
  }
}

