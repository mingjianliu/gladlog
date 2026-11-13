/* eslint-disable @typescript-eslint/no-explicit-any -- fake legacy parse objects, the check reads them untyped */
/**
 * scan5 `attemptNamedLaterPress` (T42, codex 85-tk-H-T42-1 #2 / #3): the
 * check pairs a press with its aura and reads the buffed players' hits over
 * the producer's own tolerance and span.
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { run } from "../scripts/scan5/t42";

const START = 1_000_000;
const at = (s: number): number => START + s * 1000;
const row = (event: string, s: number, extra: Record<string, unknown>) => ({
  timestamp: at(s),
  logLine: { event, timestamp: at(s) },
  ...extra,
});
const PI = "10060";
const press = (spellId: string, spellName: string, s: number, dest?: string) =>
  row(LogEvent.SPELL_CAST_SUCCESS, s, { spellId, spellName, destUnitId: dest });
const pi = (s: number, src: string) =>
  row(LogEvent.SPELL_AURA_APPLIED, s, {
    spellId: PI,
    spellName: "Power Infusion",
    srcUnitId: src,
  });
const hit = (dest: string, s: number) =>
  row(LogEvent.SPELL_DAMAGE, s, { destUnitId: dest, effectiveAmount: -1000 });

function scan(o: {
  to: string;
  casterAuraAt?: number;
  f1Hits?: any[];
  f2Hits?: any[];
}): number {
  const f1 = {
    id: "f1",
    name: "f1",
    reaction: 1,
    spec: "258",
    spellCastEvents: [press(PI, "Power Infusion", 40, "f2")],
    auraEvents: o.casterAuraAt ? [pi(o.casterAuraAt, "f1")] : [],
    damageOut: o.f1Hits ?? [],
  };
  const f2 = {
    id: "f2",
    name: "f2",
    reaction: 1,
    spec: "71",
    auraEvents: [pi(40.01, "f1")],
    damageOut: o.f2Hits ?? [],
  };
  const f3 = {
    id: "f3",
    name: "f3",
    reaction: 1,
    spec: "71",
    spellCastEvents: [press("1719", "Recklessness", 46)],
  };
  const e1 = { id: "e1", name: "e1", reaction: 2 };
  const players = [f1, f2, f3, e1];
  let n = 0;
  run({
    lines: [`  [0:40–${o.to}] on e1 — Recklessness burst (no stun)`],
    start: START,
    roundEndAt: at(600),
    players,
    owner: f1,
    byName: new Map(players.map((p) => [p.name, p])),
    bump: () => {},
    violate: () => n++,
  } as any);
  return n;
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("attemptNamedLaterPress", () => {
  it("flags a line named for a later press when the buffed teammate hit the target", () => {
    expect(scan({ to: "0:58", f2Hits: [hit("e1", 42)] })).toBe(1);
    expect(scan({ to: "0:58", f2Hits: [hit("e2", 42)] })).toBe(0);
  });

  it("pairs the caster's own aura within the producer's tolerance (1.2 s)", () => {
    expect(
      scan({ to: "0:58", casterAuraAt: 41.2, f1Hits: [hit("e1", 43)] }),
    ).toBe(1);
    expect(
      scan({ to: "0:58", casterAuraAt: 42.0, f1Hits: [hit("e1", 43)] }),
    ).toBe(0);
  });

  it("reads the buffed teammate's hits through the kill-credit slack", () => {
    expect(scan({ to: "0:58", f2Hits: [hit("e1", 60)] })).toBe(1);
    expect(scan({ to: "0:58", f2Hits: [hit("e1", 64)] })).toBe(0);
  });
});
