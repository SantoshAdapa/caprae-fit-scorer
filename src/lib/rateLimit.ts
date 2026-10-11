/**
 * In-memory sliding window rate limiter.
 *
 * NOTE: This rate limiter maintains state in memory on the current process.
 * It is per-server-instance and best-effort only (requests handled by different
 * serverless instances or across process restarts do not share counters).
 */

export interface RateLimiterOptions {
  /** Maximum number of allowed requests in the time window. */
  limit: number;
  /** Length of the rolling time window in milliseconds. */
  windowMs: number;
  /** Optional clock function for time injection (useful for testing). */
  now?: () => number;
}

export interface RateLimitCheckResult {
  /** True if the request is permitted within the rate limit. */
  allowed: boolean;
  /** Seconds until the client may retry if not allowed (0 if allowed). */
  retryAfterSec: number;
}

export interface RateLimiter {
  /** Check and record an access attempt for the specified key. */
  check: (key: string) => RateLimitCheckResult;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs, now = Date.now } = options;
  const store = new Map<string, number[]>();

  return {
    check(key: string): RateLimitCheckResult {
      const currentTime = now();
      const windowStart = currentTime - windowMs;

      const timestamps = store.get(key) ?? [];
      // Keep only timestamps within the current sliding window
      const valid = timestamps.filter((t) => t > windowStart);

      if (valid.length < limit) {
        valid.push(currentTime);
        store.set(key, valid);
        return { allowed: true, retryAfterSec: 0 };
      }

      // Limit reached: calculate when the oldest request in the window falls off
      const oldest = valid[0];
      const expiry = oldest + windowMs;
      const retryAfterMs = Math.max(0, expiry - currentTime);
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));

      store.set(key, valid);
      return { allowed: false, retryAfterSec };
    },
  };
}
