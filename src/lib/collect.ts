/**
 * Safe website page collector.
 *
 * Collects up to three canonical pages (home, /pricing, /about) for a domain,
 * enforcing robots.txt policies, SSRF prevention, rate limits, and bot
 * challenge detection.
 */

import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import type { PageType, FailureCode } from "./types";
import { safeFetch, SafeFetchDeps, SafeFetchResult } from "./net/safeFetch";
import { ROBOTS_USER_AGENT, RobotsCacheValue } from "./net/robots";

export interface CollectedPage {
  type: PageType;
  url: string;
  text: string;
}

export interface SkippedPage {
  type: PageType;
  code: string;
}

export interface CollectPagesResult {
  status: "ok" | "unscorable";
  failureCode?: FailureCode;
  pages: CollectedPage[];
  skipped: SkippedPage[];
}

export interface CollectPagesDeps {
  fetch?: (
    url: string,
    opts?: { maxBytes?: number; acceptText?: boolean },
    deps?: SafeFetchDeps
  ) => Promise<SafeFetchResult>;
  fetchDeps?: SafeFetchDeps;
  delayMs?: number;
}

const BOT_CHALLENGE_PATTERNS = [
  /just a moment/i,
  /cf-chl/i,
  /attention required/i,
  /captcha/i,
];

/**
 * Extract human-visible text from HTML using cheerio.
 * Strips script, style, noscript, svg, template, and iframe tags,
 * collapses all whitespace, trims, and caps at 100,000 characters.
 */
export function extractText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, template, iframe").remove();

  // Insert whitespace after block and boundary elements so adjacent tags don't concatenate words
  $(
    "p, div, h1, h2, h3, h4, h5, h6, li, tr, td, th, a, button, section, article, nav, header, footer, br, hr"
  ).after(" ");

  const rawText = $("body").length ? $("body").text() : $.text();
  const collapsed = rawText.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, 100_000);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Collect content for a domain's homepage, pricing, and about pages.
 */
export async function collectPages(
  domain: string,
  deps?: CollectPagesDeps
): Promise<CollectPagesResult> {
  const fetchFn = deps?.fetch ?? safeFetch;
  const delayMs = deps?.delayMs ?? 500;
  const robotsCache = new Map<string, RobotsCacheValue>();

  const pages: CollectedPage[] = [];
  const skipped: SkippedPage[] = [];

  // Helper for robots check that tracks if connection failed
  const checkRobots = async (originUrl: string, path: string) => {
    const normalizedOrigin = originUrl.replace(/\/+$/, "");
    const robotsUrl = `${normalizedOrigin}/robots.txt`;

    let cached = robotsCache.get(normalizedOrigin);
    let connectionFailed = false;
    let failureCode: FailureCode | undefined = undefined;

    if (!cached) {
      const res = await fetchFn(
        robotsUrl,
        { maxBytes: 256 * 1024, acceptText: true },
        deps?.fetchDeps
      );

      if (res.ok) {
        if (res.status >= 200 && res.status < 300) {
          const parser = robotsParser(robotsUrl, res.body);
          cached = { type: "parser", parser };
        } else if (res.status >= 400 && res.status < 500) {
          cached = { type: "allow_all" };
        } else {
          cached = { type: "disallow_all" };
        }
      } else {
        if (res.code === "HTTP_ERROR" || res.code === "TIMEOUT") {
          connectionFailed = true;
        }
        cached = { type: "disallow_all", failureCode: res.code };
        failureCode = res.code;
      }

      robotsCache.set(normalizedOrigin, cached);
    }

    let allowed = true;
    if (cached.type === "allow_all") {
      allowed = true;
    } else if (cached.type === "disallow_all") {
      allowed = false;
      failureCode = cached.failureCode;
    } else {
      const targetUrl = `${normalizedOrigin}${path.startsWith("/") ? "" : "/"}${path}`;
      allowed = cached.parser.isAllowed(targetUrl, ROBOTS_USER_AGENT) !== false;
    }

    return { allowed, connectionFailed, failureCode };
  };

  // Try https first
  let protocol = "https:";
  let origin = `${protocol}//${domain}`;

  // ── Step 1: Homepage ───────────────────────────────────────────────
  const homePath = "/";
  let homeRobots = await checkRobots(origin, homePath);

  // If https connection failed on robots check, fall back to http
  if (!homeRobots.allowed && homeRobots.connectionFailed && protocol === "https:") {
    protocol = "http:";
    origin = `${protocol}//${domain}`;
    await sleep(delayMs);
    homeRobots = await checkRobots(origin, homePath);
  }

  if (!homeRobots.allowed) {
    return {
      status: "unscorable",
      failureCode: homeRobots.failureCode ?? "ROBOTS_DISALLOWED",
      pages: [],
      skipped: [],
    };
  }

  await sleep(delayMs);

  let homeFetchRes = await fetchFn(
    `${origin}${homePath}`,
    { maxBytes: 1_000_000, acceptText: false },
    deps?.fetchDeps
  );

  // Fall back to http ONLY if https CONNECTION fails for the homepage
  if (
    !homeFetchRes.ok &&
    (homeFetchRes.code === "HTTP_ERROR" || homeFetchRes.code === "TIMEOUT") &&
    protocol === "https:"
  ) {
    protocol = "http:";
    origin = `${protocol}//${domain}`;

    await sleep(delayMs);

    homeRobots = await checkRobots(origin, homePath);
    if (!homeRobots.allowed) {
      return {
        status: "unscorable",
        failureCode: "ROBOTS_DISALLOWED",
        pages: [],
        skipped: [],
      };
    }

    await sleep(delayMs);

    homeFetchRes = await fetchFn(
      `${origin}${homePath}`,
      { maxBytes: 1_000_000, acceptText: false },
      deps?.fetchDeps
    );
  }

  // If homepage fetch failed completely
  if (!homeFetchRes.ok) {
    return {
      status: "unscorable",
      failureCode: homeFetchRes.code,
      pages: [],
      skipped: [],
    };
  }

  // Check bot protection status and markers
  if (
    homeFetchRes.status === 403 ||
    homeFetchRes.status === 429 ||
    homeFetchRes.status === 503
  ) {
    const isBotChallenge = BOT_CHALLENGE_PATTERNS.some((pat) =>
      pat.test(homeFetchRes.body)
    );
    if (isBotChallenge) {
      return {
        status: "unscorable",
        failureCode: "BOT_PROTECTION",
        pages: [],
        skipped: [],
      };
    }
    return {
      status: "unscorable",
      failureCode: "HTTP_ERROR",
      pages: [],
      skipped: [],
    };
  }

  if (homeFetchRes.status < 200 || homeFetchRes.status >= 300) {
    return {
      status: "unscorable",
      failureCode: "HTTP_ERROR",
      pages: [],
      skipped: [],
    };
  }

  // Extract visible text
  const homeText = extractText(homeFetchRes.body);
  if (homeText.length < 300) {
    return {
      status: "unscorable",
      failureCode: "JS_RENDERED_OR_EMPTY",
      pages: [],
      skipped: [],
    };
  }

  pages.push({
    type: "home",
    url: homeFetchRes.finalUrl,
    text: homeText,
  });

  // ── Step 2: /pricing and /about ────────────────────────────────────
  const subPages: { type: PageType; path: string }[] = [
    { type: "pricing", path: "/pricing" },
    { type: "about", path: "/about" },
  ];

  for (const sub of subPages) {
    await sleep(delayMs);

    const subRobots = await checkRobots(origin, sub.path);
    if (!subRobots.allowed) {
      skipped.push({ type: sub.type, code: subRobots.failureCode ?? "ROBOTS_DISALLOWED" });
      continue;
    }

    await sleep(delayMs);

    const subRes = await fetchFn(
      `${origin}${sub.path}`,
      { maxBytes: 1_000_000, acceptText: false },
      deps?.fetchDeps
    );

    if (!subRes.ok) {
      skipped.push({ type: sub.type, code: subRes.code });
      continue;
    }

    if (subRes.status === 404) {
      skipped.push({ type: sub.type, code: "NOT_FOUND" });
      continue;
    }

    if (subRes.status < 200 || subRes.status >= 300) {
      skipped.push({ type: sub.type, code: `HTTP_${subRes.status}` });
      continue;
    }

    const subText = extractText(subRes.body);
    pages.push({
      type: sub.type,
      url: subRes.finalUrl,
      text: subText,
    });
  }

  return {
    status: "ok",
    pages,
    skipped,
  };
}
