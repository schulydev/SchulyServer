import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { LinkProviderDto, LinkedAccountDto, LinkedAccountStatus, LinkingApi } from '../core/linking-api';
import { linkErrorMessage } from '../core/linking-step';
import { DataRefresh } from './data-refresh';
import { removeSavedAccount, userIdFromToken } from '../core/browser-cache';
import { AuthStore } from './auth.store';

/** Capability kinds the web has a generic UI for. */
export const WEB_KINDS = ['mail', 'chat', 'drive', 'notes', 'calendar', 'absence_reporting'] as const;
export type CapabilityKind = (typeof WEB_KINDS)[number];

export interface CapabilityAccount {
  id: string;
  providerId: string;
  providerName: string;
  title: string;
  detail: string | null;
  status: LinkedAccountStatus;
  basePath: string;
}

/** A page of its own in the app shell, reached from the provider's group in the sidebar. */
export const PAGE_KINDS: Record<string, { url: string; title: string; icon: string }> = {
  mail: { url: '/mail', title: 'Mail', icon: 'lucideMail' },
  chat: { url: '/chat', title: 'Chat', icon: 'lucideMessagesSquare' },
  drive: { url: '/drive', title: 'Drive', icon: 'lucideHardDrive' },
  notes: { url: '/notes', title: 'Notes', icon: 'lucideNotebook' },
};

export interface NavGroup {
  providerId: string;
  label: string;
  items: { kind: string; title: string; url: string; icon: string }[];
}

const isWebKind = (kind: string): kind is CapabilityKind => (WEB_KINDS as readonly string[]).includes(kind);

/** Linked accounts that offer each capability kind the web has a UI for, with the base path the capability declares. */
export function capabilityAccountsOf(accounts: LinkedAccountDto[]): Record<CapabilityKind, CapabilityAccount[]> {
  const result = Object.fromEntries(WEB_KINDS.map((kind) => [kind, [] as CapabilityAccount[]])) as Record<CapabilityKind, CapabilityAccount[]>;
  for (const account of accounts) {
    if (!account.id) continue;
    for (const capability of account.capabilities ?? []) {
      if (!isWebKind(capability.kind) || !capability.basePath) continue;
      result[capability.kind].push({
        id: account.id,
        providerId: account.providerId,
        providerName: account.providerName,
        title: account.title,
        detail: account.detail ?? null,
        status: account.status,
        basePath: capability.basePath.replace(/\/+$/, ''),
      });
    }
  }
  return result;
}

/** One sidebar group per provider that has a linked account, with an entry per capability that has its own page. */
export function navGroupsOf(accounts: LinkedAccountDto[], providers: LinkProviderDto[]): NavGroup[] {
  const order = new Map(providers.map((p, i) => [p.id, p.sortOrder * 1000 + i]));
  const groups = new Map<string, NavGroup>();
  for (const account of accounts) {
    if (!account.id) continue;
    const group = groups.get(account.providerId) ?? { providerId: account.providerId, label: account.providerName, items: [] };
    for (const capability of account.capabilities ?? []) {
      const page = PAGE_KINDS[capability.kind];
      if (!page || !capability.basePath || group.items.some((i) => i.kind === capability.kind)) continue;
      group.items.push({ kind: capability.kind, title: capability.label || page.title, url: page.url, icon: page.icon });
    }
    groups.set(account.providerId, group);
  }
  return [...groups.values()]
    .filter((g) => g.items.length)
    .sort((a, b) => (order.get(a.providerId) ?? 1e9) - (order.get(b.providerId) ?? 1e9));
}

interface LinkedAccountsState {
  providers: LinkProviderDto[];
  accounts: LinkedAccountDto[];
  chosen: Partial<Record<CapabilityKind, string>>;
  loading: boolean;
  loaded: boolean;
  loadError: string | null;
  providersError: string | null;
  busy: boolean;
  actionError: string | null;
}

const SYNC_POLL_MS = 3000;
const SYNC_MAX_MS = 180_000;

/**
 * The signed-in user's linked accounts across every provider, plus the providers the host offers.
 * Navigation, capability pages and settings all derive from this one store.
 */
export const LinkedAccountsStore = signalStore(
  withState<LinkedAccountsState>({
    providers: [],
    accounts: [],
    chosen: {},
    loading: false,
    loaded: false,
    loadError: null,
    providersError: null,
    busy: false,
    actionError: null,
  }),
  withComputed((store) => ({
    capabilityAccounts: computed(() => capabilityAccountsOf(store.accounts())),
    navGroups: computed(() => navGroupsOf(store.accounts(), store.providers())),
    hasAccounts: computed(() => store.accounts().some((a) => !!a.id)),
    syncing: computed(() => store.accounts().some((a) => a.status === 'syncing')),
    schoolAccounts: computed(() => store.accounts().filter((a) => a.capabilities?.some((c) => c.kind === 'school_data'))),
    linkableProviders: computed(() => store.providers().filter((p) => p.flows.length > 0)),
    groups: computed(() => {
      const byProvider = new Map<string, { providerId: string; name: string; provider: LinkProviderDto | null; accounts: LinkedAccountDto[] }>();
      for (const account of store.accounts()) {
        const entry = byProvider.get(account.providerId) ?? {
          providerId: account.providerId,
          name: account.providerName,
          provider: store.providers().find((p) => p.id === account.providerId) ?? null,
          accounts: [],
        };
        entry.accounts.push(account);
        byProvider.set(account.providerId, entry);
      }
      return [...byProvider.values()];
    }),
  })),
  withMethods((store, api = inject(LinkingApi), refresh = inject(DataRefresh, { optional: true }), auth = inject(AuthStore)) => {
    let sequence = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waited = 0;

    const stopPolling = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };

    const schedulePoll = () => {
      if (timer || waited >= SYNC_MAX_MS) return;
      timer = setTimeout(async () => {
        timer = undefined;
        // A hidden tab neither polls nor spends its three minutes.
        if (typeof document !== 'undefined' && document.hidden) return schedulePoll();
        waited += SYNC_POLL_MS;
        await loadAccounts();
      }, SYNC_POLL_MS);
    };

    /** Fetches the accounts. A newer call wins; a failure keeps the list on screen and says so. Resolves to whether it worked. */
    const loadAccounts = async (): Promise<boolean> => {
      const mine = ++sequence;
      const wasSyncing = store.syncing();
      try {
        const rows = await firstValueFrom(api.accounts());
        if (mine !== sequence) return true;
        // An entry with an empty id is a provider that failed to list its accounts; it stays so the card can say so.
        const accounts = Array.isArray(rows) ? rows : [];
        patchState(store, { accounts, loaded: true, loadError: null });
        if (store.syncing()) schedulePoll();
        else {
          waited = 0;
          if (wasSyncing) refresh?.reloadAll();
        }
        return true;
      } catch (error) {
        if (mine === sequence) patchState(store, { loaded: true, loadError: linkErrorMessage(error, 'Could not load your accounts.') });
        return false;
      }
    };

    const loadProviders = async () => {
      try {
        const rows = await firstValueFrom(api.providers('web'));
        patchState(store, { providers: Array.isArray(rows) ? [...rows].sort((a, b) => a.sortOrder - b.sortOrder) : [], providersError: null });
      } catch (error) {
        patchState(store, { providersError: linkErrorMessage(error, 'Could not load the available schools and services.') });
      }
    };

    /** The account the user picked for a kind, or the first one that offers it. */
    const selectedId = (kind: CapabilityKind): string | null => {
      const accounts = store.capabilityAccounts()[kind];
      return accounts.find((a) => a.id === store.chosen()[kind])?.id ?? accounts[0]?.id ?? null;
    };
    const selected = (kind: CapabilityKind): CapabilityAccount | null => {
      const id = selectedId(kind);
      return store.capabilityAccounts()[kind].find((a) => a.id === id) ?? null;
    };

    return {
      loadProviders,
      loadAccounts,
      /** Initial load with the spinner. */
      async load(): Promise<void> {
        patchState(store, { loading: !store.loaded() });
        await Promise.all([loadAccounts(), loadProviders()]);
        patchState(store, { loading: false });
      },
      /**
       * After a link finished (or failed in a way that may still have linked): reload the accounts at once and
       * everything derived from them. Resolves when the list is current.
       */
      async afterLink(): Promise<void> {
        waited = 0;
        await loadAccounts();
        refresh?.reloadAll();
      },
      async unlink(account: LinkedAccountDto): Promise<boolean> {
        patchState(store, { busy: true, actionError: null });
        try {
          await firstValueFrom(api.unlink(account.providerId, account.id));
          await removeSavedAccount(userIdFromToken(auth.accessToken()), account.id);
          patchState(store, { accounts: store.accounts().filter((a) => !(a.providerId === account.providerId && a.id === account.id)) });
          if (account.capabilities?.some((c) => c.kind === 'school_data')) refresh?.clearAndReload();
          else refresh?.reloadAll();
          void loadAccounts();
          return true;
        } catch (error) {
          patchState(store, { actionError: linkErrorMessage(error, 'Could not unlink that account. Try again.') });
          return false;
        } finally {
          patchState(store, { busy: false });
        }
      },
      clearActionError(): void {
        patchState(store, { actionError: null });
      },
      selectedId,
      selected,
      select(kind: CapabilityKind, id: string): void {
        patchState(store, { chosen: { ...store.chosen(), [kind]: id } });
      },
      /** `<basePath>/<accountId>` for the selected account of a kind. */
      endpoint(kind: CapabilityKind): string | null {
        const account = selected(kind);
        return account ? `${account.basePath}/${encodeURIComponent(account.id)}` : null;
      },
      stopPolling,
    };
  }),
  withHooks({
    onInit: (store) => void store.load(),
    onDestroy: (store) => store.stopPolling(),
  }),
);
