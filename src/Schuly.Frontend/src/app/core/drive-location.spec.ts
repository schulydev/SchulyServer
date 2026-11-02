import { describe, expect, it } from 'vitest';
import { DriveView, MINE_ROOT, enterFolder, listingOf, locationLabel, parseView, restoreLocation, sameLocation, serializeView, truncateTrail } from './drive-location';

const team: DriveView = { location: { kind: 'team', teamId: 'T 1', teamName: 'Class', channelId: '19:abc@thread.tacv2', channelName: 'Deutsch' }, trail: [] };

describe('listingOf', () => {
  it('lists own OneDrive by folder names', () => {
    expect(listingOf(MINE_ROOT)).toEqual({ path: 'files', query: { path: 'root' }, shape: 'array' });
    const view = enterFolder(enterFolder(MINE_ROOT, { id: 'a', name: 'School', driveId: null })!, { id: 'b', name: 'Math & Co', driveId: null })!;
    expect(listingOf(view).query).toEqual({ path: 'root:/School/Math%20%26%20Co:' });
  });

  it('maps shared and recent', () => {
    expect(listingOf({ location: { kind: 'shared' }, trail: [] }).path).toBe('files/shared');
    expect(listingOf({ location: { kind: 'recent' }, trail: [] }).path).toBe('files/recent');
  });

  it('lists a team root with its channel and encodes the ids', () => {
    expect(listingOf(team)).toEqual({ path: 'teams/T%201/files', query: { channelId: '19:abc@thread.tacv2' }, shape: 'items' });
    expect(listingOf({ location: { kind: 'team', teamId: 't', teamName: 'n' }, trail: [] }).query).toEqual({});
  });

  it('lists inside a team or shared folder by drive and item id', () => {
    const inside = enterFolder(team, { id: 'i/1', name: 'Tests', driveId: 'b!x' })!;
    expect(listingOf(inside).path).toBe('drives/b!x/items/i%2F1/children');
    const shared = enterFolder({ location: { kind: 'shared' }, trail: [] }, { id: 'i', name: 'F', driveId: 'd' })!;
    expect(listingOf(shared).path).toBe('drives/d/items/i/children');
  });

  it('lists an opened search folder from its own ids, deeper ones from the trail', () => {
    const view: DriveView = { location: { kind: 'folder', driveId: 'd1', itemId: 'f1', name: 'X' }, trail: [] };
    expect(listingOf(view).path).toBe('drives/d1/items/f1/children');
    expect(listingOf(enterFolder(view, { id: 'f2', name: 'Y', driveId: 'd1' })!).path).toBe('drives/d1/items/f2/children');
  });
});

describe('navigation', () => {
  it('cannot enter a non-OneDrive folder without a drive id', () => {
    expect(enterFolder(team, { id: 'a', name: 'A', driveId: null })).toBeNull();
  });
  it('truncates the trail', () => {
    const deep = enterFolder(enterFolder(team, { id: 'a', name: 'A', driveId: 'd' })!, { id: 'b', name: 'B', driveId: 'd' })!;
    expect(truncateTrail(deep, 1).trail.map((c) => c.name)).toEqual(['A']);
    expect(truncateTrail(deep, 0).trail).toEqual([]);
  });
  it('compares locations by ids', () => {
    expect(sameLocation(team.location, { kind: 'team', teamId: 'T 1', teamName: 'renamed', channelId: '19:abc@thread.tacv2' })).toBe(true);
    expect(sameLocation(team.location, { kind: 'team', teamId: 'T 1', teamName: 'Class' })).toBe(false);
    expect(sameLocation({ kind: 'mine' }, { kind: 'shared' })).toBe(false);
  });
  it('labels locations', () => {
    expect(locationLabel(team.location)).toBe('Class > Deutsch');
    expect(locationLabel({ kind: 'recent' })).toBe('Recent');
  });
});

describe('persistence', () => {
  it('round trips a view and survives garbage', () => {
    expect(parseView(serializeView(team))).toEqual(team);
    expect(parseView('{nope')).toEqual(MINE_ROOT);
    expect(parseView(undefined)).toEqual(MINE_ROOT);
  });
  it('restores only id free locations', () => {
    expect(restoreLocation('shared')).toEqual({ kind: 'shared' });
    expect(restoreLocation('team:1')).toEqual({ kind: 'mine' });
    expect(restoreLocation(null)).toEqual({ kind: 'mine' });
  });
});
