import { TranslatePipe } from '@ngx-translate/core';
import { Component, computed, input, model, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';

const EMAIL = /^[^\s@<>(),;]+@[^\s@<>(),;]+\.[^\s@<>(),;]+$/;

/** Splits pasted or typed text into addresses; accepts "Name <a@b.c>" as well as bare addresses. */
export function parseAddresses(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const part of text.split(/[,;\n]+/)) {
    const raw = part.trim();
    if (!raw) continue;
    const address = raw.match(/<([^>]+)>/)?.[1]?.trim() ?? raw;
    (EMAIL.test(address) ? valid : invalid).push(address);
  }
  return { valid, invalid };
}

/** Recipient field with one removable chip per address. Enter, comma, semicolon or leaving the field turns the text into chips. */
@Component({
  selector: 'app-recipient-input',
  imports: [TranslatePipe, NgIcon],
  providers: [provideIcons({ lucideX })],
  template: `
    <div
      class="bg-background focus-within:border-ring focus-within:ring-ring/30 flex min-h-9 min-w-0 flex-wrap items-center gap-1 rounded-md border px-2 py-1 focus-within:ring-3"
    >
      @for (address of value(); track address) {
        <span class="bg-muted flex max-w-full items-center gap-1 rounded-full py-0.5 ps-2.5 pe-1 text-sm">
          <span class="min-w-0 truncate">{{ address }}</span>
          <button
            type="button"
            class="hover:bg-foreground/10 focus-visible:outline-ring flex size-5 shrink-0 items-center justify-center rounded-full focus-visible:outline-2"
            (click)="remove(address)"
          >
            <ng-icon name="lucideX" class="text-xs" aria-hidden="true" />
            <span class="sr-only">{{ 'common.removeName' | translate: { name: address } }}</span>
          </button>
        </span>
      }
      <input
        [id]="inputId()"
        type="text"
        autocomplete="off"
        class="placeholder:text-muted-foreground min-w-32 flex-1 bg-transparent py-0.5 text-sm outline-none"
        [attr.aria-label]="label()"
        [attr.aria-invalid]="problem() ? 'true' : null"
        [attr.aria-describedby]="problem() ? inputId() + '-problem' : null"
        [value]="draft()"
        (input)="draft.set($any($event.target).value)"
        (keydown)="onKey($event)"
        (blur)="commit()"
        (paste)="onPaste($event)"
      />
    </div>
    @if (problem(); as text) {
      <p [id]="inputId() + '-problem'" class="text-destructive mt-1 text-xs" role="alert">{{ text }}</p>
    }
  `,
  host: { class: 'block min-w-0' },
})
export class RecipientInput {
  readonly value = model<string[]>([]);
  readonly label = input.required<string>();
  readonly inputId = input.required<string>();

  protected readonly draft = signal('');
  protected readonly problem = signal<string | null>(null);
  protected readonly hasDraft = computed(() => this.draft().trim().length > 0);

  protected add(text: string): void {
    const { valid, invalid } = parseAddresses(text);
    if (valid.length) {
      const known = new Set(this.value().map((a) => a.toLowerCase()));
      const fresh = valid.filter((a, i) => !known.has(a.toLowerCase()) && valid.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i);
      if (fresh.length) this.value.set([...this.value(), ...fresh]);
    }
    this.problem.set(invalid.length ? `${invalid.join(', ')} is not a valid email address.` : null);
    this.draft.set(invalid.join(', '));
  }

  /** Called on blur and by the form before sending, so text still typed is not lost. */
  commit(): void {
    if (this.hasDraft()) this.add(this.draft());
    else this.problem.set(null);
  }

  protected remove(address: string): void {
    this.value.set(this.value().filter((a) => a !== address));
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      if (this.hasDraft() || event.key !== 'Enter') event.preventDefault();
      if (this.hasDraft()) this.add(this.draft());
    } else if (event.key === 'Backspace' && !this.draft() && this.value().length) {
      this.value.set(this.value().slice(0, -1));
    }
  }

  protected onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!/[,;\n]/.test(text)) return;
    event.preventDefault();
    this.add(text);
  }
}
