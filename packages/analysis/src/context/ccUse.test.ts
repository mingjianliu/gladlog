/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import {
  makeAdvancedAction,
  makeAuraEvent,
  makeDamageEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../test/ported/testHelpers";
import { ensureAnalysisData } from "../index";
import { pvpTrinketReadyAtSecond } from "../utils/ccTargetState";
import { CC_USE_CAP, ccUseSummary, formatCcUse } from "./ccUse";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const standAt = (x: number) =>
  Array.from({ length: 121 }, (_, s) => makeAdvancedAction(at(s), x, 0));

function scenario(opts: {
  ownerSpec?: CombatUnitSpec;
  burstTargetId?: string | null;
  bursts?: Array<[number, number]>;
  spikes?: Array<{ from: number; to: number; target: string }>;
  unmappedPerSecond?: number;
  extraBoltAtS?: number;
  priestCcFromTo?: [number, number];
}) {
  const owner = makeUnit("p1", {
    name: "Owner",
    spec: opts.ownerSpec ?? CombatUnitSpec.Warrior_Arms,
    class: CombatUnitClass.Warrior,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: [
      makeSpellCastEvent("107570", at(5), "e1", "Rogue", "p1", "Owner"),
      ...(opts.extraBoltAtS === undefined
        ? []
        : [
            makeSpellCastEvent(
              "107570",
              at(opts.extraBoltAtS),
              "e1",
              "Rogue",
              "p1",
              "Owner",
            ),
          ]),
    ],
    advancedActions: standAt(0),
  });
  const spikeDamage = (who: string, destId: string) =>
    (opts.spikes ?? [])
      .filter((w) => w.target === who)
      .flatMap((w) =>
        Array.from({ length: w.to - w.from }, (_, i) => [
          {
            ...makeDamageEvent(at(w.from + i), -50_000, destId),
            srcUnitId: "e1",
            srcUnitName: "Rogue",
          },
          ...(opts.unmappedPerSecond
            ? [
                {
                  ...makeDamageEvent(
                    at(w.from + i),
                    -opts.unmappedPerSecond,
                    destId,
                  ),
                  srcUnitId: "Creature-0-x",
                  srcUnitName: "X",
                },
              ]
            : []),
        ]).flat(),
      );
  (owner as any).damageIn = spikeDamage("Owner", "p1");
  const mateDamage = spikeDamage("Mate", "m1");
  const mate = makeUnit("m1", {
    name: "Mate",
    reaction: CombatUnitReaction.Friendly,
    damageIn: mateDamage,
    advancedActions: standAt(2),
  });
  const rogue = makeUnit("e1", {
    name: "Rogue",
    spec: CombatUnitSpec.Rogue_Assassination,
    reaction: CombatUnitReaction.Hostile,
    advancedActions: standAt(5),
  });
  const priest = makeUnit("e2", {
    name: "Priest",
    spec: CombatUnitSpec.Priest_Holy,
    reaction: CombatUnitReaction.Hostile,
    auraEvents: opts.priestCcFromTo
      ? [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "118",
            at(opts.priestCcFromTo[0]),
            "m1",
            "e2",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "118",
            at(opts.priestCcFromTo[1]),
            "m1",
            "e2",
          ),
        ]
      : [],
    // 15 yd: inside Storm Bolt's 20 yd, outside Shockwave (10) and
    // Intimidating Shout (8) — the fixture has no COMBATANT_INFO, so the
    // warrior's whole CC kit is on the ledger.
    advancedActions: standAt(15),
  });
  const combat: any = {
    startTime: T0,
    endTime: at(120),
    startInfo: { zoneId: "" },
    units: { p1: owner, m1: mate, e1: rogue, e2: priest },
  };
  const targetId = opts.burstTargetId === undefined ? "e1" : opts.burstTargetId;
  return ccUseSummary({
    combat,
    owner,
    friends: [owner, mate],
    enemies: [rogue, priest],
    enemyCC: [],
    burstLedger: (opts.bursts ?? []).map(([f, t]) => ({
      fromSeconds: f,
      toSeconds: t,
      dominantTarget: targetId ? { unitId: targetId } : null,
    })) as any,
    pressureWindows: (opts.spikes ?? []).map((w) => ({
      fromSeconds: w.from,
      toSeconds: w.to,
      totalDamage: 50_000 * (w.to - w.from),
      targetName: w.target,
      targetSpec: "",
    })),
  });
}

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("ccUseSummary (GH #77 part 2)", () => {
  it("counts completed casts and renders them", () => {
    const out = scenario({});
    expect(out.counts.find((c) => c.spellId === "107570")).toEqual(
      expect.objectContaining({ casts: 1, firstCastS: 5 }),
    );
    const lines = formatCcUse(out, { friendly: (n) => n, enemy: (n) => n });
    expect(lines[1]).toContain("Storm Bolt cast 1× (first 0:05)");
  });

  it("offense: bookmarks the enemy healer during the owner's burst on a non-healer", () => {
    const out = scenario({ bursts: [[60, 75]] });
    expect(out.bookmarks).toHaveLength(1);
    expect(out.bookmarks[0]).toEqual(
      expect.objectContaining({
        kind: "offense",
        targetName: "Priest",
        burstIndex: 1,
      }),
    );
    const lines = formatCcUse(out, { friendly: (n) => n, enemy: (n) => n });
    expect(lines[2]).toMatch(
      /\[CC BOOKMARK\] {2}Storm Bolt → Priest: during your Burst #1 \(1:00–1:15\) on Rogue, their healer was not CC'd/,
    );
  });

  it("never counts the rendered second in which the CC was actually cast (cast at 70.7 s)", () => {
    const out = scenario({ bursts: [[60, 75]], extraBoltAtS: 70.7 });
    const bolt = out.bookmarks.filter((b) => b.spellId === "107570");
    expect(bolt).toHaveLength(1);
    expect(bolt[0]!.seconds).not.toContain(70);
    expect(bolt[0]!.seconds[bolt[0]!.seconds.length - 1]).toBe(69);
  });

  it("never claims a second in which the target became CC'd (CC at 67.8 s renders under 1:07)", () => {
    const out = scenario({ bursts: [[60, 75]], priestCcFromTo: [67.8, 70] });
    const bolt = out.bookmarks.filter((b) => b.spellId === "107570");
    expect(bolt.length).toBeGreaterThan(0);
    for (const b of bolt) expect(b.seconds).not.toContain(67);
  });

  it("a PvP trinket used at 10.8 s is spent from rendered second 10", () => {
    const summary = { trinketUseTimes: [10.8], trinketCooldownSeconds: 120 };
    expect(pvpTrinketReadyAtSecond(summary, 9)).toBe(true);
    expect(pvpTrinketReadyAtSecond(summary, 10)).toBe(false);
    expect(pvpTrinketReadyAtSecond(summary, 131)).toBe(true);
  });

  it("offense: nothing when the burst target is the healer or unknown", () => {
    expect(
      scenario({ bursts: [[60, 75]], burstTargetId: "e2" }).bookmarks,
    ).toHaveLength(0);
    expect(
      scenario({ bursts: [[60, 75]], burstTargetId: null }).bookmarks,
    ).toHaveLength(0);
  });

  it("defense: bookmarks a teammate's dominant attacker; the share uses ALL damage taken", () => {
    const spike = { from: 80, to: 90, target: "Mate" };
    const bolts = (x: ReturnType<typeof scenario>) =>
      x.bookmarks.filter((b) => b.spellId === "107570");
    const out = scenario({ spikes: [spike] });
    expect(bolts(out)).toHaveLength(1);
    expect(bolts(out)[0]).toEqual(
      expect.objectContaining({ kind: "defense", targetName: "Rogue" }),
    );
    // Equal unmapped damage → the rogue did 50 %, under the 60 % door
    expect(
      scenario({ spikes: [spike], unmappedPerSecond: 50_000 }).bookmarks,
    ).toHaveLength(0);
    // A spike on the owner is not a teammate's
    expect(
      scenario({ spikes: [{ ...spike, target: "Owner" }] }).bookmarks,
    ).toHaveLength(0);
  });

  it("healer owners get counts only", () => {
    const out = scenario({
      ownerSpec: CombatUnitSpec.Priest_Discipline,
      bursts: [[60, 75]],
    });
    expect(out.bookmarks).toHaveLength(0);
  });

  it(`keeps at most ${CC_USE_CAP} bookmarks — the longest, in time order`, () => {
    const out = scenario({
      bursts: [
        [10, 16],
        [30, 45],
        [60, 70],
      ],
    });
    expect(out.bookmarks).toHaveLength(CC_USE_CAP);
    expect(out.bookmarks.map((b) => b.burstIndex)).toEqual([2, 3]);
  });
});
