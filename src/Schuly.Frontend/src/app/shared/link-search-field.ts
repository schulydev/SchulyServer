import { Component, ElementRef, computed, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowLeft, lucideSearch } from '@ng-icons/lucide';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { LinkOptionDto } from '../core/linking-api';
import { filterSearchOptions, searchOption } from '../core/linking-step';

/**
 * A select field that also takes a typed value: a search box over the options (name, tag and address of each),
 * plus "Not in the list" to type the value by hand.
 */
@Component({
  selector: 'app-link-search-field',
  imports: [NgIcon, HlmButton, HlmInput],
  providers: [provideIcons({ lucideArrowLeft, lucideSearch })],
  host: { class: 'flex flex-col gap-1.5' },
  template: `
    @if (manual()) {
      <input
        hlmInput
        [id]="inputId()"
        type="url"
        inputmode="url"
        autocomplete="off"
        spellcheck="false"
        autocapitalize="none"
        class="h-10"
        [attr.data-autofocus]="autofocus() ? '' : null"
        [attr.placeholder]="placeholder() || null"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [attr.aria-describedby]="describedBy()"
        [value]="value()"
        (input)="valueChange.emit($any($event.target).value)"
      />
      <button hlmBtn type="button" variant="link" class="text-muted-foreground self-start px-0" (click)="leaveManual()">
        <ng-icon name="lucideArrowLeft" aria-hidden="true" /> Back to the list
      </button>
    } @else {
      <div class="relative">
        <ng-icon name="lucideSearch" aria-hidden="true" class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          hlmInput
          [id]="inputId()"
          type="text"
          role="combobox"
          autocomplete="off"
          spellcheck="false"
          class="h-10 pl-9"
          aria-autocomplete="list"
          aria-expanded="true"
          [attr.aria-controls]="listId()"
          [attr.aria-activedescendant]="activeId()"
          [attr.data-autofocus]="autofocus() ? '' : null"
          [attr.aria-invalid]="invalid() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          placeholder="Search"
          [value]="query()"
          (input)="search($any($event.target).value)"
          (keydown)="onKey($event)"
        />
      </div>
      <div class="max-h-72 overflow-y-auto rounded-lg border p-1" role="listbox" [id]="listId()" [attr.aria-label]="label()">
        <p class="text-muted-foreground px-2.5 pt-1.5 pb-0.5 text-xs" aria-live="polite">{{ hits().length }} of {{ options().length }}</p>
        @for (option of hits(); track option.value; let i = $index) {
          <div
            role="option"
            [id]="optionId(i)"
            [attr.aria-selected]="option.value === value()"
            class="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 rounded-md px-2.5 py-2"
            [class.bg-muted]="i === active() && option.value !== value()"
            [class.bg-primary/10]="option.value === value()"
            (mousedown)="$event.preventDefault()"
            (click)="pick(option.value)"
            (mouseenter)="active.set(i)"
          >
            <span class="text-sm font-medium [overflow-wrap:anywhere]">{{ option.name }}</span>
            @if (option.tag) {
              <span class="bg-muted text-muted-foreground self-start rounded-md px-1.5 py-px text-xs font-semibold">{{ option.tag }}</span>
            }
            @if (option.address) {
              <span class="text-muted-foreground col-span-2 text-xs [overflow-wrap:anywhere]">{{ option.address }}</span>
            }
          </div>
        }
        <div
          role="option"
          [id]="optionId(hits().length)"
          aria-selected="false"
          class="flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2"
          [class.bg-muted]="active() === hits().length"
          (mousedown)="$event.preventDefault()"
          (click)="enterManual()"
          (mouseenter)="active.set(hits().length)"
        >
          <span class="text-primary text-sm font-medium">Not in the list</span>
          <span class="text-muted-foreground text-xs">Enter the address yourself</span>
        </div>
      </div>
    }
  `,
})
export class LinkSearchField {
  readonly inputId = input.required<string>();
  readonly label = input('');
  readonly options = input<LinkOptionDto[]>([]);
  readonly value = input('');
  readonly placeholder = input<string | null>(null);
  readonly describedBy = input<string | null>(null);
  readonly invalid = input(false);
  readonly autofocus = input(false);
  readonly valueChange = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly all = computed(() => this.options().map(searchOption));
  /** Typed by hand when the current value is not one of the options. */
  protected readonly manual = linkedSignal<LinkOptionDto[], boolean>({
    source: this.options,
    computation: (options) => untracked(() => !!this.value() && !options.some((o) => o.value === this.value())),
  });
  protected readonly query = signal('');
  protected readonly hits = computed(() => filterSearchOptions(this.all(), this.query()));
  protected readonly active = linkedSignal<number>(() => Math.max(0, this.hits().findIndex((o) => o.value === this.value())));
  protected readonly listId = computed(() => `${this.inputId()}-list`);
  protected readonly activeId = computed(() => this.optionId(this.active()));

  protected optionId(index: number): string {
    return `${this.inputId()}-option-${index}`;
  }

  protected search(query: string): void {
    this.query.set(query);
    this.active.set(0);
  }

  protected pick(value: string): void {
    this.valueChange.emit(value);
  }

  protected onKey(event: KeyboardEvent): void {
    const last = this.hits().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.active.update((i) => Math.min(last, Math.max(0, i + (event.key === 'ArrowDown' ? 1 : -1))));
      this.host.nativeElement.querySelector(`#${CSS.escape(this.activeId())}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const index = this.active();
      if (index === last) this.enterManual();
      else if (this.hits()[index]) this.pick(this.hits()[index].value);
    }
  }

  protected enterManual(): void {
    this.manual.set(true);
    this.valueChange.emit('');
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLInputElement>('input')?.focus());
  }

  protected leaveManual(): void {
    this.manual.set(false);
    this.valueChange.emit('');
    queueMicrotask(() => this.host.nativeElement.querySelector<HTMLInputElement>('input')?.focus());
  }
}
