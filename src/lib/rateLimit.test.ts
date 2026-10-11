import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  it("allows requests up to the limit and blocks exceeding requests", () => {
    let fakeTime = 1000;
    const limiter = createRateLimiter({
      limit: 3,
      windowMs: 10_000,
      now: () => fakeTime,
    });

    // 1st request
    expect(limiter.check("user-1")).toEqual({ allowed: true, retryAfterSec: 0 });
    // 2nd request at t = 2000
    fakeTime = 2000;
    expect(limiter.check("user-1")).toEqual({ allowed: true, retryAfterSec: 0 });
    // 3rd request at t = 3000
    fakeTime = 3000;
    expect(limiter.check("user-1")).toEqual({ allowed: true, retryAfterSec: 0 });

    // 4th request at t = 4000 (exceeds limit 3)
    fakeTime = 4000;
    const blocked = limiter.check("user-1");
    expect(blocked.allowed).toBe(false);
    // Oldest was at 1000, window is 10000, so oldest expires at 11000.
    // At t = 4000, 11000 - 4000 = 7000ms = 7s.
    expect(blocked.retryAfterSec).toBe(7);
  });

  it("slides window forward and allows requests once oldest expires", () => {
    let fakeTime = 10_000;
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 5000,
      now: () => fakeTime,
    });

    // Use up limit
    expect(limiter.check("ip-1").allowed).toBe(true); // at 10000
    fakeTime = 11_000;
    expect(limiter.check("ip-1").allowed).toBe(true); // at 11000
    fakeTime = 12_000;
    expect(limiter.check("ip-1").allowed).toBe(false); // at 12000 (blocked)

    // Advance past oldest request (10000 + 5000 = 15000)
    fakeTime = 15_001;
    // Oldest is expired, 1 request remains in window (11000), so 1 slot is free
    const check1 = limiter.check("ip-1");
    expect(check1.allowed).toBe(true);

    // Another request now hits the limit again
    const check2 = limiter.check("ip-1");
    expect(check2.allowed).toBe(false);
  });

  it("isolates counters between different keys", () => {
    const fakeTime = 1000;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 5000,
      now: () => fakeTime,
    });

    expect(limiter.check("key-A").allowed).toBe(true);
    expect(limiter.check("key-A").allowed).toBe(false);

    // key-B should have its own quota
    expect(limiter.check("key-B").allowed).toBe(true);
    expect(limiter.check("key-B").allowed).toBe(false);
  });
});
