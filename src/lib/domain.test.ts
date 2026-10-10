import { describe, it, expect } from "vitest";
import {
  normalizeDomain,
  parseDomainList,
  dedupeDomains,
  MAX_DOMAINS_PER_RUN,
} from "./domain";

// ─────────────────────────────────────────────────────────────────────
// normalizeDomain
// ─────────────────────────────────────────────────────────────────────

describe("normalizeDomain", () => {
  // ── valid inputs ──

  it("accepts a plain domain", () => {
    expect(normalizeDomain("example.com")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("lowercases uppercase input", () => {
    expect(normalizeDomain("EXAMPLE.COM")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("strips path, query, and fragment from an https URL", () => {
    expect(normalizeDomain("https://example.com/path?q=1#frag")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("strips leading www.", () => {
    expect(normalizeDomain("www.example.com")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("strips trailing dot", () => {
    expect(normalizeDomain("example.com.")).toEqual({
      ok: true,
      domain: "example.com",
    });
  });

  it("converts IDN münchen.de to punycode", () => {
    expect(normalizeDomain("münchen.de")).toEqual({
      ok: true,
      domain: "xn--mnchen-3ya.de",
    });
  });

  it("accepts 127.0.0.1.nip.io (domain, not an IP literal)", () => {
    // nip.io domains resolve to the embedded IP, but the string itself
    // is a valid multi-label domain name — blocking is the network
    // layer's job (resolved-IP check), not ours.
    expect(normalizeDomain("127.0.0.1.nip.io")).toEqual({
      ok: true,
      domain: "127.0.0.1.nip.io",
    });
  });

  // ── invalid inputs ──

  it("rejects empty input", () => {
    const r = normalizeDomain("");
    expect(r.ok).toBe(false);
  });

  it("rejects whitespace-only input", () => {
    const r = normalizeDomain("   ");
    expect(r.ok).toBe(false);
  });

  it("rejects a single label (no dot)", () => {
    const r = normalizeDomain("example");
    expect(r.ok).toBe(false);
  });

  it("rejects localhost", () => {
    const r = normalizeDomain("localhost");
    expect(r.ok).toBe(false);
  });

  it("rejects foo.local", () => {
    const r = normalizeDomain("foo.local");
    expect(r.ok).toBe(false);
  });

  it("rejects IPv4 literal 192.168.1.1", () => {
    const r = normalizeDomain("192.168.1.1");
    expect(r.ok).toBe(false);
  });

  it("rejects decimal IP 2130706433 (→ 127.0.0.1)", () => {
    // The URL parser normalises 2130706433 to 127.0.0.1.
    const r = normalizeDomain("2130706433");
    expect(r.ok).toBe(false);
  });

  it("rejects hex IP 0x7f.0.0.1 (→ 127.0.0.1)", () => {
    const r = normalizeDomain("0x7f.0.0.1");
    expect(r.ok).toBe(false);
  });

  it("rejects short IP 127.1 (→ 127.0.0.1)", () => {
    const r = normalizeDomain("127.1");
    expect(r.ok).toBe(false);
  });

  it("rejects IPv6 [::1]", () => {
    const r = normalizeDomain("[::1]");
    expect(r.ok).toBe(false);
  });

  it("rejects https://[::1]/", () => {
    const r = normalizeDomain("https://[::1]/");
    expect(r.ok).toBe(false);
  });

  it("rejects ftp:// (unsupported scheme)", () => {
    const r = normalizeDomain("ftp://example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/scheme/i);
  });

  it("rejects user:pass@example.com (userinfo)", () => {
    const r = normalizeDomain("user:pass@example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/@/);
  });

  it("rejects example.com:8080 (port)", () => {
    const r = normalizeDomain("example.com:8080");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/port/i);
  });

  it("rejects 'exa mple.com' (space in domain)", () => {
    const r = normalizeDomain("exa mple.com");
    expect(r.ok).toBe(false);
  });

  it("rejects -bad.com (label starts with hyphen)", () => {
    const r = normalizeDomain("-bad.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/hyphen/i);
  });

  it("rejects bad_.com (underscore not allowed)", () => {
    const r = normalizeDomain("bad_.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/invalid/i);
  });

  it("rejects a 64-character label", () => {
    const long = "a".repeat(64) + ".com";
    const r = normalizeDomain(long);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/63/);
  });

  it("rejects all-numeric TLD (example.123)", () => {
    // Note: the WHATWG URL parser itself rejects "example.123" because it
    // interprets the final label as a partial IPv4 number. Our all-numeric-
    // TLD check is a second safety net for parsers that don't do this.
    const r = normalizeDomain("example.123");
    expect(r.ok).toBe(false);
  });

  it("rejects 127.0.0.1 (IPv4 literal)", () => {
    const r = normalizeDomain("127.0.0.1");
    expect(r.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// parseDomainList
// ─────────────────────────────────────────────────────────────────────

describe("parseDomainList", () => {
  it("splits on newlines, commas, semicolons, and whitespace", () => {
    const result = parseDomainList("a.com\nb.com,c.com;d.com e.com");
    expect(result).toEqual(["a.com", "b.com", "c.com", "d.com", "e.com"]);
  });

  it("drops empty entries from leading/trailing separators", () => {
    expect(parseDomainList(",, a.com ,,")).toEqual(["a.com"]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// dedupeDomains
// ─────────────────────────────────────────────────────────────────────

describe("dedupeDomains", () => {
  it("preserves first-seen order and counts duplicates", () => {
    const r = dedupeDomains(["b.com", "a.com", "B.COM", "a.com"]);
    expect(r.domains).toEqual(["b.com", "a.com"]);
    expect(r.duplicates).toBe(2);
  });

  it("reports invalid entries with a reason string", () => {
    const r = dedupeDomains(["good.com", "localhost", "-bad.com"]);
    expect(r.domains).toEqual(["good.com"]);
    expect(r.invalid).toHaveLength(2);
    expect(r.invalid[0].input).toBe("localhost");
    expect(r.invalid[0].reason).toBeTruthy();
    expect(r.invalid[1].input).toBe("-bad.com");
    expect(r.invalid[1].reason).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────
// MAX_DOMAINS_PER_RUN (sanity)
// ─────────────────────────────────────────────────────────────────────

describe("MAX_DOMAINS_PER_RUN", () => {
  it("is 20", () => {
    expect(MAX_DOMAINS_PER_RUN).toBe(20);
  });
});
