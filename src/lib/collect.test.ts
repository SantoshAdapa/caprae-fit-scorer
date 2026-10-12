import { describe, it, expect, vi } from "vitest";
import { collectPages, extractText } from "./collect";
import type { SafeFetchResult } from "./net/safeFetch";

describe("extractText", () => {
  it("removes script, style, noscript, svg, template, iframe and collapses whitespace", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>body { color: red; }</style>
          <script>console.log("secret");</script>
        </head>
        <body>
          <noscript>Need JS</noscript>
          <svg><path d="M0 0"/></svg>
          <template><div>Hidden</div></template>
          <iframe src="/frame"></iframe>
          <h1>  Hello   World  </h1>
          <p>This is a    test paragraph.   </p>
        </body>
      </html>
    `;

    const text = extractText(html);
    expect(text).toBe("Hello World This is a test paragraph.");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("color: red");
    expect(text).not.toContain("Need JS");
  });

  it("caps text at 100,000 characters", () => {
    const longHtml = `<body>${"A".repeat(150_000)}</body>`;
    const text = extractText(longHtml);
    expect(text.length).toBe(100_000);
  });

  it("separates adjacent tags with whitespace instead of merging words", () => {
    const html = `<body><nav><a href="/p">Product</a><a href="/r">Resources</a></nav><p>First sentence.</p><p>Second sentence.</p></body>`;
    const text = extractText(html);
    expect(text).toBe("Product Resources First sentence. Second sentence.");
  });
});

describe("collectPages", () => {
  const dummyLongText = "A".repeat(400);
  const syntheticHtml = `<html><body><h1>Company</h1><p>${dummyLongText}</p></body></html>`;

  it("collects home, pricing, and about pages successfully", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return {
          ok: true,
          status: 200,
          contentType: "text/plain",
          body: "User-agent: *\nAllow: /",
          finalUrl: url,
          redirects: 0,
        } as SafeFetchResult;
      }
      return {
        ok: true,
        status: 200,
        contentType: "text/html",
        body: syntheticHtml,
        finalUrl: url,
        redirects: 0,
      } as SafeFetchResult;
    });

    const res = await collectPages("example.com", {
      fetch: mockFetch,
      delayMs: 0,
    });

    expect(res.status).toBe("ok");
    expect(res.pages).toHaveLength(3);
    expect(res.pages.map((p) => p.type)).toEqual(["home", "pricing", "about"]);
    expect(res.skipped).toHaveLength(0);
  });

  it("falls back to http when https connection fails for homepage", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.startsWith("https://")) {
        return {
          ok: false,
          code: "HTTP_ERROR",
          detail: "ECONNREFUSED",
        } as SafeFetchResult;
      }
      if (url.endsWith("/robots.txt")) {
        return {
          ok: true,
          status: 404,
          contentType: "text/plain",
          body: "Not Found",
          finalUrl: url,
          redirects: 0,
        } as SafeFetchResult;
      }
      return {
        ok: true,
        status: 200,
        contentType: "text/html",
        body: syntheticHtml,
        finalUrl: url,
        redirects: 0,
      } as SafeFetchResult;
    });

    const res = await collectPages("example.com", {
      fetch: mockFetch,
      delayMs: 0,
    });

    expect(res.status).toBe("ok");
    expect(res.pages[0].url).toContain("http://example.com");
  });

  it("returns ROBOTS_DISALLOWED when homepage is disallowed", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return {
          ok: true,
          status: 200,
          contentType: "text/plain",
          body: "User-agent: *\nDisallow: /",
          finalUrl: url,
          redirects: 0,
        } as SafeFetchResult;
      }
      return {
        ok: true,
        status: 200,
        contentType: "text/html",
        body: syntheticHtml,
        finalUrl: url,
        redirects: 0,
      } as SafeFetchResult;
    });

    const res = await collectPages("example.com", {
      fetch: mockFetch,
      delayMs: 0,
    });

    expect(res.status).toBe("unscorable");
    expect(res.failureCode).toBe("ROBOTS_DISALLOWED");
    expect(res.pages).toHaveLength(0);
  });

  it("returns BOT_PROTECTION on 403/429/503 with challenge markers", async () => {
    for (const marker of ["Just a moment...", "cf-chl", "Attention Required", "captcha challenge"]) {
      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/robots.txt")) {
          return { ok: true, status: 404, body: "", redirects: 0 } as SafeFetchResult;
        }
        return {
          ok: true,
          status: 403,
          contentType: "text/html",
          body: `<html><body>${marker}</body></html>`,
          finalUrl: url,
          redirects: 0,
        } as SafeFetchResult;
      });

      const res = await collectPages("example.com", {
        fetch: mockFetch,
        delayMs: 0,
      });

      expect(res.status).toBe("unscorable");
      expect(res.failureCode).toBe("BOT_PROTECTION");
    }
  });

  it("returns HTTP_ERROR on other non-2xx homepage", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return { ok: true, status: 404, body: "", redirects: 0 } as SafeFetchResult;
      }
      return {
        ok: true,
        status: 500,
        contentType: "text/html",
        body: `<html><body>Internal Server Error</body></html>`,
        finalUrl: url,
        redirects: 0,
      } as SafeFetchResult;
    });

    const res = await collectPages("example.com", {
      fetch: mockFetch,
      delayMs: 0,
    });

    expect(res.status).toBe("unscorable");
    expect(res.failureCode).toBe("HTTP_ERROR");
  });

  it("returns JS_RENDERED_OR_EMPTY if homepage visible text is < 300 chars", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return { ok: true, status: 404, body: "", redirects: 0 } as SafeFetchResult;
      }
      return {
        ok: true,
        status: 200,
        contentType: "text/html",
        body: `<html><body><div id="root">Loading application...</div></body></html>`,
        finalUrl: url,
        redirects: 0,
      } as SafeFetchResult;
    });

    const res = await collectPages("example.com", {
      fetch: mockFetch,
      delayMs: 0,
    });

    expect(res.status).toBe("unscorable");
    expect(res.failureCode).toBe("JS_RENDERED_OR_EMPTY");
  });

  it("returns REDIRECTED_OFFSITE when homepage redirects offsite", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return { ok: true, status: 404, body: "", redirects: 0 } as SafeFetchResult;
      }
      return {
        ok: false,
        code: "REDIRECTED_OFFSITE",
        detail: "Redirected to other.com",
      } as SafeFetchResult;
    });

    const res = await collectPages("example.com", {
      fetch: mockFetch,
      delayMs: 0,
    });

    expect(res.status).toBe("unscorable");
    expect(res.failureCode).toBe("REDIRECTED_OFFSITE");
  });

  it("skips /pricing and /about on 404 or robots disallow without marking site unscorable", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith("/robots.txt")) {
        return {
          ok: true,
          status: 200,
          contentType: "text/plain",
          body: "User-agent: *\nDisallow: /about",
          finalUrl: url,
          redirects: 0,
        } as SafeFetchResult;
      }
      if (url.endsWith("/pricing")) {
        return {
          ok: true,
          status: 404,
          contentType: "text/html",
          body: "Not Found",
          finalUrl: url,
          redirects: 0,
        } as SafeFetchResult;
      }
      return {
        ok: true,
        status: 200,
        contentType: "text/html",
        body: syntheticHtml,
        finalUrl: url,
        redirects: 0,
      } as SafeFetchResult;
    });

    const res = await collectPages("example.com", {
      fetch: mockFetch,
      delayMs: 0,
    });

    expect(res.status).toBe("ok");
    expect(res.pages).toHaveLength(1);
    expect(res.pages[0].type).toBe("home");
    expect(res.skipped).toHaveLength(2);
    expect(res.skipped).toContainEqual({ type: "pricing", code: "NOT_FOUND" });
    expect(res.skipped).toContainEqual({ type: "about", code: "ROBOTS_DISALLOWED" });
  });
});
