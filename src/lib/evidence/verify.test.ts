import { describe, it, expect } from "vitest";
import { verifyQuote } from "./verify";

describe("verifyQuote", () => {
  // Label all synthetic test text as synthetic
  const syntheticPageText =
    "Welcome to Acme Corp. We build modern cloud SaaS platforms for growing teams. Founded in 2018, our software powers thousands of businesses.";

  it("passes for an exact quote and returns exact slice offsets", () => {
    const quote = "We build modern cloud SaaS platforms";
    const result = verifyQuote(syntheticPageText, quote);

    expect(result.verified).toBe(true);
    expect(result.start).toBeDefined();
    expect(result.end).toBeDefined();
    if (result.start !== undefined && result.end !== undefined) {
      expect(syntheticPageText.slice(result.start, result.end)).toBe(quote);
    }
  });

  it("fails for an altered quote", () => {
    const altered = "We build legacy cloud SaaS platforms";
    const result = verifyQuote(syntheticPageText, altered);
    expect(result.verified).toBe(false);
    expect(result.start).toBeUndefined();
    expect(result.end).toBeUndefined();
  });

  it("fails for a completely fabricated quote", () => {
    const fabricated = "Acme Corp raised 100 million dollars in Series Z";
    const result = verifyQuote(syntheticPageText, fabricated);
    expect(result.verified).toBe(false);
  });

  it("passes for whitespace and curly quote variants", () => {
    const syntheticPageWithQuotes =
      "Acme is \u201cthe world\u2019s fastest\u201d data engine\u00a0for enterprise teams.";

    // Quote has straight quotes and extra internal whitespace
    const quoteWithStraightQuotes =
      'the   world\'s    fastest" data engine for enterprise';

    const result = verifyQuote(syntheticPageWithQuotes, quoteWithStraightQuotes);
    expect(result.verified).toBe(true);
    expect(result.start).toBeDefined();
    expect(result.end).toBeDefined();
    if (result.start !== undefined && result.end !== undefined) {
      // Offsets slice the original page text cleanly
      const slice = syntheticPageWithQuotes.slice(result.start, result.end);
      expect(slice.length).toBeGreaterThan(0);
      expect(slice).toContain("fastest");
    }
  });

  it("fails when quote is too short (< 8 chars)", () => {
    const shortQuote = "SaaS"; // 4 chars
    const result = verifyQuote(syntheticPageText, shortQuote);
    expect(result.verified).toBe(false);

    const sevenChars = "1234567"; // 7 chars
    expect(verifyQuote("Here is 1234567 in text", sevenChars).verified).toBe(false);
  });

  it("fails when quote is too long (> 300 chars)", () => {
    const longQuote = "A".repeat(301);
    const longText = `Prefix ${longQuote} Suffix`;
    const result = verifyQuote(longText, longQuote);
    expect(result.verified).toBe(false);
  });

  it("enforces case-sensitive matching", () => {
    const lowerQuote = "we build modern cloud saas platforms";
    const result = verifyQuote(syntheticPageText, lowerQuote);
    expect(result.verified).toBe(false);
  });
});
