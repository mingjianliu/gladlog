import { LogEvent } from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { auraStandsForPressAt } from "../src/utils/auraActivationEra";
import {
  channelRefusedAtCast,
  rowIsPressEndingCast,
} from "../src/utils/castCommitSpans";
import {
  isPressHitRow,
  PRESS_LANDED_SAME_INSTANT_MS,
  pressLandedOn,
} from "../src/utils/castMissRows";
import {
  canonicalSpellId,
  effectEvidenceCastSeconds,
  spellAliasIds,
} from "../src/utils/cooldowns";
import {
  immunityStopsDamageSpell,
  immunityStopsSpellSchool,
  wallStopsEveryHit,
} from "../src/utils/enemyDefensives";
import { LOG_ZONE_UNCERTAINTY_MS,logDatedAt } from "../src/utils/logEra";
import { landedThroughWall } from "../src/utils/offensiveWasteAnalysis";
import {
  offensiveCooldownIdAt,
  variantSharesCooldownAt,
} from "../src/utils/overrideVariantEra";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "../src/utils/talents";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

/**
 * fact11 (F26) shared predicates — each pinned on the real ids of the audit
 * finding it answers, with the reading it replaced as the negative case.
 */

const OLD = PATCH_1215_GOLIVE_EPOCH_MS - 3 * 24 * 3600 * 1000; // 12.1.0 log
const NEW = PATCH_1215_GOLIVE_EPOCH_MS + 3 * 24 * 3600 * 1000; // 12.1.5 log
const NEAR = PATCH_1215_GOLIVE_EPOCH_MS - LOG_ZONE_UNCERTAINTY_MS / 2;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("logDatedAt — the one dated reading", () => {
  const d = { cutoverEpochMs: 1_000_000_000, before: "old", since: "new" };
  it("before / since / undatable", () => {
    expect(logDatedAt(d, 1)).toBe("old");
    expect(logDatedAt(d, 1_000_000_000)).toBe("new");
    expect(logDatedAt(d, Number.NaN)).toBe("new");
  });
  it("inside the zone uncertainty: the rule's careful side", () => {
    const at = 1_000_000_000 - LOG_ZONE_UNCERTAINTY_MS / 2;
    expect(logDatedAt(d, at)).toBe("new");
    expect(logDatedAt({ ...d, uncertainTakes: "before" }, at)).toBe("old");
    expect(logDatedAt({ ...d, uncertainTakes: "before" }, Number.NaN)).toBe(
      "old",
    );
  });
});

describe("Doom Winds 384352: an aura-only press before 12.1.5, a proc from it (D7 / D44)", () => {
  it("dated", () => {
    expect(auraStandsForPressAt("384352", OLD)).toBe(true);
    expect(auraStandsForPressAt("384352", NEW)).toBe(false);
    // careful side: a press (spends the cooldown)
    expect(auraStandsForPressAt("384352", NEAR)).toBe(true);
  });
  it("an undated aura-only activation is untouched", () => {
    expect(auraStandsForPressAt("114051", NEW)).toBe(true);
  });
  // codex 20-F26-01 #1: the effect-evidence fallback read the same proc
  // aura as a press and spent the cooldown
  it("the effect-evidence fallback follows the date", () => {
    const at = (start: number) => {
      const u = makeUnit("sh", {
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "466772",
            start + 10_000,
            "sh",
            "sh",
          ),
        ],
      });
      return effectEvidenceCastSeconds(u as never, "384352", 60, {
        startTime: start,
        units: { sh: u },
      } as never);
    };
    expect(at(NEW)).toEqual([]);
    expect(at(OLD)).toEqual([10]);
  });
});

describe("Predator's Wake 1259431 / The Hunt 1246167 (D22 D25 D29)", () => {
  it("shares The Hunt's cooldown from 12.1.5 only", () => {
    expect(variantSharesCooldownAt("1259431", OLD)).toBe(false);
    expect(variantSharesCooldownAt("1259431", NEW)).toBe(true);
    expect(variantSharesCooldownAt("1259431", undefined)).toBe(true);
    expect(variantSharesCooldownAt("383410", OLD)).toBe(true);
  });
  it("canonicalSpellId / spellAliasIds read the date", () => {
    expect(canonicalSpellId("1259431", OLD)).toBe("1259431");
    expect(canonicalSpellId("1259431", NEW)).toBe("1246167");
    expect(canonicalSpellId("1259431")).toBe("1246167");
    expect(spellAliasIds("1246167", OLD)).not.toContain("1259431");
    expect(spellAliasIds("1246167", NEW)).toContain("1259431");
  });
  it("an offensive press spends its own cooldown before 12.1.5", () => {
    expect(offensiveCooldownIdAt("1259431", OLD)).toBe("1259431");
    expect(offensiveCooldownIdAt("1259431", NEW)).toBe("1246167");
    expect(offensiveCooldownIdAt("1246167", OLD)).toBe("1246167");
  });
});

describe("The Hunt's effect after a Predator's Wake of its own (D26, 605 preview)", () => {
  // a70ff89c r2: Wake 1259431 at 28.919, The Hunt's 1246168 on the target
  // 0.2 s later, no press of The Hunt in the round
  const dh = (start: number) => {
    const u = makeUnit("dh", {
      spellCastEvents: [
        makeSpellCastEvent("1259431", start + 28_919, "enemy-1", "E", "dh"),
      ],
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "1246168",
          start + 29_150,
          "dh",
          "enemy-1",
        ),
      ],
    });
    return { u, combat: { startTime: start, units: { dh: u } } as never };
  };
  it("is the Wake's own on a 12.1.0 log: no press of The Hunt", () => {
    const { u, combat } = dh(OLD);
    expect(effectEvidenceCastSeconds(u as never, "1246167", 90, combat)).toEqual(
      [],
    );
  });
  it("still proves a press with no such variant press beside it", () => {
    const { combat } = dh(OLD);
    const bare = makeUnit("dh", {
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "1246168",
          OLD + 29_150,
          "dh",
          "enemy-1",
        ),
      ],
    });
    expect(
      effectEvidenceCastSeconds(bare as never, "1246167", 90, {
        ...(combat as object),
        units: { dh: bare },
      } as never),
    ).toEqual([29.15]);
  });
});

describe("school coverage of an immunity (D20)", () => {
  it("Cloak of Shadows' hand mask: physical goes through, magic does not", () => {
    expect(immunityStopsSpellSchool("31224", "100780")).toBe(false); // Tiger Palm
    expect(immunityStopsSpellSchool("31224", "116858")).toBe(true); // Chaos Bolt
  });
  it("a full immunity with no mask stays unknown (the caller's rule)", () => {
    expect(immunityStopsSpellSchool("186265", "100780")).toBeUndefined();
  });
});

describe("a damage spell's IMMUNE cause (D32)", () => {
  it("Ice Block explains a Lava Burst, Precognition does not", () => {
    expect(immunityStopsDamageSpell("45438", "51505")).toBe(true);
    expect(immunityStopsDamageSpell("377362", "51505")).toBe(false);
  });
  it("a school-limited immunity only for its schools", () => {
    expect(immunityStopsDamageSpell("31224", "100780")).toBe(false);
  });
  it("pct-100 walls only", () => {
    expect(wallStopsEveryHit("186265")).toBe(true); // Aspect of the Turtle
    expect(wallStopsEveryHit("48792")).toBe(false); // Icebound Fortitude
  });
});

describe("a hit through a wall (D21)", () => {
  it("a damage row inside Turtle went through it; a miss did not", () => {
    expect(landedThroughWall("186265", { hit: true })).toBe(true);
    expect(landedThroughWall("186265", { hit: false })).toBe(false);
  });
  it("a damage-reduction wall is hit through by design", () => {
    expect(landedThroughWall("48792", { hit: true })).toBe(false);
  });
});

describe("a non-control press that landed anyway (D10)", () => {
  const hunt = "370965";
  const rows = [
    {
      spellId: "370966",
      spellName: "The Hunt",
      destUnitId: "W",
      timestamp: 70_419,
      logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: 70_419 },
    },
  ];
  it("its impact on the unit counts as landing there", () => {
    expect(isPressHitRow(hunt, "The Hunt", rows[0] as never)).toBe(true);
    expect(
      pressLandedOn(rows as never, hunt, "The Hunt", [70_150], 70_150, "W"),
    ).toBe(true);
  });
  it("not on another unit", () => {
    expect(
      pressLandedOn(rows as never, hunt, "The Hunt", [70_150], 70_150, "X"),
    ).toBe(false);
  });
});

describe("landed through the refusal: its own instant only", () => {
  // Arcane Surge 365350 IMMUNE into Ice Block at 28_536; its same-named
  // 453326 hit lands 2.4 s later, once the block is gone
  const later = [
    {
      spellId: "453326",
      spellName: "Arcane Surge",
      destUnitId: "V",
      timestamp: 30_952,
      logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: 30_952 },
    },
  ];
  it("a hit seconds after the IMMUNE is no landing through it", () => {
    expect(
      pressLandedOn(
        later as never,
        "365350",
        "Arcane Surge",
        [28_535],
        28_535,
        "V",
        28_536,
      ),
    ).toBe(false);
    // without the refusal's instant (the old reading) it was one
    expect(
      pressLandedOn(later as never, "365350", "Arcane Surge", [28_535], 28_535, "V"),
    ).toBe(true);
  });
  it("The Hunt's impact in its root's IMMUNE millisecond still is", () => {
    const rows = [
      {
        spellId: "370966",
        spellName: "The Hunt",
        destUnitId: "W",
        timestamp: 70_419,
        logLine: { event: LogEvent.SPELL_DAMAGE, timestamp: 70_419 },
      },
    ];
    expect(
      pressLandedOn(
        rows as never,
        "370965",
        "The Hunt",
        [70_150],
        70_150,
        "W",
        70_419 + PRESS_LANDED_SAME_INSTANT_MS,
      ),
    ).toBe(true);
  });
});

describe("cast rows that end a channel (D2)", () => {
  const row = (spellId: string, t: number) => ({
    spellId,
    spellName: "",
    timestamp: t,
    destUnitId: "",
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: t },
  });
  it("a button press does, an unknown id does not", () => {
    const rows = [row("2061", 1000)]; // Flash Heal
    expect(rowIsPressEndingCast(rows[0] as never, rows as never)).toBe(true);
    const rows2 = [row("999999999", 1000)];
    expect(rowIsPressEndingCast(rows2[0] as never, rows2 as never)).toBe(false);
  });
});

describe("a channel refused at its press (D39)", () => {
  const unit = (withEffect: boolean) =>
    ({
      id: "M",
      missesOut: [
        {
          srcUnitId: "M",
          spellId: "205021",
          spellName: "Ray of Frost",
          timestamp: 9_020,
          logLine: { event: LogEvent.SPELL_MISSED, timestamp: 9_020 },
        },
      ],
      damageOut: withEffect
        ? [
            {
              srcUnitId: "M",
              spellId: "205021",
              spellName: "Ray of Frost",
              timestamp: 10_000,
              logLine: {
                event: LogEvent.SPELL_PERIODIC_DAMAGE,
                timestamp: 10_000,
              },
            },
          ]
        : [],
      healOut: [],
      auraEvents: [],
    }) as never;
  it("own MISS at the press, nothing after: refused", () => {
    expect(
      channelRefusedAtCast(
        unit(false),
        "205021",
        9_000,
        14_000,
        "Ray of Frost",
      ),
    ).toBe(true);
  });
  it("a tick after the MISS: it ran", () => {
    expect(
      channelRefusedAtCast(unit(true), "205021", 9_000, 14_000, "Ray of Frost"),
    ).toBe(false);
  });
});
