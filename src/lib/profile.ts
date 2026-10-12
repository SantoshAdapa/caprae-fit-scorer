/**
 * Default illustrative profile and scoring limitations.
 *
 * Pure data — no network, no I/O, no dependencies beyond ./types.
 */

import type { Profile } from "./types";

/**
 * An illustrative scoring profile.
 * NOT Caprae's actual acquisition criteria — used for demonstration only.
 * Weights sum to 100.
 */
export const DEFAULT_PROFILE: Profile = {
  id: "illustrative-v1",
  label: "Illustrative profile (not Caprae's criteria)",
  illustrative: true,
  criteria: [
    { id: "sells_software", label: "Sells software", weight: 25 },
    { id: "serves_businesses", label: "Serves businesses (B2B)", weight: 25 },
    { id: "visible_pricing", label: "Visible pricing", weight: 20 },
    { id: "recurring_model", label: "Recurring revenue model", weight: 15 },
    { id: "operating_history", label: "Operating history", weight: 15 },
  ],
};

/**
 * Hard-coded limitations shown alongside every score.
 * Each string is a standalone bullet point.
 */
export const SCORE_LIMITATIONS: string[] = [
  "Illustrative profile, not Caprae's criteria.",
  "Score = share of profile weight with verified evidence. Missing evidence is unknown, not negative.",
  "Evidence comes only from the homepage, /pricing, and /about.",
  "Rules-only mode is keyword-based and coarse: quotes prove text presence, not commercial intent.",
  "This is a screening aid, not an investment recommendation.",
];
