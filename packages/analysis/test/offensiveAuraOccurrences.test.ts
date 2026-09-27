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
      availableAgainAtMs: s(10.6) + 120_000,
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
      [cast("198013", 50), cast("200166", 50.9)],
      [
        aura(LogEvent.SPELL_AURA_APPLIED, "162264", 50),
        aura(LogEvent.SPELL_AURA_REMOVED, "162264", 80),
      ],
    );
    const occ = auraOffensiveOccurrences(u, COMBAT).occurrences;
    expect(occ).toHaveLength(1);
    expect(occ[0]!.provenance).toBe("press-inferred");
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
