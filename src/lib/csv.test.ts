import { describe, it, expect } from "vitest";
import { toCsv, CsvRow } from "./csv";
import { DEFAULT_PROFILE } from "./profile";
import type { Profile } from "./types";

describe("toCsv", () => {
  const meta = {
    generatedAt: "2026-10-11T23:00:00.000Z",
    mode: "rules",
  };

  it("generates correct header matching profile criteria in order", () => {
    const csv = toCsv([], DEFAULT_PROFILE, meta);
    const lines = csv.split("\r\n");
    const header = lines[0];

    const expectedCols = [
      "rank",
      "domain",
      "status",
      "failure_code",
      "confirmed_score",
      "max_possible_score",
      "evidence_count",
      "funding_red_flag",
      "sells_software_status",
      "sells_software_quote",
      "sells_software_source_url",
      "serves_businesses_status",
      "serves_businesses_quote",
      "serves_businesses_source_url",
      "visible_pricing_status",
      "visible_pricing_quote",
      "visible_pricing_source_url",
      "recurring_model_status",
      "recurring_model_quote",
      "recurring_model_source_url",
      "operating_history_status",
      "operating_history_quote",
      "operating_history_source_url",
      "profile",
      "mode",
      "generated_at",
    ];

    expect(header).toBe(expectedCols.join(","));
  });

  it("handles commas, quotes, and newlines in cell values according to RFC 4180", () => {
    const rows: CsvRow[] = [
      {
        rank: 1,
        domain: "quote-test.com",
        status: "fetched",
        analysis: {
          status: "ok",
          score: {
            confirmed: 100,
            maxPossible: 100,
            evidenceCount: 5,
            totalCriteria: 5,
          },
          evidence: [
            {
              criterionId: "sells_software",
              status: "met",
              // Contains comma, quotes, and newline
              quote: 'Software, "platform",\nand apps',
              sourceUrl: "https://quote-test.com/",
              verified: true,
              extractor: "rule",
            },
          ],
          redFlags: [],
        },
      },
    ];

    const csv = toCsv(rows, DEFAULT_PROFILE, meta);
    const lines = csv.split("\r\n");
    expect(lines.length).toBeGreaterThan(1);
    // Embedded quotes must be doubled and whole cell wrapped in double quotes
    expect(csv).toContain('"Software, ""platform"",\nand apps"');
  });

  it("prevents formula injection by prefixing =, +, -, @, \\t, and \\r with a single quote", () => {
    const rows: CsvRow[] = [
      {
        rank: 1,
        domain: "=1+1.com",
        status: "fetched",
        analysis: {
          status: "ok",
          score: {
            confirmed: 25,
            maxPossible: 100,
            evidenceCount: 1,
            totalCriteria: 5,
          },
          evidence: [
            {
              criterionId: "sells_software",
              status: "met",
              quote: "+1 premium software dashboard",
              sourceUrl: "https://test.com",
              verified: true,
              extractor: "rule",
            },
            {
              criterionId: "serves_businesses",
              status: "met",
              quote: "-1 negative workflow",
              sourceUrl: "https://test.com",
              verified: true,
              extractor: "rule",
            },
            {
              criterionId: "visible_pricing",
              status: "met",
              quote: "@SUM formula pricing",
              sourceUrl: "https://test.com",
              verified: true,
              extractor: "rule",
            },
            {
              criterionId: "recurring_model",
              status: "met",
              quote: "\ttab subscription",
              sourceUrl: "https://test.com",
              verified: true,
              extractor: "rule",
            },
            {
              criterionId: "operating_history",
              status: "met",
              quote: "\rcarriage history",
              sourceUrl: "https://test.com",
              verified: true,
              extractor: "rule",
            },
          ],
        },
      },
    ];

    const csv = toCsv(rows, DEFAULT_PROFILE, meta);

    // Formula injection cells must start with single quote
    expect(csv).toContain("'=1+1.com");
    expect(csv).toContain("'+1 premium software dashboard");
    expect(csv).toContain("'-1 negative workflow");
    expect(csv).toContain("'@SUM formula pricing");
    expect(csv).toContain("'\ttab subscription");
  });

  it("formats empty values and unscorable rows cleanly", () => {
    const rows: CsvRow[] = [
      {
        rank: "-",
        domain: "unscorable.test",
        status: "unscorable",
        failureCode: "BLOCKED_PRIVATE_ADDRESS",
      },
    ];

    const csv = toCsv(rows, DEFAULT_PROFILE, meta);
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(3); // Header, 1 data row, trailing empty line

    const rowCols = lines[1].split(",");
    expect(rowCols[0]).toBe("'-"); // '-' is a formula prefix character, so gets '-
    expect(rowCols[1]).toBe("unscorable.test");
    expect(rowCols[2]).toBe("unscorable");
    expect(rowCols[3]).toBe("BLOCKED_PRIVATE_ADDRESS");
    expect(rowCols[4]).toBe(""); // confirmed_score
    expect(rowCols[5]).toBe(""); // max_possible_score
    expect(rowCols[6]).toBe(""); // evidence_count
    expect(rowCols[7]).toBe(""); // funding_red_flag
  });

  it("records funding_red_flag as 'yes' when redFlags are present", () => {
    const rows: CsvRow[] = [
      {
        rank: 1,
        domain: "funded.test",
        status: "fetched",
        analysis: {
          status: "ok",
          redFlags: [
            {
              kind: "funding_mention",
              quote: "raised $10M in Series A",
              sourceUrl: "https://funded.test/about",
              pageType: "about",
              charStart: 0,
              charEnd: 24,
              verified: true,
              extractor: "rule",
            },
          ],
        },
      },
    ];

    const csv = toCsv(rows, DEFAULT_PROFILE, meta);
    const lines = csv.split("\r\n");
    const rowCols = lines[1].split(",");
    expect(rowCols[7]).toBe("yes");
  });

  it("uses CRLF line endings throughout", () => {
    const rows: CsvRow[] = [
      { rank: 1, domain: "a.com", status: "fetched" },
      { rank: 2, domain: "b.com", status: "fetched" },
    ];

    const csv = toCsv(rows, DEFAULT_PROFILE, meta);
    expect(csv.includes("\r\n")).toBe(true);
    // Every line break should be \r\n
    const withoutCrlf = csv.replace(/\r\n/g, "");
    expect(withoutCrlf.includes("\n")).toBe(false);
  });

  it("respects custom profile criteria order and labels", () => {
    const customProfile: Profile = {
      id: "custom-profile",
      label: "Custom Tech Profile",
      illustrative: true,
      criteria: [
        { id: "sells_software", label: "Software", weight: 50 },
        { id: "visible_pricing", label: "Pricing", weight: 50 },
      ],
    };

    const csv = toCsv([], customProfile, meta);
    const header = csv.split("\r\n")[0];
    expect(header).toBe(
      "rank,domain,status,failure_code,confirmed_score,max_possible_score,evidence_count,funding_red_flag,sells_software_status,sells_software_quote,sells_software_source_url,visible_pricing_status,visible_pricing_quote,visible_pricing_source_url,profile,mode,generated_at"
    );
  });
});
