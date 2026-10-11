/**
 * Exact quote verification against page text.
 *
 * Verifies that an extracted quote originates verbatim from the page text.
 * Uses strictly length-preserving character normalizations on page text
 * so character offsets remain 1:1 aligned with the original text.
 */

export interface VerifyQuoteResult {
  verified: boolean;
  start?: number;
  end?: number;
}

/**
 * Length-preserving normalizer for page text.
 * Replaces non-breaking spaces with standard spaces and curly quotes with straight quotes.
 * Every replacement is strictly 1 character to 1 character.
 */
function normalizePageText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

/**
 * Normalizes a candidate quote by collapsing whitespace, trimming,
 * and standardizing quotes and non-breaking spaces.
 */
function normalizeQuote(quote: string): string {
  return quote
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Verifies whether a candidate quote exists verbatim in the target page text.
 *
 * Constraints:
 * - Quotes shorter than 8 or longer than 300 characters are never verified.
 * - Matching is case-sensitive.
 * - Offsets map directly to the original pageText slice.
 */
export function verifyQuote(pageText: string, quote: string): VerifyQuoteResult {
  const normQuote = normalizeQuote(quote);

  if (normQuote.length < 8 || normQuote.length > 300) {
    return { verified: false };
  }

  const normPage = normalizePageText(pageText);
  const start = normPage.indexOf(normQuote);

  if (start === -1) {
    return { verified: false };
  }

  const end = start + normQuote.length;
  return {
    verified: true,
    start,
    end,
  };
}
