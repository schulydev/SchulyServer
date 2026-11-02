import { Component, computed, input, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowDown, lucideArrowUp, lucideArrowUpDown } from '@ng-icons/lucide';
import type { Sheet } from './csv';

export const MAX_RENDERED_ROWS = 2000;
const MAX_COLUMNS = 200;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Read-only sortable table for CSV/TSV files and spreadsheets. The first row is the header. */
@Component({
  selector: 'app-viewer-table',
  imports: [NgIcon],
  providers: [provideIcons({ lucideArrowDown, lucideArrowUp, lucideArrowUpDown })],
  template: `
    @if (sheets().length > 1) {
      <div class="bg-background flex items-center gap-2 border-b px-4 py-2 text-sm">
        <label for="viewer-sheet" class="text-muted-foreground">Sheet</label>
        <select
          id="viewer-sheet"
          class="border-input bg-background text-foreground focus-visible:ring-ring/50 h-8 rounded-md border px-2 focus-visible:ring-[3px] focus-visible:outline-none"
          (change)="pick($any($event.target).selectedIndex)"
        >
          @for (s of sheets(); track $index) {
            <option [selected]="$index === index()">{{ s.name }}</option>
          }
        </select>
      </div>
    }
    @if (columns().length) {
      <div class="bg-background min-h-0 flex-1 overflow-auto" tabindex="0" data-viewer-keys [attr.aria-label]="'Table of ' + label()">
        <table class="w-max min-w-full border-separate border-spacing-0 text-sm">
          <caption class="sr-only">
            {{ label() }}
          </caption>
          <thead>
            <tr>
              @for (c of columns(); track $index) {
                <th scope="col" class="bg-muted sticky top-0 z-10 border-b p-0 text-left font-medium whitespace-nowrap" [attr.aria-sort]="ariaSort($index)">
                  <button
                    type="button"
                    class="hover:bg-accent focus-visible:ring-ring/50 flex w-full items-center gap-1.5 px-3 py-2 text-left focus-visible:ring-[3px] focus-visible:outline-none focus-visible:ring-inset"
                    (click)="sortBy($index)"
                  >
                    {{ c || 'Column ' + ($index + 1) }}
                    <ng-icon [name]="icon($index)" class="text-muted-foreground shrink-0" aria-hidden="true" />
                  </button>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of shown(); track $index) {
              <tr class="even:bg-muted/30">
                @for (c of columns(); track $index) {
                  <td class="max-w-96 truncate border-b px-3 py-1.5 whitespace-nowrap" [attr.title]="row[$index]">{{ row[$index] }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (note(); as n) {
        <p class="text-muted-foreground bg-background border-t px-4 py-2 text-xs" role="status">{{ n }}</p>
      }
    } @else {
      <p class="text-muted-foreground m-auto text-sm">This file has no rows.</p>
    }
  `,
})
export class ViewerTable {
  readonly sheets = input.required<Sheet[]>();
  readonly label = input('file');

  protected readonly index = signal(0);
  private readonly sortCol = signal<number | null>(null);
  private readonly sortDesc = signal(false);

  private readonly sheet = computed(() => this.sheets()[Math.min(this.index(), this.sheets().length - 1)]);
  protected readonly columns = computed(() => (this.sheet()?.rows[0] ?? []).slice(0, MAX_COLUMNS));
  private readonly body = computed(() => this.sheet()?.rows.slice(1) ?? []);
  private readonly sorted = computed(() => {
    const col = this.sortCol();
    const rows = this.body();
    if (col === null) return rows;
    const dir = this.sortDesc() ? -1 : 1;
    return [...rows].sort((a, b) => dir * collator.compare(a[col] ?? '', b[col] ?? ''));
  });
  protected readonly shown = computed(() => this.sorted().slice(0, MAX_RENDERED_ROWS));
  protected readonly note = computed(() => {
    const total = this.body().length;
    if (total > MAX_RENDERED_ROWS) return `Showing the first ${MAX_RENDERED_ROWS} of ${total}${this.sheet()?.truncated ? '+' : ''} rows. Download the file to see all of it.`;
    return this.sheet()?.truncated ? 'Only the first rows of this file are shown. Download the file to see all of it.' : null;
  });

  protected pick(i: number): void {
    this.index.set(i);
    this.sortCol.set(null);
  }

  protected sortBy(col: number): void {
    if (this.sortCol() !== col) {
      this.sortCol.set(col);
      this.sortDesc.set(false);
    } else if (!this.sortDesc()) this.sortDesc.set(true);
    else this.sortCol.set(null);
  }

  protected ariaSort(col: number): 'ascending' | 'descending' | 'none' {
    return this.sortCol() !== col ? 'none' : this.sortDesc() ? 'descending' : 'ascending';
  }

  protected icon(col: number): string {
    return this.sortCol() !== col ? 'lucideArrowUpDown' : this.sortDesc() ? 'lucideArrowDown' : 'lucideArrowUp';
  }
}
