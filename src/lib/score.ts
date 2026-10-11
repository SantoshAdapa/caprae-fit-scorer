/**
 * Deterministic scoring engine for acquisition fit.
 *
 * Confirmed score = percentage share of profile weight backed by verified evidence.
 * Missing evidence is unknown, not negative. Contradicted evidence lowers maxPossible.
 */

import type { Evidence, Profile } from "./types";

export interface CompanyScore {
  confirmed: number;
  maxPossible: number;
  evidenceCount: number;
  totalCriteria: number;
}

/**
 * Calculates confirmed score and maximum possible score for a company against a target profile.
 *
 * @param evidence - List of criteria evidence items.
 * @param profile - Target profile containing criteria and their respective weights.
 * @returns Deterministic score breakdown.
 */
export function scoreCompany(
  evidence: Evidence[],
  profile: Profile
): CompanyScore {
  const totalWeight = profile.criteria.reduce((sum, c) => sum + c.weight, 0);
  let confirmedWeight = 0;
  let contradictedWeight = 0;
  let evidenceCount = 0;

  for (const criterion of profile.criteria) {
    const ev = evidence.find((e) => e.criterionId === criterion.id);
    if (ev && ev.verified) {
      if (ev.status === "met") {
        confirmedWeight += criterion.weight;
        evidenceCount++;
      } else if (ev.status === "contradicted") {
        contradictedWeight += criterion.weight;
      }
    }
  }

  const confirmed =
    totalWeight > 0 ? Math.round((100 * confirmedWeight) / totalWeight) : 0;
  const maxPossible =
    totalWeight > 0
      ? Math.round((100 * (totalWeight - contradictedWeight)) / totalWeight)
      : 0;
  const totalCriteria = profile.criteria.length;

  return {
    confirmed,
    maxPossible,
    evidenceCount,
    totalCriteria,
  };
}
