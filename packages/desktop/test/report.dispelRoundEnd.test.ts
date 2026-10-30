import {
  annotateMissedPurgesWithKillWindows,
  buildMatchContext,
  computeOffensiveWindows,
  reconstructDispelSummary,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import { deriveDispelDash } from "../src/renderer/src/report/derive/dispelDash";
import { toLegacySafe } from "../src/renderer/src/report/derive/legacySource";
import { deriveMistakes } from "../src/renderer/src/report/derive/mistakes";
import type { StoredMatch } from "../src/renderer/src/report/derive/types";
import {
  ROUND_END_DEATH_S,
  roundEndFixture,
  SOLO_SHUFFLE,
} from "./fixtures/roundEndFixture";

// One match, read twice: as a Solo Shuffle round (the injected death at 70 s
// ends it) and as 3v3 (the same death ends nothing). See roundEndFixture.ts
// for what crosses the 70 s mark.
const shuffle = roundEndFixture(SOLO_SHUFFLE);
const threes = roundEndFixture("3v3");

/** `start|unit|printed seconds` of a panel row or a card. */
const rowKeys = (
  rows: ReadonlyArray<{ tS: number; unitName: string; text: string }>,
): string[] =>
  rows
    .map((r) => {
      const n = /(\d+)s 未被/.exec(r.text)?.[1];
      return `${r.tS.toFixed(3)}|${r.unitName}|${n}`;
    })
    .sort();

/** The same key off a window of the dispel summary. */
const windowKeys = (
  ws: ReadonlyArray<{
    timeSeconds: number;
    durationSeconds: number;
    enemyName?: string;
    targetName?: string;
  }>,
): string[] =>
  ws
    .map(
      (w) =>
        `${w.timeSeconds.toFixed(3)}|${w.enemyName ?? w.targetName}|${Math.round(w.durationSeconds)}`,
    )
    .sort();

const purgeRows = (m: StoredMatch) =>
  deriveDispelDash(m).missedPurges.map((r) => ({ ...r, text: r.label }));
const cleanseRows = (m: StoredMatch) =>
  deriveDispelDash(m).missedCleanses.map((r) => ({ ...r, text: r.label }));
const cards = (m: StoredMatch) =>
  deriveMistakes(m)
    .filter((c) => c.type === "missed-purge-kill-window")
    .map((c) => ({ ...c, text: c.detail }));

function teams(m: StoredMatch) {
  const legacy = toLegacySafe(m);
  const all = Object.values(legacy.units);
  const players = all.filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction === CombatUnitReaction.Hostile,
  );
  const petsOf = (owners: typeof players) =>
    all.filter((u) => u.ownerId && owners.some((o) => o.id === u.ownerId));
  return {
    legacy,
    friends,
    enemies,
    friendlyPets: petsOf(friends),
    enemyPets: petsOf(enemies),
  };
}

const at = <T extends { tS: number; unitName: string }>(
  rows: readonly T[],
  tS: number,
  unitName: string,
): T | undefined =>
  rows.find((r) => Math.abs(r.tS - tS) < 0.0005 && r.unitName === unitName);

describe("战报的驱散读者:窗口止于回合结束(与 prompt 同一个 roundEndMs)", () => {
  it("单排:跨过回合终结死亡的漏驱散行被截在那一刻;回合内不足 3 秒或死亡之后才上的 buff 没有行", () => {
    const rows = purgeRows(shuffle);
    // 66.385 → 70: 3.6 s, printed 4s (20 s to its removal)
    expect(at(rows, 66.385, "Player2-Test")!.label).toContain(
      "身上 4s 未被驱散",
    );
    expect(at(rows, 66.386, "Player5-Test")!.label).toContain(
      "身上 4s 未被驱散",
    );
    // 67.143 → 70: 2.9 s, under the 3 s reaction floor
    expect(at(rows, 67.143, "Player4-Test")).toBeUndefined();
    expect(rows.filter((r) => r.tS >= ROUND_END_DEATH_S)).toEqual([]);
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      const n = Number(/(\d+)s 未被/.exec(r.label)![1]);
      // the printed length is rounded: at most half a second over
      expect(r.tS + n).toBeLessThanOrEqual(ROUND_END_DEATH_S + 0.5);
    }
  });

  it("单排:未解除的控制行同样截在回合结束", () => {
    const rows = cleanseRows(shuffle);
    expect(rows).toHaveLength(1);
    // 64 → 70 (its removal is at 72)
    expect(rows[0]!.label).toContain("Fear 6s 未被解");
  });

  it("单排:missed-purge-kill-window 卡片跟着同一个窗口", () => {
    // User ruling 2026-10-20 (an unpressed kit defensive is in hand): the
    // fixture's kill windows before 70 s are gone (their targets hold one),
    // so the cards the round keeps are none; the cut is still the round end —
    // the same match read as 3v3 has cards past 70 s, the round has none
    // User rulings 2026-10-21: the target's own Power Word: Shield ends a
    // `defenseless` span — the enemy priest's shields take the last kill
    // windows, so neither reading has a card; the round-end cut itself is
    // pinned on the purge rows above and below
    expect(cards(shuffle)).toEqual([]);
    expect(cards(threes)).toEqual([]);
  });

  // weekly review 2026-10-24: with no card in either reading the case above
  // pins nothing about the cut. Without the enemy priest's own shields
  // (Power Word: Shield 17 / Void Shield 1253593 — what took the kill
  // windows on 2026-10-21) the kill windows come back: read as 3v3 the match
  // has cards past the injected death, read as the round none — the cut
  // the cards share with the purge rows.
  it("单排:去掉敌方牧师自己的盾后,3v3 读法在 70s 之后有卡片,回合读法一张也没有(截在回合结束)", () => {
    const noOwnShields = (m: StoredMatch): StoredMatch => {
      for (const u of Object.values(
        m.units as unknown as Record<
          string,
          { auraEvents: Array<{ spellId: number }> }
        >,
      ))
        u.auraEvents = u.auraEvents.filter(
          (a) => a.spellId !== 17 && a.spellId !== 1253593,
        );
      return m;
    };
    // (F18 batch 1, 2026-10-25: a kill window now also opens before the
    // injected death, at 67.1 s — in both readings; what is pinned is the
    // cut past the death)
    const threesCards = cards(noOwnShields(roundEndFixture("3v3")));
    expect(
      threesCards.filter((c) => c.tS >= ROUND_END_DEATH_S).length,
    ).toBeGreaterThan(0);
    expect(
      cards(noOwnShields(roundEndFixture(SOLO_SHUFFLE))).filter(
        (c) => c.tS >= ROUND_END_DEATH_S,
      ),
    ).toEqual([]);
  });

  it("其他赛制不变:3v3 里的死亡不是回合结束,行与卡片就是只给 {startTime, endTime} 时的那些", () => {
    const rows = purgeRows(threes);
    expect(at(rows, 66.385, "Player2-Test")!.label).toContain("身上 20s");
    expect(at(rows, 66.386, "Player5-Test")!.label).toContain("身上 14s");
    expect(at(rows, 67.143, "Player4-Test")!.label).toContain("身上 7s");
    expect(rows.filter((r) => r.tS >= ROUND_END_DEATH_S)).toHaveLength(6);
    expect(cleanseRows(threes)[0]!.label).toContain("Fear 8s 未被解");

    // what the two readers handed the function before they handed the round
    const { legacy, friends, enemies, friendlyPets, enemyPets } = teams(threes);
    const logOnly = { startTime: legacy.startTime, endTime: legacy.endTime };
    const dash = reconstructDispelSummary(
      friends,
      enemies,
      logOnly,
      friendlyPets,
      enemyPets,
    );
    expect(dash.scopedMissedPurgeWindows ?? []).toEqual([]);
    expect(rowKeys(rows)).toEqual(windowKeys(dash.missedPurgeWindows));
    expect(rowKeys(cleanseRows(threes))).toEqual(
      windowKeys(dash.missedCleanseWindows),
    );
    const card = reconstructDispelSummary(friends, enemies, logOnly);
    annotateMissedPurgesWithKillWindows(
      card.missedPurgeWindows,
      computeOffensiveWindows(enemies, friends, legacy),
    );
    expect(rowKeys(cards(threes))).toEqual(
      windowKeys(card.missedPurgeWindows.filter((w) => w.duringKillWindow)),
    );
  });

  it("单排:面板的窗口就是 prompt 那份驱散汇总的窗口,[UNCLEANSED DEBUFF] 行印的是同一个秒数", () => {
    const { legacy, friends, enemies, friendlyPets, enemyPets } =
      teams(shuffle);
    // as buildMatchContext calls it: the round itself, both sides' pets
    const prompt = reconstructDispelSummary(
      friends,
      enemies,
      legacy,
      friendlyPets,
      enemyPets,
    );
    annotateMissedPurgesWithKillWindows(
      prompt.missedPurgeWindows,
      computeOffensiveWindows(enemies, friends, legacy),
    );
    expect(prompt.scopedMissedPurgeWindows ?? []).toEqual([]);
    expect(rowKeys(purgeRows(shuffle))).toEqual(
      windowKeys(prompt.missedPurgeWindows),
    );
    expect(rowKeys(cleanseRows(shuffle))).toEqual(
      windowKeys(prompt.missedCleanseWindows),
    );
    expect(rowKeys(cards(shuffle))).toEqual(
      windowKeys(prompt.missedPurgeWindows.filter((w) => w.duringKillWindow)),
    );

    // the rendered prompt of the friendly who can dispel it (the Disc Priest)
    const owner = friends.find((f) => f.name === "Player3-Test")!;
    const context = buildMatchContext(legacy, friends, enemies, { owner });
    const line = context
      .split("\n")
      .find((l) => l.includes("[UNCLEANSED DEBUFF]") && l.includes("Fear"));
    expect(line).toMatch(
      /^\s*1:04\s+\[UNCLEANSED DEBUFF\]\s+Fear on .* \| 6s \|/,
    );
  });

  it("面板行的可行性标注就是 prompt 那份汇总的字段:无视线/超射程 = losReachable(射程 + 该地图的视线),不是只看射程", () => {
    let noReach = 0;
    let rangeAloneDiffers = 0;
    for (const m of [shuffle, threes]) {
      const { legacy, friends, enemies, friendlyPets, enemyPets } = teams(m);
      const prompt = reconstructDispelSummary(
        friends,
        enemies,
        legacy,
        friendlyPets,
        enemyPets,
      );
      annotateMissedPurgesWithKillWindows(
        prompt.missedPurgeWindows,
        computeOffensiveWindows(enemies, friends, legacy),
      );
      const start = (w: { timeSeconds: number }) => w.timeSeconds.toFixed(3);
      expect(
        purgeRows(m).map((r) => [
          r.tS.toFixed(3),
          r.unitName,
          r.label.includes("(我方击杀窗口内)"),
          r.label.includes("(驱散在 CD)"),
          r.label.includes("(驱散者被控/被锁"),
          r.label.includes("(无视线/超射程)"),
        ]),
      ).toEqual(
        [...prompt.missedPurgeWindows]
          .sort((a, b) => a.timeSeconds - b.timeSeconds)
          .map((w) => [
            start(w),
            w.enemyName,
            !!w.duringKillWindow,
            !!w.purgeWasOnCD,
            !!w.purgersLockedOut,
            w.losReachable === false,
          ]),
      );
      expect(
        cleanseRows(m).map((r) => [
          r.tS.toFixed(3),
          r.unitName,
          r.label.includes("(解法在 CD)"),
          r.label.includes("(驱散者被控/被锁"),
          r.label.includes("(无视线/超射程)"),
          r.label.includes("(对方 DR 未递减,解了易被续控)"),
        ]),
      ).toEqual(
        [...prompt.missedCleanseWindows]
          .sort((a, b) => a.timeSeconds - b.timeSeconds)
          .map((w) => [
            start(w),
            w.targetName,
            !!w.cleanseWasOnCD,
            !!w.dispellersLockedOut,
            w.losReachable === false,
            !!w.drChainRisk,
          ]),
      );
      // the reading the panel had before: the round without its zone
      const rangeAlone = reconstructDispelSummary(
        friends,
        enemies,
        {
          startTime: legacy.startTime,
          endTime: legacy.endTime,
          startInfo: { bracket: legacy.startInfo.bracket },
          units: legacy.units,
        },
        friendlyPets,
        enemyPets,
      );
      const windows = [
        ...prompt.missedPurgeWindows,
        ...prompt.missedCleanseWindows,
      ];
      const before = [
        ...rangeAlone.missedPurgeWindows,
        ...rangeAlone.missedCleanseWindows,
      ];
      expect(before).toHaveLength(windows.length);
      noReach += windows.filter((w) => w.losReachable === false).length;
      rangeAloneDiffers += windows.filter(
        (w, i) => w.losReachable !== before[i]!.losReachable,
      ).length;
    }
    // the fixture has the case: windows only the zone's line of sight rules
    // out (the two brackets together) — a geometry or fixture change that
    // empties it shows here
    expect({ noReach, rangeAloneDiffers }).toEqual({
      noReach: 9,
      rangeAloneDiffers: 3,
    });
  });
});
