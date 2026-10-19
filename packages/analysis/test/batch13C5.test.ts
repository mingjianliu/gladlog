/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * F15 / fact1215 C5: what a friendly proc-only activation goes out with
 * (8cd58545: Radiant Glory's Avenging Wrath in the ms of each Wake of Ashes —
 * the friendly side dropped the `with Wake of Ashes` the enemy side prints).
 */
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  procTriggerAt,
  procTriggerOf,
} from "../src/context/timelineSections/enemyCd";
import { ensureAnalysisData } from "../src/data/ensure";

const T0 = 1_000_000;
const cast = (id: string, name: string, atMs: number) => ({
  spellId: id,
  spellName: name,
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + atMs },
});

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("procTriggerOf", () => {
  const paladin = {
    spellCastEvents: [18_000, 48_000].flatMap((t) => [
      cast("255937", "Wake of Ashes", t),
      cast("454351", "Avenging Wrath", t),
    ]),
  } as any;
  it("names the press the activation rides on, never the activation under another id", () => {
    // the friendly ledger keys it by the 31884 button
    expect(procTriggerOf(paladin, "31884", [T0 + 18_000, T0 + 48_000])).toBe(
      "Wake of Ashes",
    );
    expect(procTriggerOf(paladin, "454351", [T0 + 18_000, T0 + 48_000])).toBe(
      "Wake of Ashes",
    );
  });
  it("one shared ms proves nothing", () => {
    expect(procTriggerOf(paladin, "31884", [T0 + 18_000])).toBeUndefined();
  });
});

describe("procTriggerAt / ledger anchoring (codex 20-F15-25)", () => {
  const paladin = {
    spellCastEvents: [
      ...[10_000, 40_000].flatMap((t) => [
        cast("255937", "Wake of Ashes", t),
        cast("454351", "Avenging Wrath", t),
      ]),
      // a cast-less activation between them is in the ledger at 25 s
    ],
  } as any;
  it("an activation with no Wake press in its ms does not read `with Wake of Ashes`", () => {
    const round = procTriggerOf(paladin, "31884", [
      T0 + 10_000,
      T0 + 25_000,
      T0 + 40_000,
    ]);
    expect(round).toBe("Wake of Ashes");
    expect(procTriggerAt(paladin, "31884", T0 + 25_000, round)).toBe(
      undefined,
    );
    expect(procTriggerAt(paladin, "31884", T0 + 10_000, round)).toBe(
      "Wake of Ashes",
    );
  });
  it("a ledger time 2 ms before the cast row still finds its pairing", () => {
    expect(
      procTriggerOf(paladin, "31884", [T0 + 9998, T0 + 39_998]),
    ).toBe("Wake of Ashes");
    expect(
      procTriggerAt(paladin, "31884", T0 + 9998, "Wake of Ashes"),
    ).toBe("Wake of Ashes");
  });
});
