/**
 * codex 20-F17-03 #3 (2026-10-23): the report's HP timeline and replay read
 * a sample's max HP through the analysis' own reading
 * (`correctedAdvancedSamples`), not the raw field — a lagging max read
 * 90.9 % in both where the prompt read 100 %.
 */
import { correctedAdvancedSamples } from "@gladlog/parser-compat";

import { deriveReplay } from "../src/renderer/src/report/derive/replay";
import { deriveTimeline } from "../src/renderer/src/report/derive/timeline";
import { loadMatchFixture } from "./fixtures/loadFixture";

describe("report HP readers take the corrected max HP", () => {
  const base = loadMatchFixture();
  const player = Object.values(base.units).find(
    (u) => u.kind === "Player" && u.info,
  )!;
  const t0 = base.startTime + 10_000;
  // a bear form exit: current HP rescaled at +50 ms, the max field at +310 ms
  const lagSamples = [
    { timestamp: t0, hp: 1_607_106, maxHp: 1_644_592, x: 0, y: 0 },
    { timestamp: t0 + 50, hp: 1_239_524, maxHp: 1_644_592, x: 0, y: 0 },
    { timestamp: t0 + 310, hp: 1_251_259, maxHp: 1_265_069, x: 0, y: 0 },
  ];
  const m = {
    ...base,
    units: {
      ...base.units,
      [player.id]: {
        ...player,
        healIn: [],
        damageIn: [],
        advancedSamples: lagSamples,
      },
    },
  } as typeof base;

  it("the shared reading corrects the lagging row", () => {
    expect(
      correctedAdvancedSamples(m.units[player.id]!).map((s) => s.maxHp),
    ).toEqual([1_644_592, 1_265_069, 1_265_069]);
  });
  it("timeline and replay print it", () => {
    const series = deriveTimeline(m).series.find(
      (s) => s.unitId === player.id,
    )!;
    expect(series.points.find((p) => p.t === t0 + 50)?.maxHp).toBe(1_265_069);
    const track = deriveReplay(m).tracks.find((t) => t.unitId === player.id)!;
    expect(track.samples.find((s) => s.t === t0 + 50)?.maxHp).toBe(1_265_069);
  });
});
