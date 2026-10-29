/** Converted PDFs kept in memory for the session, least recently used first out. */
const MAX_BYTES = 150 * 1024 * 1024;

const entries = new Map<string, Blob>();
let total = 0;

export function getCachedPdf(key: string | undefined): Blob | null {
  if (!key) return null;
  const hit = entries.get(key);
  if (!hit) return null;
  entries.delete(key);
  entries.set(key, hit);
  return hit;
}

export function putCachedPdf(key: string | undefined, blob: Blob): void {
  if (!key || blob.size > MAX_BYTES) return;
  const old = entries.get(key);
  if (old) total -= old.size;
  entries.delete(key);
  entries.set(key, blob);
  total += blob.size;
  for (const [k, v] of entries) {
    if (total <= MAX_BYTES) break;
    if (k === key) continue;
    entries.delete(k);
    total -= v.size;
  }
}

export function clearPdfCache(): void {
  entries.clear();
  total = 0;
}

export function pdfCacheSize(): number {
  return total;
}
