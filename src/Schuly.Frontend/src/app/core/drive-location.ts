import { t } from '../core/i18n';
/**
 * Where the Drive page is looking and how a place maps to a listing request. Ids of teams, channels, drives and items are opaque
 * strings from the plugin: they are passed back verbatim (encoded into paths) and never parsed.
 */
export type DriveLocation =
  | { kind: 'mine' }
  | { kind: 'shared' }
  | { kind: 'recent' }
  | { kind: 'team'; teamId: string; teamName: string; channelId?: string; channelName?: string }
  | { kind: 'folder'; driveId: string; itemId: string; name: string };

/** One folder of the breadcrumb below the location. Own OneDrive folders go by name, every other location by drive and item id. */
export interface Crumb {
  name: string;
  driveId: string | null;
  itemId: string | null;
}

/** A location and the folders opened inside it. */
export interface DriveView {
  location: DriveLocation;
  trail: Crumb[];
}

export const MINE_ROOT: DriveView = { location: { kind: 'mine' }, trail: [] };

type QueryValue = string | number | boolean;

export interface Listing {
  /** Route below the account's drive endpoint. */
  path: string;
  query: Record<string, QueryValue>;
  /** `array`: the body is the list. `items`: the body is `{ items: [...] }` (team files). */
  shape: 'array' | 'items';
}

/** The `path` parameter of an own-OneDrive folder given as the names from the drive root. */
export const drivePath = (names: string[]): string => (names.length ? `root:/${names.map(encodeURIComponent).join('/')}:` : 'root');

const childrenOf = (driveId: string, itemId: string): Listing => ({
  path: `drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children`,
  query: {},
  shape: 'array',
});

/** The request that lists the folder a view shows. */
export function listingOf(view: DriveView): Listing {
  const { location, trail } = view;
  if (location.kind === 'mine') return { path: 'files', query: { path: drivePath(trail.map((c) => c.name)) }, shape: 'array' };
  const last = trail.at(-1);
  if (last?.driveId && last.itemId) return childrenOf(last.driveId, last.itemId);
  switch (location.kind) {
    case 'shared':
      return { path: 'files/shared', query: {}, shape: 'array' };
    case 'recent':
      return { path: 'files/recent', query: {}, shape: 'array' };
    case 'team':
      return {
        path: `teams/${encodeURIComponent(location.teamId)}/files`,
        query: location.channelId ? { channelId: location.channelId } : {},
        shape: 'items',
      };
    case 'folder':
      return childrenOf(location.driveId, location.itemId);
  }
}

/** A short name for the root of a location. */
export function locationLabel(location: DriveLocation): string {
  switch (location.kind) {
    case 'mine':
      return t('files.mine');
    case 'shared':
      return t('files.shared');
    case 'recent':
      return t('files.recent');
    case 'team':
      return location.channelName ? `${location.teamName} > ${location.channelName}` : location.teamName;
    case 'folder':
      return location.name;
  }
}

export function sameLocation(a: DriveLocation, b: DriveLocation): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'team' && b.kind === 'team') return a.teamId === b.teamId && (a.channelId ?? null) === (b.channelId ?? null);
  if (a.kind === 'folder' && b.kind === 'folder') return a.driveId === b.driveId && a.itemId === b.itemId;
  return true;
}

/** The view after opening a folder entry, or null when the folder cannot be addressed (a non-OneDrive folder without a drive id). */
export function enterFolder(view: DriveView, entry: { id: string; name: string; driveId: string | null }): DriveView | null {
  if (view.location.kind === 'mine') {
    return { ...view, trail: [...view.trail, { name: entry.name, driveId: null, itemId: entry.id }] };
  }
  if (!entry.driveId) return null;
  return { ...view, trail: [...view.trail, { name: entry.name, driveId: entry.driveId, itemId: entry.id }] };
}

/** The view with only the first `depth` folders of its trail. */
export function truncateTrail(view: DriveView, depth: number): DriveView {
  return { ...view, trail: view.trail.slice(0, Math.max(0, depth)) };
}

export const serializeView = (view: DriveView): string => JSON.stringify(view);

export function parseView(raw: unknown): DriveView {
  if (typeof raw !== 'string') return MINE_ROOT;
  try {
    const value = JSON.parse(raw) as DriveView;
    return value?.location?.kind && Array.isArray(value.trail) ? value : MINE_ROOT;
  } catch {
    return MINE_ROOT;
  }
}

/** The location remembered per browser: only the places that need no ids. Anything else starts at My files. */
export function restoreLocation(stored: string | null): DriveLocation {
  return stored === 'shared' || stored === 'recent' ? { kind: stored } : { kind: 'mine' };
}
