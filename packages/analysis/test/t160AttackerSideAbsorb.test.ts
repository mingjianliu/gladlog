/* eslint-disable @typescript-eslint/no-explicit-any -- minimal legacy units */
/**
 * Pipeline T160 (round-13 retest P9): an absorb whose aura sits on the
 * ATTACKER (Mindgames 375902, Sanctuary 208771, Blessed Hammer 229976) is no
 * shield of the target's — `[KILL WINDOW] … team burst 459k (+142k absorbed)`
 * counted a Shadow Priest's own Mindgames on the attacker as her shields.
 * The kill-window sums leave those rows out of both figures; a real shield
 * still counts.
 */
import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { ensureAnalysisData } from "../src/data/ensure";
import { absorbContributionsInWindow } from "../src/utils/absorbShields";
import { auditWindowTargeting } from "../src/utils/burstLedger";
import {
  ATTACKER_SIDE_ABSORB_IDS,
  incomingPressureEvents,
  isAttackerSideAbsorb,
  isDamageSentRow,
  isDamageTakenRow,
  isDeferralDamageRow,
  sumAbsorbedPressure,
} from "../src/utils/incomingPressure";
import { computeOffensiveWindows } from "../src/utils/offensiveWindows";
import { makeSpellCastEvent, makeUnit } from "./ported/testHelpers";

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;

beforeAll(async () => {
  await ensureAnalysisData();
});

describe("isAttackerSideAbsorb / isDamageTakenRow / isDamageSentRow", () => {
  const row = (spellId: string, event: LogEvent) => ({
    spellId,
    logLine: { event: event as string },
  });

  it("三个挂在攻击者身上的吸收是表里的全部", () => {
    expect([...ATTACKER_SIDE_ABSORB_IDS].sort()).toEqual([
      "208771",
      "229976",
      "375902",
    ]);
    expect(isAttackerSideAbsorb({ spellId: "375902" })).toBe(true);
    expect(isAttackerSideAbsorb({ spellId: "17" })).toBe(false);
    expect(isAttackerSideAbsorb({ spellId: null })).toBe(false);
  });

  it("Mindgames 的吸收行:目标没有承受(taken 不算),但攻击者确实打向了它(sent 照算);同 id 的伤害行两边都算 (R87)", () => {
    const eaten = row("375902", LogEvent.SPELL_ABSORBED);
    expect(isDamageTakenRow(eaten)).toBe(false);
    expect(isDamageSentRow(eaten)).toBe(true);
    const hit = row("375902", LogEvent.SPELL_DAMAGE);
    expect(isDamageTakenRow(hit)).toBe(true);
    expect(isDamageSentRow(hit)).toBe(true);
  });

  it("延后盾的吸收行两边都不算,普通盾的吸收行两边都算", () => {
    const stretch = row("410355", LogEvent.SPELL_ABSORBED);
    expect(isDeferralDamageRow(stretch)).toBe(true);
    expect(isDamageTakenRow(stretch)).toBe(false);
    expect(isDamageSentRow(stretch)).toBe(false);
    const shield = row("17", LogEvent.SPELL_ABSORBED);
    expect(isDamageTakenRow(shield)).toBe(true);
    expect(isDamageSentRow(shield)).toBe(true);
  });
});

describe("击杀窗口的 absorbed 只算目标自己的盾", () => {
  const combat = { startTime: T0, endTime: at(60), units: {} } as never;

  const absorb = (shieldId: string, s: number, amount: number) => ({
    logLine: {
      event: LogEvent.SPELL_ABSORBED,
      timestamp: at(s),
      parameters: [],
    },
    timestamp: at(s),
    spellId: shieldId,
    spellName: shieldId,
    srcUnitId: "e1",
    srcUnitName: "EnemyDruid",
    destUnitId: "e1",
    destUnitName: "EnemyDruid",
    absorbedAmount: amount,
    attackerId: "f1",
    attackSpellId: "133",
    attackSpellName: "Fireball",
  });

  const windowsWith = (shieldId: string) => {
    const enemy = makeUnit("e1", {
      name: "EnemyDruid",
      spec: CombatUnitSpec.Druid_Feral,
      reaction: CombatUnitReaction.Hostile,
      spellCastEvents: [
        makeSpellCastEvent(
          "22812",
          at(2),
          "e1",
          "EnemyDruid",
          "e1",
          "EnemyDruid",
        ),
      ] as never,
      absorbsIn: [
        absorb(shieldId, 30, 20_000),
        absorb(shieldId, 31, 20_000),
      ] as never,
      damageIn: [],
    });
    const mage = makeUnit("f1", {
      name: "Mage",
      spec: CombatUnitSpec.Mage_Fire,
    });
    const ws = computeOffensiveWindows(
      [enemy] as never,
      [mage] as never,
      combat,
    );
    expect(ws).toHaveLength(1);
    return ws[0]!;
  };

  it.each(["375902", "208771", "229976"])(
    "攻击者身上的 %s 吃掉 40k:没有爆发,absorbed 为 0",
    (id) => {
      const w = windowsWith(id);
      expect(w.friendlyDamageInWindow).toBe(0);
      expect(w.friendlyAbsorbedInWindow).toBe(0);
      expect(w.bursts).toEqual([]);
    },
  );

  it("对照:目标的 Power Word: Shield 吃掉同样的 40k,照算", () => {
    const w = windowsWith("17");
    expect(w.friendlyAbsorbedInWindow).toBe(40_000);
    expect(w.bursts).toHaveLength(1);
  });
});

// User ruling R84 (2026-11-19): damage eaten by an aura on the attacker is
// not absorbed pressure on the unit it was aimed at — the incoming side reads
// the same predicate as the offence side.
describe("受击一侧:挂在攻击者身上的吸收不算我方承受的压力 (R84)", () => {
  const absorb = (spellId: string, s: number, amount: number): any => ({
    spellId,
    spellName: `S${spellId}`,
    attackerId: "enemy",
    attackSpellId: "585",
    absorbedAmount: amount,
    timestamp: at(s),
    logLine: { event: LogEvent.SPELL_ABSORBED, timestamp: at(s) },
  });
  const victim = (absorbsIn: any[]): any => ({
    id: "us",
    reaction: CombatUnitReaction.Friendly,
    damageIn: [],
    absorbsIn,
  });

  it("incomingPressureEvents / sumAbsorbedPressure 跳过 Mindgames 行,普通盾照算", () => {
    const u = victim([absorb("375902", 5, 40_000), absorb("17", 6, 25_000)]);
    expect(incomingPressureEvents(u).map((e) => e.spellId)).toEqual(["17"]);
    expect(sumAbsorbedPressure(u, at(0), at(10))).toBe(25_000);
  });

  it("absorbContributionsInWindow 不把攻击者身上的光环列成这个单位的盾", () => {
    const u = victim([absorb("208771", 5, 40_000), absorb("17", 6, 25_000)]);
    expect(
      absorbContributionsInWindow(u, at(0), at(10)).map((c) => c.spellId),
    ).toEqual(["17"]);
  });
});

// User ruling R87 (2026-11-19): a sentence about where a player SENT damage
// keeps counting a hit an aura on that player ate. 22-3-229: a warrior
// swinging at the team's focus with Mindgames on him read off-target.
describe("打向谁:被自己身上的光环吃掉的攻击仍算打向了那个目标 (R87)", () => {
  const row = (
    event: LogEvent,
    dest: string,
    amount: number,
    spellId = "1",
  ): any => ({
    spellId,
    destUnitId: dest,
    effectiveAmount: event === LogEvent.SPELL_ABSORBED ? amount : -amount,
    logLine: { event, timestamp: at(5) },
  });
  const unit = (id: string, reaction: number, damageOut: any[] = []): any => ({
    id,
    name: id,
    reaction,
    info: {},
    damageOut,
    deathRecords: [],
  });
  const audit = (eatenBy: string) => {
    const owner = unit("owner", 1, [
      // 60k of swings at the focus, eaten; 50k landed on a third enemy
      row(LogEvent.SPELL_ABSORBED, "focus", 60_000, eatenBy),
      row(LogEvent.SPELL_DAMAGE, "other", 50_000),
    ]);
    const mate = unit("mate", 1, [row(LogEvent.SPELL_DAMAGE, "focus", 500_000)]);
    const enemies = ["target", "focus", "other"].map((id) => unit(id, 2));
    const combat: any = {
      startTime: T0,
      endTime: at(60),
      units: Object.fromEntries(
        [owner, mate, ...enemies].map((u) => [u.id, u]),
      ),
    };
    const window: any = {
      fromSeconds: 0,
      toSeconds: 20,
      durationSeconds: 20,
      targetUnitId: "target",
      targetName: "target",
    };
    return auditWindowTargeting(owner, [window], enemies, combat)[0]!;
  };

  it("Mindgames 吃掉的挥击仍算打向集火目标:最大非目标是集火对象,followedTeamFocus 成立", () => {
    const a = audit("375902");
    expect(a.topOffTarget?.unitId).toBe("focus");
    expect(a.followedTeamFocus).toBe(true);
    expect(a.playerDamageTotal).toBe(110_000);
  });

  it("对照:延后盾的记账行两边都不算,最大非目标变成第三个敌人", () => {
    const a = audit("410355");
    expect(a.topOffTarget?.unitId).toBe("other");
    expect(a.followedTeamFocus).toBe(false);
    expect(a.playerDamageTotal).toBe(50_000);
  });
});
