import { describe, it, expect, vi } from "vitest";
import { handleAnalyze } from "./analyzeHandler";
import type { CollectPagesResult } from "./collect";

describe("handleAnalyze", () => {
  const dummyCollect = vi.fn().mockResolvedValue({
    status: "ok",
    pages: [
      { type: "home", url: "https://iana.org/", text: "Hello from IANA" },
      { type: "about", url: "https://iana.org/about", text: "About page text" },
    ],
    skipped: [{ type: "pricing", code: "NOT_FOUND" }],
  } as CollectPagesResult);

  function createRequest(body: unknown, headers?: Record<string, string>): Request {
    return new Request("http://localhost:3000/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("responds 429 with Retry-After when rate limit is exceeded", async () => {
    const mockLimiter = {
      check: vi.fn().mockReturnValue({ allowed: false, retryAfterSec: 42 }),
    };

    const req = createRequest({ domain: "iana.org" }, { "x-forwarded-for": "203.0.113.195, 10.0.0.1" });
    const res = await handleAnalyze(req, { limiter: mockLimiter });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    const json = await res.json();
    expect(json).toEqual({ error: "RATE_LIMITED" });
  });

  it("responds 400 on malformed JSON body", async () => {
    const req = new Request("http://localhost:3000/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json ",
    });

    const res = await handleAnalyze(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "INVALID_JSON" });
  });

  it("responds 400 on invalid body shape (extra keys or over 300 chars)", async () => {
    // Extra property rejected by strict()
    const reqExtra = createRequest({ domain: "iana.org", extra: 123 });
    const resExtra = await handleAnalyze(reqExtra);
    expect(resExtra.status).toBe(400);
    expect(await resExtra.json()).toEqual({ error: "INVALID_SHAPE" });

    // String over 300 chars
    const reqLong = createRequest({ domain: "a".repeat(301) });
    const resLong = await handleAnalyze(reqLong);
    expect(resLong.status).toBe(400);
    expect(await resLong.json()).toEqual({ error: "INVALID_SHAPE" });
  });

  it("responds 400 on invalid domain syntax", async () => {
    const req = createRequest({ domain: "bad_domain" });
    const res = await handleAnalyze(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({ error: "INVALID_DOMAIN" });
  });

  it("responds 403 when ALLOWED_DOMAINS_ONLY is active and domain is not allowlisted", async () => {
    const req = createRequest({ domain: "google.com" });
    const res = await handleAnalyze(req, {
      env: { ALLOWED_DOMAINS_ONLY: "true" },
      allowedDomains: ["iana.org", "python.org"],
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toEqual({ error: "NOT_ALLOWLISTED" });
  });

  it("returns FetchSummary on valid request without exposing page text", async () => {
    const req = createRequest({ domain: "https://iana.org/path" });
    const res = await handleAnalyze(req, {
      collectPages: dummyCollect,
      env: { ALLOWED_DOMAINS_ONLY: "false" },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      domain: "iana.org",
      status: "ok",
      pages: [
        { type: "home", url: "https://iana.org/", chars: 15 },
        { type: "about", url: "https://iana.org/about", chars: 15 },
      ],
      skipped: [{ type: "pricing", code: "NOT_FOUND" }],
    });
    // Ensure raw text is never exposed
    expect(JSON.stringify(json)).not.toContain("Hello from IANA");
  });

  it("never includes resolved IP address in BLOCKED_PRIVATE_ADDRESS responses", async () => {
    const mockBlockedCollect = vi.fn().mockResolvedValue({
      status: "unscorable",
      failureCode: "BLOCKED_PRIVATE_ADDRESS",
      pages: [],
      skipped: [],
    } as CollectPagesResult);

    const req = createRequest({ domain: "private-internal.test" });
    const res = await handleAnalyze(req, {
      collectPages: mockBlockedCollect,
      env: { ALLOWED_DOMAINS_ONLY: "false" },
    });

    expect(res.status).toBe(200);
    const bodyText = await res.text();
    // Confirm structured summary
    expect(bodyText).toContain('"BLOCKED_PRIVATE_ADDRESS"');
    // Ensure resolved IP address (127.0.0.1, 10.x, etc.) is not leaked
    expect(bodyText).not.toContain("127.0.0.1");
    expect(bodyText).not.toContain("192.168.");
    expect(bodyText).not.toContain("10.0.");
    expect(bodyText).not.toContain("169.254.");
  });

  it("responds 500 with INTERNAL_ERROR on unexpected error", async () => {
    const failingCollect = vi.fn().mockRejectedValue(new Error("Fatal explosion"));
    const req = createRequest({ domain: "iana.org" });
    const res = await handleAnalyze(req, {
      collectPages: failingCollect,
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: "INTERNAL_ERROR" });
    // Raw error message must not be leaked
    expect(JSON.stringify(json)).not.toContain("Fatal explosion");
  });
});
