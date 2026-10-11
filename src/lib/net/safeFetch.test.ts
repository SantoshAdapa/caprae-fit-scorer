import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";
import { safeFetch } from "./safeFetch";
import { isAddressAllowed } from "./ip";

describe("safeFetch", () => {
  let server: http.Server;
  let serverPort: number;
  let connectionCount = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      connectionCount++;
      const url = new URL(req.url || "/", `http://127.0.0.1:${serverPort}`);

      if (url.pathname === "/normal") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.writeHead(200);
        res.end("<html><body>Hello World</body></html>");
        return;
      }

      if (url.pathname === "/redirect-ip") {
        res.writeHead(302, { Location: "http://169.254.169.254/" });
        res.end();
        return;
      }

      if (url.pathname === "/redirect-offsite") {
        res.writeHead(302, { Location: "http://different.test/page" });
        res.end();
        return;
      }

      if (url.pathname === "/redirect-www") {
        res.writeHead(302, { Location: `http://ok.test:${serverPort}/normal` });
        res.end();
        return;
      }

      if (url.pathname === "/loop") {
        const count = parseInt(url.searchParams.get("count") || "0", 10);
        res.writeHead(302, { Location: `http://ok.test:${serverPort}/loop?count=${count + 1}` });
        res.end();
        return;
      }

      if (url.pathname === "/large") {
        res.setHeader("Content-Type", "text/html");
        res.writeHead(200);
        // Send chunks exceeding 1 MB
        const chunk = "X".repeat(64 * 1024);
        for (let i = 0; i < 20; i++) {
          res.write(chunk);
        }
        res.end();
        return;
      }

      if (url.pathname === "/slow") {
        // Delay response beyond test timeout
        setTimeout(() => {
          res.setHeader("Content-Type", "text/html");
          res.writeHead(200);
          res.end("slow");
        }, 300);
        return;
      }

      if (url.pathname === "/non-html") {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      res.writeHead(404);
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        serverPort = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns ok for a normal page", async () => {
    const res = await safeFetch(`http://ok.test:${serverPort}/normal`, undefined, {
      allowedPorts: [serverPort],
      isAddressAllowed: () => true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.status).toBe(200);
      expect(res.body).toContain("Hello World");
      expect(res.contentType).toContain("text/html");
      expect(res.redirects).toBe(0);
    }
  });

  it("returns BLOCKED_PRIVATE_ADDRESS on redirect to literal IP (169.254.169.254)", async () => {
    const res = await safeFetch(`http://ok.test:${serverPort}/redirect-ip`, undefined, {
      allowedPorts: [serverPort, 80],
      isAddressAllowed: () => true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("BLOCKED_PRIVATE_ADDRESS");
    }
  });

  it("returns REDIRECTED_OFFSITE on redirect to different host", async () => {
    const res = await safeFetch(`http://ok.test:${serverPort}/redirect-offsite`, undefined, {
      allowedPorts: [serverPort, 80],
      isAddressAllowed: () => true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("REDIRECTED_OFFSITE");
    }
  });

  it("follows a www-to-bare (or bare-to-www) redirect on same host", async () => {
    const res = await safeFetch(`http://www.ok.test:${serverPort}/redirect-www`, undefined, {
      allowedPorts: [serverPort],
      isAddressAllowed: () => true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.status).toBe(200);
      expect(res.redirects).toBe(1);
      expect(res.body).toContain("Hello World");
    }
  });

  it("fails when there are more than 3 redirects", async () => {
    const res = await safeFetch(`http://ok.test:${serverPort}/loop?count=0`, undefined, {
      allowedPorts: [serverPort],
      isAddressAllowed: () => true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("HTTP_ERROR");
    }
  });

  it("returns TOO_LARGE when body exceeds limit", async () => {
    const res = await safeFetch(`http://ok.test:${serverPort}/large`, { maxBytes: 50000 }, {
      allowedPorts: [serverPort],
      isAddressAllowed: () => true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("TOO_LARGE");
    }
  });

  it("returns TIMEOUT when request exceeds deadline", async () => {
    const res = await safeFetch(`http://ok.test:${serverPort}/slow`, undefined, {
      allowedPorts: [serverPort],
      isAddressAllowed: () => true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      // Inject short timeout for test
      timeoutMs: 100,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("TIMEOUT");
    }
  });

  it("returns NOT_HTML when response is non-HTML", async () => {
    const res = await safeFetch(`http://ok.test:${serverPort}/non-html`, undefined, {
      allowedPorts: [serverPort],
      isAddressAllowed: () => true,
      resolve: async () => [{ address: "127.0.0.1", family: 4 }],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("NOT_HTML");
    }
  });

  describe("critical SSRF & DNS rebinding tests", () => {
    it("(a) returns BLOCKED_PRIVATE_ADDRESS and records ZERO connections with real isAddressAllowed", async () => {
      const priorCount = connectionCount;

      const res = await safeFetch(`http://evil.test:${serverPort}/normal`, undefined, {
        allowedPorts: [serverPort],
        isAddressAllowed: isAddressAllowed, // REAL validator
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("BLOCKED_PRIVATE_ADDRESS");
      }
      expect(connectionCount).toBe(priorCount);
    });

    it("(b) blocks when resolve returns [8.8.8.8, 10.0.0.1]", async () => {
      const res = await safeFetch(`http://mixed.test:${serverPort}/normal`, undefined, {
        allowedPorts: [serverPort],
        isAddressAllowed: isAddressAllowed,
        resolve: async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ],
      });

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("BLOCKED_PRIVATE_ADDRESS");
      }
    });

    it("(c) blocks direct IP literal URLs outright", async () => {
      const urls = [
        "http://127.0.0.1/normal",
        "http://[::1]/normal",
        "http://2130706433/normal",
        "http://0x7f.0.0.1/normal",
      ];

      for (const url of urls) {
        const res = await safeFetch(url);
        expect(res.ok).toBe(false);
        if (!res.ok) {
          expect(res.code).toBe("BLOCKED_PRIVATE_ADDRESS");
        }
      }
    });
  });
});
