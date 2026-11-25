/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * Pipeline T262 — ownShieldNotPopped opens the attempt at the producer's own
 * millisecond (`extractKillAttempts`' `fromSeconds`), not at the top of the
 * printed second. The producer is stubbed: the case is what the check does
 * with the bracket the product gives it.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it, vi } from "vitest";

const produced = vi.hoisted(() => ({ attempts: [] as any[] }));
vi.mock("@gladlog/analysis/src/utils/killAttempts", async (original) => ({
  ...(await original<object>()),
  extractKillAttempts: () => produced.attempts,
}));

// imported after the mock is registered (vi.mock is hoisted either way)
import { run as runFact11 } from "../scripts/scan5/fact11";

const START = 1_000_000;
const DARK_PACT = "108416";

/** A failed attempt printed [2:58–3:01] on a warlock whose Dark Pact ate
 * 80k of our hits at `absorbMs`. */
function scanAt(absorbMs: number): string[] {
  const owner = { id: "o", name: "Owner", pid: "1", reaction: 1, info: {} };
  const lock = {
    id: "w",
    name: "Lock",
    pid: "4",
    reaction: 2,
    info: {},
    absorbsIn: [
      {
        timestamp: START + absorbMs,
        logLine: {
          event: LogEvent.SPELL_ABSORBED,
          timestamp: START + absorbMs,
        },
        srcUnitId: "w",
        attackerId: "o",
        spellId: DARK_PACT,
        absorbedAmount: 80_000,
      },
    ],
  };
  const players = [owner, lock];
  const kinds: string[] = [];
  runFact11({
    lines: [
      "  [2:58–3:01] on Lock — Boomstick burst (no stun) | FAILED: not enough damage",
    ],
    text: "",
    menu: "",
    rawLines: [],
    legacy: {
      startTime: START,
      endTime: START + 600_000,
      units: Object.fromEntries(players.map((p) => [p.id, p])),
    },
    players,
    units: players,
    byName: new Map(players.map((p) => [p.name, p])),
    owner,
    unitOfPid: (pid: string | undefined) => players.find((p) => p.pid === pid),
    pidOf: (name: string) => players.find((p) => p.name === name)?.pid,
    start: START,
    end: START + 600_000,
    roundEndAt: START + 600_000,
    bump: () => {},
    violate: (check: string, kind: string) => {
      if (check === "ownShieldNotPopped") kinds.push(kind);
    },
  } as any);
  return kinds;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ownShieldNotPopped (T262)", () => {
  const attempt = { targetName: "Lock", fromSeconds: 178.22, toSeconds: 181.4 };

  it("reads a shield used up in the printed second before the attempt opened", () => {
    produced.attempts = [attempt];
    expect(scanAt(178_000)).toEqual([]);
  });

  it("flags a shield that ate our hits once the attempt was open", () => {
    produced.attempts = [attempt];
    expect(scanAt(178_500)).toEqual(["Dark Pact"]);
    // the end stays the printed bracket's last second
    expect(scanAt(181_900)).toEqual(["Dark Pact"]);
  });

  it("falls back to the printed second when the producer has no such attempt", () => {
    produced.attempts = [{ ...attempt, targetName: "Other" }];
    expect(scanAt(178_000)).toEqual(["Dark Pact"]);
  });
});
