/**
 * Triage 2026-09-29 sync-burst F-L4: a multi-CD burst ledger header gives
 * each CD its own span; a single-CD header is unchanged.
 */
import { describe, expect, it } from "vitest";

import {
  formatBurstLedgerForContext,
  type IBurstLedgerEntry,
} from "../src/utils/burstLedger";

const entry = (spells: IBurstLedgerEntry["spells"]): IBurstLedgerEntry => ({
  fromSeconds: 11.301,
  toSeconds: 41.358,
  spells,
  totalDamage: 0,
  damageByTarget: [],
  dominantTarget: null,
  allyCDsOverlapping: [],
  otherDeaths: [],
});

describe("formatBurstLedgerForContext — header (F-L4)", () => {
  it("DT 0:11–0:26 + Army 0:11–0:41 under the union 0:11–0:41", () => {
    const [, header] = formatBurstLedgerForContext(
      [
        entry([
          { spellId: "63560", spellName: "Dark Transformation", castTimeSeconds: 11.301, spanToSeconds: 26.301 },
          { spellId: "42650", spellName: "Army of the Dead", castTimeSeconds: 11.358, spanToSeconds: 41.358 },
        ]),
      ],
      [],
      [],
    );
    expect(header).toBe(
      "  Burst #1 — 0:11–0:41 | Dark Transformation 0:11–0:26 + Army of the Dead 0:11–0:41",
    );
  });
  it("a single CD keeps the bare name", () => {
    const [, header] = formatBurstLedgerForContext(
      [entry([{ spellId: "42650", spellName: "Army of the Dead", castTimeSeconds: 11.358, spanToSeconds: 41.358 }])],
      [],
      [],
    );
    expect(header).toBe("  Burst #1 — 0:11–0:41 | Army of the Dead");
  });
});
