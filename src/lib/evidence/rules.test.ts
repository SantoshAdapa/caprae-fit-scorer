import { describe, it, expect } from "vitest";
import { extractEvidence } from "./rules";
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
});
