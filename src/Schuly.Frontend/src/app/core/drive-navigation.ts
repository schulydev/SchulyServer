import { t } from '../core/i18n';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { DriveEntry, DriveStore } from '../stores/capability-data.store';
import { LinkedAccountsStore } from '../stores/linked-accounts.store';
import { DriveLocation, DriveView, enterFolder, locationLabel, restoreLocation, truncateTrail } from './drive-location';
import { DriveSearch } from './drive-search';
import { persistedChoice } from './persisted';

const REMEMBERED = ['mine', 'shared', 'recent'] as const;

type FolderRef = Pick<DriveEntry, 'id' | 'name' | 'driveId'>;

/**
 * Where the Drive page is: a location and the folders opened in it, shared by the Schuly and Explorer views and the switcher.
 * Drives the store's listing; moving anywhere clears the search field.
 */
@Injectable()
export class DriveNavigation {
  private readonly store = inject(DriveStore);
  private readonly accounts = inject(LinkedAccountsStore);
  private readonly search = inject(DriveSearch);
  private readonly remembered = persistedChoice<(typeof REMEMBERED)[number]>('schuly.drive.location', REMEMBERED, 'mine');

  readonly view = signal<DriveView>({ location: restoreLocation(this.remembered.value()), trail: [] });
  readonly location = computed(() => this.view().location);
  readonly trail = computed(() => this.view().trail);
  readonly rootLabel = computed(() => locationLabel(this.location()));

  /** Text for an empty folder of the current location. */
  readonly emptyText = computed(() => {
    switch (this.location().kind) {
      case 'shared':
        return t('files.empty.shared');
      case 'recent':
        return t('files.empty.recent');
      case 'team':
        return t('files.empty.team');
      default:
        return t('files.empty.drive');
    }
  });

  constructor() {
    effect(() => {
      const view = this.view();
      untracked(() => this.store.openView(view));
    });
    // Another account starts over at My files.
    let account: string | null | undefined;
    effect(() => {
      const id = this.accounts.selectedId('drive');
      untracked(() => {
        if (account !== undefined && account !== id) this.goTo({ kind: 'mine' });
        account = id;
      });
    });
  }

  goTo(location: DriveLocation): void {
    this.view.set({ location, trail: [] });
    this.search.query.set('');
    if (location.kind === 'mine' || location.kind === 'shared' || location.kind === 'recent') this.remembered.set(location.kind);
  }

  /** Back to the first `depth` folders of the trail (0 is the location itself). */
  goToDepth(depth: number): void {
    this.view.update((v) => truncateTrail(v, depth));
    this.search.query.set('');
  }

  /** The view after opening a folder entry, or null when it cannot be opened in place. */
  viewAfter(entry: FolderRef): DriveView | null {
    return enterFolder(this.view(), entry);
  }

  /** Opens a folder entry of the listing; returns false when it has to be opened elsewhere. */
  enter(entry: FolderRef): boolean {
    const next = this.viewAfter(entry);
    if (!next) return false;
    this.view.set(next);
    this.search.query.set('');
    return true;
  }

  /** Opens a folder found by search as its own location. */
  openFound(entry: FolderRef): void {
    if (entry.driveId) this.goTo({ kind: 'folder', driveId: entry.driveId, itemId: entry.id, name: entry.name });
  }

  up(): void {
    if (this.trail().length) this.goToDepth(this.trail().length - 1);
  }

  prefetch(entry: FolderRef): void {
    const next = this.viewAfter(entry);
    if (next) this.store.prefetchView(next);
  }
}
