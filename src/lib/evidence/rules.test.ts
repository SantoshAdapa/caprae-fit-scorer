import { describe, it, expect } from "vitest";
import { extractEvidence, findCriterionMatch } from "./rules";
import { DEFAULT_PROFILE } from "../profile";
import type { CollectedPage } from "../collect";

describe("extractEvidence", () => {
  // Label all synthetic test text as synthetic
  const fixedNow = new Date("2026-01-01T00:00:00Z");

  it("extracts verified evidence for each criterion when present in synthetic text", () => {
    const syntheticPages: CollectedPage[] = [
      {
        type: "home",
        url: "https://synthetic.test/",
        text: "Acme platform is the leading SaaS web app built for businesses and enterprise teams everywhere.",
      },
      {
        type: "pricing",
        url: "https://synthetic.test/pricing",
        text: "Simple transparent pricing starting at $49 per month billed monthly for each team.",
      },
      {
        type: "about",
        url: "https://synthetic.test/about",
        text: "Our journey began when Acme was established in 2018 by engineers passionate about cloud software.",
      },
    ];

    const result = extractEvidence(syntheticPages, DEFAULT_PROFILE, fixedNow);

    expect(result.evidence).toHaveLength(5);
    const sellsSoftware = result.evidence.find((e) => e.criterionId === "sells_software");
    const servesBusinesses = result.evidence.find((e) => e.criterionId === "serves_businesses");
    const visiblePricing = result.evidence.find((e) => e.criterionId === "visible_pricing");
    const recurringModel = result.evidence.find((e) => e.criterionId === "recurring_model");
    const operatingHistory = result.evidence.find((e) => e.criterionId === "operating_history");

    expect(sellsSoftware?.status).toBe("met");
    expect(sellsSoftware?.verified).toBe(true);
    expect(sellsSoftware?.quote).toBeDefined();

    expect(servesBusinesses?.status).toBe("met");
    expect(servesBusinesses?.verified).toBe(true);

    expect(visiblePricing?.status).toBe("met");
    expect(visiblePricing?.verified).toBe(true);
    expect(visiblePricing?.sourceUrl).toBe("https://synthetic.test/pricing");

    expect(recurringModel?.status).toBe("met");
    expect(recurringModel?.verified).toBe(true);

    expect(operatingHistory?.status).toBe("met");
    expect(operatingHistory?.verified).toBe(true);
  });

  it("returns status unknown with no quote when criteria are absent in synthetic text", () => {
    const syntheticEmptyPages: CollectedPage[] = [
      {
        type: "home",
        url: "https://synthetic.test/",
        text: "A nondescript landing page with no company details or commercial information.",
      },
    ];

    const result = extractEvidence(syntheticEmptyPages, DEFAULT_PROFILE, fixedNow);

    for (const ev of result.evidence) {
      expect(ev.status).toBe("unknown");
      expect(ev.verified).toBe(false);
      expect(ev.quote).toBeUndefined();
    }
    expect(result.redFlags).toHaveLength(0);
  });

  it("enforces the 5-year operating history rule with injected now", () => {
    // 2023 is only 3 years old in 2026 -> should not meet criterion
    const syntheticYoungPages: CollectedPage[] = [
      {
        type: "home",
        url: "https://synthetic.test/",
        text: "Founded in 2023 to pioneer modern generative workflows for creators.",
      },
    ];

    const youngResult = extractEvidence(syntheticYoungPages, DEFAULT_PROFILE, fixedNow);
    const youngHistory = youngResult.evidence.find((e) => e.criterionId === "operating_history");
    expect(youngHistory?.status).toBe("unknown");

    // 2020 is 6 years old in 2026 -> should meet criterion
    const syntheticOldPages: CollectedPage[] = [
      {
        type: "home",
        url: "https://synthetic.test/",
        text: "Founded in 2020 to pioneer modern generative workflows for creators.",
      },
    ];

    const oldResult = extractEvidence(syntheticOldPages, DEFAULT_PROFILE, fixedNow);
    const oldHistory = oldResult.evidence.find((e) => e.criterionId === "operating_history");
    expect(oldHistory?.status).toBe("met");
    expect(oldHistory?.verified).toBe(true);
  });

  it("ignores operating history years that appear immediately after copyright notices", () => {
    const syntheticCopyrightPages: CollectedPage[] = [
      {
        type: "home",
        url: "https://synthetic.test/",
        text: "Acme Inc. All rights reserved. Copyright 2015. Please contact our support team.",
      },
    ];

    const res1 = extractEvidence(syntheticCopyrightPages, DEFAULT_PROFILE, fixedNow);
    expect(res1.evidence.find((e) => e.criterionId === "operating_history")?.status).toBe("unknown");

    const syntheticSymbolPages: CollectedPage[] = [
      {
        type: "home",
        url: "https://synthetic.test/",
        text: "All rights reserved. © 2015 Acme Corporation.",
      },
    ];

    const res2 = extractEvidence(syntheticSymbolPages, DEFAULT_PROFILE, fixedNow);
    expect(res2.evidence.find((e) => e.criterionId === "operating_history")?.status).toBe("unknown");
  });

  it("respects page-order preference (pricing first for visible_pricing and recurring_model)", () => {
    const syntheticPages: CollectedPage[] = [
      {
        type: "home",
        url: "https://synthetic.test/",
        text: "Our enterprise plans start at $99 per month for everyone.",
      },
      {
        type: "pricing",
        url: "https://synthetic.test/pricing",
        text: "Official rates: starter is $29 monthly on the pricing page.",
      },
    ];

    const result = extractEvidence(syntheticPages, DEFAULT_PROFILE, fixedNow);
    const pricingEvidence = result.evidence.find((e) => e.criterionId === "visible_pricing");
    const recurringEvidence = result.evidence.find((e) => e.criterionId === "recurring_model");

    // Should prioritize the pricing page over the home page
    expect(pricingEvidence?.pageType).toBe("pricing");
    expect(pricingEvidence?.quote).toContain("$29");

    expect(recurringEvidence?.pageType).toBe("pricing");
    expect(recurringEvidence?.quote).toContain("monthly");
  });

  it("detects funding red flags in synthetic text", () => {
    const syntheticFundingPages: CollectedPage[] = [
      {
        type: "about",
        url: "https://synthetic.test/about",
        text: "In late 2024, Acme announced a $20M Series B funding round led by top venture firms.",
      },
    ];

    const result = extractEvidence(syntheticFundingPages, DEFAULT_PROFILE, fixedNow);
    expect(result.redFlags).toHaveLength(1);
    expect(result.redFlags[0].kind).toBe("funding_mention");
    expect(result.redFlags[0].quote).toContain("Series B");
    expect(result.redFlags[0].verified).toBe(true);
  });

  it("verifies that each extracted quote slices out of its page text exactly", () => {
    const syntheticPages: CollectedPage[] = [
      {
        type: "home",
        url: "https://synthetic.test/",
        text: "Acme is a cloud software platform designed for teams to automate billing.",
      },
    ];

    const result = extractEvidence(syntheticPages, DEFAULT_PROFILE, fixedNow);
    const metEvidence = result.evidence.filter((e) => e.status === "met");

    for (const ev of metEvidence) {
      expect(ev.quote).toBeDefined();
      expect(ev.charStart).toBeDefined();
      expect(ev.charEnd).toBeDefined();
      const page = syntheticPages.find((p) => p.type === ev.pageType);
      expect(page).toBeDefined();
      if (page && ev.charStart !== undefined && ev.charEnd !== undefined) {
        const slice = page.text.slice(ev.charStart, ev.charEnd);
        expect(slice).toBe(ev.quote);
      }
    }
  });

  describe("false-positive regressions and positive controls", () => {
    it("rejects non-commercial software mentions (iana.org and python.org examples)", () => {
      const pages: CollectedPage[] = [
        {
          type: "home",
          url: "https://iana.org/",
          text: "Protocols must use codes that have the same interpretation by every software implementation across networks.",
        },
        {
          type: "about",
          url: "https://python.org/psf",
          text: "The Python Software Foundation is an independent non-profit corporation.",
        },
      ];

      const result = extractEvidence(pages, DEFAULT_PROFILE, fixedNow);
      const sellsSoftware = result.evidence.find((e) => e.criterionId === "sells_software");
      expect(sellsSoftware?.status).toBe("unknown");
      expect(sellsSoftware?.verified).toBe(false);
    });

    it("rejects generic newsletter sign-up text from matching sells_software", () => {
      const pages: CollectedPage[] = [
        {
          type: "home",
          url: "https://blog.test/",
          text: "Sign up for our newsletter to receive weekly productivity tips and updates.",
        },
      ];

      const result = extractEvidence(pages, DEFAULT_PROFILE, fixedNow);
      const sellsSoftware = result.evidence.find((e) => e.criterionId === "sells_software");
      expect(sellsSoftware?.status).toBe("unknown");
    });

    it("rejects operational report cadences from matching recurring_model (iana.org example)", () => {
      const pages: CollectedPage[] = [
        {
          type: "home",
          url: "https://iana.org/performance",
          text: "We review operational performance commitments at a glance and in monthly reports.",
        },
      ];

      const result = extractEvidence(pages, DEFAULT_PROFILE, fixedNow);
      const recurring = result.evidence.find((e) => e.criterionId === "recurring_model");
      expect(recurring?.status).toBe("unknown");
    });

    it("rejects one-time per-user and per-seat pricing without recurring context from matching recurring_model", () => {
      const pages: CollectedPage[] = [
        {
          type: "pricing",
          url: "https://onetime.test/pricing",
          text: "One-time perpetual license: $499 per user flat fee, or $2,500 per seat with no recurring charges.",
        },
      ];

      const result = extractEvidence(pages, DEFAULT_PROFILE, fixedNow);
      const recurring = result.evidence.find((e) => e.criterionId === "recurring_model");
      expect(recurring?.status).toBe("unknown");
      expect(recurring?.verified).toBe(false);
    });

    it("matches positive controls for explicit recurring cadences (per month, /mo, billed annually)", () => {
      const pages: CollectedPage[] = [
        {
          type: "pricing",
          url: "https://recurring.test/pricing",
          text: "Starter plan is $12/mo per seat or $10 per user per month billed annually. Cancel anytime.",
        },
      ];

      const result = extractEvidence(pages, DEFAULT_PROFILE, fixedNow);
      const recurring = result.evidence.find((e) => e.criterionId === "recurring_model");
      expect(recurring?.status).toBe("met");
      expect(recurring?.verified).toBe(true);
      expect(recurring?.quote).toBeDefined();
    });

    it("rejects donation amounts and foundation grants from matching visible_pricing", () => {
      const pages: CollectedPage[] = [
        {
          type: "home",
          url: "https://nonprofit.test/",
          text: "Please support our mission: donate $25 or $50 today. All gifts are tax-deductible.",
        },
        {
          type: "about",
          url: "https://nonprofit.test/about",
          text: "In 2024, our research team received a $100,000 grant from philanthropic partners.",
        },
      ];

      const result = extractEvidence(pages, DEFAULT_PROFILE, fixedNow);
      const pricing = result.evidence.find((e) => e.criterionId === "visible_pricing");
      expect(pricing?.status).toBe("unknown");
    });

    it("preserves legitimate product pricing even when donation text is within 50 characters", () => {
      // Proximity test: 'donation' is only 23 characters away from '$49'
      const proximatePages: CollectedPage[] = [
        {
          type: "pricing",
          url: "https://saas-community.test/pricing",
          text: "Support our open-source tools with a donation. Pro plan is $49 per month for teams.",
        },
      ];

      const result = extractEvidence(proximatePages, DEFAULT_PROFILE, fixedNow);
      const pricing = result.evidence.find((e) => e.criterionId === "visible_pricing");
      expect(pricing?.status).toBe("met");
      expect(pricing?.verified).toBe(true);
      expect(pricing?.quote).toContain("$49");
    });

    it("rejects donation amount in mixed clause and selects only the commercial price by character offset", () => {
      const mixedText =
        "Donate $25 to the foundation or buy our commercial software license for $99.";

      // 1. Direct offset assertion: proves $25 was rejected and $99 was selected
      const match = findCriterionMatch("visible_pricing", mixedText, fixedNow);
      expect(match).not.toBeNull();
      expect(match?.start).toBe(mixedText.indexOf("$99"));
      expect(match?.end).toBe(mixedText.indexOf("$99") + 3);
      expect(mixedText.slice(match!.start, match!.end)).toBe("$99");
      expect(match?.start).not.toBe(mixedText.indexOf("$25"));

      // 2. Integration via extractEvidence: quote verification and page slice integrity
      const mixedPages: CollectedPage[] = [
        {
          type: "pricing",
          url: "https://dual-model.test/pricing",
          text: mixedText,
        },
      ];

      const result = extractEvidence(mixedPages, DEFAULT_PROFILE, fixedNow);
      const pricing = result.evidence.find((e) => e.criterionId === "visible_pricing");
      expect(pricing?.status).toBe("met");
      expect(pricing?.verified).toBe(true);
      expect(pricing?.charStart).toBeDefined();
      expect(pricing?.charEnd).toBeDefined();
      expect(mixedText.slice(pricing!.charStart!, pricing!.charEnd!)).toBe(pricing!.quote);
      expect(pricing?.quote).toContain("$99");
    });

    it("isolates commercial price quote without donation amount when separated by text", () => {
      const separatedText =
        "Please donate $25 to support our open-source community foundation and research initiatives. " +
        "We provide educational materials to public schools across the country. " +
        "For commercial enterprise deployment, our software license is $99 per seat.";

      // 1. Direct offset assertion on separated text
      const match = findCriterionMatch("visible_pricing", separatedText, fixedNow);
      expect(match).not.toBeNull();
      expect(match?.start).toBe(separatedText.indexOf("$99"));
      expect(match?.end).toBe(separatedText.indexOf("$99") + 3);
      expect(separatedText.slice(match!.start, match!.end)).toBe("$99");
      expect(match?.start).not.toBe(separatedText.indexOf("$25"));

      // 2. Integration via extractEvidence: quote isolates $99 without $25
      const separatedPages: CollectedPage[] = [
        {
          type: "pricing",
          url: "https://dual-model-separated.test/pricing",
          text: separatedText,
        },
      ];

      const result = extractEvidence(separatedPages, DEFAULT_PROFILE, fixedNow);
      const pricing = result.evidence.find((e) => e.criterionId === "visible_pricing");
      expect(pricing?.status).toBe("met");
      expect(pricing?.verified).toBe(true);
      expect(pricing?.charStart).toBeDefined();
      expect(pricing?.charEnd).toBeDefined();
      expect(separatedText.slice(pricing!.charStart!, pricing!.charEnd!)).toBe(pricing!.quote);
      expect(pricing?.quote).toContain("$99");
      expect(pricing?.quote).not.toContain("$25");
    });

    it("rejects generic and non-commercial mentions of platform and dashboard", () => {
      const pages: CollectedPage[] = [
        {
          type: "home",
          url: "https://civic.test/",
          text: "Our political platform advocates for clean energy, and passengers on the subway platform must wait behind the line.",
        },
        {
          type: "about",
          url: "https://civic.test/health",
          text: "The state health department maintains a public health dashboard, while the vehicle dashboard monitors tire pressure.",
        },
      ];

      const result = extractEvidence(pages, DEFAULT_PROFILE, fixedNow);
      const sellsSoftware = result.evidence.find((e) => e.criterionId === "sells_software");
      expect(sellsSoftware?.status).toBe("unknown");
      expect(sellsSoftware?.verified).toBe(false);
    });

    it("matches positive controls for legitimate SaaS tools using platform or dashboard (Linear, Slack, Zapier, Basecamp)", () => {
      const testCases = [
        {
          name: "Linear",
          text: "Linear is a developer platform built for high-performance engineering teams.",
          expected: "developer platform",
        },
        {
          name: "Slack",
          text: "Slack is an enterprise collaboration platform for teams to work together.",
          expected: "collaboration platform",
        },
        {
          name: "Zapier",
          text: "Zapier is a workflow automation platform that connects thousands of work apps.",
          expected: "automation platform",
        },
        {
          name: "Basecamp",
          text: "Basecamp is a project management tool with an intuitive team dashboard for businesses.",
          expected: "team dashboard",
        },
      ];

      for (const tc of testCases) {
        const pages: CollectedPage[] = [
          {
            type: "home",
            url: `https://${tc.name.toLowerCase()}.test/`,
            text: tc.text,
          },
        ];
        const result = extractEvidence(pages, DEFAULT_PROFILE, fixedNow);
        const sellsSoftware = result.evidence.find((e) => e.criterionId === "sells_software");
        expect(sellsSoftware?.status, `Failed for ${tc.name}`).toBe("met");
        expect(sellsSoftware?.verified, `Verification failed for ${tc.name}`).toBe(true);
        expect(sellsSoftware?.quote, `Quote mismatch for ${tc.name}`).toContain(tc.expected);
      }
    });

    it("matches positive controls for legitimate B2B SaaS product, pricing, and billing terms", () => {
      const pages: CollectedPage[] = [
        {
          type: "home",
          url: "https://saas.test/",
          text: "Acme is a cloud software platform built for teams. Start your 14-day free trial or request a demo.",
        },
        {
          type: "pricing",
          url: "https://saas.test/pricing",
          text: "Transparent pricing: Team plan is $29 per user/month, billed annually or $35 billed monthly.",
        },
      ];

      const result = extractEvidence(pages, DEFAULT_PROFILE, fixedNow);
      expect(result.evidence.find((e) => e.criterionId === "sells_software")?.status).toBe("met");
      expect(result.evidence.find((e) => e.criterionId === "visible_pricing")?.status).toBe("met");
      expect(result.evidence.find((e) => e.criterionId === "recurring_model")?.status).toBe("met");
    });
  });
});
