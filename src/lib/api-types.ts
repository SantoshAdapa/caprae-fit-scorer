/**
 * Public API response types for domain analysis and page fetching.
 *
 * Defines the public contract returned to the client.
 * NOTE: NEVER include page text or internal detail strings in FetchSummary.
 */

import type { FailureCode, PageType } from "./types";

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
