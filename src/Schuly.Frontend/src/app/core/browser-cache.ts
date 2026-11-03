/**
 * Saved API answers in IndexedDB, after OutNote's docs/frontend-and-api.md. One database per user. IndexedDB isn't encrypted, so every way of
 * being signed out deletes every such database in this browser (see AuthStore), and an entry also goes after MAX_AGE_MS or past MAX_ENTRIES.
 * If storage is blocked or missing, reads find nothing and writes do nothing, so the app simply works live.
 */
export interface SavedResponse<T = unknown> {
  data: T;
  etag: string | null;
  at: number;
}

const PREFIX = 'schuly-cache-';
const STORE = 'responses';
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 300;

let open: { userId: string; db: Promise<IDBDatabase | null> } | null = null;

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** The signed-in user's id, from the access token. It only names the database; the server decides what anyone may read. */
export function userIdFromToken(token: string | null): string | null {
  try {
    const part = (token ?? '').split('.')[1];
    if (!part) return null;
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown };
    return typeof claims.sub === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(claims.sub) ? claims.sub : null;
  } catch {
    return null;
  }
}

function database(userId: string): Promise<IDBDatabase | null> {
  if (open?.userId === userId) return open.db;
  void open?.db.then((db) => db?.close());
  const db = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(PREFIX + userId, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        // Another tab signing out deletes this database: let go of it, or the delete waits for this tab.
        request.result.onversionchange = () => {
          request.result.close();
          if (open?.userId === userId) open = null;
        };
        resolve(request.result);
        void prune(request.result);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  open = { userId, db };
  return db;
}

async function prune(db: IDBDatabase): Promise<void> {
  try {
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    const keys = await done(store.getAllKeys());
    const values = (await done(store.getAll())) as SavedResponse[];
    const byAge = keys.map((key, n) => ({ key, at: values[n]?.at ?? 0 })).sort((a, b) => b.at - a.at);
    const oldest = Date.now() - MAX_AGE_MS;
    const writer = db.transaction(STORE, 'readwrite').objectStore(STORE);
    byAge.forEach((entry, n) => {
      if (n >= MAX_ENTRIES || entry.at < oldest) writer.delete(entry.key);
    });
  } catch {
    // The next visit tries again.
  }
}

export async function readSaved<T>(userId: string | null, key: string): Promise<SavedResponse<T> | null> {
  try {
    const db = userId ? await database(userId) : null;
    if (!db) return null;
    return ((await done(db.transaction(STORE).objectStore(STORE).get(key))) as SavedResponse<T> | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function writeSaved(userId: string | null, key: string, value: SavedResponse): Promise<void> {
  try {
    const db = userId ? await database(userId) : null;
    if (db) await done(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key));
  } catch {
    // Not saved; the next visit fetches it.
  }
}

export async function removeSaved(userId: string | null, key: string): Promise<void> {
  try {
    const db = userId ? await database(userId) : null;
    if (db) await done(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
  } catch {
    // It ages out.
  }
}

/** Forgets every answer of one linked account, after unlinking it. */
export async function removeSavedAccount(userId: string | null, accountId: string): Promise<void> {
  try {
    const db = userId ? await database(userId) : null;
    if (!db) return;
    const part = `/${encodeURIComponent(accountId)}/`;
    const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
    const keys = await done(store.getAllKeys());
    const writer = db.transaction(STORE, 'readwrite').objectStore(STORE);
    for (const key of keys) if (String(key).includes(part)) writer.delete(key);
  } catch {
    // It ages out, and a sign-out takes it anyway.
  }
}

/** Deletes every user's saved answers in this browser. Tabs still holding a database let go through `onversionchange`, so the delete isn't left waiting on them. */
export async function clearBrowserCaches(): Promise<void> {
  const current = open;
  open = null;
  const names = new Set<string>();
  if (current) {
    names.add(PREFIX + current.userId);
    (await current.db)?.close();
  }
  try {
    for (const info of (await indexedDB.databases?.()) ?? []) if (info.name?.startsWith(PREFIX)) names.add(info.name);
    await Promise.all(
      [...names].map(
        (name) =>
          new Promise<void>((resolve) => {
            const request = indexedDB.deleteDatabase(name);
            // Blocked still deletes, as soon as the last connection closes.
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          }),
      ),
    );
  } catch {
    // No IndexedDB here, so nothing was saved.
  }
}
