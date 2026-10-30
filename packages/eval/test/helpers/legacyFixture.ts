import type { GladMatch } from "@gladlog/parser";
import { type IArenaMatch,toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";

/** desktop's anonymized fixture (a GladMatch with rawLines stripped) → the
 * compat legacy shape */
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
