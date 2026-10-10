type Entry = { count: number; windowStart: number };

/**
 * Fixed-window counter, per process. Deliberately NOT a refactor of login's
 * inline limiter in routes/auth.ts — that one is load-bearing with its own
 * documented tuning history, and this one needs something it does not: key
 * eviction, because the forgot-password limiter is keyed by caller-supplied
 * email rather than by IP.
 *
 * Per-process and restart-resettable, which is acceptable only while nos-api
 * runs a single instance. Scaled out, each limit loosens per instance and this
 * needs to move to shared storage.
 */
export function makeRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, Entry>();

  return {
    /** True when this key is OVER the limit. */
    check(key: string): boolean {
      const now = Date.now();
      // ponytail: O(n) sweep per call — fine at tens of keys; switch to a
      // timer or a bounded LRU if this ever serves real traffic.
      for (const [k, entry] of hits) {
        if (now - entry.windowStart > windowMs) hits.delete(k);
      }

      const entry = hits.get(key);
      if (!entry || now - entry.windowStart > windowMs) {
        hits.set(key, { count: 1, windowStart: now });
        return false;
      }
      entry.count += 1;
      return entry.count > limit;
    },
    reset(): void {
      hits.clear();
    },
    /** Live key count. Exported so the eviction test can be non-vacuous. */
    size(): number {
      return hits.size;
    },
  };
}
