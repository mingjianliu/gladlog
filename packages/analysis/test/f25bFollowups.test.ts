/**
 * F25 leftovers (GH #191, #190):
 *  - #190: the outgoing DR walk reads a control's logged length inside the
 *    reset tick band only when nothing but the game ended it
 *    (`ccLengthIsDrEvidence`, the incoming walk's predicate);
 *  - fact10 D21 follow-up (user ruling 2026-11-05): an enemy healer's own
 *    control reflected back onto it is a healer lock (`enemyHealerCcWindows`);
 *  - fact10 D8 follow-up: a control immunity another unit put on the healer
 *    in the control's REMOVED millisecond is the lock's `endedBy`.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { enemyHealerCcWindows } from "../src/analysis/candidates/cooldownTiming";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  CC_IMMUNITY_END_LEAD,
  ccLengthIsDrEvidence,
  formatCcRemovalCause,
} from "../src/utils/ccTrinketAnalysis";
import {
  buildCcCategoryHistory,
  DR_RESET_CUTOVER_EPOCH_MS,
  DR_RESET_MS_121,
  drLevelAtLanding,
  getDRCategory,
} from "../src/utils/drAnalysis";
import {
  analyzeOutgoingCCChains,
  outgoingCcChainsWithDrHistory,
} from "../src/utils/outgoingCcChains";
import { BLESSING_OF_SANCTUARY_ID } from "../src/utils/sanctuaryRemovals";
import {
  makeAuraEvent,
  makeSpellCastEvent,
  makeUnit,
} from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

// a 12.1 epoch: the reset window is 20 s, the tick band 400 ms after it
const T0 = DR_RESET_CUTOVER_EPOCH_MS + 86_400_000;
const at = (s: number) => T0 + Math.round(s * 1000);
const CHEAP_SHOT = "1833"; // 4 s stun
const DIVINE_SHIELD = "642";
const HOJ = "853";
const FEAR = "118699"; // Fear's aura
const BERSERKER_SHOUT = "384100";

const combatOf = (units: any[], endS = 300) =>
  ({
    startTime: T0,
    endTime: at(endS),
    units: Object.fromEntries(units.map((u) => [u.id, u])),
  }) as never;

describe("#190: the outgoing walk's band reads only a length the game decided", () => {
  const rogue = () =>
    makeUnit("f1", {
      name: "Rogue",
      spec: CombatUnitSpec.Rogue_Subtlety,
      reaction: CombatUnitReaction.Friendly,
    });
  // Cheap Shot 0–4 s (Full), then a second one 20.1 s after it ended — in the
  // band — that came off at 2 s, half its length
  const enemyWith = (extra: any[], src = "f1") =>
    makeUnit("e1", {
      name: "EnemyPally",
      spec: CombatUnitSpec.Paladin_Retribution,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          CHEAP_SHOT,
          at(0),
          src,
          "e1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          CHEAP_SHOT,
          at(4),
          src,
          "e1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          CHEAP_SHOT,
          at(4 + DR_RESET_MS_121 / 1000 + 0.1),
          src,
          "e1",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          CHEAP_SHOT,
          at(6 + DR_RESET_MS_121 / 1000 + 0.1),
          src,
          "e1",
        ),
        ...extra,
      ],
    });
  const second = (e: any) => {
    const f = rogue();
    const apps = analyzeOutgoingCCChains([f], [e], combatOf([f, e])).flatMap(
      (c) => c.applications,
    );
    expect(apps).toHaveLength(2);
    return apps[1]!;
  };

  it("a half-length run the game ended reads 50 %", () => {
    expect(second(enemyWith([])).drInfo.level).toBe("50%");
  });

  it("the same half length cut by an immunity in its REMOVED millisecond is no evidence: the reset stands", () => {
    const shield = makeAuraEvent(
      LogEvent.SPELL_AURA_APPLIED,
      DIVINE_SHIELD,
      at(6 + DR_RESET_MS_121 / 1000 + 0.1),
      "e1",
      "e1",
      "BUFF",
    );
    expect(second(enemyWith([shield])).drInfo.level).toBe("Full");
  });

  it("…and so is one its holder's death cascade took off (605 39-2 r2 1:00: 2.04 s of 4, the unit died 36 ms later)", () => {
    const e = enemyWith([]);
    (e as any).deathRecords = [
      { timestamp: at(6 + DR_RESET_MS_121 / 1000 + 0.1) + 36 },
    ];
    expect(second(e).drInfo.level).toBe("Full");
  });

  it("…and so is one an ally's Blessing of Sanctuary took off (cover set 31-2 r2 1:39)", () => {
    const removeMs = at(6 + DR_RESET_MS_121 / 1000 + 0.1);
    const pally = makeUnit("e2", {
      name: "EnemyHpal",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          BLESSING_OF_SANCTUARY_ID,
          removeMs,
          "e1",
          "EnemyPally",
          "e2",
          "EnemyHpal",
        ),
      ],
    });
    const f = rogue();
    const e = enemyWith([]);
    const apps = analyzeOutgoingCCChains(
      [f],
      [e, pally],
      combatOf([f, e, pally]),
    ).flatMap((c) => c.applications);
    expect(apps).toHaveLength(2);
    expect(apps[1]!.drInfo.level).toBe("Full");
    // a pet's control: the chain credits the owner, the rows name the pet —
    // the predicate reads the aura's own source (the cover set's case was a
    // hunter pet's Intimidation)
    const pet = makeUnit("p1", {
      name: "Pet",
      reaction: CombatUnitReaction.Friendly,
      ownerId: "f1",
    });
    const e2 = enemyWith([], "p1");
    const petApps = analyzeOutgoingCCChains(
      [f],
      [e2, pally],
      combatOf([f, pet, e2, pally]),
    ).flatMap((c) => c.applications);
    expect(petApps).toHaveLength(2);
    expect(petApps[1]!.drInfo.level).toBe("Full");
    // …and the holder's DR history (`buildCcCategoryHistory`, the reading
    // behind `[CC BROKEN]` / `[CC REMOVED]`'s time left and the dispel DR)
    // reads it the same way once handed the predicate
    const units = new Map([f, pet, e2, pally].map((u) => [u.id, u as never]));
    const landing = {
      applyMs: at(4 + DR_RESET_MS_121 / 1000 + 0.1),
      spellId: CHEAP_SHOT,
      srcUnitId: "p1",
    };
    const historyOf = (gate?: typeof ccLengthIsDrEvidence) =>
      buildCcCategoryHistory(e2, getDRCategory(CHEAP_SHOT), T0, units, gate);
    // the history's own reading: whatever cut it, the band read 50 %
    expect(drLevelAtLanding(historyOf(), landing)).toBe("50%");
    expect(drLevelAtLanding(historyOf(ccLengthIsDrEvidence), landing)).toBe(
      "Full",
    );
  });
});

describe("fact10 D21 follow-up: a healer's own control reflected onto it is a lock", () => {
  const warrior = () =>
    makeUnit("f1", {
      name: "Warrior",
      spec: CombatUnitSpec.Warrior_Arms,
      reaction: CombatUnitReaction.Friendly,
    });
  const holyPally = () =>
    makeUnit("e1", {
      name: "EnemyHpal",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        // its own Hammer of Justice, sent back by a reflect: source = itself
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, HOJ, at(30), "e1", "e1"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, HOJ, at(34), "e1", "e1"),
      ],
    });

  it("is DR history only on the chain, flagged reflectedOntoTarget", () => {
    const f = warrior();
    const e = holyPally();
    // no application of ours: the plain walk has no chain for it
    expect(analyzeOutgoingCCChains([f], [e], combatOf([f, e]))).toHaveLength(0);
    const [chain] = outgoingCcChainsWithDrHistory([f], [e], combatOf([f, e]));
    expect(chain?.applications).toHaveLength(0);
    expect(chain?.drHistory).toHaveLength(1);
    expect(chain!.drHistory![0]).toMatchObject({
      drOnly: true,
      reflectedOntoTarget: true,
    });
  });

  it("opens a healer-lock window", () => {
    const f = warrior();
    const e = holyPally();
    const w = enemyHealerCcWindows([f], [e], combatOf([f, e]));
    expect(w).toHaveLength(1);
    expect(w[0]!.fromSeconds).toBeCloseTo(30, 3);
    expect(w[0]!.toSeconds).toBeCloseTo(34, 3);
  });

  it("a control the healer put on ITSELF with no reflect (a buff-typed self aura) opens none", () => {
    const f = warrior();
    const e = makeUnit("e1", {
      name: "EnemyHpal",
      spec: CombatUnitSpec.Paladin_Holy,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          HOJ,
          at(30),
          "e1",
          "e1",
          "BUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          HOJ,
          at(34),
          "e1",
          "e1",
          "BUFF",
        ),
      ],
    });
    expect(enemyHealerCcWindows([f], [e], combatOf([f, e]))).toHaveLength(0);
  });
});

describe("fact10 D8 follow-up: an ally's control immunity ends the lock", () => {
  const warlock = () =>
    makeUnit("f1", {
      name: "Lock",
      spec: CombatUnitSpec.Warlock_Affliction,
      reaction: CombatUnitReaction.Friendly,
    });
  const priestWith = (shoutSrc: string | null) =>
    makeUnit("e1", {
      name: "EnemyPriest",
      spec: CombatUnitSpec.Priest_Holy,
      reaction: CombatUnitReaction.Hostile,
      auraEvents: [
        makeAuraEvent(LogEvent.SPELL_AURA_APPLIED, FEAR, at(50), "f1", "e1"),
        makeAuraEvent(LogEvent.SPELL_AURA_REMOVED, FEAR, at(51.5), "f1", "e1"),
        ...(shoutSrc
          ? [
              {
                ...makeAuraEvent(
                  LogEvent.SPELL_AURA_APPLIED,
                  BERSERKER_SHOUT,
                  at(51.5),
                  shoutSrc,
                  "e1",
                  "BUFF",
                ),
                srcUnitName: "EnemyWarrior",
              },
            ]
          : []),
      ],
    });
  const enemyWarrior = () =>
    makeUnit("e2", {
      name: "EnemyWarrior",
      spec: CombatUnitSpec.Warrior_Fury,
      reaction: CombatUnitReaction.Hostile,
    });

  it("endedBy names the immunity and who put it up", () => {
    const f = warlock();
    const e = priestWith("e2");
    const w = enemyHealerCcWindows(
      [f],
      [e, enemyWarrior()],
      combatOf([f, e, enemyWarrior()]),
    );
    expect(w).toHaveLength(1);
    expect(w[0]!.endedBy).toMatchObject({
      kind: "immunity",
      spellName: "Berserker Shout",
      byUnitId: "e2",
    });
    expect(formatCcRemovalCause(w[0]!.endedBy!, "f1")).toBe(
      `${CC_IMMUNITY_END_LEAD}Berserker Shout (EnemyWarrior)`,
    );
  });

  it("no immunity at the removal: no endedBy", () => {
    const f = warlock();
    const e = priestWith(null);
    const w = enemyHealerCcWindows([f], [e], combatOf([f, e]));
    expect(w).toHaveLength(1);
    expect(w[0]!.endedBy).toBeUndefined();
  });
});
