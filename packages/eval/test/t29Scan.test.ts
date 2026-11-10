/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5/t29 reads the producer's refusal (`pressRefusalMissRow` /
 * `pressRefusalMissType`), never a miss search of its own (codex
 * 80-PIPE-34-B34 #2): a Deathmark cast on A, a DODGE on B 1 ms later and an
 * IMMUNE on A 2 ms later is refused IMMUNE — the press's own target's row.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t29";

const START = 1_000_000;
const DEATHMARK = "360194";
const AT = START + 25_000;

const miss = (destUnitId: string, ms: number, missType: string): any => ({
  srcUnitId: "r",
  destUnitId,
  spellId: DEATHMARK,
  missType,
  timestamp: ms,
  logLine: { event: LogEvent.SPELL_MISSED, timestamp: ms },
});

function world(reaction: number) {
  const unit = (id: string, over: Record<string, unknown> = {}): any => ({
    id,
    name: id === "r" ? "Rogue" : id.toUpperCase(),
    reaction: id === "r" ? reaction : 3 - reaction,
    type: 1,
    spec: CombatUnitSpec.Druid_Restoration,
    info: {},
    spellCastEvents: [],
    auraEvents: [],
    damageOut: [],
    healOut: [],
    missesOut: [],
    deathRecords: [],
    advancedActions: [],
    ...over,
  });
  const rogue = unit("r", {
    spec: CombatUnitSpec.Rogue_Assassination,
    spellCastEvents: [
      {
        spellId: DEATHMARK,
        spellName: "Deathmark",
        srcUnitId: "r",
        destUnitId: "a",
        timestamp: AT,
        logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: AT },
      },
    ],
    missesOut: [miss("b", AT + 1, "DODGE"), miss("a", AT + 2, "IMMUNE")],
  });
  const a = unit("a");
  const b = unit("b");
  const units = { r: rogue, a, b };
  return { rogue, players: [rogue, a, b], units };
}

function scan(ctx: Record<string, unknown>) {
  const seen: string[] = [];
  const bumps: Record<string, number> = {};
  run({
    text: "",
    lines: [],
    menu: "",
    start: START,
    unitOfPid: () => undefined,
    rawStreams: () => ({ available: false, castFailed: [] }),
    violate: (check: string, kind: string) => seen.push(`${check}: ${kind}`),
    bump: (check: string) => {
      bumps[check] = (bumps[check] ?? 0) + 1;
    },
    ...ctx,
  } as any);
  return { seen, bumps };
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("scan5/t29 reads the producer's refusing row", () => {
  it("pressEffectRefusedListed: the kind is the press's own target's miss type", () => {
    const w = world(2);
    const text = [
      '  <unit id="4" name="Rogue" spec="Assassination Rogue" role="enemy">',
      "0:30 [STATE] x",
      "      [RES] rdy:Δ  enemy:Deathmark/Assassination Rogue(11s left)  focus:1",
    ].join("\n");
    const { seen } = scan({
      text,
      legacy: {
        startTime: START,
        endTime: START + 120_000,
        units: w.units,
      },
      unitOfPid: (pid: string) => (pid === "4" ? w.rogue : undefined),
    });
    expect(seen).toEqual(["pressEffectRefusedListed: refused IMMUNE"]);
  });

  it("refusedPressMarker: the marker's type must be the producer's row's", () => {
    const w = world(1);
    const row = (marker: string) =>
      `  - id=missed-sync-window:B:1:20 type=missed-sync-window t=20s units=B facts={t=20, windowEndT=24, healer=B, cc=Fear, dr=Full, durationS=4, readyCds=Deathmark (yours), pressedAfter=Deathmark +1.0s ${marker}, cellKey=x}`;
    const ctx = (marker: string) => ({
      menu: row(marker),
      owner: w.rogue,
      players: w.players,
      byName: new Map(w.players.map((u: any) => [u.name, u])),
      legacy: {
        startTime: START,
        endTime: START + 120_000,
        units: w.units,
      },
    });
    const ok = scan(ctx("(refused: IMMUNE)"));
    expect(ok.seen).toEqual([]);
    expect(ok.bumps.refusedPressMarker).toBe(1);
    expect(scan(ctx("(refused: DODGE)")).seen).toEqual([
      "refusedPressMarker: miss type IMMUNE printed DODGE",
    ]);
  });
});
