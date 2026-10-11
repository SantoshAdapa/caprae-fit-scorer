import { describe, it, expect, vi } from "vitest";
import { isAllowedByRobots } from "./robots";
import type { SafeFetchResult } from "./safeFetch";

describe("isAllowedByRobots", () => {
  const origin = "https://example.com";

  it("parses 2xx robots.txt and respects allow / disallow rules", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      contentType: "text/plain",
      body: "User-agent: *\nDisallow: /private\nAllow: /public",
      finalUrl: "https://example.com/robots.txt",
      redirects: 0,
    } as SafeFetchResult);

    const allowedPublic = await isAllowedByRobots(origin, "/public", { fetch: mockFetch });
    expect(allowedPublic).toBe(true);

    const allowedPrivate = await isAllowedByRobots(origin, "/private", { fetch: mockFetch });
    expect(allowedPrivate).toBe(false);
  });

  it("treats any 4xx (e.g. 404, 401, 403) as allowed per RFC 9309", async () => {
    for (const status of [404, 401, 403]) {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status,
        contentType: "text/plain",
        body: "Not Found",
        finalUrl: "https://example.com/robots.txt",
        redirects: 0,
      } as SafeFetchResult);

      const allowed = await isAllowedByRobots(origin, "/any-path", { fetch: mockFetch });
      expect(allowed).toBe(true);
    }
  });

  it("treats 5xx (e.g. 500, 503) as disallowed (conservative)", async () => {
    for (const status of [500, 503]) {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status,
        contentType: "text/plain",
        body: "Server Error",
        finalUrl: "https://example.com/robots.txt",
        redirects: 0,
      } as SafeFetchResult);

      const allowed = await isAllowedByRobots(origin, "/any-path", { fetch: mockFetch });
      expect(allowed).toBe(false);
    }
  });

  it("treats timeout and network error as disallowed (conservative)", async () => {
    const mockFetchTimeout = vi.fn().mockResolvedValue({
      ok: false,
      code: "TIMEOUT",
      detail: "Request timed out",
    } as SafeFetchResult);

    const allowedTimeout = await isAllowedByRobots(origin, "/any-path", { fetch: mockFetchTimeout });
    expect(allowedTimeout).toBe(false);

    const mockFetchHttpErr = vi.fn().mockResolvedValue({
      ok: false,
      code: "HTTP_ERROR",
      detail: "Connection reset",
    } as SafeFetchResult);

    const allowedErr = await isAllowedByRobots(origin, "/any-path", { fetch: mockFetchHttpErr });
    expect(allowedErr).toBe(false);
  });

  it("treats guard failure (BLOCKED_PRIVATE_ADDRESS) as disallowed", async () => {
    const mockFetchGuard = vi.fn().mockResolvedValue({
      ok: false,
      code: "BLOCKED_PRIVATE_ADDRESS",
      detail: "Private IP",
    } as SafeFetchResult);

    const allowed = await isAllowedByRobots(origin, "/any-path", { fetch: mockFetchGuard });
    expect(allowed).toBe(false);
  });

  it("caches the result per origin so robots.txt is only fetched once", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      contentType: "text/plain",
      body: "User-agent: *\nDisallow: /admin",
      finalUrl: "https://example.com/robots.txt",
      redirects: 0,
    } as SafeFetchResult);

    const cache = new Map();

    const first = await isAllowedByRobots(origin, "/admin", { fetch: mockFetch, cache });
    expect(first).toBe(false);

    const second = await isAllowedByRobots(origin, "/home", { fetch: mockFetch, cache });
    expect(second).toBe(true);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
