import { describe, it, expect } from "vitest";
import { scoreCompany } from "./score";
import { DEFAULT_PROFILE } from "./profile";
import type { Evidence, Profile } from "./types";

describe("scoreCompany", () => {
  it("scores 100 confirmed and 100 maxPossible when all criteria are met and verified", () => {
    const allMet: Evidence[] = DEFAULT_PROFILE.criteria.map((c) => ({
      criterionId: c.id,
      status: "met",
      verified: true,
      extractor: "rule",
    }));

    const score = scoreCompany(allMet, DEFAULT_PROFILE);
    expect(score.confirmed).toBe(100);
    expect(score.maxPossible).toBe(100);
    expect(score.evidenceCount).toBe(5);
    expect(score.totalCriteria).toBe(5);
  });

  it("scores 0 confirmed and 100 maxPossible when no evidence is met", () => {
    const noneMet: Evidence[] = DEFAULT_PROFILE.criteria.map((c) => ({
      criterionId: c.id,
      status: "unknown",
      verified: false,
      extractor: "rule",
    }));

    const score = scoreCompany(noneMet, DEFAULT_PROFILE);
    expect(score.confirmed).toBe(0);
    expect(score.maxPossible).toBe(100);
    expect(score.evidenceCount).toBe(0);
    expect(score.totalCriteria).toBe(5);
  });

  it("calculates confirmed score correctly for mixed criteria", () => {
    // sells_software (25) and serves_businesses (25) met -> 50%
    const mixed: Evidence[] = [
      { criterionId: "sells_software", status: "met", verified: true, extractor: "rule" },
      { criterionId: "serves_businesses", status: "met", verified: true, extractor: "rule" },
      { criterionId: "visible_pricing", status: "unknown", verified: false, extractor: "rule" },
      { criterionId: "recurring_model", status: "unknown", verified: false, extractor: "rule" },
      { criterionId: "operating_history", status: "unknown", verified: false, extractor: "rule" },
    ];

    const score = scoreCompany(mixed, DEFAULT_PROFILE);
    expect(score.confirmed).toBe(50);
    expect(score.maxPossible).toBe(100);
    expect(score.evidenceCount).toBe(2);
  });

  it("lowers maxPossible when a criterion is contradicted and verified", () => {
    // visible_pricing (20) contradicted -> maxPossible = 100 - 20 = 80
    // sells_software (25) met -> confirmed = 25
    const contradicted: Evidence[] = [
      { criterionId: "sells_software", status: "met", verified: true, extractor: "rule" },
      { criterionId: "serves_businesses", status: "unknown", verified: false, extractor: "rule" },
      { criterionId: "visible_pricing", status: "contradicted", verified: true, extractor: "rule" },
      { criterionId: "recurring_model", status: "unknown", verified: false, extractor: "rule" },
      { criterionId: "operating_history", status: "unknown", verified: false, extractor: "rule" },
    ];

    const score = scoreCompany(contradicted, DEFAULT_PROFILE);
    expect(score.confirmed).toBe(25);
    expect(score.maxPossible).toBe(80);
    expect(score.evidenceCount).toBe(1);
  });

  it("does not count an unverified met status", () => {
    const unverifiedMet: Evidence[] = [
      { criterionId: "sells_software", status: "met", verified: false, extractor: "rule" },
    ];

    const score = scoreCompany(unverifiedMet, DEFAULT_PROFILE);
    expect(score.confirmed).toBe(0);
    expect(score.evidenceCount).toBe(0);
  });

  it("supports custom profile weights", () => {
    const customProfile: Profile = {
      id: "custom",
      label: "Custom",
      illustrative: true,
      criteria: [
        { id: "sells_software", label: "Software", weight: 60 },
        { id: "serves_businesses", label: "B2B", weight: 40 },
      ],
    };

    const evidence: Evidence[] = [
      { criterionId: "sells_software", status: "met", verified: true, extractor: "rule" },
      { criterionId: "serves_businesses", status: "unknown", verified: false, extractor: "rule" },
    ];

    const score = scoreCompany(evidence, customProfile);
    expect(score.confirmed).toBe(60);
    expect(score.maxPossible).toBe(100);
    expect(score.evidenceCount).toBe(1);
    expect(score.totalCriteria).toBe(2);
  });

  it("is pure and deterministic (same input produces same output)", () => {
    const evidence: Evidence[] = [
      { criterionId: "sells_software", status: "met", verified: true, extractor: "rule" },
    ];

    const score1 = scoreCompany(evidence, DEFAULT_PROFILE);
    const score2 = scoreCompany(evidence, DEFAULT_PROFILE);
    expect(score1).toEqual(score2);
  });
});
