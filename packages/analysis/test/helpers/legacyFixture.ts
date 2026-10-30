import type { GladMatch } from "@gladlog/parser";
import { type IArenaMatch, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";

/** desktop's anonymized fixture (a GladMatch with rawLines stripped) → the
 *  compat legacy shape */
export function loadLegacyMatchFixture(): IArenaMatch {
  const p = new URL(
    "../../../desktop/test/fixtures/report-match.json",
    import.meta.url,
  ).pathname;
  const data = JSON.parse(readFileSync(p, "utf-8")) as Omit<
    GladMatch,
    "rawLines"
  >;
  return toLegacyMatch({ ...data, rawLines: [] } as GladMatch);
}

/** desktop's other anonymized fixture (the 90 s 3v3 real-match sample) →
 *  the compat legacy shape */
export function loadLegacyRealMatchSample(): IArenaMatch {
  const p = new URL(
    "../../../desktop/test/fixtures/real-match-sample.json",
    import.meta.url,
  ).pathname;
  const data = JSON.parse(readFileSync(p, "utf-8")) as {
    units: Record<string, Record<string, unknown>>;
  };
  // an older stored document: pad the streams it predates, as desktop's
  // `toLegacySafe` does before converting
  for (const u of Object.values(data.units))
    for (const k of [
      "absorbsIn",
      "absorbsOut",
      "actionsIn",
      "actionsOut",
      "advancedSamples",
      "auraEvents",
      "casts",
      "damageIn",
      "damageOut",
      "deaths",
      "healIn",
      "healOut",
      "petCasts",
    ])
      if (!Array.isArray(u[k])) u[k] = [];
  return toLegacyMatch({ ...data, rawLines: [] } as unknown as GladMatch);
}
