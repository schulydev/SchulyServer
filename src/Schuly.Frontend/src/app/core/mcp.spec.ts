import { describe, expect, it } from 'vitest';
import { cursorInstallLink, mcpClientGuides, mcpUrl, vscodeInstallLink } from './mcp-clients';
import { fullAccessPreset, readOnlyPreset, samePermissions, summarize, withLevel } from './mcp-permissions';
import { safeReturnUrl } from './return-url';

describe('permission presets', () => {
  it('read-only reads everything and never writes or deletes', () => {
    const set = readOnlyPreset();
    expect(Object.values(set.areas).every((level) => level === 'Read')).toBe(true);
    expect(set.allowDestructive).toBe(false);
    expect(set.microsoftAccountIds).toBeNull();
  });

  it('full access writes only where supported and allows deleting', () => {
    const set = fullAccessPreset();
    expect(set.areas.Mail).toBe('ReadWrite');
    expect(set.areas.Absences).toBe('ReadWrite');
    expect(set.areas.Teams).toBe('ReadWrite');
    expect(set.areas.Grades).toBe('Read');
    expect(set.allowDestructive).toBe(true);
  });

  it('drops deleting when the last write permission is removed', () => {
    let set = fullAccessPreset();
    for (const area of ['Mail', 'Absences', 'Teams', 'OneNote'] as const) set = withLevel(set, area, 'Read');
    expect(set.allowDestructive).toBe(false);
  });
});

describe('summarize', () => {
  it('omits areas that are off and says so when nothing is left', () => {
    expect(summarize({ areas: { Grades: 'Off' }, allowDestructive: false, microsoftAccountIds: null })).toEqual([
      'No access',
    ]);
  });

  it('lists levels and deleting', () => {
    const chips = summarize({
      areas: { Grades: 'Read', Mail: 'ReadWrite' },
      allowDestructive: true,
      microsoftAccountIds: null,
    });
    expect(chips).toEqual(['Grades: read', 'Mail: read & write', 'Deleting allowed']);
  });

  it('compares sets regardless of account order', () => {
    const a = { ...readOnlyPreset(), microsoftAccountIds: ['1', '2'] };
    const b = { ...readOnlyPreset(), microsoftAccountIds: ['2', '1'] };
    expect(samePermissions(a, b)).toBe(true);
    expect(samePermissions(a, readOnlyPreset())).toBe(false);
  });
});

describe('client deep links', () => {
  const url = mcpUrl('https://app.schuly.dev');

  it('builds the server url from the origin', () => {
    expect(url).toBe('https://app.schuly.dev/mcp');
  });

  it('encodes the Cursor config as base64 json', () => {
    const link = cursorInstallLink(url);
    const config = new URL(link).searchParams.get('config')!;
    expect(link.startsWith('cursor://anysphere.cursor-deeplink/mcp/install?name=schuly&config=')).toBe(true);
    expect(JSON.parse(atob(config))).toEqual({ url });
  });

  it('encodes the VS Code config as json', () => {
    const link = vscodeInstallLink(url);
    expect(link.startsWith('vscode:mcp/install?')).toBe(true);
    expect(JSON.parse(decodeURIComponent(link.slice('vscode:mcp/install?'.length)))).toEqual({
      name: 'schuly',
      type: 'http',
      url,
    });
  });

  it('never puts a key in an install link', () => {
    for (const guide of mcpClientGuides(url)) expect(guide.installLink?.href ?? '').not.toContain('schuly_mcp_');
  });
});

describe('safeReturnUrl', () => {
  it('accepts same-origin paths with a query', () => {
    expect(safeReturnUrl('/connect/authorize?client_id=a&state=b')).toBe('/connect/authorize?client_id=a&state=b');
  });

  it('rejects other origins', () => {
    expect(safeReturnUrl('https://evil.example')).toBeNull();
    expect(safeReturnUrl('//evil.example')).toBeNull();
    expect(safeReturnUrl(undefined)).toBeNull();
  });
});
