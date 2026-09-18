export interface TtlCache {
  get<T>(key: string, load: () => Promise<T>): Promise<T>;
  clear(): void;
}

export const META_TTL_MS = 10 * 60 * 1000;

/** Memoise an async loader per key. Field and table metadata rarely changes, and one HR question may need it several times. */
export function createTtlCache(ttlMs: number, now: () => number = Date.now): TtlCache {
  const entries = new Map<string, { expires: number; value: unknown }>();
  return {
    async get<T>(key: string, load: () => Promise<T>): Promise<T> {
      const hit = entries.get(key);
      if (hit && hit.expires > now()) return hit.value as T;
      const value = await load();
      entries.set(key, { expires: now() + ttlMs, value });
      return value;
    },
    clear() {
      entries.clear();
    },
  };
}
