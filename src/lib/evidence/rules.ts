/**
 * Rule-based heuristic evidence extractor.
 *
 * Scans collected canonical pages for illustrative pattern matches across profile criteria
 * and extracts verified quote windows with precise character boundaries.
 *
 * NOTE: Rules-only mode is keyword-based, illustrative, and coarse.
 */

import type {
  CriterionId,
  Evidence,
  PageType,
  Profile,
  RedFlag,
} from "../types";
import type { CollectedPage } from "../collect";
import { verifyQuote } from "./verify";

interface MatchResult {
  start: number;
  end: number;
}

/**
 * Builds a word-boundary-trimmed quote window of up to 240 characters around a match.
 */
function buildQuoteWindow(
  text: string,
  matchStart: number,
  matchEnd: number
): { quote: string; start: number; end: number } {
  const radius = 120;
  let start = Math.max(0, matchStart - radius);
  let end = Math.min(text.length, matchEnd + radius);

  // Trim start to word boundary
  if (start > 0) {
    const spaceIdx = text.indexOf(" ", start);
    if (spaceIdx !== -1 && spaceIdx <= matchStart) {
      start = spaceIdx + 1;
    }
  }

  // Trim end to word boundary
  if (end < text.length) {
    const spaceIdx = text.lastIndexOf(" ", end);
    if (spaceIdx !== -1 && spaceIdx >= matchEnd) {
      end = spaceIdx;
    }
  }

  // Ensure total length is at most 240 chars while preserving match
  while (end - start > 240) {
    const distLeft = matchStart - start;
    const distRight = end - matchEnd;
    if (distLeft > distRight) {
      const nextSpace = text.indexOf(" ", start + 1);
      if (nextSpace !== -1 && nextSpace <= matchStart) {
        start = nextSpace + 1;
      } else {
        start++;
      }
    } else {
      const prevSpace = text.lastIndexOf(" ", end - 1);
      if (prevSpace !== -1 && prevSpace >= matchEnd) {
        end = prevSpace;
      } else {
        end--;
      }
    }
  }

  // Trim whitespace
  while (text[start] === " " && start < matchStart) {
    start++;
  }
  while (text[end - 1] === " " && end > matchEnd) {
    end--;
  }

  let quote = text.slice(start, end);

  // Ensure minimum length of 8 characters for verifyQuote
  if (quote.length < 8) {
    start = Math.max(0, Math.min(start, text.length - 8));
    end = Math.min(text.length, start + 8);
    quote = text.slice(start, end);
  }

  return { quote, start, end };
}

/**
 * Evaluates pattern matching for a specific criterion on a single page's text.
 */
function findCriterionMatch(
  id: CriterionId,
  text: string,
  now: Date
): MatchResult | null {
  switch (id) {
    case "sells_software": {
      const regex =
        /\b(software|saas|platform|dashboard|web app|sign up|free trial|request a demo)\b/i;
      const m = regex.exec(text);
      return m ? { start: m.index, end: m.index + m[0].length } : null;
    }

    case "serves_businesses": {
      const regex =
        /\b(for teams|for businesses|for companies|for agencies|for enterprises|for organizations|b2b|your team|your business|your company|your customers)\b/i;
      const m = regex.exec(text);
      return m ? { start: m.index, end: m.index + m[0].length } : null;
    }

    case "visible_pricing": {
      // Must be a currency amount; the word "pricing" alone is NOT enough
      const regex = /(?:[$€£₹]|(?:USD|EUR|GBP|INR)\s*)\d+(?:[.,]\d+)?/i;
      const m = regex.exec(text);
      return m ? { start: m.index, end: m.index + m[0].length } : null;
    }

    case "recurring_model": {
      const regex =
        /(?:\b(per month|per year|monthly|annually|per user|per seat|subscription)\b|\/(?:mo|month|yr)\b)/i;
      const m = regex.exec(text);
      return m ? { start: m.index, end: m.index + m[0].length } : null;
    }

    case "operating_history": {
      const regex =
        /(?:since|founded in|established in|est\.|started in|in business since)\s+(\d{4})\b/gi;
      let m: RegExpExecArray | null;

      while ((m = regex.exec(text)) !== null) {
        const year = parseInt(m[1], 10);
        const currentYear = now.getFullYear();

        // Must be from 1980 to current year, and at least 5 years old
        if (year >= 1980 && year <= currentYear && currentYear - year >= 5) {
          // Ignore matches that are within 12 characters after "copyright" or copyright symbol
          const prefixWindow = text.slice(Math.max(0, m.index - 12), m.index);
          if (/(?:copyright|©|\(c\))/i.test(prefixWindow)) {
            continue;
          }

          return { start: m.index, end: m.index + m[0].length };
        }
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Searches page text for funding red flags.
 */
function findFundingRedFlags(text: string): MatchResult[] {
  const regex =
    /\b(series [a-e]|raised\s+[$€£₹]?\d[\d.,]*\s*(?:[kmbt]|million|billion)?|venture-backed|seed round|funding round)\b/gi;
  const results: MatchResult[] = [];
  let m: RegExpExecArray | null;

  while ((m = regex.exec(text)) !== null) {
    results.push({ start: m.index, end: m.index + m[0].length });
  }

  return results;
}

/**
 * Sorts collected pages according to the priority order for a given criterion.
 */
function orderPagesForCriterion(
  id: CriterionId,
  pages: CollectedPage[]
): CollectedPage[] {
  const priorityOrder: PageType[] =
    id === "visible_pricing" || id === "recurring_model"
      ? ["pricing", "home", "about"]
      : ["home", "about", "pricing"];

  return [...pages].sort((a, b) => {
    const idxA = priorityOrder.indexOf(a.type);
    const idxB = priorityOrder.indexOf(b.type);
    return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
  });
}

/**
 * Extracts rule-based evidence and red flags across collected pages.
 */
export function extractEvidence(
  pages: CollectedPage[],
  profile: Profile,
  now: Date = new Date()
): { evidence: Evidence[]; redFlags: RedFlag[] } {
  const evidenceList: Evidence[] = [];
  const redFlags: RedFlag[] = [];

  // ── 1. Extract Evidence for Profile Criteria in Profile Order ───────
  for (const criterion of profile.criteria) {
    const sortedPages = orderPagesForCriterion(criterion.id, pages);
    let matchedEvidence: Evidence | null = null;

    for (const page of sortedPages) {
      const match = findCriterionMatch(criterion.id, page.text, now);
      if (!match) continue;

      const { quote } = buildQuoteWindow(
        page.text,
        match.start,
        match.end
      );
      const verifyResult = verifyQuote(page.text, quote);

      if (verifyResult.verified && verifyResult.start !== undefined && verifyResult.end !== undefined) {
        matchedEvidence = {
          criterionId: criterion.id,
          status: "met",
          quote,
          sourceUrl: page.url,
          pageType: page.type,
          charStart: verifyResult.start,
          charEnd: verifyResult.end,
          verified: true,
          extractor: "rule",
        };
        break; // First verified match wins
      }
    }

    if (matchedEvidence) {
      evidenceList.push(matchedEvidence);
    } else {
      evidenceList.push({
        criterionId: criterion.id,
        status: "unknown",
        verified: false,
        extractor: "rule",
      });
    }
  }

  // ── 2. Extract Red Flags (Funding Mentions) ─────────────────────────
  for (const page of pages) {
    const flagMatches = findFundingRedFlags(page.text);
    let lastEnd = -1;

    for (const match of flagMatches) {
      if (match.start < lastEnd) {
        continue; // Skip overlapping match already captured in previous quote window
      }

      const { quote } = buildQuoteWindow(
        page.text,
        match.start,
        match.end
      );
      const verifyResult = verifyQuote(page.text, quote);

      if (verifyResult.verified && verifyResult.start !== undefined && verifyResult.end !== undefined) {
        lastEnd = verifyResult.end;
        redFlags.push({
          kind: "funding_mention",
          quote,
          sourceUrl: page.url,
          pageType: page.type,
          charStart: verifyResult.start,
          charEnd: verifyResult.end,
          verified: true,
          extractor: "rule",
        });
      }
    }
  }

  return { evidence: evidenceList, redFlags };
}
