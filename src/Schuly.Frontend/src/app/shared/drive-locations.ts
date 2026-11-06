import { TranslatePipe } from '@ngx-translate/core';
import { t } from '../core/i18n';
import { Component, computed, inject, signal } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideChevronRight, lucideClock, lucideHardDrive, lucideHash, lucideShare2, lucideUsers } from '@ng-icons/lucide';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { DriveLocation, sameLocation } from '../core/drive-location';
import { DriveNavigation } from '../core/drive-navigation';
import { DriveChannel, DriveTeam, DriveTeams } from '../core/drive-teams';

const ITEM =
  'focus-visible:outline-ring hover:bg-muted flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm focus-visible:outline-2 aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground aria-[current=page]:font-medium';

/**
 * Chooses where the Drive page looks: My files, Shared with me, Recent and each team with its channels.
 * A list on wide screens (teams expand to their channels), selects on narrow ones. Teams are optional: when they cannot be loaded
 * the first three places still work.
 */
@Component({
  selector: 'app-drive-locations',
  imports: [TranslatePipe, HlmSelectImports, NgIcon],
  providers: [provideIcons({ lucideChevronDown, lucideChevronRight, lucideClock, lucideHardDrive, lucideHash, lucideShare2, lucideUsers })],
  host: { class: 'block' },
  template: `
    <div class="flex flex-wrap items-center gap-2 lg:hidden">
      <label for="drive-location" class="sr-only">{{ 'files.location' | translate }}</label>
      <hlm-select [value]="placeKey()" [itemToString]="placeLabel" (valueChange)="choosePlace($event)">
        <hlm-select-trigger buttonId="drive-location" class="min-w-44">
          <hlm-select-value />
        </hlm-select-trigger>
        <hlm-select-content *hlmSelectPortal>
          <hlm-select-group>
            <hlm-select-item value="mine">{{ 'files.mine' | translate }}</hlm-select-item>
            <hlm-select-item value="shared">{{ 'files.shared' | translate }}</hlm-select-item>
            <hlm-select-item value="recent">{{ 'files.recent' | translate }}</hlm-select-item>
            @if (nav.location().kind === 'folder') {
              <hlm-select-item value="folder">{{ nav.rootLabel() }}</hlm-select-item>
            }
            @for (team of teams.teams(); track team.id) {
              <hlm-select-item [value]="'team:' + team.id">{{ team.displayName }}</hlm-select-item>
            }
          </hlm-select-group>
        </hlm-select-content>
      </hlm-select>
      @if (currentTeam(); as team) {
        <label for="drive-channel" class="sr-only">{{ 'files.channelOf' | translate: { team: team.displayName } }}</label>
        <hlm-select [value]="channelKey()" [itemToString]="channelLabel" (valueChange)="chooseChannel(team, $event)">
          <hlm-select-trigger buttonId="drive-channel" class="min-w-44">
            <hlm-select-value />
          </hlm-select-trigger>
          <hlm-select-content *hlmSelectPortal>
            <hlm-select-group>
              <hlm-select-item value="all">{{ 'files.allFiles' | translate }}</hlm-select-item>
              @for (channel of channelsOf(team.id); track channel.id) {
                <hlm-select-item [value]="'channel:' + channel.id">{{ channel.displayName }}</hlm-select-item>
              }
            </hlm-select-group>
          </hlm-select-content>
        </hlm-select>
      }
    </div>

    <nav [attr.aria-label]="'files.locations' | translate" class="hidden lg:block">
      <ul class="flex flex-col gap-0.5">
        <li>
          <button type="button" [class]="item" [attr.aria-current]="isCurrent({ kind: 'mine' })" (click)="nav.goTo({ kind: 'mine' })">
            <ng-icon name="lucideHardDrive" size="16" class="shrink-0" aria-hidden="true" />
            {{ 'files.mine' | translate }}
          </button>
        </li>
        <li>
          <button type="button" [class]="item" [attr.aria-current]="isCurrent({ kind: 'shared' })" (click)="nav.goTo({ kind: 'shared' })">
            <ng-icon name="lucideShare2" size="16" class="shrink-0" aria-hidden="true" />
            {{ 'files.shared' | translate }}
          </button>
        </li>
        <li>
          <button type="button" [class]="item" [attr.aria-current]="isCurrent({ kind: 'recent' })" (click)="nav.goTo({ kind: 'recent' })">
            <ng-icon name="lucideClock" size="16" class="shrink-0" aria-hidden="true" />
            {{ 'files.recent' | translate }}
          </button>
        </li>
        @if (nav.location().kind === 'folder') {
          <li>
            <button type="button" [class]="item" aria-current="page">
              <ng-icon name="lucideHardDrive" size="16" class="shrink-0" aria-hidden="true" />
              <span class="truncate">{{ nav.rootLabel() }}</span>
            </button>
          </li>
        }
      </ul>

      @if (teams.teams().length || teams.state() === 'loading' || teams.state() === 'failed') {
        <h2 class="text-muted-foreground mt-4 mb-1 px-2 text-xs font-medium">{{ 'files.teams' | translate }}</h2>
      }
      @if (teams.state() === 'failed') {
        <p class="text-muted-foreground px-2 text-xs">
          {{ 'files.teamsFailed' | translate }}
          <button type="button" class="underline" (click)="teams.reload()">{{ 'common.retry' | translate }}</button>
        </p>
      }
      <ul class="flex flex-col gap-0.5">
        @for (team of teams.teams(); track team.id) {
          <li>
            <button
              type="button"
              [class]="item"
              [attr.aria-current]="isTeamRoot(team)"
              [attr.aria-expanded]="isOpen(team.id)"
              (click)="pickTeam(team)"
            >
              <ng-icon [name]="isOpen(team.id) ? 'lucideChevronDown' : 'lucideChevronRight'" size="16" class="shrink-0" aria-hidden="true" />
              <span class="truncate" [attr.title]="team.displayName">{{ team.displayName }}</span>
            </button>
            @if (isOpen(team.id)) {
              @let list = teams.channels()[team.id];
              <ul class="ml-4 flex flex-col gap-0.5 border-l pl-1" [attr.aria-label]="'files.channelsOf' | translate: { team: team.displayName }">
                @if (!list || list.state === 'loading') {
                  <li class="text-muted-foreground px-2 py-1 text-xs" role="status">{{ 'files.loadingChannels' | translate }}</li>
                } @else if (list.state === 'failed') {
                  <li class="text-muted-foreground px-2 py-1 text-xs">
                    {{ 'files.channelsFailed' | translate }}
                    <button type="button" class="underline" (click)="teams.loadChannels(team.id)">{{ 'common.retry' | translate }}</button>
                  </li>
                }
                @for (channel of list?.items ?? []; track channel.id) {
                  <li>
                    <button type="button" [class]="item" [attr.aria-current]="isChannel(team, channel)" (click)="pickChannel(team, channel)">
                      <ng-icon name="lucideHash" size="16" class="shrink-0" aria-hidden="true" />
                      <span class="truncate" [attr.title]="channel.displayName">{{ channel.displayName }}</span>
                    </button>
                  </li>
                }
              </ul>
            }
          </li>
        }
      </ul>
    </nav>
  `,
})
export class DriveLocations {
  protected readonly nav = inject(DriveNavigation);
  protected readonly teams = inject(DriveTeams);
  protected readonly item = ITEM;
  private readonly expanded = signal<Set<string>>(new Set());

  /** The team of the open location, if it is one. */
  protected readonly currentTeam = computed<DriveTeam | null>(() => {
    const location = this.nav.location();
    return location.kind === 'team' ? { id: location.teamId, displayName: location.teamName } : null;
  });

  protected readonly placeKey = computed(() => {
    const location = this.nav.location();
    return location.kind === 'team' ? `team:${location.teamId}` : location.kind;
  });

  protected readonly channelKey = computed(() => {
    const location = this.nav.location();
    return location.kind === 'team' && location.channelId ? `channel:${location.channelId}` : 'all';
  });

  protected readonly placeLabel = (key: string): string => {
    if (key === 'mine') return t('files.mine');
    if (key === 'shared') return t('files.shared');
    if (key === 'recent') return t('files.recent');
    if (key === 'folder') return this.nav.rootLabel();
    const team = this.teams.teams().find((t) => `team:${t.id}` === key);
    const location = this.nav.location();
    return team?.displayName ?? (location.kind === 'team' ? location.teamName : key);
  };

  protected readonly channelLabel = (key: string): string => {
    if (key === 'all') return t('files.allFiles');
    const location = this.nav.location();
    if (location.kind === 'team') {
      const channel = this.channelsOf(location.teamId).find((c) => `channel:${c.id}` === key);
      return channel?.displayName ?? location.channelName ?? key;
    }
    return key;
  };

  protected channelsOf(teamId: string): DriveChannel[] {
    return this.teams.channels()[teamId]?.items ?? [];
  }

  protected isCurrent(location: DriveLocation): 'page' | null {
    return sameLocation(this.nav.location(), location) ? 'page' : null;
  }

  protected isTeamRoot(team: DriveTeam): 'page' | null {
    const location = this.nav.location();
    return location.kind === 'team' && location.teamId === team.id && !location.channelId ? 'page' : null;
  }

  protected isChannel(team: DriveTeam, channel: DriveChannel): 'page' | null {
    const location = this.nav.location();
    return location.kind === 'team' && location.teamId === team.id && location.channelId === channel.id ? 'page' : null;
  }

  protected isOpen(teamId: string): boolean {
    return this.expanded().has(teamId);
  }

  /** Opens a team's files and unfolds its channels; pressing the open team again folds them. */
  protected pickTeam(team: DriveTeam): void {
    if (this.isOpen(team.id) && this.isTeamRoot(team)) {
      this.expanded.update((set) => new Set([...set].filter((id) => id !== team.id)));
      return;
    }
    this.showTeam(team);
  }

  private showTeam(team: DriveTeam): void {
    this.expanded.update((set) => new Set([...set, team.id]));
    this.teams.loadChannels(team.id);
    this.nav.goTo({ kind: 'team', teamId: team.id, teamName: team.displayName });
  }

  protected pickChannel(team: DriveTeam, channel: DriveChannel): void {
    this.nav.goTo({ kind: 'team', teamId: team.id, teamName: team.displayName, channelId: channel.id, channelName: channel.displayName });
  }

  protected choosePlace(key: string | null | undefined): void {
    if (!key) return;
    if (key === 'mine' || key === 'shared' || key === 'recent') return this.nav.goTo({ kind: key });
    const team = this.teams.teams().find((t) => `team:${t.id}` === key);
    if (team) this.showTeam(team);
  }

  protected chooseChannel(team: DriveTeam, key: string | null | undefined): void {
    if (!key) return;
    const channel = this.channelsOf(team.id).find((c) => `channel:${c.id}` === key);
    this.nav.goTo(
      channel
        ? { kind: 'team', teamId: team.id, teamName: team.displayName, channelId: channel.id, channelName: channel.displayName }
        : { kind: 'team', teamId: team.id, teamName: team.displayName },
    );
  }
}
