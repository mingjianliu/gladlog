/* eslint-disable @typescript-eslint/no-explicit-any */
import { ensureAnalysisData } from "@gladlog/analysis";
import { buildPlayerLoadout } from "@gladlog/analysis/src/context/resourceSnapshot";
import { extractMajorCooldowns } from "@gladlog/analysis/src/utils/cooldowns";
import {
  extractKillAttempts,
  formatKillAttemptsForContext,
} from "@gladlog/analysis/src/utils/killAttempts";
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { checkKillTierWallOwnership } from "../src/quality/promptQualityCheck";

// R08 (b) (user ruling 2026-10-11): a 20–99 % wall the kit line tags
// `[UNUSED]` for a unit is in that unit's hand wherever a KILL ATTEMPTS line
// states its tier. The lines are f4da82c5's.
const KIT = [
  '  <unit id="1" name="Gordul-Al\'Akir-EU" spec="Frost Mage" role="log owner">',
  "    <cooldowns>Ice Block [210s, 2 Charges, lasts 10s], Frozen Orb [60s]</cooldowns>",
  "  </unit>",
  '  <unit id="4" name="Bärröw-DunModr-EU" spec="Beast Mastery Hunter" role="enemy">',
  "    <cooldowns>Aspect of the Turtle [135s, lasts 8s], Survival of the Fittest [90s, 2 Charges, lasts 8s], Bestial Wrath [30s]</cooldowns>",
  "  </unit>",
  '  <unit id="5" name="Nocarbs-Ravencrest-EU" spec="Demonology Warlock" role="enemy">',
  "    <cooldowns>Grimoire: Imp Lord [120s], Unending Resolve [180s, lasts 8s] [UNUSED], Dark Pact [45s, lasts 20s], Mortal Coil [45s] [UNUSED]</cooldowns>",
  "  </unit>",
  '  <unit id="6" name="Shadowsdoom-Haomarush-EU" spec="Restoration Druid" role="enemy">',
  "    <cooldowns>Barkskin [60s, lasts 12s] [UNUSED — started 1×, never finished], Ironbark [70s, lasts 12s], Tranquility [180s, lasts 8s] [UNUSED]</cooldowns>",
  "  </unit>",
];
const attempt = (target: string, opportunity: string) =>
  `  [1:15–1:18] on ${target} — Terror of the Skies opener (Full DR), 1 stun | opportunity: ${opportunity} | team focus 90% (0.35M on target inside it, 0.95M incl. the 5 s after) | FAILED: not enough damage`;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("checkKillTierWallOwnership", () => {
  it("fails: f4da82c5 as it printed — the Warlock with `Unending Resolve … [UNUSED]` named the softer target, PRIME", () => {
    const fails = checkKillTierWallOwnership([
      ...KIT,
      attempt(
        "Bärröw-DunModr-EU",
        "gated (Survival of the Fittest in hand; softer target then: Nocarbs-Ravencrest-EU — PRIME)",
      ),
    ]);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain(
      "line 13: KILL ATTEMPTS 把 Nocarbs-Ravencrest-EU 写成 更软的目标 — PRIME,而技能栏里 Unending Resolve 标着 [UNUSED]",
    );
  });

  it("fails: the target itself printed PRIME, and a gated list that leaves the `[UNUSED]` wall out", () => {
    const fails = checkKillTierWallOwnership([
      ...KIT,
      attempt(
        "Shadowsdoom-Haomarush-EU",
        "PRIME (no trinket, no 20-99% wall in hand)",
      ),
      attempt(
        "Shadowsdoom-Haomarush-EU",
        "gated (Ironbark in hand; no softer target)",
      ),
      attempt(
        "Bärröw-DunModr-EU",
        "trinket up (softer target then: Shadowsdoom-Haomarush-EU — gated, Ironbark in hand)",
      ),
    ]);
    expect(fails).toHaveLength(3);
    expect(fails[0]).toContain("写成 PRIME,而技能栏里 Barkskin 标着");
    expect(fails[1]).toContain("写成 gated (Ironbark in hand)");
    expect(fails[2]).toContain("更软的目标 — gated, Ironbark in hand");
  });

  it("passes: the wall named in hand; a pressed wall and a non-wall `[UNUSED]` entry say nothing; `trinket up` is not read", () => {
    expect(
      checkKillTierWallOwnership([
        ...KIT,
        attempt(
          "Bärröw-DunModr-EU",
          "gated (Survival of the Fittest in hand; softer target then: Nocarbs-Ravencrest-EU — gated, Unending Resolve in hand)",
        ),
        attempt(
          "Nocarbs-Ravencrest-EU",
          "gated (Unending Resolve in hand; Dark Pact already up since 1:10; no softer target)",
        ),
        attempt(
          "Shadowsdoom-Haomarush-EU",
          "gated (Barkskin/Ironbark in hand; no softer target)",
        ),
        // the hunter's kit has no `[UNUSED]` wall: PRIME is a statement the
        // text cannot contradict
        attempt(
          "Bärröw-DunModr-EU",
          "PRIME (no trinket, no 20-99% wall in hand)",
        ),
        attempt("Nocarbs-Ravencrest-EU", "trinket up (no softer target)"),
      ]),
    ).toEqual([]);
  });

  it("a unit with no kit in the roster is not compared", () => {
    expect(
      checkKillTierWallOwnership([
        attempt(
          "Nocarbs-Ravencrest-EU",
          "PRIME (no trinket, no 20-99% wall in hand)",
        ),
      ]),
    ).toEqual([]);
  });
});

// Producer → gate: the kit line `buildPlayerLoadout` prints and the attempt
// lines `extractKillAttempts` builds, for one round.
describe("buildPlayerLoadout + extractKillAttempts ⇄ checkKillTierWallOwnership", () => {
  const T0 = Date.UTC(2026, 7, 15);
  const at = (s: number) => T0 + s * 1000;
  const unit = (id: string, over: Record<string, unknown>): any => ({
    id,
    name: id,
    type: 1,
    reaction: CombatUnitReaction.Hostile,
    spec: CombatUnitSpec.None,
    info: { talents: [], pvpTalents: [] },
    spellCastEvents: [],
    castStartEvents: [],
    petSpellCastEvents: [],
    auraEvents: [],
    damageOut: [],
    damageIn: [],
    healIn: [],
    healOut: [],
    absorbsIn: [],
    absorbsOut: [],
    deathRecords: [],
    advancedActions: [],
    actionIn: [],
    actionOut: [],
    ...over,
  });
  const cast = (spellId: string, s: number, who: string): any => ({
    spellId,
    spellName: spellId,
    srcUnitId: who,
    srcUnitName: who,
    destUnitId: who,
    destUnitName: who,
    timestamp: at(s),
    logLine: {
      event: LogEvent.SPELL_CAST_SUCCESS,
      timestamp: at(s),
      parameters: [],
    },
  });
  const stun = (target: string, fromS: number, durS: number): any[] =>
    [LogEvent.SPELL_AURA_APPLIED, LogEvent.SPELL_AURA_REMOVED].map(
      (event, k) => ({
        spellId: "408",
        spellName: "Kidney Shot",
        srcUnitId: "Owner",
        srcUnitName: "Owner",
        destUnitId: target,
        destUnitName: target,
        timestamp: at(fromS + k * durS),
        logLine: { event, timestamp: at(fromS + k * durS), parameters: [] },
        auraType: "DEBUFF",
      }),
    );
  const render = () => {
    // the Hunter is stunned with his trinket up; the Warlock burned his at
    // 0.5 s and never pressed Unending Resolve
    const hunter = unit("Hunter", { auraEvents: stun("Hunter", 10, 5) });
    const lock = unit("Lock", {
      class: CombatUnitClass.Warlock,
      spec: CombatUnitSpec.Warlock_Demonology,
      spellCastEvents: [cast("336126", 0.5, "Lock")],
    });
    const owner = unit("Owner", {
      reaction: CombatUnitReaction.Friendly,
      damageOut: [
        {
          destUnitId: "Hunter",
          effectiveAmount: 60_000,
          logLine: {
            event: LogEvent.SPELL_DAMAGE,
            timestamp: at(12),
            parameters: [],
          },
        },
      ],
    });
    const combat: any = {
      startTime: T0,
      endTime: at(300),
      startInfo: { bracket: "3v3", zoneId: "1505" },
      units: { Owner: owner, Hunter: hunter, Lock: lock },
    };
    const enemies = [hunter, lock];
    const loadout = buildPlayerLoadout(
      owner,
      "Subtlety Rogue",
      [],
      [],
      {
        players: enemies.map((e) => ({
          playerName: e.name,
          specName: "x",
          offensiveCDs: [],
        })),
        alignedBurstWindows: [],
      } as any,
      enemies,
      enemies.map((player) => ({
        player,
        cds: extractMajorCooldowns(player, combat, { withBaselineOnly: true }),
      })),
    ).text.split("\n");
    const attempts = formatKillAttemptsForContext(
      extractKillAttempts([owner], enemies, combat),
    );
    return { loadout, attempts };
  };

  it("the kit tags the wall `[UNUSED]`, the attempt names its owner as gated with it, and the gate passes", () => {
    const { loadout, attempts } = render();
    expect(loadout.join("\n")).toMatch(
      /Unending Resolve \[180s, lasts \d+s\] \[UNUSED\]/,
    );
    expect(attempts.join("\n")).toContain(
      "opportunity: trinket up (softer target then: Lock — gated, Unending Resolve in hand)",
    );
    expect(checkKillTierWallOwnership([...loadout, ...attempts])).toEqual([]);
  });

  it("mutation: the same block with the old input's answer (`— PRIME`) fails", () => {
    const { loadout, attempts } = render();
    const old = attempts.map((l) =>
      l.replace(
        "softer target then: Lock — gated, Unending Resolve in hand",
        "softer target then: Lock — PRIME",
      ),
    );
    expect(old).not.toEqual(attempts);
    expect(checkKillTierWallOwnership([...loadout, ...old])).toHaveLength(1);
  });
});
