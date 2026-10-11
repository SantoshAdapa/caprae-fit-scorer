import { describe, it, expect } from "vitest";
import { FAILURE_MESSAGES } from "./failureMessages";
import type { FailureCode } from "./types";

describe("FAILURE_MESSAGES", () => {
  const allCodes: FailureCode[] = [
    "INVALID_DOMAIN",
    "DNS_FAILED",
    "BLOCKED_PRIVATE_ADDRESS",
    "ROBOTS_DISALLOWED",
    "HTTP_ERROR",
    "TIMEOUT",
    "TOO_LARGE",
    "NOT_HTML",
    "JS_RENDERED_OR_EMPTY",
    "BOT_PROTECTION",
    "REDIRECTED_OFFSITE",
    "NOT_ALLOWLISTED",
    "INTERNAL_ERROR",
  ];

  it("provides a non-empty message for every FailureCode", () => {
    for (const code of allCodes) {
      const message = FAILURE_MESSAGES[code];
      expect(message, `Message for ${code} should exist`).toBeDefined();
      expect(typeof message).toBe("string");
      expect(message.trim().length).toBeGreaterThan(0);
    }
  });

  it("contains exactly all 13 FailureCode keys", () => {
    expect(Object.keys(FAILURE_MESSAGES).sort()).toEqual(allCodes.sort());
  });
});
