/** One optional, bounded-latency Memcached connection shared by state and quotas. */
export type MemcachedClient = {
  get(key: string, callback: (error: Error | null, value: Buffer | null) => void): void;
  set(key: string, value: string, options: { expires: number }, callback: (error: Error | null) => void): void;
  increment(key: string, amount: number, options: { expires: number; initial: number }, callback: (error: Error | null, success: boolean, value: number) => void): void;
};

export class SharedCache {
  private retryAt = 0;

  constructor(private readonly client: MemcachedClient) {}

  private async call<T>(operation: (resolve: (value: T) => void, reject: (error: Error) => void) => void): Promise<T> {
    if (Date.now() < this.retryAt) throw new Error("Memcached is cooling down.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Memcached request timed out.")), 400);
        operation(resolve, reject);
      });
    } catch (error) {
      // An oversized optional state-cache item is not a cache outage and
      // must not disable otherwise healthy, tiny authentication counters.
      if (!(error instanceof Error && /^MemJS SET: Value too large/.test(error.message))) {
        this.retryAt = Date.now() + 5_000;
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  get(key: string): Promise<Buffer | null> {
    return this.call((resolve, reject) => this.client.get(key, (error, value) => error ? reject(error) : resolve(value)));
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    return this.call((resolve, reject) => this.client.set(key, value, { expires: ttlSeconds }, (error) => error ? reject(error) : resolve()));
  }

  increment(key: string, ttlSeconds: number): Promise<number> {
    return this.call((resolve, reject) => this.client.increment(key, 1, { expires: ttlSeconds, initial: 1 }, (error, success, value) => {
      if (error) reject(error);
      else if (!success || !Number.isSafeInteger(value) || value < 1) reject(new Error("Invalid shared quota counter."));
      else resolve(value);
    }));
  }
}

let connection: { key: string; promise: Promise<SharedCache> } | null = null;

export function sharedCacheConfigured(): boolean {
  return Boolean(process.env.MEMCACHED_SERVERS?.trim());
}

export async function getSharedCache(): Promise<SharedCache | null> {
  const servers = process.env.MEMCACHED_SERVERS?.trim();
  if (!servers) return null;
  const username = process.env.MEMCACHED_USERNAME || process.env.MEMCACHIER_USERNAME;
  const password = process.env.MEMCACHED_PASSWORD || process.env.MEMCACHIER_PASSWORD;
  const key = JSON.stringify([servers, username, password]);
  if (!connection || connection.key !== key) {
    connection = {
      key,
      promise: import("memjs").then((mod) => {
        const create = mod.Client?.create ?? mod.default?.Client.create;
        if (!create) throw new Error("memjs client unavailable");
        return new SharedCache(create(servers, {
          username, password, timeout: 0.15, conntimeout: 0.15, retries: 1,
        }));
      }),
    };
  }
  return connection.promise;
}
