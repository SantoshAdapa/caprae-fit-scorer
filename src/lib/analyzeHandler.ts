/**
 * Handler for the /api/analyze endpoint.
 *
 * Enforces rate limiting by IP, strict Zod body validation, domain normalization,
 * optional demonstration allowlist restriction, and safe page collection.
 *
 * NOTE: Responses return summary metrics only. Raw page text, internal error details,
 * and resolved IP addresses are NEVER included in response payloads.
 */

import { z } from "zod";
import type { FetchSummary } from "./api-types";
import { collectPages as defaultCollectPages } from "./collect";
import { normalizeDomain } from "./domain";
import { createRateLimiter, RateLimiter } from "./rateLimit";
import defaultAllowedDomains from "../data/allowed-domains.json";

// Default rate limiter: 60 requests per 10 minutes per IP
const defaultLimiter = createRateLimiter({
  limit: 60,
  windowMs: 10 * 60 * 1000,
});

const analyzeBodySchema = z
  .object({
    domain: z.string().max(300),
  })
  .strict();

export interface AnalyzeHandlerDeps {
  collectPages?: typeof defaultCollectPages;
  env?: Record<string, string | undefined>;
  limiter?: RateLimiter;
  allowedDomains?: string[];
}

/**
 * Handle incoming POST requests to /api/analyze.
 */
export async function handleAnalyze(
  req: Request,
  deps?: AnalyzeHandlerDeps
): Promise<Response> {
  try {
    // ── 1. Rate limiting ──────────────────────────────────────────────
    const xff = req.headers.get("x-forwarded-for");
    const clientKey = xff ? xff.split(",")[0].trim() : "unknown";

    const limiter = deps?.limiter ?? defaultLimiter;
    const rateCheck = limiter.check(clientKey);

    if (!rateCheck.allowed) {
      return new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(rateCheck.retryAfterSec),
        },
      });
    }

    // ── 2. JSON Body Parsing & Zod Validation ─────────────────────────
    let bodyJson: unknown;
    try {
      bodyJson = await req.json();
    } catch {
      return Response.json({ error: "INVALID_JSON" }, { status: 400 });
    }

    const parseResult = analyzeBodySchema.safeParse(bodyJson);
    if (!parseResult.success) {
      return Response.json({ error: "INVALID_SHAPE" }, { status: 400 });
    }

    // ── 3. Domain Normalization ───────────────────────────────────────
    const norm = normalizeDomain(parseResult.data.domain);
    if (!norm.ok) {
      return Response.json({ error: "INVALID_DOMAIN" }, { status: 400 });
    }

    const cleanDomain = norm.domain;

    // ── 4. Allowlist Check (Optional Restriction) ─────────────────────
    const currentEnv = deps?.env ?? process.env;
    const allowedList = deps?.allowedDomains ?? defaultAllowedDomains;

    if (currentEnv.ALLOWED_DOMAINS_ONLY === "true") {
      if (!allowedList.includes(cleanDomain)) {
        return Response.json({ error: "NOT_ALLOWLISTED" }, { status: 403 });
      }
    }

    // ── 5. Safe Page Collection ───────────────────────────────────────
    const collectFn = deps?.collectPages ?? defaultCollectPages;
    const result = await collectFn(cleanDomain);

    const summary: FetchSummary = {
      domain: cleanDomain,
      status: result.status,
      failureCode: result.failureCode,
      pages: result.pages.map((p) => ({
        type: p.type,
        url: p.url,
        chars: p.text.length,
      })),
      skipped: result.skipped.map((s) => ({
        type: s.type,
        code: s.code,
      })),
    };

    return Response.json(summary, { status: 200 });
  } catch {
    // Unexpected failures return generic error without echoing input or stack traces
    return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
