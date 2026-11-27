/**
 * Small in-memory cache for async route data and resolved cover URLs.
 *
 * The app talks to a local server, so we intentionally avoid a complex cache
 * and simply keep recently fetched results in memory. This removes skeleton
 * flashes when navigating back to a view and lets idle prefetching warm the
 * next likely screen.
 */

const store = new Map<string, unknown>();

export const dataCache = {
  get<T>(key: string): T | undefined {
    return store.get(key) as T | undefined;
  },

  set<T>(key: string, value: T): void {
    store.set(key, value);
  },

  has(key: string): boolean {
    return store.has(key);
  },

  /** Drop every entry whose key starts with `prefix`. */
  invalidate(prefix: string): void {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
  },

  clear(): void {
    store.clear();
  },
};

export function coverCacheKey(id: string, size: number): string {
  return `cover:${id}:${size}`;
}
