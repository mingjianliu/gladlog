/**
 * User ruling P-P5b = C (2026-10-01, triage missed-cleanse F-P5 forward
 * check): a removal that is not a spec's Magic purge counts only inside its
 * own scope — Shattering Throw against immunity shields, Shiv against enrage
 * effects, Arcane Torrent (only for a player observed casting it) against
 * Magic buffs within its radius. The holder is never a general purger, and a
 * general purger's lines do not change. Ruling P-P5b-land (2026-10-02): only
 * Shattering Throw carries a missed-purge line; Arcane Torrent is header-only;
 * Shiv is neither.
 */
import {
  CombatUnitClass,
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { beforeAll, describe, expect, it } from "vitest";

import { buildMatchContext } from "../src/context/buildMatchContext";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  IMMUNE_SHIELD_MECHANIC,
  SHATTERING_THROW_REMOVES,
  SHIV_REMOVES,
} from "../src/data/scopedPurges";
import {
  canOffensivePurge,
  formatMissedPurgeExemption,
  getDispelType,
  missedPurgeNotActionable,
  isMagicPurgeTarget,
  missedPurgesFor,
  reconstructDispelSummary,
  scopedPurgeToolsOf,
  scopedToolAnswers,
  scopedToolRemoves,
} from "../src/utils/dispelAnalysis";
import { ccMechanicOf } from "../src/utils/spellMechanics";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

beforeAll(async () => {
  await ensureAnalysisData();
});

const T0 = 1_000_000;
const at = (s: number) => T0 + s * 1000;
const combat = { startTime: T0, endTime: at(300) };
const cast = (unitId: string, spellId: string, s: number) => ({
  spellId,
  spellName: spellId,
  timestamp: at(s),
  srcUnitId: unitId,
  destUnitId: "e1",
  logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: at(s) },
});
/** an Arms Warrior; `throwAt` = Shattering Throw casts (seconds) */
const warrior = (throwAt: number[] = []): any =>
  makeUnit("w1", {
    name: "Warrior-R-US",
    spec: CombatUnitSpec.Warrior_Arms,
    class: CombatUnitClass.Warrior,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: throwAt.map((s) => cast("w1", "64382", s)),
  });
/** a Retribution Paladin; `torrentAt` = Arcane Torrent (155145) casts */
const paladin = (torrentAt: number[] = []): any =>
  makeUnit("p1", {
    name: "Paladin-F-US",
    spec: CombatUnitSpec.Paladin_Retribution,
    class: CombatUnitClass.Paladin,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: torrentAt.map((s) => cast("p1", "155145", s)),
  });
const rogue = (): any =>
  makeUnit("r1", {
    name: "Rogue-R-US",
    spec: CombatUnitSpec.Rogue_Assassination,
    class: CombatUnitClass.Rogue,
    reaction: CombatUnitReaction.Friendly,
  });
const priest = (torrentAt: number[] = []): any =>
  makeUnit("d1", {
    name: "Priest-R-US",
    spec: CombatUnitSpec.Priest_Discipline,
    class: CombatUnitClass.Priest,
    reaction: CombatUnitReaction.Friendly,
    spellCastEvents: torrentAt.map((s) => cast("d1", "232633", s)),
  });
/** an enemy Mage carrying `spellId` as a BUFF over [from, to] seconds */
const enemyWith = (spellId: string, from: number, to: number): any =>
  makeUnit("e1", {
    name: "Mage-R-US",
    spec: CombatUnitSpec.Mage_Frost,
    class: CombatUnitClass.Mage,
    reaction: CombatUnitReaction.Hostile,
    auraEvents: [
      makeAuraEvent(
        LogEvent.SPELL_AURA_APPLIED,
        spellId,
        at(from),
        "e1",
        "e1",
        "BUFF",
      ),
      makeAuraEvent(
        LogEvent.SPELL_AURA_REMOVED,
        spellId,
        at(to),
        "e1",
        "e1",
        "BUFF",
      ),
    ],
  });
const summary = (friends: any[], enemy: any) =>
  reconstructDispelSummary(friends, [enemy], combat);
/** every missed-purge window: the team's, then the scoped-only ones */
const windows = (friends: any[], enemy: any) => {
  const ds = summary(friends, enemy);
  return [...ds.missedPurgeWindows, ...(ds.scopedMissedPurgeWindows ?? [])];
};
const context = (owner: any, friends: any[], enemy: any) =>
  buildMatchContext(
    {
      ...combat,
      units: Object.fromEntries([...friends, enemy].map((u) => [u.id, u])),
      startInfo: { zoneId: "1505", bracket: "3v3" },
    } as any,
    friends,
    [enemy],
    { owner },
  );
const purgeLines = (owner: any, friends: any[], enemy: any) =>
  context(owner, friends, enemy)
    .split("\n")
    .filter((l) => l.includes("[MISSED PURGE OPPORTUNITY]"));
const headerOf = (owner: any, friends: any[], enemy: any) => {
  const lines = context(owner, friends, enemy).split("\n");
  const i = lines.indexOf("PURGE RESPONSIBILITY");
  return lines.slice(i + 1, i + 3);
};

describe("the scoped tools a player holds", () => {
  it("a Warrior observed casting Shattering Throw holds it; one never seen with it does not", () => {
    expect(scopedPurgeToolsOf(warrior([200]))).toEqual([
      {
        castSpellId: "64382",
        name: "Shattering Throw",
        scope: "immunity",
        note: "immunity shields only, 1.5s cast",
        castSeconds: 1.5,
      },
    ]);
    expect(scopedPurgeToolsOf(warrior())).toEqual([]);
  });
  it("every Rogue holds Shiv — enrage effects only", () => {
    expect(scopedPurgeToolsOf(rogue())).toEqual([
      {
        castSpellId: "5938",
        name: "Shiv",
        scope: "enrage",
        note: "enrage effects only",
        castSeconds: 0,
      },
    ]);
  });
  it("Arcane Torrent counts only for a player observed casting it, with its DB2 radius", () => {
    expect(scopedPurgeToolsOf(paladin())).toEqual([]);
    expect(scopedPurgeToolsOf(paladin([200]))).toEqual([
      {
        castSpellId: "155145",
        name: "Arcane Torrent",
        scope: "magic",
        note: "one Magic buff from enemies within 8 yd of the caster",
        castSeconds: 0,
      },
    ]);
  });
  it("a general purger gains nothing from Arcane Torrent, and no scoped holder becomes a general purger", () => {
    expect(scopedPurgeToolsOf(priest([200]))).toEqual([]);
    for (const u of [warrior([200]), rogue(), paladin([200])])
      expect(canOffensivePurge(u)).toBe(false);
  });
});

describe("what each scope covers", () => {
  it("immunity: the observed set, every id an immune shield in DB2 — never Aspect of the Turtle or a plain Magic buff", () => {
    for (const id of SHATTERING_THROW_REMOVES) {
      expect(ccMechanicOf(id), id).toBe(IMMUNE_SHIELD_MECHANIC);
      expect(scopedToolRemoves({ scope: "immunity" }, id), id).toBe(true);
    }
    expect(ccMechanicOf("186265")).not.toBe(IMMUNE_SHIELD_MECHANIC);
    for (const id of ["186265", "1044", "10060"])
      expect(scopedToolRemoves({ scope: "immunity" }, id), id).toBe(false);
  });
  it("enrage: the observed enrage effects, none of them a Magic buff", () => {
    for (const id of SHIV_REMOVES) {
      expect(scopedToolRemoves({ scope: "enrage" }, id), id).toBe(true);
      expect(getDispelType(id), id).toBeNull();
    }
    expect(scopedToolRemoves({ scope: "enrage" }, "1022")).toBe(false);
  });
  it("magic: any Magic buff is in scope — and no Magic buff is ever Arcane Torrent's missed window", () => {
    // an observed removal is explained by the dispel type alone — Arcane
    // Torrent did strip Power Word: Fortitude (blocklisted: free to reapply)
    for (const id of ["1022", "1044", "10060", "21562"])
      expect(scopedToolRemoves({ scope: "magic" }, id), id).toBe(true);
    expect(scopedToolRemoves({ scope: "magic" }, "184362")).toBe(false);
    // ruling P-P5b-land: only Shattering Throw carries a window
    for (const id of ["1022", "1044", "10060", "21562", "642", "45438"])
      expect(scopedToolAnswers({ scope: "magic" }, id), id).toBe(false);
    expect(scopedToolAnswers({ scope: "enrage" }, "184362")).toBe(false);
    expect(scopedToolAnswers({ scope: "immunity" }, "45438")).toBe(true);
    expect(isMagicPurgeTarget("1022")).toBe(true);
    expect(isMagicPurgeTarget("21562")).toBe(false); // blocklisted team buff
    expect(isMagicPurgeTarget("642")).toBe(false); // blocklisted immunity shell
  });
});

describe("Shattering Throw against an immunity shield", () => {
  it("an Ice Block nobody threw at is a missed window — the warrior's, kept apart from the team's list", () => {
    const ds = summary([warrior([200])], enemyWith("45438", 10, 20));
    // the desktop dashboard / mistakes card and every other reader of
    // missedPurgeWindows keep the universe they had (codex review)
    expect(ds.missedPurgeWindows).toEqual([]);
    const ws = ds.scopedMissedPurgeWindows!;
    expect(ws).toHaveLength(1);
    expect(ws[0]).toMatchObject({
      spellId: "45438",
      timeSeconds: 10,
      durationSeconds: 10,
      priority: "Critical",
      purgeWasOnCD: false,
      scopedPurgers: [
        { purgerName: "Warrior-R-US", tool: { name: "Shattering Throw" } },
      ],
    });
  });
  it("a shield the throw took off is not a miss — the purge shares the removal's timestamp (75.922 + 6.933 ≠ 82.855 in floats)", () => {
    // 17664ae3 round 1: Blessing of Protection 75.922 → 82.855, removed by
    // the warrior's Shattering Throw at 82.855
    const w: any = makeUnit("w1", {
      name: "Warrior-R-US",
      spec: CombatUnitSpec.Warrior_Fury,
      class: CombatUnitClass.Warrior,
      reaction: CombatUnitReaction.Friendly,
      spellCastEvents: [cast("w1", "64382", 82.351)],
      actionOut: [
        {
          spellId: "64380",
          spellName: "Shattering Throw",
          extraSpellId: "1022",
          extraSpellName: "Blessing of Protection",
          timestamp: at(82.855),
          srcUnitId: "w1",
          srcUnitName: "Warrior-R-US",
          destUnitId: "e1",
          destUnitName: "Mage-R-US",
          logLine: { event: LogEvent.SPELL_DISPEL, timestamp: at(82.855) },
        },
      ],
    });
    expect(75.922 + 6.933).toBeLessThan(82.855); // the trap
    const ds = reconstructDispelSummary(
      [w],
      [enemyWith("1022", 75.922, 82.855)],
      combat,
    );
    expect(ds.ourPurges.map((p) => p.removedSpellId)).toEqual(["1022"]);
    expect(ds.missedPurgeWindows).toEqual([]);
  });
  it("no Shattering Throw on the team → no window (Ice Block stays outside the Magic purge)", () => {
    expect(windows([warrior()], enemyWith("45438", 10, 20))).toEqual([]);
    expect(windows([priest()], enemyWith("45438", 10, 20))).toEqual([]);
    expect(windows([rogue()], enemyWith("45438", 10, 20))).toEqual([]);
  });
  it("a 1.5 s cast needs the reaction bar plus the cast: a 4 s Ice Block is not a miss, a 4.5 s one is", () => {
    expect(windows([warrior([200])], enemyWith("45438", 10, 14))).toEqual([]);
    expect(windows([warrior([200])], enemyWith("45438", 10, 14.5))).toHaveLength(
      1,
    );
  });
  it("locked out counts the cast too: stunned until 3.5 s before the shield ends → not actionable; 4.6 s → actionable", () => {
    // Ice Block 10–20 s; Hammer of Justice on the warrior from 10 s
    const stunnedUntil = (s: number): any => {
      const w = warrior([200]);
      w.auraEvents = [
        makeAuraEvent(
          LogEvent.SPELL_AURA_APPLIED,
          "853",
          at(10),
          "e1",
          "w1",
          "DEBUFF",
        ),
        makeAuraEvent(
          LogEvent.SPELL_AURA_REMOVED,
          "853",
          at(s),
          "e1",
          "w1",
          "DEBUFF",
        ),
      ];
      return w;
    };
    const late = stunnedUntil(16.5); // 3.5 s free < 3 s + 1.5 s cast
    const lateDs = summary([late], enemyWith("45438", 10, 20));
    expect(lateDs.scopedMissedPurgeWindows![0].purgersLockedOut).toBe(true);
    expect(lateDs.scopedMissedPurgeWindows![0].scopedPurgers![0].lockedOut).toBe(
      true,
    );
    expect(purgeLines(late, [late], enemyWith("45438", 10, 20))).toEqual([
      "0:10  [MISSED PURGE OPPORTUNITY]   Ice Block active on 2(FMage) (unpurged for 10s) | your removal for it: Shattering Throw (immunity shields only, 1.5s cast) | purgers were CC'd/locked out — not actionable",
    ]);
    const early = stunnedUntil(15.4); // 4.6 s free
    const earlyDs = summary([early], enemyWith("45438", 10, 20));
    expect(earlyDs.scopedMissedPurgeWindows![0].purgersLockedOut).toBe(false);
    expect(
      earlyDs.scopedMissedPurgeWindows![0].scopedPurgers![0].lockedOut,
    ).toBe(false);
  });
  it("Aspect of the Turtle and a plain Magic buff are outside its scope", () => {
    expect(windows([warrior([200])], enemyWith("186265", 10, 18))).toEqual([]);
    expect(windows([warrior([200])], enemyWith("10060", 10, 25))).toEqual([]);
  });
  it("the owner's line names the tool; thrown 60 s earlier, it reads the 180 s cooldown", () => {
    const w = warrior([200]);
    expect(purgeLines(w, [w], enemyWith("45438", 10, 20))).toEqual([
      "0:10  [MISSED PURGE OPPORTUNITY]   Ice Block active on 2(FMage) (unpurged for 10s) | your removal for it: Shattering Throw (immunity shields only, 1.5s cast)",
    ]);
    const spent = warrior([5]);
    expect(purgeLines(spent, [spent], enemyWith("45438", 65, 75))).toEqual([
      "1:05  [MISSED PURGE OPPORTUNITY]   Ice Block active on 2(FMage) (unpurged for 10s) | your removal for it: Shattering Throw (immunity shields only, 1.5s cast) | purge on cooldown for the whole buff (ready 3:05) — not actionable",
    ]);
  });
  it("a priest owner beside that warrior gets no Ice Block line — it is not the priest's to remove", () => {
    const w = warrior([200]);
    const p = priest();
    const enemy = enemyWith("45438", 10, 20);
    expect(windows([p, w], enemy)).toHaveLength(1);
    expect(purgeLines(p, [p, w], enemy)).toEqual([]);
    expect(purgeLines(w, [p, w], enemy)).toHaveLength(1);
  });
  it("the header states the scope instead of calling the warrior a purger", () => {
    const w = warrior([200]);
    const p = priest();
    const enemy = enemyWith("45438", 10, 20);
    expect(headerOf(w, [w, p], enemy)).toEqual([
      "  Log owner (Arms Warrior): CANNOT offensive purge, except Shattering Throw: immunity shields only, 1.5s cast",
      "  Team purgers: Discipline Priest",
    ]);
    expect(headerOf(p, [w, p], enemy)).toEqual([
      "  Log owner (Discipline Priest): CAN offensive purge",
      "  Team purgers: Arms Warrior (Shattering Throw: immunity shields only, 1.5s cast)",
    ]);
  });
});

describe("Arcane Torrent is stated in the header and never accuses (ruling P-P5b-land)", () => {
  it("a caster with it ready, Blessing of Protection up for 10 s → no window, no line; the header states the scope", () => {
    const p = paladin([200]);
    const enemy = enemyWith("1022", 10, 20);
    expect(windows([p], enemy)).toEqual([]);
    expect(purgeLines(p, [p], enemy)).toEqual([]);
    expect(headerOf(p, [p], enemy)).toEqual([
      "  Log owner (Retribution Paladin): CANNOT offensive purge, except Arcane Torrent: one Magic buff from enemies within 8 yd of the caster",
      "  Team purgers: none",
    ]);
  });
  it("never pressed this match → not stated at all", () => {
    const p = paladin();
    expect(headerOf(p, [p], enemyWith("1022", 10, 20))[0]).toBe(
      "  Log owner (Retribution Paladin): CANNOT offensive purge",
    );
  });
  it("beside a priest it adds nothing to the priest's window", () => {
    const pr = priest();
    const pal = paladin([5]);
    const enemy = enemyWith("1022", 20, 30);
    expect(windows([pr, pal], enemy)).toEqual(windows([pr], enemy));
    expect(missedPurgesFor(pal, summary([pr, pal], enemy))).toEqual([]);
  });
});

describe("a general purger's window is untouched by a scoped teammate", () => {
  it("priest + Shattering Throw warrior on Blessing of Protection: the priest reads the team's facts, the warrior its own", () => {
    const pr = priest();
    const w = warrior([5]); // thrown at 0:05 → back at 3:05
    const enemy = enemyWith("1022", 20, 30);
    const alone = windows([pr], enemy)[0];
    const both = windows([pr, w], enemy)[0];
    const { scopedPurgers, ...rest } = both;
    expect(rest).toEqual(alone); // window-level facts: the priest's, as before
    expect(summary([pr, w], enemy).scopedMissedPurgeWindows).toEqual([]);
    expect(scopedPurgers).toEqual([
      {
        purgerName: "Warrior-R-US",
        tool: {
          name: "Shattering Throw",
          scope: "immunity",
          note: "immunity shields only, 1.5s cast",
          castSeconds: 1.5,
        },
        purgeReadyAtSeconds: 185,
        lockedOut: false,
        losReachable: null,
      },
    ]);
    const ds = { missedPurgeWindows: [both], scopedMissedPurgeWindows: [] };
    expect(missedPurgesFor(pr, ds)).toEqual([both]);
    const mine = missedPurgesFor(w, ds)[0];
    expect(mine.purgeWasOnCD).toBe(true);
    expect(formatMissedPurgeExemption(mine)).toBe(
      " | your removal for it: Shattering Throw (immunity shields only, 1.5s cast) | purge on cooldown for the whole buff (ready 3:05) — not actionable",
    );
    // the priest owner's line: no tool note, no cooldown — exactly the
    // general purger's line (only the enemy's player number moved)
    expect(purgeLines(pr, [pr, w], enemy)).toEqual([
      "0:20  [MISSED PURGE OPPORTUNITY]   Blessing of Protection active on 3(FMage) (unpurged for 10s)",
    ]);
    expect(purgeLines(pr, [pr], enemy)).toEqual([
      "0:20  [MISSED PURGE OPPORTUNITY]   Blessing of Protection active on 2(FMage) (unpurged for 10s)",
    ]);
  });
});

describe("Shiv removes enrage effects — a scope for the roster scan, never a line or a header clause", () => {
  it("an enemy Enrage produces no window; the Rogue header is the plain one (ruling P-P5b-land)", () => {
    const r = rogue();
    const p = priest();
    const enemy = enemyWith("184362", 10, 20);
    expect(windows([r], enemy)).toEqual([]);
    expect(headerOf(r, [r, p], enemy)).toEqual([
      "  Log owner (Assassination Rogue): CANNOT offensive purge",
      "  Team purgers: Discipline Priest",
    ]);
    expect(headerOf(p, [r, p], enemy)).toEqual([
      "  Log owner (Discipline Priest): CAN offensive purge",
      "  Team purgers: none",
    ]);
  });
});

// B-tier X1: the desktop dispel panel flags a scoped window "not actionable"
// through the predicate the prompt's exemption suffix is worded from.
describe("missedPurgeNotActionable — the formatter's three 'not actionable' conditions", () => {
  const w = (over: Record<string, unknown>) => ({
    timeSeconds: 100,
    durationSeconds: 8,
    purgersLockedOut: false,
    losReachable: true as boolean | null,
    viaScopedTool: {
      name: "Shattering Throw",
      scope: "immunity" as const,
      note: "immunity shields only, 1.5s cast",
      castSeconds: 1.5,
    },
    ...over,
  });
  const agree = (over: Record<string, unknown>) => {
    const why = missedPurgeNotActionable(w(over));
    const text = formatMissedPurgeExemption(w(over));
    // the predicate says "not actionable" exactly when the suffix does
    expect(
      why.lockedOut || why.noReach || why.onCooldownThroughout,
    ).toBe(text.includes("not actionable"));
    return why;
  };

  it("agrees with the rendered suffix on every condition", () => {
    expect(agree({})).toEqual({
      lockedOut: false,
      noReach: false,
      onCooldownThroughout: false,
    });
    expect(agree({ purgersLockedOut: true }).lockedOut).toBe(true);
    expect(agree({ losReachable: false }).noReach).toBe(true);
    expect(agree({ losReachable: null }).noReach).toBe(false);
    // 4.4 s of the buff left < 3 s reaction + 1.5 s cast
    expect(agree({ purgeReadyAtSeconds: 103.6 }).onCooldownThroughout).toBe(
      true,
    );
    // 4.6 s left: the tool came back in time
    expect(agree({ purgeReadyAtSeconds: 103.4 }).onCooldownThroughout).toBe(
      false,
    );
  });

  it("the cast time is the scoped tool's: a general purge needs only the reaction threshold", () => {
    const general = { ...w({ purgeReadyAtSeconds: 104.5 }) } as any;
    delete general.viaScopedTool;
    // 3.5 s left ≥ 3 s: actionable for an instant purge, not for a 1.5 s cast
    expect(missedPurgeNotActionable(general).onCooldownThroughout).toBe(false);
    expect(
      missedPurgeNotActionable(w({ purgeReadyAtSeconds: 104.5 }))
        .onCooldownThroughout,
    ).toBe(true);
  });
});
