/**
 * RFC 4180 compliant CSV export with formula injection prevention.
 *
 * Exports analyzed company fit records, scores, and criterion evidence.
 * Formats line endings with CRLF (\r\n) and escapes text according to RFC 4180.
 * Neutralizes CSV/Excel formula injection attempts (=, +, -, @, \t, \r)
 * by prefixing with a single quote (').
 */

import type { Evidence, Profile, RedFlag } from "./types";

export interface CsvRowAnalysis {
  status?: string;
  failureCode?: string;
  mode?: string;
  score?: {
    confirmed?: number;
    maxPossible?: number;
    evidenceCount?: number;
    totalCriteria?: number;
  };
  evidence?: Evidence[];
  redFlags?: RedFlag[];
}

export interface CsvRow {
  rank?: string | number;
  domain: string;
  status: string;
  failureCode?: string;
  analysis?: CsvRowAnalysis;
  score?: {
    confirmed?: number;
    maxPossible?: number;
    evidenceCount?: number;
    totalCriteria?: number;
  };
  evidence?: Evidence[];
  redFlags?: RedFlag[];
}

export interface CsvMeta {
  generatedAt: string | Date;
  mode?: string;
}

const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Formats a single cell value for safe RFC 4180 CSV inclusion:
 * 1. Defends against formula injection if first char is =, +, -, @, \t, or \r.
 * 2. Escapes double quotes (") as ("").
 * 3. Encloses fields containing quotes, commas, or line breaks in double quotes.
 */
export function formatCsvCell(val: unknown): string {
  if (val === null || val === undefined) {
    return "";
  }

  let str = String(val);

  // Formula injection defense: prefix with ' if the first character can trigger spreadsheet execution
  if (str.length > 0 && FORMULA_PREFIXES.includes(str[0])) {
    str = `'${str}`;
  }

  // RFC 4180: If the string contains comma, quote, or newline, escape internal quotes and wrap in quotes
  if (
    str.includes('"') ||
    str.includes(",") ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Converts table analysis rows to an RFC 4180 compliant CSV string.
 *
 * @param rows - Analyzed rows currently displayed in the table.
 * @param profile - Target profile defining criteria order and labels.
 * @param meta - Metadata containing generation timestamp and mode.
 * @returns Serialized CSV string with CRLF line endings.
 */
export function toCsv(
  rows: CsvRow[],
  profile: Profile,
  meta: CsvMeta
): string {
  // ── 1. Build Header Row ───────────────────────────────────────────
  const headers: string[] = [
    "rank",
    "domain",
    "status",
    "failure_code",
    "confirmed_score",
    "max_possible_score",
    "evidence_count",
    "funding_red_flag",
  ];

  for (const criterion of profile.criteria) {
    headers.push(
      `${criterion.id}_status`,
      `${criterion.id}_quote`,
      `${criterion.id}_source_url`
    );
  }

  headers.push("profile", "mode", "generated_at");

  const headerLine = headers.map((h) => formatCsvCell(h)).join(",");

  // ── 2. Format Data Rows ───────────────────────────────────────────
  const isoTimestamp =
    meta.generatedAt instanceof Date
      ? meta.generatedAt.toISOString()
      : String(meta.generatedAt);

  const rowLines = rows.map((row) => {
    const analysis = row.analysis;
    const score = analysis?.score ?? row.score;
    const evidence = analysis?.evidence ?? row.evidence ?? [];
    const redFlags = analysis?.redFlags ?? row.redFlags ?? [];
    const failureCode = analysis?.failureCode || row.failureCode || "";
    const hasRedFlag = redFlags.length > 0 ? "yes" : "";
    const mode = analysis?.mode || meta.mode || "rules";

    const cells: string[] = [
      formatCsvCell(row.rank !== undefined ? row.rank : ""),
      formatCsvCell(row.domain),
      formatCsvCell(row.status),
      formatCsvCell(failureCode),
      formatCsvCell(score?.confirmed !== undefined ? score.confirmed : ""),
      formatCsvCell(score?.maxPossible !== undefined ? score.maxPossible : ""),
      formatCsvCell(score?.evidenceCount !== undefined ? score.evidenceCount : ""),
      formatCsvCell(hasRedFlag),
    ];

    for (const criterion of profile.criteria) {
      const ev = evidence.find((e) => e.criterionId === criterion.id);
      const critStatus = ev?.status || "";
      const critQuote = ev?.quote || "";
      const critSourceUrl = ev?.sourceUrl || "";

      cells.push(
        formatCsvCell(critStatus),
        formatCsvCell(critQuote),
        formatCsvCell(critSourceUrl)
      );
    }

    cells.push(
      formatCsvCell(profile.label),
      formatCsvCell(mode),
      formatCsvCell(isoTimestamp)
    );

    return cells.join(",");
  });

  // Combine header and rows with CRLF endings and trailing newline
  return [headerLine, ...rowLines].join("\r\n") + "\r\n";
}
