/**
 * FT I12 (user ruling 2026-10-11, option b) — a `[CONTESTED]` line states
 * cast risk, and the enemy interrupts ready, only for a control that has a
 * cast to interrupt. The reading is official: `interruptibleCastOf`
 * (spellMechanicsGenerated.json `castMs` + the DB2 channel flag).
 *
 * Raw rows behind the ids below (605-file capture, the owner's rows in the
 * whole log): Hammer of Justice 853 — 2 SPELL_CAST_SUCCESS, 0 SPELL_CAST_START
 * (6aa7029e); Psychic Scream 8122 — 3 / 0 (22f18481); Capacitor Totem 192058
 * — 17 / 0 (d780f387); Cyclone 33786 — 9 SUCCESS, 18 START (1405c83e); Song
 * of Chi-Ji 198898 — 7 / 9 (62d13045); Lightning Lasso 305483 — 1 SUCCESS, 0
 * START, then its channelled stun 305485 for 5 s (b0a4eba8).
 */
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src";
import { castEffectPairs, castInAuraSet } from "../src/data/castEffectAuras";
import observed from "../src/data/observedSpellIdsGenerated.json";
import { getEnglishSpellName } from "../src/data/spellEffectData";
import { ccSpellIds } from "../src/data/spellTags";
import {
  CONTESTED_LINE_RE_SRC,
  contestedTailForm,
  contestedTailFormsOfName,
  contestedTradeTail,
  formatContestedTradeLine,
  type IContestedTradeFact,
} from "../src/utils/healerOffenseAnalysis";
import { interruptibleCastOf } from "../src/utils/spellMechanics";

beforeAll(async () => {
  await ensureAnalysisData();
});

const fact = (over: Partial<IContestedTradeFact>): IContestedTradeFact => ({
  fromSeconds: 144,
  toSeconds: 148,
  durationSeconds: 4,
  teamMinHpPct: 80,
  ccSpellName: "Hammer of Justice",
  ccSpellId: "853",
  ccInterruptible: "none",
  enemyHealerName: "Chunguswings-Onyxia-US",
  enemyHealerSpec: "Holy Priest",
  enemyHealerTrinket: "available",
  ownerHealing: 138_000,
  ownerCCCasts: 1,
  enemyInterruptsReady: 1,
  ...over,
});

describe("interruptibleCastOf — what of a cast a kick can stop, by DB2", () => {
  it("every id used here is alive in the corpus", () => {
    const seen = new Set((observed as number[]).map(String));
    for (const id of [
      "853",
      "8122",
      "192058",
      "22570",
      "33786",
      "198898",
      "605",
      "305483",
      "305485",
    ])
      expect(seen.has(id), id).toBe(true);
  });

  it("an instant is `none`", () => {
    for (const id of ["853", "8122", "192058", "22570"])
      expect(interruptibleCastOf(id), id).toBe("none");
  });

  it("a base cast time is a `bar` — also when the spell channels afterwards", () => {
    for (const id of ["33786", "198898", "605"])
      expect(interruptibleCastOf(id), id).toBe("bar");
  });

  it("Lightning Lasso begins instantly and channels the stun its cast applies — a `channel`, not an instant", () => {
    expect(interruptibleCastOf("305483")).toBe("channel");
  });

  it("no DB2 row is unknown, never an instant", () => {
    expect(interruptibleCastOf("999999999")).toBeUndefined();
  });
});

describe("the [CONTESTED] line's tail", () => {
  it("an instant: no cast-risk clause and no interrupt count", () => {
    expect(formatContestedTradeLine(fact({}))).toBe(
      "  [CONTESTED] 2:24–2:28 (4s, team min HP 80%): Hammer of Justice ready on enemy healer Chunguswings-Onyxia-US (DR Full, trinket available); you healed 138k, cast 1 CC — contested trade: a CC here competed with continued healing (instant: no cast to interrupt) (EV question, not a verdict).",
    );
  });

  it("a cast bar: the text every line carried before", () => {
    expect(
      formatContestedTradeLine(
        fact({
          ccSpellName: "Cyclone",
          ccSpellId: "33786",
          ccInterruptible: "bar",
        }),
      ),
    ).toBe(
      "  [CONTESTED] 2:24–2:28 (4s, team min HP 80%): Cyclone ready on enemy healer Chunguswings-Onyxia-US (DR Full, trinket available); you healed 138k, cast 1 CC; enemy interrupts ready: 1 — contested trade: a CC here competed with continued healing AND carried cast risk (EV question, not a verdict).",
    );
  });

  it("a channel reads as a cast bar does", () => {
    expect(contestedTradeTail("channel", 2)).toBe(contestedTradeTail("bar", 2));
  });

  it("a cast DB2 has no row for claims neither", () => {
    expect(contestedTradeTail(undefined, 3)).toBe(
      " — contested trade: a CC here competed with continued healing (EV question, not a verdict).",
    );
  });

  it("every form reads back through the shared pattern, and nothing else does", () => {
    const re = new RegExp(CONTESTED_LINE_RE_SRC);
    const forms = [
      ["bar", "risk"],
      ["channel", "risk"],
      ["none", "instant"],
      [undefined, "silent"],
    ] as const;
    for (const [kind, form] of forms) {
      const m = re.exec(
        formatContestedTradeLine(fact({ ccInterruptible: kind })),
      );
      expect(m?.[5]).toBe("Hammer of Justice");
      expect(contestedTailForm(m![10]!)).toBe(form);
    }
    // mutations: an instant note beside the count, a dropped disclaimer
    expect(
      contestedTailForm(
        "; enemy interrupts ready: 1 — contested trade: a CC here competed with continued healing (instant: no cast to interrupt) (EV question, not a verdict).",
      ),
    ).toBeNull();
    expect(
      contestedTailForm(
        " — contested trade: a CC here competed with continued healing (instant: no cast to interrupt)",
      ),
    ).toBeNull();
  });
});

describe("contestedTailFormsOfName — the gate's reading of the rendered name", () => {
  it("one form per name for the controls the capture's lines name", () => {
    const want: Array<[string, "risk" | "instant"]> = [
      ["Psychic Scream", "instant"],
      ["Hammer of Justice", "instant"],
      ["Holy Word: Chastise", "instant"],
      ["Incapacitating Roar", "instant"],
      ["Maim", "instant"],
      ["Blinding Light", "instant"],
      ["Paralysis", "instant"],
      ["Leg Sweep", "instant"],
      ["Mighty Bash", "instant"],
      // its stun 118905 carries the totem's own 2 s cast; the press is 192058
      ["Capacitor Totem", "instant"],
      ["Hex", "risk"],
      ["Mind Control", "risk"],
      ["Sleep Walk", "risk"],
      ["Cyclone", "risk"],
      // its disorient 198909 is instant; the press 198898 has a 1.8 s cast
      ["Song of Chi-Ji", "risk"],
      ["Lightning Lasso", "risk"],
    ];
    for (const [name, form] of want)
      expect([...contestedTailFormsOfName(name)], name).toEqual([form]);
  });

  it("a name no CC cast carries has no form", () => {
    expect(contestedTailFormsOfName("No Such Control").size).toBe(0);
  });

  it("the names two casts of different kinds share are known — a new one weakens the gate for that name", () => {
    const names = new Set<string>();
    for (const id of ccSpellIds) names.add(getEnglishSpellName(id));
    for (const [cast] of castEffectPairs())
      if (castInAuraSet(cast, ccSpellIds)) names.add(getEnglishSpellName(cast));
    const twoForms = [...names]
      .filter((n) => contestedTailFormsOfName(n).size > 1)
      .sort();
    // Fear 5782 has a 1.7 s cast; 130616 (same name) is instant
    expect(twoForms).toEqual(["Fear"]);
  });
});
