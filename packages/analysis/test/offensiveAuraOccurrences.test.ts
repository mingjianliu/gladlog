/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GH #119 — offensive effects whose only evidence is an aura: Havoc
 * Metamorphosis (the 191427 button never logs; the press shows as its 200166
 * landing, Demonic grants the form off Eye Beam) and Doom Winds 466772. One
 * extractor feeds the enemy-CD timeline, the crisis consumers and the aura
 * path (`hasOffensiveSpellActive`).
 */
import { CombatUnitSpec, LogEvent } from "@gladlog/parser-compat";

import { effectiveCooldownSeconds } from "../src/data/spellEffectData";
import {
  auraSurelyUpPastMs,
  nextAuraPressMs,
  resentAuraApplications,
} from "../src/utils/auraSurelyUp";
import { hasOffensiveSpellActive } from "../src/utils/cooldowns";
import {
  isEnemyCdWindowSpell,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import {
  auraOffensiveOccurrences,
  DEMONIC_FORM_SECONDS,
  OFFENSIVE_AURA_FLAGS,
} from "../src/utils/offensiveAuraOccurrences";
import { offensiveDangerWeight } from "../src/utils/spellDanger";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

const START = 1_000_000;
const COMBAT = { startTime: START, endTime: START + 180_000 } as any;
const s = (sec: number) => START + sec * 1000;

const aura = (ev: LogEvent, id: string, sec: number, who = "dh") =>
  makeAuraEvent(ev, id, s(sec), who, who, "BUFF");
const cast = (id: string, sec: number, who = "dh") =>
  makeSpellCastEvent(id, s(sec), who, "Self", who);
const havoc = (casts: any[], auras: any[]) =>
  makeUnit("dh", {
    name: "Havoc",
    spec: CombatUnitSpec.DemonHunter_Havoc,
    spellCastEvents: casts,
    auraEvents: auras,
  });
const enh = (casts: any[], auras: any[]) =>
  makeUnit("sh", {
    name: "Enh",
    spec: CombatUnitSpec.Shaman_Enhancement,
    spellCastEvents: casts,
    auraEvents: auras,
  });
const metaWeight = offensiveDangerWeight(
  "191427",
  (id) => effectiveCooldownSeconds(id) ?? 0,
);

function withDemonic<T>(role: "burst" | "minor" | "fact", fn: () => T): T {
  const saved = { ...OFFENSIVE_AURA_FLAGS };
  try {
    OFFENSIVE_AURA_FLAGS.demonic = role;
    return fn();
  } finally {
    Object.assign(OFFENSIVE_AURA_FLAGS, saved);
  }
}

describe("Havoc Metamorphosis 162264", () => {
  it("a press (its 200166 landing) is one occurrence of 191427: cooldown spent, observed end, full weight", () => {
    const u = havoc(
      [cast("200166", 10.6)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 10),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 40),
      ],
    );
    const [o, ...rest] = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(rest).toHaveLength(0);
    expect(o).toMatchObject({
      spellId: "191427",
      provenance: "press-inferred",
      startMs: s(10),
      endMs: s(40),
      endObserved: true,
      cooldownSeconds: 120,
      // recovered from the activation, the instant the friendly ledger dates
      // the press at (codex T05-2 #2)
      availableAgainAtMs: s(10) + 120_000,
      burstRole: "burst",
    });
    expect(o!.dangerWeight).toBe(metaWeight);
  });

  it("an Eye Beam form is Demonic: no cooldown, no availability, weight by the ruling switch", () => {
    const u = () =>
      havoc(
        [cast("198013", 20.2)],
        [
          aura(LogEvent.SPELL_AURA_APPLIED, "162264", 20),
          aura(LogEvent.SPELL_AURA_REMOVED, "162264", 27),
        ],
      );
    const fact = withDemonic("fact", () =>
      auraOffensiveOccurrences(u(), COMBAT),
    );
    expect(fact.occurrences[0]).toMatchObject({
      spellId: "162264",
      spellName: "Metamorphosis (Demonic)",
      provenance: "proc",
      cooldownSeconds: 0,
      availableAgainAtMs: null,
      availabilityUnknown: false,
      dangerWeight: 0,
      burstRole: "fact",
    });
    const burst = withDemonic("burst", () =>
      auraOffensiveOccurrences(u(), COMBAT),
    );
    expect(burst.occurrences[0]!.dangerWeight).toBe(metaWeight);
    expect(burst.occurrences[0]!.burstRole).toBe("burst");
    // user ruling 2026-09-26 「算小爆发」: the default — a burst priced at
    // Eye Beam's 30 s cooldown (weight 0), never a window on its own
    const minor = auraOffensiveOccurrences(u(), COMBAT);
    expect(OFFENSIVE_AURA_FLAGS.demonic).toBe("minor");
    expect(minor.occurrences[0]).toMatchObject({
      burstRole: "burst",
      dangerWeight: offensiveDangerWeight(
        "198013",
        (id) => effectiveCooldownSeconds(id) ?? 0,
      ),
    });
    expect(minor.occurrences[0]!.dangerWeight).toBeLessThan(metaWeight);
  });

  it("a form with neither a press nor an Eye Beam is unresolved — no proc claim", () => {
    const u = havoc(
      [],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 30),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 45),
      ],
    );
    const [o] = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(o).toMatchObject({
      provenance: "unresolved",
      availabilityUnknown: true,
      availableAgainAtMs: null,
    });
  });

  it("a press INTO a running Demonic form splits it: the press occurrence starts at the press (agy review)", () => {
    const u = havoc(
      [cast("198013", 5), cast("200166", 7.5)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 5),
        aura(LogEvent.SPELL_AURA_REFRESH, "162264", 7.5),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 37),
      ],
    );
    const occ = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(occ.map((o) => [o.provenance, o.startMs, o.endMs])).toEqual([
      ["proc", s(5), s(7.5)],
      ["press-inferred", s(7.5), s(37)],
    ]);
  });

  it("a landing within the logging lag of the aura start is not a split", () => {
    const u = havoc(
      [cast("200166", 50.9)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 50),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 80),
      ],
    );
    const occ = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(occ).toHaveLength(1);
    expect(occ[0]!.provenance).toBe("press-inferred");
    expect(occ[0]!.startMs).toBe(s(50));
  });

  // T05 a2: the row an Eye Beam explains is Demonic's, and the press goes up
  // where the friendly ledger dates it (`metamorphosisPressActivationMs`):
  // its landing, as no row of its own was logged
  it("an Eye Beam's form row then a landing within the lag: split at the landing", () => {
    const u = havoc(
      [cast("198013", 50.02), cast("200166", 50.9)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 50),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 80),
      ],
    );
    const occ = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(occ.map((o) => [o.provenance, o.startMs])).toEqual([
      ["proc", s(50)],
      ["press-inferred", s(50.9)],
    ]);
  });

  it("a Demonic form with no logged removal ends at Demonic's own 5 s, never at a cast's duration", () => {
    const u = havoc(
      [cast("198013", 60)],
      [aura(LogEvent.SPELL_AURA_APPLIED, "162264", 60)],
    );
    const [o] = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(o!.endObserved).toBe(false);
    expect(o!.endMs).toBe(s(60 + DEMONIC_FORM_SECONDS));
  });

  it("auras outside the round are not evidence (round-bounded stream)", () => {
    const u = havoc(
      [cast("200166", 170.5)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 170),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 400),
      ],
    );
    const [o] = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(o!.endMs).toBeLessThanOrEqual(COMBAT.endTime);
    expect(o!.endObserved).toBe(false);
  });
});

describe("codex review 2026-09-26 — the four reproduced failures", () => {
  it("1: the aura path reads the round's bounds, not the last aura event", () => {
    const u = enh([], [aura(LogEvent.SPELL_AURA_APPLIED, "466772", 30, "sh")]);
    // timeline: 30–38 s; the active check must agree at 35 s
    const [o] = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect([o!.startMs, o!.endMs]).toEqual([s(30), s(38)]);
    expect(hasOffensiveSpellActive(u, s(35), null, undefined, COMBAT)).toBe(
      true,
    );
  });

  it("2: a Demonic form's inferred end runs from its latest REFRESH", () => {
    const u = havoc(
      [cast("198013", 10)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 10),
        aura(LogEvent.SPELL_AURA_REFRESH, "162264", 16),
        aura(LogEvent.SPELL_AURA_APPLIED, "999999", 120),
      ],
    );
    const [o] = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(o!.endMs).toBe(s(16 + DEMONIC_FORM_SECONDS));
  });

  it("3: a press with no logged removal lasts the press's own duration, not the aura row's 20 s cap", () => {
    const u = havoc(
      [cast("200166", 30.6)],
      [aura(LogEvent.SPELL_AURA_APPLIED, "162264", 30)],
    );
    const [o] = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(o!.endMs).toBeGreaterThan(s(50));
    expect(o!.endObserved).toBe(false);
  });

  it("4: a logged 191427 button and its aura are ONE occurrence", () => {
    const u = havoc(
      [cast("191427", 30), cast("200166", 30.6)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 30),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 60),
      ],
    );
    const tl = reconstructEnemyCDTimeline([u], COMBAT);
    const metas = tl.players[0]!.offensiveCDs.filter(
      (c) => c.spellId === "191427",
    );
    expect(metas).toHaveLength(1);
    expect(metas[0]!.buffEndSeconds).toBe(60);
  });
});

describe("codex re-review 2026-09-26", () => {
  it("two separate aura occurrences stay two — the logged-cast merge never matches an appended occurrence", () => {
    const u = havoc(
      [],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 10),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 11),
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 12),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 17),
      ],
    );
    const tl = reconstructEnemyCDTimeline([u], COMBAT);
    expect(
      tl.players[0]!.offensiveCDs.map((c) => [
        c.castTimeSeconds,
        c.buffEndSeconds,
      ]),
    ).toEqual([
      [10, 11],
      [12, 17],
    ]);
    expect(hasOffensiveSpellActive(u, s(11.5), null, undefined, COMBAT)).toBe(
      false,
    );
  });
});

describe("aura twins of canonical casts (user 2026-09-27 「都做了吧」)", () => {
  const lock = (casts: any[], auras: any[]) =>
    makeUnit("wl", {
      name: "Lock",
      spec: CombatUnitSpec.Warlock_Destruction,
      spellCastEvents: casts,
      auraEvents: auras,
    });
  const wlAura = (ev: LogEvent, id: string, sec: number) =>
    makeAuraEvent(ev, id, s(sec), "wl", "wl", "BUFF");
  const wlCast = (id: string, sec: number) =>
    makeSpellCastEvent(id, s(sec), "wl", "Self", "wl");

  it("Summon Infernal: the cast keeps its place and takes the 30 s aura end — not DB2's 0.25 s cast row", () => {
    const u = lock(
      [wlCast("1122", 20)],
      [
        wlAura(LogEvent.SPELL_AURA_APPLIED, "111685", 21),
        wlAura(LogEvent.SPELL_AURA_REMOVED, "111685", 51),
      ],
    );
    const tl = reconstructEnemyCDTimeline([u], COMBAT);
    const inf = tl.players[0]!.offensiveCDs.filter(
      (c) => c.spellName === "Summon Infernal",
    );
    expect(inf).toHaveLength(1);
    expect([inf[0]!.castTimeSeconds, inf[0]!.buffEndSeconds]).toEqual([20, 51]);
  });

  it("the aura path starts AT THE CAST, not ≈ 1 s later at the aura (agy review)", () => {
    const u = lock(
      [wlCast("1122", 20)],
      [
        wlAura(LogEvent.SPELL_AURA_APPLIED, "111685", 21),
        wlAura(LogEvent.SPELL_AURA_REMOVED, "111685", 51),
      ],
    );
    expect(hasOffensiveSpellActive(u, s(20.5), null, undefined, COMBAT)).toBe(
      true,
    );
    expect(hasOffensiveSpellActive(u, s(52), null, undefined, COMBAT)).toBe(
      false,
    );
  });

  it("an inferred aura end only lengthens the cast estimate — a re-application cannot cut Ascendance's 15 s to 5 s (agy review)", () => {
    const sham = makeUnit("sh2", {
      name: "Ele",
      spec: CombatUnitSpec.Shaman_Elemental,
      // the second application carries a cast of the aura id itself (a
      // proc cast), so the interval builder closes the first segment at
      // 25 s — without one it keeps a same-spell re-apply open (batch 9)
      spellCastEvents: [
        makeSpellCastEvent("114050", s(20), "sh2", "Self", "sh2"),
        makeSpellCastEvent("1219480", s(25), "sh2", "Self", "sh2"),
      ],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "1219480",
          s(20),
          "sh2",
          "sh2",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "1219480",
          s(25),
          "sh2",
          "sh2",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "1219480",
          s(31),
          "sh2",
          "sh2",
          "BUFF",
        ),
      ],
    });
    const cds = reconstructEnemyCDTimeline([sham], COMBAT).players[0]!
      .offensiveCDs;
    const pressed = cds.find((c) => c.castTimeSeconds === 20)!;
    expect(pressed.buffEndSeconds).toBeGreaterThanOrEqual(35);
    // the re-application with no press is its own minor burst, keyed on the
    // cooldown id like the pressed twin
    const proc = cds.find((c) => c.spellName === "Ascendance (no press)")!;
    expect(proc.spellId).toBe("114050");
    expect(proc.dangerWeight).toBe(0);
  });

  it("an aura with no press is a minor burst: weight 0, '?' availability, no window alone", () => {
    const u = lock(
      [],
      [
        wlAura(LogEvent.SPELL_AURA_APPLIED, "111685", 40),
        wlAura(LogEvent.SPELL_AURA_REMOVED, "111685", 45),
      ],
    );
    const [o] = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(o).toMatchObject({
      spellName: "Summon Infernal (no press)",
      provenance: "unresolved",
      dangerWeight: 0,
      availabilityUnknown: true,
      burstRole: "burst",
    });
    expect(
      reconstructEnemyCDTimeline([u], COMBAT).alignedBurstWindows,
    ).toHaveLength(0);
  });
});

describe("Doom Winds 466772", () => {
  it("no logged press and no Ascendance: an ordinary Doom Winds occurrence (user ruling), 60 s weight", () => {
    const u = enh(
      [],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "466772", 30, "sh"),
        aura(LogEvent.SPELL_AURA_REMOVED, "466772", 40, "sh"),
      ],
    );
    const [o] = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(o).toMatchObject({
      spellId: "384352",
      provenance: "press-inferred",
      cooldownSeconds: 60,
      endMs: s(40),
    });
    expect(o!.dangerWeight).toBeCloseTo(Math.log(2), 5);
  });

  it("granted by Ascendance: ONE burst — no Doom Winds occurrence (user ruling 「一次呀」)", () => {
    const u = enh(
      [cast("114051", 30, "sh")],
      [aura(LogEvent.SPELL_AURA_APPLIED, "466772", 30, "sh")],
    );
    expect(auraOffensiveOccurrences(u, COMBAT).occurrences).toHaveLength(0);
  });

  it("a logged press keeps its cast occurrence, which takes the observed end", () => {
    const u = enh(
      [cast("384352", 30, "sh")],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "466772", 30, "sh"),
        aura(LogEvent.SPELL_AURA_REMOVED, "466772", 33, "sh"),
      ],
    );
    const tl = reconstructEnemyCDTimeline([u], COMBAT);
    const dw = tl.players[0]!.offensiveCDs.filter(
      (c) => c.spellName === "Doom Winds",
    );
    expect(dw).toHaveLength(1);
    expect(dw[0]!.buffEndSeconds).toBe(33);
  });
});

describe("consumers read the same occurrences", () => {
  it("timeline: a press is a solo window; a Demonic 'fact' never enters a window (agy review)", () => {
    const u = havoc(
      [cast("200166", 10.5), cast("198013", 100)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 10),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 40),
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 100),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 107),
      ],
    );
    const tl = withDemonic("fact", () =>
      reconstructEnemyCDTimeline([u], COMBAT),
    );
    // the burst list never holds a fact — every burst reader is safe by
    // construction; the fact lives in offensiveFacts for the renderer only
    expect(tl.players[0]!.offensiveCDs.map((c) => c.spellName)).toEqual([
      "Metamorphosis",
    ]);
    expect(tl.players[0]!.offensiveFacts!.map((c) => c.spellName)).toEqual([
      "Metamorphosis (Demonic)",
    ]);
    // under "burst" the Demonic form is an ordinary burst member
    const tlA = withDemonic("burst", () =>
      reconstructEnemyCDTimeline([u], COMBAT),
    );
    expect(tlA.players[0]!.offensiveCDs.map((c) => c.spellName)).toEqual([
      "Metamorphosis",
      "Metamorphosis (Demonic)",
    ]);
    expect(tlA.players[0]!.offensiveFacts).toBeUndefined();
    expect(
      tl.alignedBurstWindows.map((w) => [w.fromSeconds, w.toSeconds]),
    ).toEqual([[10, 40]]);
  });

  it("a minor (Demonic) burst never opens a window alone, but joins an aligned one", () => {
    const alone = havoc(
      [cast("198013", 100)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 100),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 107),
      ],
    );
    const tl = reconstructEnemyCDTimeline([alone], COMBAT);
    expect(tl.players[0]!.offensiveCDs.map((c) => c.spellName)).toEqual([
      "Metamorphosis (Demonic)",
    ]);
    expect(tl.alignedBurstWindows).toHaveLength(0);
    // next to a teammate's 60 s Doom Winds: two cooldowns aligned → a window
    const mate = enh(
      [],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "466772", 101, "sh"),
        aura(LogEvent.SPELL_AURA_REMOVED, "466772", 109, "sh"),
      ],
    );
    const tl2 = reconstructEnemyCDTimeline([alone, mate], COMBAT);
    expect(tl2.alignedBurstWindows).toHaveLength(1);
  });

  it("aura path: active inside the observed interval only, and the press passes the enemy-window filter", () => {
    const u = havoc(
      [cast("200166", 10.5)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 10),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 40),
      ],
    );
    expect(hasOffensiveSpellActive(u, s(20), null)).toBe(true);
    expect(hasOffensiveSpellActive(u, s(20), null, isEnemyCdWindowSpell)).toBe(
      true,
    );
    expect(hasOffensiveSpellActive(u, s(41), null)).toBe(false);
  });

  it("aura path: an unclosed Doom Winds is no longer active forever", () => {
    const u = enh(
      [],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "466772", 30, "sh"),
        aura(LogEvent.SPELL_AURA_APPLIED, "999999", 120, "sh"),
      ],
    );
    expect(hasOffensiveSpellActive(u, s(35), null)).toBe(true);
    expect(hasOffensiveSpellActive(u, s(100), null)).toBe(false);
  });
});

describe("aura twins pair one cast with one application (codex 20-F15-25)", () => {
  it("454351 cast at 10 s (removed 10.5 s) and a cast-less one at 12.5 s: two occurrences, the second `(no press)`", () => {
    const ret = makeUnit("rp", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [cast("454351", 10, "rp")],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "454351", 10, "rp"),
        aura(LogEvent.SPELL_AURA_REMOVED, "454351", 10.5, "rp"),
        aura(LogEvent.SPELL_AURA_APPLIED, "454351", 12.5, "rp"),
        aura(LogEvent.SPELL_AURA_REMOVED, "454351", 20.5, "rp"),
      ],
    });
    const occ = auraOffensiveOccurrences(ret, COMBAT).occurrences.filter(
      (o) => o.spellId === "454351",
    );
    expect(occ.map((o) => [o.spellName, o.startMs, o.endMs])).toEqual([
      ["Avenging Wrath", s(10), s(10.5)],
      ["Avenging Wrath (no press)", s(12.5), s(20.5)],
    ]);
  });
  it("… and the enemy timeline keeps the two apart (codex 20-F15-34)", () => {
    const ret = makeUnit("rp", {
      name: "Ret",
      spec: CombatUnitSpec.Paladin_Retribution,
      spellCastEvents: [cast("454351", 10, "rp")],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "454351", 10, "rp"),
        aura(LogEvent.SPELL_AURA_REMOVED, "454351", 10.5, "rp"),
        aura(LogEvent.SPELL_AURA_APPLIED, "454351", 12.5, "rp"),
        aura(LogEvent.SPELL_AURA_REMOVED, "454351", 20.5, "rp"),
      ],
    });
    const tl = reconstructEnemyCDTimeline([ret], COMBAT);
    const aw = (tl.players[0]?.offensiveCDs ?? []).filter(
      (c) => c.spellId === "454351",
    );
    expect(aw.map((c) => [c.castTimeSeconds, c.buffEndSeconds])).toEqual([
      [10, 10.5],
      [12.5, 20.5],
    ]);
  });
});

describe("T308: an aura-only life the log shows still up (codex 85-tk-L5-T308-1 #1 #3 #4)", () => {
  // Doom Winds 466772 (8 s) up at 10 s with no REMOVED; refreshed at 25 s
  const doom = (extraCasts: any[] = []) =>
    enh(extraCasts, [
      aura(LogEvent.SPELL_AURA_APPLIED, "466772", 10, "sh"),
      aura(LogEvent.SPELL_AURA_REFRESH, "466772", 25, "sh"),
    ]);
  const endOf = (u: any, bounds: any) =>
    (auraOffensiveOccurrences(u, bounds).occurrences.find(
      (o) => o.spellId === "384352",
    )?.endMs ?? 0) - START;
  const combatOf = (u: any) => ({
    startTime: START,
    endTime: s(60),
    units: { sh: u },
  });
  it("a REFRESH past its official end is the evidence: to the length it renewed (ruling (B))", () => {
    const u = doom();
    // REFRESH at 25 s, past the 18 s end: up for its 8 s from there
    expect(endOf(u, combatOf(u))).toBe(33_000);
  });
  it("a synthetic window (no units, no round end) keeps the cap", () => {
    const u = doom();
    expect(endOf(u, { startTime: START, endTime: s(60) })).toBe(33_000);
  });
  it("the caster's next press ends it, though its application row was lost", () => {
    // a press at 30 s, inside the renewed length, cuts the life there
    const u = doom([cast("384352", 30, "sh")]);
    expect(endOf(u, combatOf(u))).toBe(30_000);
  });
});

describe("T308: the threat reader runs on what the timeline runs on (codex 85-tk-L5-T308-1 #6)", () => {
  // Breath of Sindragosa's aura 1249658 (8 s) at 10 s, no REMOVED, its
  // breath ticking at 22 s; the round ends at 60 s
  const dk = () =>
    makeUnit("dk", {
      name: "Frost",
      spec: CombatUnitSpec.DeathKnight_Frost,
      spellCastEvents: [cast("152279", 10, "dk")],
      auraEvents: [aura(LogEvent.SPELL_AURA_APPLIED, "1249658", 10, "dk")],
      damageOut: [
        {
          srcUnitId: "dk",
          destUnitId: "e1",
          spellId: "1249658",
          spellName: "Breath of Sindragosa",
          logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: s(22) },
        },
      ],
    } as any);
  it("active at 21 s with the combat's units; off without them; off past the last tick (ruling (B))", () => {
    const u = dk();
    const combat = { startTime: START, endTime: s(60), units: { dk: u } };
    expect(hasOffensiveSpellActive(u, s(21), null, undefined, combat)).toBe(
      true,
    );
    expect(hasOffensiveSpellActive(u, s(30), null, undefined, combat)).toBe(
      false,
    );
    expect(
      hasOffensiveSpellActive(u, s(21), null, undefined, {
        startTime: START,
        endTime: s(60),
      }),
    ).toBe(false);
  });
});

describe("T308 round 2 (codex 85-tk-L5-T308-1b)", () => {
  const doom = (casts: any[] = [], extraAuras: any[] = []) =>
    enh(casts, [
      aura(LogEvent.SPELL_AURA_APPLIED, "466772", 10, "sh"),
      aura(LogEvent.SPELL_AURA_REFRESH, "466772", 25, "sh"),
      ...extraAuras,
    ]);
  const endOf = (u: any) =>
    (auraOffensiveOccurrences(u, {
      startTime: START,
      endTime: s(60),
      units: { sh: u },
    } as any).occurrences.find((o) => o.spellId === "384352")?.endMs ?? 0) -
    START;
  it("#3: another button that grants the aura (Ascendance) is its next press", () => {
    expect(endOf(doom([cast("114051", 30, "sh")]))).toBe(30_000);
  });
  it("#4: never past its holder's death", () => {
    const u = doom();
    (u as any).deathRecords = [{ timestamp: s(30) }];
    expect(endOf(u)).toBe(30_000);
  });
  it("#10: rows added since are read again", () => {
    const u = enh([], [aura(LogEvent.SPELL_AURA_APPLIED, "466772", 10, "sh")]);
    expect(endOf(u)).toBe(18_000);
    (u as any).damageOut = [
      {
        srcUnitId: "sh",
        destUnitId: "e1",
        spellId: "466772",
        spellName: "Doom Winds",
        logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: s(22) },
      },
    ];
    expect(endOf(u)).toBe(22_000);
  });
  it("#2: a hit just before the next press is that press's, for the threat reader too", () => {
    const u = makeUnit("dk", {
      name: "Frost",
      spec: CombatUnitSpec.DeathKnight_Frost,
      spellCastEvents: [cast("152279", 10, "dk"), cast("152279", 50, "dk")],
      auraEvents: [aura(LogEvent.SPELL_AURA_APPLIED, "1249658", 10, "dk")],
      damageOut: [
        {
          srcUnitId: "dk",
          destUnitId: "e1",
          spellId: "1249658",
          spellName: "Breath of Sindragosa",
          logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: s(49.8) },
        },
      ],
    } as any);
    const combat = { startTime: START, endTime: s(60), units: { dk: u } };
    expect(hasOffensiveSpellActive(u, s(40), null, undefined, combat)).toBe(
      false,
    );
  });
});

describe("T308 round 3 (codex 85-tk-L5-T308-1c)", () => {
  const hit = (src: string, id: string, name: string, sec: number) => ({
    srcUnitId: src,
    destUnitId: "e1",
    spellId: id,
    spellName: name,
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: s(sec) },
  });
  const doomHit = (sec: number) => hit("sh", "466772", "Doom Winds", sec);
  const bosHit = (sec: number) =>
    hit("dk", "1249658", "Breath of Sindragosa", sec);
  const round = (u: any, endSec = 60) => ({
    startTime: START,
    endTime: s(endSec),
    units: { [u.id]: u },
  });
  const occEnd = (u: any) =>
    (auraOffensiveOccurrences(u, round(u) as any).occurrences.find(
      (o) => o.spellId === "384352",
    )?.endMs ?? 0) - START;
  const frost = (
    casts: any[],
    auras: any[],
    hits: any[],
    deaths: number[] = [],
  ) =>
    makeUnit("dk", {
      name: "Frost",
      spec: CombatUnitSpec.DeathKnight_Frost,
      spellCastEvents: casts,
      auraEvents: auras,
      damageOut: hits,
      deathRecords: deaths.map((t) => ({ timestamp: s(t) })),
    } as any);

  it("#1: the next press of an aura is any button that grants it (Ascendance → Doom Winds), past the press's own 2 s", () => {
    const u = enh(
      [
        cast("384352", 10, "sh"),
        cast("384352", 11.5, "sh"),
        cast("114051", 40, "sh"),
      ],
      [],
    );
    expect(nextAuraPressMs(u, "466772", "384352", s(10))).toBe(s(40));
    expect(nextAuraPressMs(u, "466772", "384352", s(41))).toBe(Infinity);
  });
  it("#2: a REMOVED written with no source closes the aura-only life", () => {
    const u = enh(
      [],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "466772", 10, "sh"),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "466772",
          s(29),
          "0000000000000000",
          "sh",
          "BUFF",
        ),
      ],
    );
    (u as any).damageOut = [doomHit(22)];
    expect(occEnd(u)).toBe(29_000);
    expect(hasOffensiveSpellActive(u, s(52), null, undefined, round(u))).toBe(
      false,
    );
  });
  it("#3: one source-less REMOVED closes one caster's copy, not both", () => {
    const t = makeUnit("t", {
      name: "Target",
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "210824", s(10), "mA", "t"),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "210824", s(11), "mB", "t"),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "210824",
          s(13),
          "0000000000000000",
          "t",
        ),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "210824", s(20), "mB", "t"),
      ],
    } as any);
    expect(hasOffensiveSpellActive(t, s(15), new Set(["mA", "mB"]))).toBe(true);
  });
  it("#4: a death before the official end leaves nothing to run on", () => {
    const u = enh([], [aura(LogEvent.SPELL_AURA_APPLIED, "466772", 10, "sh")]);
    (u as any).damageOut = [doomHit(22)];
    (u as any).deathRecords = [{ timestamp: s(16) }];
    expect(occEnd(u)).toBeLessThanOrEqual(18_000);
  });
  it("#5: a refreshed life with no REMOVED ends at its holder's death", () => {
    const u = frost(
      [cast("152279", 10, "dk")],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "1249658", 10, "dk"),
        aura(LogEvent.SPELL_AURA_REFRESH, "1249658", 33, "dk"),
      ],
      [],
      [37],
    );
    expect(hasOffensiveSpellActive(u, s(39), null, undefined, round(u))).toBe(
      false,
    );
  });
  it("#6: a second press that REFRESHes the aura is read from its own press", () => {
    const u = makeUnit("w", {
      name: "Fury",
      spec: CombatUnitSpec.Warrior_Fury,
      spellCastEvents: [cast("1719", 10, "w"), cast("1719", 47, "w")],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "1719", 10, "w"),
        aura(LogEvent.SPELL_AURA_REFRESH, "1719", 47, "w"),
        aura(LogEvent.SPELL_AURA_REFRESH, "1719", 75, "w"),
      ],
    } as any);
    // the second press's Recklessness, refreshed at 75 s past its due end:
    // up to that refresh's length, no further (ruling (B))
    expect(
      hasOffensiveSpellActive(u, s(80), null, undefined, round(u, 110)),
    ).toBe(true);
    expect(
      hasOffensiveSpellActive(u, s(100), null, undefined, round(u, 110)),
    ).toBe(false);
  });
  it("#7: an APPLIED re-sent inside the official length with no press is the same life", () => {
    const u = frost(
      [cast("152279", 10, "dk")],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "1249658", 10, "dk"),
        aura(LogEvent.SPELL_AURA_APPLIED, "1249658", 15, "dk"),
      ],
      [bosHit(22)],
    );
    expect(hasOffensiveSpellActive(u, s(21), null, undefined, round(u))).toBe(
      true,
    );
  });
  it("#8: casts and deaths added since are read again", () => {
    const u = enh([], [aura(LogEvent.SPELL_AURA_APPLIED, "466772", 10, "sh")]);
    (u as any).damageOut = [doomHit(22)];
    expect(occEnd(u)).toBe(22_000);
    // a press at 21 s: the 22 s hit is that press's, no evidence of this life
    (u as any).spellCastEvents = [cast("114051", 21, "sh")];
    expect(occEnd(u)).toBe(18_000);
    (u as any).spellCastEvents = [];
    (u as any).deathRecords = [{ timestamp: s(21) }];
    expect(occEnd(u)).toBe(18_000);
  });
});

describe("T308 round 4 (codex 85-tk-L5-T308-1d)", () => {
  const hit = (src: string, id: string, name: string, sec: number) => ({
    srcUnitId: src,
    destUnitId: "e1",
    spellId: id,
    spellName: name,
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: s(sec) },
  });
  const round = (u: any, endSec = 60) => ({
    startTime: START,
    endTime: s(endSec),
    units: { [u.id]: u },
  });
  const occEnd = (u: any) =>
    (auraOffensiveOccurrences(u, round(u) as any).occurrences.find(
      (o) => o.spellId === "384352",
    )?.endMs ?? 0) - START;
  const doomEnd = (casts: any[]) => {
    const u = enh(casts, [
      {
        ...aura(LogEvent.SPELL_AURA_APPLIED, "466772", 10, "sh"),
        srcUnitName: "Enh",
      },
    ]);
    (u as any).damageOut = [hit("sh", "466772", "Doom Winds", 22)];
    const tl = reconstructEnemyCDTimeline([u], round(u) as any);
    return tl.players[0]?.offensiveCDs.find((c) => c.spellId === "384352")
      ?.buffEndSeconds;
  };
  it("1c #1 (codex's fixture): a logged press's life runs to its last evidence before Ascendance, the next button that grants it", () => {
    // ruling (B): its 22 s hit, not on to the Ascendance at 40 s
    expect(doomEnd([cast("384352", 10, "sh"), cast("114051", 40, "sh")])).toBe(
      22,
    );
    // an Ascendance before that hit ends the life at its official end
    expect(doomEnd([cast("384352", 10, "sh"), cast("114051", 21, "sh")])).toBe(
      18,
    );
  });
  it("#1: Doom Winds' pulse (same name, no cooldown of its own) is no next press", () => {
    expect(
      doomEnd([
        cast("384352", 10, "sh"),
        cast("469270", 13, "sh"),
        cast("114051", 40, "sh"),
      ]),
    ).toBe(22);
    expect(
      nextAuraPressMs(
        enh([cast("469270", 13, "sh")], []),
        "466772",
        "384352",
        s(10),
      ),
    ).toBe(Infinity);
  });
  it("#3: an APPLIED re-sent inside a REFRESHed life, with no press near, vetoes nothing", () => {
    const u = makeUnit("dk", {
      name: "Frost",
      spec: CombatUnitSpec.DeathKnight_Frost,
      spellCastEvents: [cast("152279", 10, "dk")],
      auraEvents: [
        aura(LogEvent.SPELL_AURA_APPLIED, "1249658", 10, "dk"),
        aura(LogEvent.SPELL_AURA_REFRESH, "1249658", 17, "dk"),
        aura(LogEvent.SPELL_AURA_APPLIED, "1249658", 20, "dk"),
      ],
      damageOut: [hit("dk", "1249658", "Breath of Sindragosa", 29)],
    } as any);
    expect(auraSurelyUpPastMs(u, u, "1249658", "152279", s(18), s(60))).toBe(
      true,
    );
  });
  it("#4: an aura-only life with no REMOVED ends at its holder's death, refreshed or not", () => {
    const u = enh(
      [],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "466772", 10, "sh"),
        aura(LogEvent.SPELL_AURA_REFRESH, "466772", 15, "sh"),
      ],
    );
    (u as any).deathRecords = [{ timestamp: s(16) }];
    // the occurrence keeps the end it was due (no countdown knows a death
    // to come — 1f #2); nothing is active on the dead holder
    expect(occEnd(u)).toBe(23_000);
    expect(hasOffensiveSpellActive(u, s(15), null, undefined, round(u))).toBe(
      true,
    );
    expect(hasOffensiveSpellActive(u, s(21), null, undefined, round(u))).toBe(
      false,
    );
  });
  it("#5: a run first seen as a REFRESH is the oldest open one a source-less REMOVED closes", () => {
    const t = makeUnit("t", {
      name: "Target",
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_REFRESH, "210824", s(10), "mA", "t"),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "210824", s(11), "mB", "t"),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "210824",
          s(13),
          "0000000000000000",
          "t",
        ),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "210824", s(20), "mB", "t"),
      ],
    } as any);
    expect(hasOffensiveSpellActive(t, s(15), new Set(["mA", "mB"]))).toBe(true);
  });
  it("#6: an aura row added since is read again", () => {
    const u = enh([], [aura(LogEvent.SPELL_AURA_APPLIED, "466772", 10, "sh")]);
    (u as any).damageOut = [hit("sh", "466772", "Doom Winds", 22)];
    expect(occEnd(u)).toBe(22_000);
    (u as any).auraEvents = [
      ...u.auraEvents,
      aura(LogEvent.SPELL_AURA_REMOVED, "466772", 24, "sh"),
    ];
    expect(occEnd(u)).toBe(24_000);
  });
});

describe("T308 round 5 (codex 85-tk-L5-T308-1e)", () => {
  const hit = (src: string, id: string, name: string, sec: number) => ({
    srcUnitId: src,
    destUnitId: "e1",
    spellId: id,
    spellName: name,
    logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: s(sec) },
  });
  it("#1 (90c01e7f r6): an Ascendance inside a Doom Winds' span carries the life on to the kill", () => {
    const u = enh(
      [cast("114051", 12.494, "sh")],
      [aura(LogEvent.SPELL_AURA_APPLIED, "466772", 9.197, "sh")],
    );
    (u as any).damageOut = [30.217, 33.211].map((t) =>
      hit("sh", "466772", "Doom Winds", t),
    );
    const bounds = { startTime: START, endTime: s(33.234), units: { sh: u } };
    const o = auraOffensiveOccurrences(u, bounds as any).occurrences.find(
      (x) => x.spellId === "384352",
    );
    // its last strike, ruling (B) (the kill follows at 33.234 s)
    expect((o?.endMs ?? 0) - START).toBe(33_211);
    expect(hasOffensiveSpellActive(u, s(30.217), null, undefined, bounds)).toBe(
      true,
    );
  });
  it("#2 #3: a re-sent APPLIED is the same life and moves no anchor; one past the anchor's length is a new life", () => {
    const w = makeUnit("w", {
      name: "Arms",
      spec: CombatUnitSpec.Warrior_Arms,
      spellCastEvents: [cast("107574", 10, "w")],
    } as any);
    const rows = [
      aura(LogEvent.SPELL_AURA_APPLIED, "107574", 10, "w"),
      aura(LogEvent.SPELL_AURA_APPLIED, "107574", 24, "w"),
      aura(LogEvent.SPELL_AURA_APPLIED, "107574", 36, "w"),
      aura(LogEvent.SPELL_AURA_REFRESH, "107574", 39, "w"),
    ];
    const resent = resentAuraApplications(w, rows as any, "107574");
    expect([...resent]).toEqual([rows[1]]);
  });
  it("#4 (1f #2): a Metamorphosis the log never closes keeps its due end, and is off once its holder is dead", () => {
    const u = havoc(
      [cast("200166", 10.6, "dh")],
      [aura(LogEvent.SPELL_AURA_APPLIED, "162264", 10, "dh")],
    );
    (u as any).deathRecords = [{ timestamp: s(16) }];
    const bounds = { startTime: START, endTime: s(60), units: { dh: u } };
    const meta = auraOffensiveOccurrences(u, bounds as any).occurrences.find(
      (o) => o.spellId === "191427",
    );
    expect((meta?.endMs ?? 0) - START).toBeGreaterThan(16_000);
    expect(hasOffensiveSpellActive(u, s(21), null, undefined, bounds)).toBe(
      false,
    );
  });
  it("1f #1 (90c01e7f r6, strikes cut short): a life an Ascendance carried on, with no evidence past it, runs the Ascendance's length", () => {
    // the round's own rows: Doom Winds up at 9.197 s, Ascendance pressed
    // and up 12.494–27.504 s, a pulse (469270, its cast row and its hits)
    // each second from 10.2 s — codex kept them to 22.2 s on the round's
    // 10 s Doom Winds; this unit has no talents (8 s: due off at 17.197 s,
    // 20.494 s from the Ascendance), so they stop at 20.206 s
    const pulses = [10.196, 11.202, 12.189, 13.2, 14.201, 15.202, 16.209];
    pulses.push(17.2, 18.202, 19.218, 20.206);
    const u = enh(
      [
        cast("114051", 12.494, "sh"),
        ...pulses.map((t) => cast("469270", t, "sh")),
      ],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "466772", 9.197, "sh"),
        aura(LogEvent.SPELL_AURA_APPLIED, "114051", 12.494, "sh"),
        aura(LogEvent.SPELL_AURA_REMOVED, "114051", 27.504, "sh"),
      ],
    );
    (u as any).damageOut = pulses
      .filter((t) => t > 17)
      .map((t) => hit("sh", "469270", "Doom Winds", t + 0.001));
    const bounds = { startTime: START, endTime: s(33.65), units: { sh: u } };
    const o = auraOffensiveOccurrences(u, bounds as any).occurrences.find(
      (x) => x.spellId === "384352",
    );
    expect((o?.endMs ?? 0) - START).toBe(20_494);
    expect(hasOffensiveSpellActive(u, s(20.207), null, undefined, bounds)).toBe(
      true,
    );
  });
  it("#5: a run first seen as a REFRESH, re-sent, then REMOVED is up between", () => {
    const mage = makeUnit("mA", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Arcane,
    } as any);
    const t = makeUnit("t", {
      name: "Target",
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_REFRESH, "210824", s(10), "mA", "t"),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "210824", s(12), "mA", "t"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "210824", s(18), "mA", "t"),
      ],
    } as any);
    const combat = {
      startTime: START,
      endTime: s(60),
      units: { mA: mage, t },
    };
    expect(
      hasOffensiveSpellActive(t, s(14), new Set(["mA"]), undefined, combat),
    ).toBe(true);
  });
});

describe("T308 round 7 (codex 85-tk-L5-T308-1g)", () => {
  it("#2: a carried life clipped by an earlier round end keeps the carried expiry for its countdown", () => {
    const pulses = [10.196, 11.202, 12.189, 13.2, 14.201, 15.202, 16.209];
    pulses.push(17.2, 18.202, 19.218);
    const u = enh(
      [
        cast("114051", 12.494, "sh"),
        ...pulses.map((t) => cast("469270", t, "sh")),
      ],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "466772", 9.197, "sh"),
        aura(LogEvent.SPELL_AURA_APPLIED, "114051", 12.494, "sh"),
      ],
    );
    const bounds = { startTime: START, endTime: s(19.5), units: { sh: u } };
    const o = auraOffensiveOccurrences(u, bounds as any).occurrences.find(
      (x) => x.spellId === "384352",
    );
    expect(((o as any)?.officialEndMs ?? 0) - START).toBe(20_494);
  });
  it("#4: asked of one mage, a source-less REMOVED still closes the OLDEST copy, as the builder pairs it", () => {
    const mA = makeUnit("mA", {
      name: "A",
      spec: CombatUnitSpec.Mage_Arcane,
    } as any);
    const mB = makeUnit("mB", {
      name: "B",
      spec: CombatUnitSpec.Mage_Arcane,
    } as any);
    const t = makeUnit("t", {
      name: "Target",
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "210824", s(10), "mA", "t"),
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, "210824", s(11), "mB", "t"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "210824", s(13), "", "t"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, "210824", s(20), "mB", "t"),
      ],
    } as any);
    const combat = { startTime: START, endTime: s(60), units: { mA, mB, t } };
    for (const who of [["mA", "mB"], ["mB"]])
      expect(
        hasOffensiveSpellActive(t, s(15), new Set(who), undefined, combat),
      ).toBe(true);
    expect(
      hasOffensiveSpellActive(t, s(15), new Set(["mA"]), undefined, combat),
    ).toBe(false);
  });
});

describe("T308 round 8 (codex 85-tk-L5-T308-1h)", () => {
  it("#2 (a52e5d1d r1 shape): routine in-life REFRESHes renew the deadline and are no evidence past it", () => {
    const u = enh([], []);
    const t = 10;
    // an 8 s Doom Winds refreshed every 5 s to 35 s: due off at 43 s
    const rows = [
      aura(LogEvent.SPELL_AURA_APPLIED, "466772", t, "sh"),
      ...[15, 20, 25, 30, 35].map((x) =>
        aura(LogEvent.SPELL_AURA_REFRESH, "466772", x, "sh"),
      ),
    ];
    (u as any).auraEvents = rows;
    const args = [u, u, "466772", "384352", s(18), s(60)] as const;
    expect(auraSurelyUpPastMs(...args, { lifeStartMs: s(t) })).toBe(false);
    // …a refresh after the renewed deadline is the evidence (1 #4)
    (u as any).auraEvents = [
      ...rows,
      aura(LogEvent.SPELL_AURA_REFRESH, "466772", 45, "sh"),
    ];
    expect(auraSurelyUpPastMs(...args, { lifeStartMs: s(t) })).toBe(true);
  });
});
