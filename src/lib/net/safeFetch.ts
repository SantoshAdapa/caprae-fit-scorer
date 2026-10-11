/**
 * Security-hardened HTTP fetching utility.
 *
 * Implements strict protection against Server-Side Request Forgery (SSRF),
 * DNS rebinding, oversized responses, and slow-loris / timeout attacks.
 */

import net from "node:net";
import zlib from "node:zlib";
import dnsPromises from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { request, Agent } from "undici";
import type { FailureCode } from "../types";
import { isAddressAllowed } from "./ip";

export const DEFAULT_USER_AGENT =
  "CapraeFitScorerBot/0.1 (+https://caprae-fit-scorer.vercel.app)";

export type SafeFetchResult =
  | {
      ok: true;
      finalUrl: string;
      status: number;
      contentType: string;
      body: string;
      redirects: number;
    }
  | {
      ok: false;
      code: FailureCode;
      detail?: string;
    };

export interface SafeFetchOptions {
  maxBytes?: number;
  acceptText?: boolean;
  timeoutMs?: number;
}

export type ResolveItem = { address: string; family?: number } | string;

export interface SafeFetchDeps {
  resolve?: (hostname: string) => Promise<ResolveItem[]> | ResolveItem[];
  isAddressAllowed?: (ip: string) => boolean;
  allowedPorts?: number[];
  timeoutMs?: number;
}

interface ErrorDetails {
  name?: string;
  code?: string;
  message?: string;
  cause?: unknown;
}

function getErrorDetails(err: unknown): ErrorDetails | null {
  if (err && typeof err === "object") {
    return err as ErrorDetails;
  }
  return null;
}

interface Destroyable {
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  destroy?: () => unknown;
}

function destroyBody(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const d = body as Destroyable;
  try {
    d.on?.("error", () => {});
    d.destroy?.();
  } catch {}
}

/** Check if host is an IP literal (IPv4 or IPv6 in brackets/raw). */
function isIpLiteral(hostname: string): boolean {
  const clean = hostname.replace(/^\[|\]$/g, "");
  return net.isIP(clean) !== 0 || net.isIP(hostname) !== 0;
}

function isGuardError(err: unknown): boolean {
  const details = getErrorDetails(err);
  if (!details) return false;
  if (details.code === "BLOCKED_PRIVATE_ADDRESS") return true;
  if (details.cause && isGuardError(details.cause)) return true;
  return false;
}

function isTimeoutError(err: unknown): boolean {
  const details = getErrorDetails(err);
  if (!details) return false;
  if (
    details.name === "TimeoutError" ||
    details.code === "UND_ERR_HEADERS_TIMEOUT" ||
    details.code === "UND_ERR_BODY_TIMEOUT" ||
    details.code === "ABORT_ERR" ||
    (details.name === "AbortError" && /timeout/i.test(details.message || ""))
  ) {
    return true;
  }
  if (details.cause && isTimeoutError(details.cause)) return true;
  return false;
}

function isDnsError(err: unknown): boolean {
  const details = getErrorDetails(err);
  if (!details) return false;
  if (
    details.code === "ENOTFOUND" ||
    details.code === "EAI_AGAIN" ||
    details.code === "EHOSTUNREACH" ||
    details.code === "ENETUNREACH"
  ) {
    return true;
  }
  if (details.cause && isDnsError(details.cause)) return true;
  return false;
}

/**
 * Perform a safe, SSRF-guarded HTTP request.
 */
export async function safeFetch(
  url: string,
  opts?: SafeFetchOptions,
  deps?: SafeFetchDeps
): Promise<SafeFetchResult> {
  const resolveFn = deps?.resolve ?? (async (h) => dnsPromises.lookup(h, { all: true }));
  const isAddressAllowedFn = deps?.isAddressAllowed ?? isAddressAllowed;
  const allowedPorts = deps?.allowedPorts ?? [80, 443];
  const timeoutMs = opts?.timeoutMs ?? deps?.timeoutMs ?? 8000;
  const maxBytes = opts?.maxBytes ?? 1_000_000;
  const acceptText = opts?.acceptText ?? false;

  // Custom agent with guarded connect.lookup
  const agent = new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        Promise.resolve(resolveFn(hostname))
          .then((resolved) => {
            if (!resolved || resolved.length === 0) {
              const err = new Error(`DNS resolution failed for ${hostname}`) as NodeJS.ErrnoException;
              err.code = "ENOTFOUND";
              callback(err, [] as LookupAddress[]);
              return;
            }

            // Guarded check: verify all returned addresses
            for (const item of resolved) {
              const ip = typeof item === "string" ? item : item.address;
              if (!isAddressAllowedFn(ip)) {
                const err = new Error(`Blocked private or disallowed address: ${ip}`) as NodeJS.ErrnoException;
                err.code = "BLOCKED_PRIVATE_ADDRESS";
                callback(err, [] as LookupAddress[]);
                return;
              }
            }

            const isAll = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
            if (isAll) {
              const list: LookupAddress[] = resolved.map((item) => {
                const ip = typeof item === "string" ? item : item.address;
                const fam =
                  typeof item === "string"
                    ? (ip.includes(":") ? 6 : 4)
                    : (item.family ?? (ip.includes(":") ? 6 : 4));
                return { address: ip, family: fam };
              });
              // Type assertion matches Node's dual callback signature
              (callback as (err: Error | null, addresses: LookupAddress[]) => void)(null, list);
            } else {
              const first = resolved[0];
              const ip = typeof first === "string" ? first : first.address;
              const fam =
                typeof first === "string"
                  ? (ip.includes(":") ? 6 : 4)
                  : (first.family ?? (ip.includes(":") ? 6 : 4));
              (callback as (err: Error | null, address: string, family: number) => void)(null, ip, fam);
            }
          })
          .catch((err) => {
            callback(err instanceof Error ? err : new Error(String(err)), [] as LookupAddress[]);
          });
      },
    },
  });

  let currentUrl = url;
  let redirectCount = 0;
  const maxRedirects = 3;
  let initialHost: string | null = null;

  try {
    while (true) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(currentUrl);
      } catch {
        return { ok: false, code: "INVALID_DOMAIN", detail: "Malformed URL" };
      }

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return {
          ok: false,
          code: "HTTP_ERROR",
          detail: `Unsupported protocol: ${parsedUrl.protocol}`,
        };
      }

      if (parsedUrl.username || parsedUrl.password) {
        return {
          ok: false,
          code: "BLOCKED_PRIVATE_ADDRESS",
          detail: "URL userinfo not allowed",
        };
      }

      const port = parsedUrl.port
        ? parseInt(parsedUrl.port, 10)
        : parsedUrl.protocol === "https:"
        ? 443
        : 80;

      if (!allowedPorts.includes(port)) {
        return {
          ok: false,
          code: "BLOCKED_PRIVATE_ADDRESS",
          detail: `Port ${port} not allowed`,
        };
      }

      if (isIpLiteral(parsedUrl.hostname)) {
        return {
          ok: false,
          code: "BLOCKED_PRIVATE_ADDRESS",
          detail: "Direct IP literal host is not allowed",
        };
      }

      const currentHost = parsedUrl.hostname.toLowerCase();
      if (initialHost === null) {
        initialHost = currentHost;
      } else {
        const normInit = initialHost.replace(/^www\./, "");
        const normCurrent = currentHost.replace(/^www\./, "");
        if (normInit !== normCurrent) {
          return {
            ok: false,
            code: "REDIRECTED_OFFSITE",
            detail: `Redirected offsite to ${currentHost}`,
          };
        }
      }

      const res = await request(currentUrl, {
        dispatcher: agent,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": DEFAULT_USER_AGENT,
          "accept-encoding": "gzip, deflate, br",
        },
      });

      // Handle redirect status codes
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        redirectCount++;
        destroyBody(res.body);

        if (redirectCount > maxRedirects) {
          return {
            ok: false,
            code: "HTTP_ERROR",
            detail: "Too many redirects (exceeded 3)",
          };
        }

        const nextLocation = new URL(
          res.headers.location as string,
          currentUrl
        ).href;
        currentUrl = nextLocation;
        continue;
      }

      const contentType = (res.headers["content-type"] as string) || "";
      const lowerCt = contentType.toLowerCase();

      if (acceptText) {
        if (!lowerCt.includes("text/")) {
          destroyBody(res.body);
          return {
            ok: false,
            code: "NOT_HTML",
            detail: `Content-Type "${contentType}" is not text/*`,
          };
        }
      } else {
        if (!lowerCt.includes("text/html")) {
          destroyBody(res.body);
          return {
            ok: false,
            code: "NOT_HTML",
            detail: `Content-Type "${contentType}" does not contain text/html`,
          };
        }
      }

      const chunks: Buffer[] = [];
      let totalBytes = 0;

      for await (const chunk of res.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (totalBytes > maxBytes) {
          destroyBody(res.body);
          return {
            ok: false,
            code: "TOO_LARGE",
            detail: `Response body exceeded limit of ${maxBytes} bytes`,
          };
        }
        chunks.push(buf);
      }

      let rawBuffer = Buffer.concat(chunks);
      const contentEncoding = (
        (res.headers["content-encoding"] as string) || ""
      ).toLowerCase();

      if (contentEncoding) {
        try {
          if (contentEncoding.includes("br")) {
            rawBuffer = zlib.brotliDecompressSync(rawBuffer);
          } else if (contentEncoding.includes("gzip")) {
            rawBuffer = zlib.gunzipSync(rawBuffer);
          } else if (contentEncoding.includes("deflate")) {
            try {
              rawBuffer = zlib.inflateSync(rawBuffer);
            } catch {
              rawBuffer = zlib.inflateRawSync(rawBuffer);
            }
          }
        } catch {
          return {
            ok: false,
            code: "HTTP_ERROR",
            detail: `Failed to decompress ${contentEncoding} payload`,
          };
        }
      }

      const bodyText = rawBuffer.toString("utf-8");

      return {
        ok: true,
        finalUrl: currentUrl,
        status: res.statusCode,
        contentType,
        body: bodyText,
        redirects: redirectCount,
      };
    }
  } catch (err: unknown) {
    if (isGuardError(err)) {
      const details = getErrorDetails(err);
      return {
        ok: false,
        code: "BLOCKED_PRIVATE_ADDRESS",
        detail: details?.message,
      };
    }
    if (isTimeoutError(err)) {
      const details = getErrorDetails(err);
      return {
        ok: false,
        code: "TIMEOUT",
        detail: details?.message,
      };
    }
    if (isDnsError(err)) {
      const details = getErrorDetails(err);
      return {
        ok: false,
        code: "DNS_FAILED",
        detail: details?.message,
      };
    }
    const details = getErrorDetails(err);
    return {
      ok: false,
      code: "HTTP_ERROR",
      detail: details?.message || String(err),
    };
  } finally {
    await agent.destroy();
  }
}
