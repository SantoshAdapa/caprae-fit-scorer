/**
 * Robots.txt checking per RFC 9309.
 *
 * Checks if a path on a given origin is allowed for CapraeFitScorerBot.
 * Caches robots.txt results per origin across a single run.
 */

import robotsParser from "robots-parser";
import { safeFetch, SafeFetchDeps, SafeFetchResult } from "./safeFetch";

import type { FailureCode } from "../types";

export const ROBOTS_USER_AGENT = "CapraeFitScorerBot";

export type RobotsCacheValue =
  | { type: "parser"; parser: ReturnType<typeof robotsParser> }
  | { type: "allow_all" }
  | { type: "disallow_all"; failureCode?: FailureCode };

export interface RobotsDeps {
  fetch?: (
    url: string,
    opts?: { maxBytes?: number; acceptText?: boolean },
    deps?: SafeFetchDeps
  ) => Promise<SafeFetchResult>;
  fetchDeps?: SafeFetchDeps;
  cache?: Map<string, RobotsCacheValue>;
}

/**
 * Check whether a given path is allowed by the origin's robots.txt.
 *
 * Rules (RFC 9309):
 * - 2xx response: parse robots.txt and evaluate path.
 * - 4xx response (including 401 and 403): allowed (RFC 9309 section 2.3.1.2).
 * - 5xx, timeout, or network error: disallowed (conservative).
 * - Guard failures (e.g. BLOCKED_PRIVATE_ADDRESS): disallowed.
 */
export async function isAllowedByRobots(
  origin: string,
  path: string,
  deps?: RobotsDeps
): Promise<boolean> {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  const targetUrl = `${normalizedOrigin}${path.startsWith("/") ? "" : "/"}${path}`;
  const robotsUrl = `${normalizedOrigin}/robots.txt`;

  const cache = deps?.cache;
  let cached = cache?.get(normalizedOrigin);

  if (!cached) {
    const fetchFn = deps?.fetch ?? safeFetch;
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
        // Any 4xx means robots.txt does not exist/restricts nothing
        cached = { type: "allow_all" };
      } else {
        // 5xx or other status: conservative disallow
        cached = { type: "disallow_all" };
      }
    } else {
      // Timeout, network error, or guard failure: conservative disallow
      cached = { type: "disallow_all", failureCode: res.code };
    }

    if (cache) {
      cache.set(normalizedOrigin, cached);
    }
  }

  if (cached.type === "allow_all") return true;
  if (cached.type === "disallow_all") return false;

  // Evaluate parser
  const isAllowed = cached.parser.isAllowed(targetUrl, ROBOTS_USER_AGENT);
  // In robots-parser, undefined means allowed (not explicitly disallowed)
  return isAllowed !== false;
}
