/**
 * Domain normalization and validation.
 *
 * Pure functions only: no network, no DNS, no file I/O, no new deps.
 * Uses the WHATWG URL parser (globalThis.URL) for IDN-to-punycode and
 * IP-form normalization — do NOT import "node:url" because this module
 * also runs in the browser.
 *
 * Known limitation: subdomains (e.g. app.example.com vs example.com)
 * are treated as separate companies.
 *
 * This module is only the FIRST validation layer. The network layer
 * will separately check resolved IP addresses against private and
 * reserved ranges (RFC 1918, RFC 4193, link-local, etc.).
 */

import type { FailureCode } from "./types";

/** Maximum number of domains accepted in a single run. */
export const MAX_DOMAINS_PER_RUN = 20;

// ── helpers ─────────────────────────────────────────────────────────

/** Shorthand for the failure branch of normalizeDomain's return type. */
type DomainFail = {
  ok: false;
  code: Extract<FailureCode, "INVALID_DOMAIN">;
  reason: string;
};

/** Shorthand for the success branch. */
type DomainOk = { ok: true; domain: string };

/** Build a failure result. */
function fail(reason: string): DomainFail {
  return { ok: false, code: "INVALID_DOMAIN", reason };
}

/** True when the string is an IPv4 dotted-decimal literal. */
function isIPv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Domain suffixes reserved for local/private use. */
const RESERVED_SUFFIXES = [".local", ".localhost", ".internal"] as const;

// ── normalizeDomain ─────────────────────────────────────────────────

/**
 * Normalize and validate a single domain input.
 *
 * Accepts bare hostnames ("example.com") or http(s) URLs.
 * Strips path, query, fragment, leading "www.", and trailing ".".
 * Converts IDN labels to punycode via the WHATWG URL parser.
 *
 * Rejects: IP literals (v4 and v6, including decimal and hex forms),
 * localhost, reserved suffixes, ports, userinfo, non-http(s) schemes,
 * malformed labels, all-numeric TLDs, and over-long names.
 */
export function normalizeDomain(input: string): DomainOk | DomainFail {
  const trimmed = input.trim();
  if (!trimmed) return fail("Empty input");

  // ── reject userinfo early (before URL parsing could swallow it) ──
  if (trimmed.includes("@")) {
    return fail("Userinfo (@) not allowed");
  }

  // ── determine scheme; only http:// and https:// are accepted ──
  let toParse: string;
  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      return fail(`Unsupported scheme "${scheme}"`);
    }
    toParse = trimmed;
  } else {
    // No scheme — treat as bare hostname; prepend http:// for parsing.
    toParse = "http://" + trimmed;
  }

  // ── WHATWG URL parse (handles IDN → punycode, IP normalization) ──
  let url: URL;
  try {
    url = new URL(toParse);
  } catch {
    return fail("Invalid domain");
  }

  // ── reject port ──
  if (url.port) {
    return fail("Port not allowed");
  }

  let host = url.hostname.toLowerCase();

  // ── strip trailing dot ──
  if (host.endsWith(".")) {
    host = host.slice(0, -1);
  }

  // ── strip leading "www." ──
  if (host.startsWith("www.")) {
    host = host.slice(4);
  }

  // ── reject IPv6 (brackets from URL parser, or colons) ──
  if (host.startsWith("[") || host.includes(":")) {
    return fail("IPv6 addresses not allowed");
  }

  // ── reject IPv4 literals ──
  // The URL parser already normalised exotic forms (2130706433, 0x7f.0.0.1,
  // 127.1, etc.) into dotted-decimal, so a simple regex suffices here.
  if (isIPv4(host)) {
    return fail("IPv4 addresses not allowed");
  }

  // ── reject "localhost" ──
  if (host === "localhost") {
    return fail("localhost not allowed");
  }

  // ── reject single-label names (no dot) ──
  if (!host.includes(".")) {
    return fail("Single-label domain (no dot)");
  }

  // ── reject reserved suffixes (.local, .localhost, .internal) ──
  for (const suffix of RESERVED_SUFFIXES) {
    if (host === suffix.slice(1) || host.endsWith(suffix)) {
      return fail(`Reserved suffix "${suffix}" not allowed`);
    }
  }

  // ── total length ──
  if (host.length > 253) {
    return fail("Domain exceeds 253 characters");
  }

  // ── per-label checks ──
  const labels = host.split(".");
  for (const label of labels) {
    if (label.length > 63) {
      return fail("Label exceeds 63 characters");
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      return fail(`Label "${label}" starts or ends with a hyphen`);
    }
    // Only ASCII letters, digits, and hyphens allowed (punycode is ASCII).
    if (!/^[a-z0-9-]+$/.test(label)) {
      return fail(`Label "${label}" contains invalid characters`);
    }
  }

  // ── reject all-numeric TLD ──
  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld)) {
    return fail(`All-numeric TLD "${tld}" not allowed`);
  }

  return { ok: true, domain: host };
}

// ── parseDomainList ─────────────────────────────────────────────────

/**
 * Split freeform text into candidate domain strings.
 * Accepts newlines, commas, semicolons, and whitespace as separators.
 * Empty tokens are dropped.
 */
export function parseDomainList(text: string): string[] {
  return text.split(/[,;\s]+/).filter(Boolean);
}

// ── dedupeDomains ───────────────────────────────────────────────────

/**
 * Normalize, validate, and deduplicate a list of raw domain inputs.
 * Keeps first-seen order. Invalid inputs are collected with reasons.
 */
export function dedupeDomains(inputs: string[]): {
  domains: string[];
  invalid: { input: string; reason: string }[];
  duplicates: number;
} {
  const seen = new Set<string>();
  const domains: string[] = [];
  const invalid: { input: string; reason: string }[] = [];
  let duplicates = 0;

  for (const input of inputs) {
    const result = normalizeDomain(input);
    if (!result.ok) {
      invalid.push({ input, reason: result.reason });
      continue;
    }
    if (seen.has(result.domain)) {
      duplicates++;
      continue;
    }
    seen.add(result.domain);
    domains.push(result.domain);
  }

  return { domains, invalid, duplicates };
}
