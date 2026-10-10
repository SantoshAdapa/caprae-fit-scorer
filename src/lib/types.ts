/**
 * Data contract for the Acquisition Fit Scorer.
 *
 * All types are plain data — no runtime behaviour, no dependencies.
 */

// ── Criterion identifiers ───────────────────────────────────────────

/** The five criteria the profile scores against. */
export type CriterionId =
  | "sells_software"
  | "serves_businesses"
  | "visible_pricing"
  | "recurring_model"
  | "operating_history";

// ── Evidence primitives ─────────────────────────────────────────────

/** Whether a criterion was met, contradicted, or couldn't be determined. */
export type EvidenceStatus = "met" | "contradicted" | "unknown";

/** Which page the evidence was extracted from. */
export type PageType = "home" | "pricing" | "about";

/** How the evidence was extracted. */
export type Extractor = "rule" | "llm";

/** A single piece of evidence for or against a criterion. */
export interface Evidence {
  criterionId: CriterionId;
  status: EvidenceStatus;
  /** Verbatim quote from the page, if available. */
  quote?: string;
  /** URL the evidence was found on. */
  sourceUrl?: string;
  /** Which page type the evidence came from. */
  pageType?: PageType;
  /** Character offset of the quote start in the fetched text. */
  charStart?: number;
  /** Character offset of the quote end in the fetched text. */
  charEnd?: number;
  /** True if the evidence has been verified (e.g. quote found at offset). */
  verified: boolean;
  /** Which extractor produced this evidence. */
  extractor: Extractor;
}

// ── Red flags ───────────────────────────────────────────────────────

/** A red flag found during analysis (e.g. recent funding mention). */
export interface RedFlag {
  kind: "funding_mention";
  quote: string;
  sourceUrl: string;
  pageType: PageType;
  charStart: number;
  charEnd: number;
  verified: boolean;
  extractor: Extractor;
}

// ── Failure codes ───────────────────────────────────────────────────

/** Why a domain could not be scored. */
export type FailureCode =
  | "INVALID_DOMAIN"
  | "DNS_FAILED"
  | "BLOCKED_PRIVATE_ADDRESS"
  | "ROBOTS_DISALLOWED"
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "NOT_HTML"
  | "JS_RENDERED_OR_EMPTY"
  | "BOT_PROTECTION"
  | "REDIRECTED_OFFSITE"
  | "NOT_ALLOWLISTED"
  | "INTERNAL_ERROR";

// ── Analysis result ─────────────────────────────────────────────────

/** The full result of analysing a single domain. */
export interface AnalysisResult {
  domain: string;
  status: "scored" | "unscorable";
  failureCode?: FailureCode;
  evidence: Evidence[];
  redFlags: RedFlag[];
  /** Which page types were successfully fetched. */
  pagesFetched: PageType[];
  /** Whether the analysis used rules only or rules + LLM. */
  mode: "rules" | "rules+llm";
}

// ── Profile ─────────────────────────────────────────────────────────

/** A scoring profile: a labelled, weighted list of criteria. */
export interface Profile {
  id: string;
  label: string;
  /** Always true — marks this as an illustrative (non-production) profile. */
  illustrative: true;
  criteria: {
    id: CriterionId;
    label: string;
    /** Weight out of 100. All weights in a profile must sum to 100. */
    weight: number;
  }[];
}
