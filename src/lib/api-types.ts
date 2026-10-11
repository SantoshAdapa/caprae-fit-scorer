/**
 * Public API response types for domain analysis and page fetching.
 *
 * Defines the public contract returned to the client.
 * NOTE: NEVER include raw page text or internal detail strings in responses.
 */

import type { Evidence, FailureCode, PageType, RedFlag } from "./types";
import type { CompanyScore } from "./score";

export interface FetchSummaryPage {
  type: PageType;
  url: string;
  chars: number;
}

export interface FetchSummarySkipped {
  type: PageType;
  code: string;
}

export interface FetchSummary {
  domain: string;
  status: "ok" | "unscorable";
  failureCode?: FailureCode;
  pages: FetchSummaryPage[];
  skipped: FetchSummarySkipped[];
}

export type AnalyzeResponse = FetchSummary & {
  mode: "rules";
  profileLabel: string;
  evidence: Evidence[];
  redFlags: RedFlag[];
  score?: CompanyScore;
};
