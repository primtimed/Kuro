interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class InMemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

export const cache = new InMemoryCache();
export const TTL = {
  TRENDING: 60 * 60 * 1000,        // 1 hour
  SEASONAL: 60 * 60 * 1000,        // 1 hour
  SEARCH: 10 * 60 * 1000,          // 10 minutes
  DETAIL: 60 * 60 * 1000,           // 1 hour
  EPISODES: 60 * 60 * 1000,        // 1 hour
};
