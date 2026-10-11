"use client";

import * as React from "react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
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
  MAX_DOMAINS_PER_RUN,
  parseDomainList,
  dedupeDomains,
} from "@/lib/domain";
import { FAILURE_MESSAGES } from "@/lib/failureMessages";
import { runQueue } from "@/lib/runQueue";
import type { FetchSummary } from "@/lib/api-types";
import type { FailureCode } from "@/lib/types";

type RowStatus = "queued" | "running" | "fetched" | "unscorable" | "error";

interface DomainRow {
  domain: string;
  status: RowStatus;
  reason: string;
  pagesFetched: string;
  skipped: string;
}

export function FitScorerApp() {
  const [inputText, setInputText] = React.useState("");
  const [isRunning, setIsRunning] = React.useState(false);
  const [rows, setRows] = React.useState<DomainRow[]>([]);

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

    // Initialise rows with queued status
    const initialRows: DomainRow[] = effectiveDomains.map((d) => ({
      domain: d,
      status: "queued",
      reason: "Waiting in queue...",
      pagesFetched: "-",
      skipped: "-",
    }));
    setRows(initialRows);

    await runQueue(
      effectiveDomains,
      async (domain: string): Promise<DomainRow> => {
        try {
          const res = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain }),
          });

          if (res.status === 200) {
            const data: FetchSummary = await res.json();
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
                status: "fetched",
                reason: "-",
                pagesFetched: pagesStr,
                skipped: skippedStr,
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
                status: "unscorable",
                reason,
                pagesFetched: pagesStr,
                skipped: skippedStr,
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
              status: "error",
              reason,
              pagesFetched: "-",
              skipped: "-",
            };
          }

          if (res.status === 403) {
            return {
              domain,
              status: "error",
              reason: FAILURE_MESSAGES.NOT_ALLOWLISTED,
              pagesFetched: "-",
              skipped: "-",
            };
          }

          if (res.status === 429) {
            return {
              domain,
              status: "error",
              reason: "Rate limit exceeded (try again later)",
              pagesFetched: "-",
              skipped: "-",
            };
          }

          if (res.status === 500) {
            return {
              domain,
              status: "error",
              reason: FAILURE_MESSAGES.INTERNAL_ERROR,
              pagesFetched: "-",
              skipped: "-",
            };
          }

          return {
            domain,
            status: "error",
            reason: `HTTP ${res.status} response`,
            pagesFetched: "-",
            skipped: "-",
          };
        } catch {
          return {
            domain,
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
    <div className="w-full max-w-4xl space-y-6">
      <Alert>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>
          Fetch results only. Scoring comes next.
        </AlertDescription>
      </Alert>

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

      {rows.length > 0 && (
        <div className="rounded-md border mt-8">
          <Table>
            <TableCaption>
              Fetch results for analyzed domains ({rows.length} total)
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Domain</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Pages fetched</TableHead>
                <TableHead>Skipped</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.domain}>
                  <TableCell className="font-mono font-medium">
                    {row.domain}
                  </TableCell>
                  <TableCell>{renderBadge(row.status)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.reason}
                  </TableCell>
                  <TableCell className="text-xs">{row.pagesFetched}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.skipped}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
