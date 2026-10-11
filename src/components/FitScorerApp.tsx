"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  MAX_DOMAINS_PER_RUN,
  parseDomainList,
  dedupeDomains,
} from "@/lib/domain";
import { FAILURE_MESSAGES } from "@/lib/failureMessages";
import { runQueue } from "@/lib/runQueue";
import { DEFAULT_PROFILE, SCORE_LIMITATIONS } from "@/lib/profile";
import { toCsv } from "@/lib/csv";
import type { AnalyzeResponse } from "@/lib/api-types";
import type { FailureCode } from "@/lib/types";

type RowStatus = "queued" | "running" | "fetched" | "unscorable" | "error";

interface DomainRow {
  domain: string;
  originalIndex: number;
  status: RowStatus;
  reason: string;
  pagesFetched: string;
  skipped: string;
  analysis?: AnalyzeResponse;
}

export function FitScorerApp() {
  const [inputText, setInputText] = React.useState("");
  const [isRunning, setIsRunning] = React.useState(false);
  const [rows, setRows] = React.useState<DomainRow[]>([]);
  const [selectedDomain, setSelectedDomain] = React.useState<string | null>(null);

  // Capabilities (rules-only vs LLM)
  const [capabilities, setCapabilities] = React.useState<{ llm: boolean } | null>(null);

  // Client-side table filters
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [minScoreFilter, setMinScoreFilter] = React.useState<string>("");

  React.useEffect(() => {
    fetch("/api/capabilities")
      .then((r) => r.json())
      .then((data) => setCapabilities(data))
      .catch(() => setCapabilities({ llm: false }));
  }, []);

  // Parse and deduplicate inputs on the fly
  const { domains, invalid, duplicates } = React.useMemo(() => {
    const tokens = parseDomainList(inputText);
    return dedupeDomains(tokens);
  }, [inputText]);

  const isCapped = domains.length > MAX_DOMAINS_PER_RUN;
  const effectiveDomains = isCapped
    ? domains.slice(0, MAX_DOMAINS_PER_RUN)
    : domains;

  const handleAnalyze = async () => {
    if (effectiveDomains.length === 0 || isRunning) return;

    setIsRunning(true);

    // Initialise rows with queued status and preserve original input index
    const initialRows: DomainRow[] = effectiveDomains.map((d, idx) => ({
      domain: d,
      originalIndex: idx,
      status: "queued",
      reason: "Waiting in queue...",
      pagesFetched: "-",
      skipped: "-",
    }));
    setRows(initialRows);

    await runQueue(
      effectiveDomains,
      async (domain: string, index: number): Promise<DomainRow> => {
        try {
          const res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain }),
          });

          if (res.status === 200) {
            const data: AnalyzeResponse = await res.json();
            if (data.status === "ok") {
              const pagesStr =
                data.pages
                  .map((p) => `${p.type} (${p.chars.toLocaleString()} chars)`)
                  .join(", ") || "none";
              const skippedStr =
                data.skipped.map((s) => `${s.type} (${s.code})`).join(", ") ||
                "none";

              return {
                domain,
                originalIndex: index,
                status: "fetched",
                reason: "-",
                pagesFetched: pagesStr,
                skipped: skippedStr,
                analysis: data,
              };
            } else {
              const reason = data.failureCode
                ? FAILURE_MESSAGES[data.failureCode as FailureCode] ||
                  data.failureCode
                : "Unscorable";
              const pagesStr =
                data.pages
                  .map((p) => `${p.type} (${p.chars.toLocaleString()} chars)`)
                  .join(", ") || "none";
              const skippedStr =
                data.skipped.map((s) => `${s.type} (${s.code})`).join(", ") ||
                "none";

              return {
                domain,
                originalIndex: index,
                status: "unscorable",
                reason,
                pagesFetched: pagesStr,
                skipped: skippedStr,
                analysis: data,
              };
            }
          }

          if (res.status === 400) {
            const err = await res.json().catch(() => ({}));
            const reason =
              err.error === "INVALID_DOMAIN"
                ? FAILURE_MESSAGES.INVALID_DOMAIN
                : "Invalid request";
            return {
              domain,
              originalIndex: index,
              status: "error",
              reason,
              pagesFetched: "-",
              skipped: "-",
            };
          }

          if (res.status === 403) {
            return {
              domain,
              originalIndex: index,
              status: "error",
              reason: FAILURE_MESSAGES.NOT_ALLOWLISTED,
              pagesFetched: "-",
              skipped: "-",
            };
          }

          if (res.status === 429) {
            return {
              domain,
              originalIndex: index,
              status: "error",
              reason: "Rate limit exceeded (try again later)",
              pagesFetched: "-",
              skipped: "-",
            };
          }

          if (res.status === 500) {
            return {
              domain,
              originalIndex: index,
              status: "error",
              reason: FAILURE_MESSAGES.INTERNAL_ERROR,
              pagesFetched: "-",
              skipped: "-",
            };
          }

          return {
            domain,
            originalIndex: index,
            status: "error",
            reason: `HTTP ${res.status} response`,
            pagesFetched: "-",
            skipped: "-",
          };
        } catch {
          return {
            domain,
            originalIndex: index,
            status: "error",
            reason: "Network error contacting server",
            pagesFetched: "-",
            skipped: "-",
          };
        }
      },
      2, // Concurrency 2
      (itemState) => {
        setRows((prev) => {
          const next = [...prev];
          const idx = itemState.index;
          if (idx >= 0 && idx < next.length) {
            if (itemState.status === "running") {
              next[idx] = {
                ...next[idx],
                status: "running",
                reason: "Fetching canonical pages...",
              };
            } else if (itemState.result) {
              next[idx] = itemState.result;
            } else if (itemState.status === "error") {
              next[idx] = {
                ...next[idx],
                status: "error",
                reason: "Unexpected client processing error",
              };
            }
          }
          return next;
        });
      }
    );

    setIsRunning(false);
  };

  // Sort rows: completed rows by confirmed desc, then evidenceCount desc.
  // Queued, running, unscorable, and error stay at the bottom in original order.
  const sortedRows = React.useMemo(() => {
    const completed: DomainRow[] = [];
    const remaining: DomainRow[] = [];

    for (const r of rows) {
      if (r.status === "fetched" && r.analysis?.score) {
        completed.push(r);
      } else {
        remaining.push(r);
      }
    }

    completed.sort((a, b) => {
      const aScore = a.analysis?.score?.confirmed ?? 0;
      const bScore = b.analysis?.score?.confirmed ?? 0;
      if (bScore !== aScore) {
        return bScore - aScore;
      }
      const aCount = a.analysis?.score?.evidenceCount ?? 0;
      const bCount = b.analysis?.score?.evidenceCount ?? 0;
      if (bCount !== aCount) {
        return bCount - aCount;
      }
      return a.originalIndex - b.originalIndex;
    });

    remaining.sort((a, b) => a.originalIndex - b.originalIndex);

    return [
      ...completed.map((r, i) => ({ ...r, rank: String(i + 1) })),
      ...remaining.map((r) => ({ ...r, rank: "-" })),
    ];
  }, [rows]);

  // Apply client-side filters (status and min score)
  const filteredRows = React.useMemo(() => {
    return sortedRows.filter((row) => {
      // 1. Status filter
      if (statusFilter === "fetched") {
        if (row.status !== "fetched") return false;
      } else if (statusFilter === "unscorable_or_error") {
        if (row.status !== "unscorable" && row.status !== "error") return false;
      }

      // 2. Minimum confirmed score filter
      const parsedMin = parseInt(minScoreFilter, 10);
      if (!isNaN(parsedMin) && parsedMin > 0) {
        if (row.status !== "fetched" || !row.analysis?.score) {
          return false;
        }
        if (row.analysis.score.confirmed < parsedMin) {
          return false;
        }
      }

      return true;
    });
  }, [sortedRows, statusFilter, minScoreFilter]);

  const selectedRow = React.useMemo(() => {
    return rows.find((r) => r.domain === selectedDomain) || null;
  }, [rows, selectedDomain]);

  const handleExportCsv = () => {
    if (filteredRows.length === 0) return;

    const csvContent = toCsv(filteredRows, DEFAULT_PROFILE, {
      generatedAt: new Date(),
      mode: capabilities?.llm ? "rules+llm" : "rules",
    });

    // Add UTF-8 BOM (\uFEFF) in the download function as specified
    const blob = new Blob(["\uFEFF", csvContent], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fit-scores-${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const renderBadge = (status: RowStatus) => {
    switch (status) {
      case "queued":
        return <Badge variant="outline">Queued</Badge>;
      case "running":
        return <Badge variant="secondary">Running</Badge>;
      case "fetched":
        return <Badge variant="default">Fetched</Badge>;
      case "unscorable":
        return <Badge variant="secondary">Unscorable</Badge>;
      case "error":
        return <Badge variant="destructive">Error</Badge>;
    }
  };

  return (
    <div className="w-full max-w-5xl space-y-6">
      {/* Limitations panel always visible above results */}
      <div className="rounded-md border p-4 space-y-2.5 bg-muted/20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            Target Profile: {DEFAULT_PROFILE.label}
          </h3>
          {capabilities && !capabilities.llm && (
            <Badge variant="outline" className="text-xs">
              Rules-only (no AI)
            </Badge>
          )}
        </div>
        <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
          {SCORE_LIMITATIONS.map((limit, idx) => (
            <li key={idx}>{limit}</li>
          ))}
        </ul>
      </div>

      {/* Input section */}
      <div className="space-y-2">
        <label
          htmlFor="domains-textarea"
          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
        >
          Paste company domains, one per line
        </label>
        <Textarea
          id="domains-textarea"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="example.com&#10;iana.org&#10;python.org"
          rows={6}
          disabled={isRunning}
          aria-describedby="domain-counts"
        />
      </div>

      {/* Pre-run helper text and Load sample domains buttons */}
      {rows.length === 0 && !isRunning && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground border">
          <span>
            Enter company domains above to screen against the acquisition profile, or load sample domains:
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setInputText(
                  "iana.org\npython.org\nwikipedia.org\nmozilla.org\ngnu.org"
                );
              }}
            >
              Load sample domains
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setInputText(
                  "linear.app\nslack.com\nzapier.com\nbasecamp.com"
                );
              }}
            >
              Load B2B SaaS samples
            </Button>
          </div>
        </div>
      )}

      {/* Input count and validation feedback */}
      <div id="domain-counts" className="text-sm text-muted-foreground space-y-1">
        <p>
          <span className="font-medium text-foreground">
            {effectiveDomains.length}
          </span>{" "}
          valid domain{effectiveDomains.length === 1 ? "" : "s"} to run
          {duplicates > 0 && ` (${duplicates} duplicate${duplicates === 1 ? "" : "s"} ignored)`}
          {invalid.length > 0 && ` (${invalid.length} invalid)`}
        </p>

        {isCapped && (
          <p className="text-amber-600 dark:text-amber-400 font-medium">
            Note: input capped at maximum {MAX_DOMAINS_PER_RUN} domains per run.
          </p>
        )}

        {invalid.length > 0 && (
          <div className="mt-2 rounded-md bg-destructive/10 p-3 text-xs text-destructive space-y-1">
            <p className="font-semibold">Invalid entries:</p>
            <ul className="list-disc pl-4 space-y-0.5">
              {invalid.map((inv, idx) => (
                <li key={idx}>
                  <code className="font-mono">{inv.input}</code>: {inv.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Button
        onClick={handleAnalyze}
        disabled={effectiveDomains.length === 0 || isRunning}
      >
        {isRunning ? "Analyzing..." : "Analyze Domains"}
      </Button>

      {/* Results table & filters */}
      {rows.length > 0 && (
        <div className="space-y-4 mt-8">
          {/* Filter controls and Export button */}
          <div className="flex flex-wrap items-end justify-between gap-4 rounded-md border p-4 bg-card text-card-foreground">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="status-filter"
                  className="text-xs font-medium text-foreground block"
                >
                  Status
                </label>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="all">All</option>
                  <option value="fetched">Fetched</option>
                  <option value="unscorable_or_error">
                    Unscorable or error
                  </option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="min-score-filter"
                  className="text-xs font-medium text-foreground block"
                >
                  Minimum confirmed score
                </label>
                <input
                  id="min-score-filter"
                  type="number"
                  min={0}
                  max={100}
                  value={minScoreFilter}
                  onChange={(e) => setMinScoreFilter(e.target.value)}
                  placeholder="0"
                  className="h-8 w-24 rounded-md border border-input bg-background px-2.5 py-1 text-xs shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>

              <div className="pb-1 text-xs text-muted-foreground font-mono">
                Showing {filteredRows.length} of {rows.length}
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={filteredRows.length === 0}
              onClick={handleExportCsv}
            >
              Export CSV ({filteredRows.length}{" "}
              {filteredRows.length === 1 ? "row" : "rows"})
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableCaption>
                Fit analysis results ({filteredRows.length} shown of {rows.length} total)
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px] text-center">Rank</TableHead>
                  <TableHead className="w-[200px]">Domain</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead
                    className="w-[130px]"
                    title="Share of profile weight with verified evidence. Missing evidence is unknown, not negative."
                  >
                    Confirmed score
                  </TableHead>
                  <TableHead className="w-[90px]">Evidence</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Pages fetched</TableHead>
                  <TableHead>Skipped</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => {
                  const hasFundingMention = Boolean(
                    row.analysis?.redFlags && row.analysis.redFlags.length > 0
                  );
                  const scoreDisplay =
                    row.status === "fetched" && row.analysis?.score
                      ? `${Math.min(100, Math.max(0, Math.round(row.analysis.score.confirmed)))}%`
                      : "-";
                  const evidenceCountDisplay =
                    row.status === "fetched" && row.analysis?.score
                      ? `${row.analysis.score.evidenceCount}/${row.analysis.score.totalCriteria}`
                      : "-";

                  return (
                    <TableRow key={row.domain}>
                      <TableCell className="font-mono text-center text-xs font-semibold text-muted-foreground">
                        {row.rank}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedDomain(row.domain)}
                            className="font-mono font-medium underline text-left hover:text-primary cursor-pointer text-xs focus:outline-none"
                          >
                            {row.domain}
                          </button>
                          {hasFundingMention && (
                            <Badge
                              variant="destructive"
                              className="text-[10px] py-0 px-1.5"
                            >
                              Funding mention
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{renderBadge(row.status)}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold">
                        {scoreDisplay}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {evidenceCountDisplay}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.reason}
                      </TableCell>
                      <TableCell className="text-xs">{row.pagesFetched}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.skipped}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Evidence Panel Sheet */}
      <Sheet
        open={Boolean(selectedRow)}
        onOpenChange={(open) => {
          if (!open) setSelectedDomain(null);
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-lg w-full max-h-screen p-6">
          <SheetHeader>
            <SheetTitle className="font-mono text-lg flex items-center gap-2">
              <span>{selectedRow?.domain}</span>
              {selectedRow?.analysis?.score && (
                <Badge variant="secondary" className="font-sans text-xs">
                  Score: {Math.min(100, Math.max(0, Math.round(selectedRow.analysis.score.confirmed)))}%
                </Badge>
              )}
            </SheetTitle>
            <SheetDescription className="text-xs text-muted-foreground">
              Confirmed score = share of profile weight with verified evidence. Missing evidence is unknown, not negative.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 mt-4">
            {/* Criteria section */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Target Profile Criteria (5)
              </h3>
              <div className="space-y-3">
                {DEFAULT_PROFILE.criteria.map((criterion) => {
                  const ev = selectedRow?.analysis?.evidence?.find(
                    (e) => e.criterionId === criterion.id
                  );
                  const isMet = Boolean(ev && ev.status === "met" && ev.verified);

                  return (
                    <div
                      key={criterion.id}
                      className="rounded-md border p-3 space-y-2 bg-card text-card-foreground"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium">
                          {criterion.label}{" "}
                          <span className="text-muted-foreground font-normal">
                            (weight: {criterion.weight})
                          </span>
                        </div>
                        {isMet ? (
                          <Badge variant="default" className="text-[10px] py-0 px-1.5">
                            Met
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-[10px] py-0 px-1.5 text-muted-foreground"
                          >
                            Unknown
                          </Badge>
                        )}
                      </div>

                      {isMet && ev?.quote ? (
                        <div className="space-y-1.5 pt-1">
                          <blockquote className="border-l-2 border-primary pl-2.5 text-xs italic bg-muted/40 py-1.5 rounded-r text-foreground">
                            &ldquo;{ev.quote}&rdquo;
                          </blockquote>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                            <span>Page: {ev.pageType || "canonical"}</span>
                            {ev.sourceUrl && (
                              <>
                                <span>&bull;</span>
                                <a
                                  href={ev.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline hover:text-foreground inline-flex items-center gap-0.5"
                                >
                                  Source link &nearr;
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground italic">
                          No verified evidence found across fetched pages.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Red flags section */}
            {selectedRow?.analysis?.redFlags && selectedRow.analysis.redFlags.length > 0 && (
              <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <h4 className="text-xs font-semibold text-destructive uppercase tracking-wider flex items-center gap-1.5">
                  <span>Potential Red Flags</span>
                  <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                    {selectedRow.analysis.redFlags.length}
                  </Badge>
                </h4>
                <div className="space-y-2.5">
                  {selectedRow.analysis.redFlags.map((flag, idx) => (
                    <div key={idx} className="space-y-1 text-xs">
                      <blockquote className="border-l-2 border-destructive pl-2 italic text-foreground bg-background/50 py-1 rounded-r">
                        &ldquo;{flag.quote}&rdquo;
                      </blockquote>
                      {flag.sourceUrl && (
                        <div className="text-[11px] text-muted-foreground">
                          <a
                            href={flag.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:text-foreground inline-flex items-center gap-0.5"
                          >
                            Source link &nearr;
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pages fetched summary */}
            <div className="space-y-2 border-t pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Pages Fetched Summary
              </h4>
              {selectedRow?.analysis?.pages && selectedRow.analysis.pages.length > 0 ? (
                <ul className="space-y-1 font-mono text-[11px] text-muted-foreground">
                  {selectedRow.analysis.pages.map((p, idx) => (
                    <li
                      key={idx}
                      className="flex justify-between border-b border-dashed pb-0.5 last:border-b-0"
                    >
                      <span>{p.type}:</span>
                      <span>{p.chars.toLocaleString()} chars</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  {selectedRow?.status === "unscorable"
                    ? `Unscorable: ${selectedRow.reason}`
                    : "No pages collected."}
                </p>
              )}

              {selectedRow?.analysis?.skipped && selectedRow.analysis.skipped.length > 0 && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">Skipped: </span>
                  {selectedRow.analysis.skipped.map((s) => `${s.type} (${s.code})`).join(", ")}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
