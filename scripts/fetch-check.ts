/**
 * CLI utility to test real website fetching against real DNS and SSRF guards.
 *
 * Usage: npx tsx scripts/fetch-check.ts example.com iana.org
 */

import { collectPages } from "../src/lib/collect";

async function main() {
  const domains = process.argv.slice(2);

  if (domains.length === 0) {
    console.error("Usage: npx tsx scripts/fetch-check.ts <domain1> [domain2 ...]");
    process.exit(1);
  }

  for (const domain of domains) {
    console.log(`\n========================================`);
    console.log(`Domain: ${domain}`);
    console.log(`========================================`);

    try {
      const result = await collectPages(domain);

      console.log(`Status:       ${result.status}`);
      console.log(`Failure code: ${result.failureCode ?? "none"}`);

      if (result.pages.length > 0) {
        console.log(`Pages fetched (${result.pages.length}):`);
        for (const page of result.pages) {
          console.log(
            `  - [${page.type}] ${page.url} (${page.text.length.toLocaleString()} chars)`
          );
        }
      } else {
        console.log(`Pages fetched: none`);
      }

      if (result.skipped.length > 0) {
        console.log(`Skipped pages (${result.skipped.length}):`);
        for (const skip of result.skipped) {
          console.log(`  - [${skip.type}] code: ${skip.code}`);
        }
      } else {
        console.log(`Skipped pages: none`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Unexpected error collecting ${domain}:`, msg);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
