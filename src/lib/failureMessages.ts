/**
 * Human-readable explanations for all FailureCode values.
 *
 * Used across the UI and API layer to present user-friendly error messages
 * without leaking raw system error details or resolved IP addresses.
 */

import type { FailureCode } from "./types";

export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  INVALID_DOMAIN: "Invalid domain name syntax or unsupported format",
  DNS_FAILED: "DNS lookup failed (domain not found or unresolvable)",
  BLOCKED_PRIVATE_ADDRESS: "Blocked: resolves to a private or internal address",
  ROBOTS_DISALLOWED: "Crawling disallowed by robots.txt",
  HTTP_ERROR: "HTTP error or failed connection when fetching page",
  TIMEOUT: "Request timed out while connecting or reading response",
  TOO_LARGE: "Page response exceeded maximum size limit (1 MB)",
  NOT_HTML: "Content-Type is not HTML",
  JS_RENDERED_OR_EMPTY:
    "Too little readable text (page may be JavaScript-rendered or nearly empty)",
  BOT_PROTECTION: "Blocked by automated bot challenge or CAPTCHA",
  REDIRECTED_OFFSITE: "Homepage redirected offsite to a different domain",
  NOT_ALLOWLISTED: "Domain is not on the allowed demonstration list",
  INTERNAL_ERROR: "An unexpected internal server error occurred",
};
