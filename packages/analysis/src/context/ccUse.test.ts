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
  makeInterruptEvent,
  makeSpellCastEvent,
  makeUnit,
} from "../../test/ported/testHelpers";
import { ensureAnalysisData } from "../index";
import { pvpTrinketReadyAtSecond } from "../utils/ccTargetState";
import { extractMajorCooldowns } from "../utils/cooldowns";
import { CC_USE_CAP, ccUseSummary, formatCcUse } from "./ccUse";
import { buildPlayerLoadout } from "./resourceSnapshot";

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

// FT-T16 D15 "2c" (user approval 2026-10-10): a control with a cast time —
// cast bars begun (SPELL_CAST_START) next to casts that went off
// (SPELL_CAST_SUCCESS).
describe("CC USE counts — cast bars started vs casts that went off", () => {
  const CYCLONE = "33786";
  const MIGHTY_BASH = "5211"; // instant
  const WRATH = "190984"; // a cast time, not a control
  const RING_OF_FROST = "113724"; // on the Mage cooldown ledger, 2 s cast
  const barStart = (spellId: string, s: number, name: string) => ({
    ...makeSpellCastEvent(
      spellId,
      at(s),
      "e1",
      "Rogue",
      "p1",
      "Owner",
      0,
      name,
    ),
    logLine: {
      event: LogEvent.SPELL_CAST_START,
      timestamp: at(s),
      parameters: [],
    },
  });
  const wentOff = (spellId: string, s: number, name: string) =>
    makeSpellCastEvent(spellId, at(s), "e1", "Rogue", "p1", "Owner", 0, name);

  function countsLine(opts: {
    spec?: CombatUnitSpec;
    unitClass?: CombatUnitClass;
    starts?: Array<[string, number, string]>;
    casts?: Array<[string, number, string]>;
    kicks?: Array<[string, number]>;
  }) {
    const owner = makeUnit("p1", {
      name: "Owner",
      spec: opts.spec ?? CombatUnitSpec.Druid_Balance,
      class: opts.unitClass ?? CombatUnitClass.Druid,
      reaction: CombatUnitReaction.Friendly,
      castStartEvents: (opts.starts ?? []).map((x) => barStart(...x)),
      spellCastEvents: (opts.casts ?? []).map((x) => wentOff(...x)),
      actionIn: (opts.kicks ?? []).map(([spellId, s]) =>
        makeInterruptEvent("1766", "Kick", spellId, "Cyclone", at(s), "e1"),
      ),
    });
    const rogue = makeUnit("e1", {
      name: "Rogue",
      spec: CombatUnitSpec.Rogue_Assassination,
      reaction: CombatUnitReaction.Hostile,
    });
    const combat: any = {
      startTime: T0,
      endTime: at(120),
      startInfo: { zoneId: "" },
      units: { p1: owner, e1: rogue },
    };
    const summary = ccUseSummary({
      combat,
      owner,
      friends: [owner],
      enemies: [rogue],
      enemyCC: [],
      burstLedger: [],
      pressureWindows: [],
    });
    const lines = formatCcUse(summary, {
      friendly: (n) => n,
      enemy: (n) => n,
    });
    const items = (lines[1] ?? "").replace(/^\s*Counts: /, "").split(" · ");
    // the owner's kit line of the same round, from the same ledger
    const kit =
      buildPlayerLoadout(
        owner,
        "",
        extractMajorCooldowns(owner, combat),
        [],
        { players: [], alignedBurstWindows: [] } as any,
        undefined,
        undefined,
        { startTime: combat.startTime, endTime: combat.endTime },
      )
        .text.split("\n")
        .find((l) => l.includes("<cooldowns>")) ?? "";
    return { summary, items, header: lines[0] ?? "", kit };
  }
  const of = (items: string[], spell: string) =>
    items.filter((i) => i.startsWith(`${spell} `));

  it("539b6ed0's shape: four Cyclone bars begun, none went off", () => {
    const { summary, items } = countsLine({
      starts: [47.9, 49.0, 55.6, 56.5].map((s) => [CYCLONE, s, "Cyclone"]),
    });
    expect(summary.counts.find((c) => c.spellName === "Cyclone")).toEqual(
      expect.objectContaining({
        casts: 0,
        firstCastS: null,
        castBarsStarted: 4,
      }),
    );
    expect(of(items, "Cyclone")).toEqual([
      "Cyclone cast bar started 4×, went off 0×",
    ]);
  });

  it("every started bar went off: the plain `cast N×` entry, no started form", () => {
    const { items } = countsLine({
      starts: [
        [CYCLONE, 10, "Cyclone"],
        [CYCLONE, 30, "Cyclone"],
      ],
      casts: [
        [CYCLONE, 11.6, "Cyclone"],
        [CYCLONE, 31.6, "Cyclone"],
      ],
    });
    expect(of(items, "Cyclone")).toEqual(["Cyclone cast 2× (first 0:11)"]);
  });

  it("a kicked bar is a started one: 3 begun, 1 kicked, 1 stopped, 1 went off", () => {
    const { items } = countsLine({
      starts: [
        [CYCLONE, 10, "Cyclone"],
        [CYCLONE, 15, "Cyclone"],
        [CYCLONE, 19, "Cyclone"],
      ],
      kicks: [[CYCLONE, 10.9]],
      casts: [[CYCLONE, 20.6, "Cyclone"]],
    });
    expect(of(items, "Cyclone")).toEqual([
      "Cyclone cast bar started 3×, went off 1× (first 0:20)",
    ]);
  });

  it("an instant control has no cast bar: its entry keeps the plain forms", () => {
    const { summary, items } = countsLine({
      casts: [[MIGHTY_BASH, 13, "Mighty Bash"]],
    });
    expect(of(items, "Mighty Bash")).toEqual([
      "Mighty Bash cast 1× (first 0:13)",
    ]);
    expect(
      summary.counts.find((c) => c.spellId === MIGHTY_BASH)!.castBarsStarted,
    ).toBeUndefined();
    expect(items.join(" · ")).not.toContain("cast bar started");
    // and a control never started and never cast gets no entry of its own
    expect(of(items, "Cyclone")).toEqual([]);
  });

  it("a cast-time spell that is not a control gets no entry", () => {
    const { items } = countsLine({ starts: [[WRATH, 5, "Wrath"]] });
    expect(of(items, "Wrath")).toEqual([]);
  });

  it("a cooldown-ledger control with a cast time takes the form on its own entry — one entry per spell", () => {
    const { items } = countsLine({
      spec: CombatUnitSpec.Mage_Arcane,
      unitClass: CombatUnitClass.Mage,
      starts: [
        [RING_OF_FROST, 40, "Ring of Frost"],
        [RING_OF_FROST, 75, "Ring of Frost"],
      ],
      casts: [[RING_OF_FROST, 77, "Ring of Frost"]],
    });
    expect(of(items, "Ring of Frost")).toEqual([
      "Ring of Frost cast bar started 2×, went off 1× (first 1:17)",
    ]);
  });

  it("the variants of one spell are one entry: Polymorph 118 and its 61305 skin", () => {
    const { items } = countsLine({
      spec: CombatUnitSpec.Mage_Arcane,
      unitClass: CombatUnitClass.Mage,
      // the client's own (here localized) name is not what the entry prints
      starts: [
        ["118", 32, "变形术"],
        ["61305", 50, "变形术"],
        ["118", 60, "变形术"],
      ],
      casts: [["61305", 51.7, "变形术"]],
    });
    expect(of(items, "Polymorph")).toEqual([
      "Polymorph cast bar started 3×, went off 1× (first 0:51)",
    ]);
  });

  it("more casts than bars (an instant proc of the spell) reads `cast N×`, never went off > started", () => {
    const { items } = countsLine({
      starts: [[CYCLONE, 10, "Cyclone"]],
      casts: [
        [CYCLONE, 11.6, "Cyclone"],
        [CYCLONE, 40, "Cyclone"],
      ],
    });
    expect(of(items, "Cyclone")).toEqual(["Cyclone cast 2× (first 0:11)"]);
  });

  it("counts only the round: a bar begun after the round's end is not one of them", () => {
    const { items } = countsLine({
      starts: [
        [CYCLONE, 10, "Cyclone"],
        [CYCLONE, 130, "Cyclone"],
      ],
      casts: [[CYCLONE, 131.6, "Cyclone"]],
    });
    expect(of(items, "Cyclone")).toEqual([
      "Cyclone cast bar started 1×, went off 0×",
    ]);
  });

  // One number for one spell: the kit's `[UNUSED — started N×, never
  // finished]` and this line read the same bars (`castBarsOfCooldown`).
  it("a cooldown-ledger control never cast: the kit's `started N×` is this line's N", () => {
    const { items, kit } = countsLine({
      spec: CombatUnitSpec.Mage_Arcane,
      unitClass: CombatUnitClass.Mage,
      starts: [
        [RING_OF_FROST, 40, "Ring of Frost"],
        [RING_OF_FROST, 75, "Ring of Frost"],
        [RING_OF_FROST, 130, "Ring of Frost"], // after the round
      ],
    });
    expect(of(items, "Ring of Frost")).toEqual([
      "Ring of Frost cast bar started 2×, went off 0×",
    ]);
    expect(kit).toMatch(
      /Ring of Frost \[[^\]]*\] \[UNUSED — started 2×, never finished\]/,
    );
  });

  it("a glyphed Hex (211015) is the Hex cooldown's bar on both lines — the id differs, the cooldown does not", () => {
    const HEX_VARIANT = "211015";
    const shaman = {
      spec: CombatUnitSpec.Shaman_Restoration,
      unitClass: CombatUnitClass.Shaman,
    };
    const unused = countsLine({
      ...shaman,
      starts: [
        [HEX_VARIANT, 10, "Hex"],
        [HEX_VARIANT, 24, "Hex"],
      ],
    });
    expect(of(unused.items, "Hex")).toEqual([
      "Hex cast bar started 2×, went off 0×",
    ]);
    expect(unused.kit).toMatch(
      /Hex \[[^\]]*\] \[UNUSED — started 2×, never finished\]/,
    );
    const used = countsLine({
      ...shaman,
      starts: [
        [HEX_VARIANT, 10, "Hex"],
        [HEX_VARIANT, 24, "Hex"],
        [HEX_VARIANT, 60, "Hex"],
      ],
      casts: [[HEX_VARIANT, 25.6, "Hex"]],
    });
    expect(of(used.items, "Hex")).toEqual([
      "Hex cast bar started 3×, went off 1× (first 0:25)",
    ]);
    expect(used.kit).not.toMatch(/Hex \[[^\]]*\] \[UNUSED/);
  });

  it("the header says `went off` is the cast completing, not the control landing", () => {
    const { header } = countsLine({});
    expect(header).toContain("`cast bar started N×, went off M×`");
    expect(header).toContain(
      "`went off` means the cast bar completed and the spell was cast, NOT that the control landed",
    );
  });
});
