import {
  CombatUnitReaction,
  CombatUnitSpec,
  LogEvent,
} from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  buildPlayerLoadout,
  buildResourceSnapshot,
  chargesReadyCount,
  computeOnCDDisplayNames,
  computeReadyNames,
  countActiveAtonements,
} from "../src/context/resourceSnapshot";
import { analyzePlayerCCAndTrinket } from "../src/utils/ccTrinketAnalysis";
import {
  extractMajorCooldowns,
  IMajorCooldownInfo,
  specToString,
} from "../src/utils/cooldowns";
import {
  IEnemyCDTimeline,
  reconstructEnemyCDTimeline,
} from "../src/utils/enemyCDs";
import { loadLegacyMatchFixture } from "./helpers/legacyFixture";
import { makeAuraEvent, makeUnit } from "./ported/testHelpers";

describe("context.resourceSnapshot unit tests", () => {
  // ── 1. countActiveAtonements ────────────────────────────────────────────────
  describe("countActiveAtonements", () => {
    it("0个/空态: 无友方或无Aura事件 -> 计数为0", () => {
      const friends = [
        makeUnit("player-1"),
        undefined,
        makeUnit("player-2", { auraEvents: [] }),
      ];
      expect(countActiveAtonements(friends, 1000)).toBe(0);
    });

    it("典型态: 精确计数处于激活的Atonement(194384)", () => {
      const p1 = makeUnit("player-1", {
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "194384",
            1000,
            "player-1",
            "player-1",
            "BUFF",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "194384",
            5000,
            "player-1",
            "player-1",
            "BUFF",
          ),
        ],
      });
      const p2 = makeUnit("player-2", {
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "194384",
            2000,
            "player-1",
            "player-2",
            "BUFF",
          ),
        ],
      });
      // At t=3000, p1's Atonement is active over [1000, 5000] and p2's over [2000, inf)
      expect(countActiveAtonements([p1, p2], 3000)).toBe(2);
      // At t=6000, p1's was removed at 5000 while p2's is still active
      expect(countActiveAtonements([p1, p2], 6000)).toBe(1);
    });

    it("边界态: Aura恰好在查询时刻过期(SPELL_AURA_REMOVED的timestamp等于查询时刻)", () => {
      const p1 = makeUnit("player-1", {
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "194384",
            1000,
            "player-1",
            "player-1",
            "BUFF",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "194384",
            5000,
            "player-1",
            "player-1",
            "BUFF",
          ),
        ],
      });
      const p2 = makeUnit("player-2", {
        auraEvents: [
          makeAuraEvent(
            LogEvent.SPELL_AURA_APPLIED,
            "194384",
            1000,
            "player-1",
            "player-2",
            "BUFF",
          ),
          makeAuraEvent(
            LogEvent.SPELL_AURA_REMOVED,
            "194384",
            5001,
            "player-1",
            "player-2",
            "BUFF",
          ),
        ],
      });
      // Exactly at t=5000:
      // p1's removal fires at 5000; timestamp <= 5000 is processed, so it turns inactive
      // p2's removal fires at 5001; timestamp > 5000 is not processed, so it stays active
      expect(countActiveAtonements([p1, p2], 5000)).toBe(1);
    });
  });

  // ── 2. chargesReadyCount ────────────────────────────────────────────────────
  describe("chargesReadyCount", () => {
    it("0个/空态: 充能CD无释放记录 -> 返回最大充能数", () => {
      const cd = {
        spellId: "102342",
        spellName: "Ironbark",
        tag: "Defensive",
        cooldownSeconds: 60,
        maxChargesDetected: 2,
        casts: [],
        availableWindows: [],
        neverUsed: true,
      } as unknown as IMajorCooldownInfo;
      expect(chargesReadyCount(cd, 10)).toBe(2);
    });

    it("典型态: 部分释放, 部分充能完毕/正在充能", () => {
      const cd = {
        spellId: "102342",
        spellName: "Ironbark",
        tag: "Defensive",
        cooldownSeconds: 60,
        maxChargesDetected: 2,
        casts: [{ timeSeconds: 10 }, { timeSeconds: 15 }],
        availableWindows: [],
        neverUsed: false,
      } as unknown as IMajorCooldownInfo;
      // Query t=20: both casts are still recharging (10+60=70 > 20+0.5, 15+60=75 > 20+0.5)
      expect(chargesReadyCount(cd, 20)).toBe(0);
      // Query t=71: the first charge is back (10+60=70 <= 71+0.5), the second still recharging (15+60=75 > 71+0.5)
      expect(chargesReadyCount(cd, 71)).toBe(1);
    });

    it("边界态: 恰好在充能转好/消耗的边界 (timeSeconds + 0.5)", () => {
      const cd = {
        spellId: "102342",
        spellName: "Ironbark",
        tag: "Defensive",
        cooldownSeconds: 60,
        maxChargesDetected: 1,
        casts: [{ timeSeconds: 10 }],
        availableWindows: [],
        neverUsed: false,
      } as unknown as IMajorCooldownInfo;
      // Boundary 1: the consumption test is <= timeSeconds + 0.5
      // Query t=9.49 -> 10 <= 9.99 (false), not yet counted as consumed
      expect(chargesReadyCount(cd, 9.49)).toBe(1);
      // Query t=9.50 -> 10 <= 10.00 (true), counted as consumed in the same rendered second
      expect(chargesReadyCount(cd, 9.5)).toBe(0);

      // Boundary 2: the recharge test is earliestSlotReady <= timeSeconds + 0.5
      // Cast at 10s, cooldown=60s -> ready at 70s
      // Query t=69.49 -> earliestSlotReady(70) <= 69.99 (false), still on CD
      expect(chargesReadyCount(cd, 69.49)).toBe(0);
      // Query t=69.50 -> earliestSlotReady(70) <= 70.00 (true), CD is back up
      expect(chargesReadyCount(cd, 69.5)).toBe(1);
    });
  });

  // ── 3. computeReadyNames ────────────────────────────────────────────────────
  describe("computeReadyNames", () => {
    it("空态: 无任何CD配置 -> 返回空数组", () => {
      expect(computeReadyNames(10, [], [])).toEqual([]);
    });

    it("典型态: 提取就绪的CD display name(队友带 playerLabel 前缀)", () => {
      const ownerCDs = [
        {
          spellId: "102342",
          spellName: "Ironbark",
          cooldownSeconds: 60,
          maxChargesDetected: 1,
          casts: [{ timeSeconds: 10 }],
        } as unknown as IMajorCooldownInfo,
      ];
      const teammateCDs = [
        {
          cds: [
            {
              spellId: "1022",
              spellName: "Sacrifice",
              cooldownSeconds: 120,
              maxChargesDetected: 1,
              casts: [{ timeSeconds: 15 }],
            } as unknown as IMajorCooldownInfo,
          ],
          playerLabel: "2",
        },
      ];
      // Query t=80:
      // Ironbark: 10 + 60 = 70 <= 80 + 0.5 (ready)
      // Sacrifice: 15 + 120 = 135 > 80 + 0.5 (on CD)
      expect(computeReadyNames(80, ownerCDs, teammateCDs)).toEqual([
        "Ironbark",
      ]);
    });

    it("边界态: timeSeconds <= 5 规则与充能恰好转好的判断边界", () => {
      const ownerCDs = [
        {
          spellId: "102342",
          spellName: "Ironbark",
          cooldownSeconds: 60,
          maxChargesDetected: 1,
          casts: [],
        } as unknown as IMajorCooldownInfo,
      ];
      // Rule: if timeSeconds <= 5 and priorCasts.length === 0, do not add to the ready list
      expect(computeReadyNames(5.0, ownerCDs, [])).toEqual([]);
      expect(computeReadyNames(5.01, ownerCDs, [])).toEqual(["Ironbark"]);

      // The exact recharge boundary (cast at 10s, 60s CD)
      const ownerCasts = [
        {
          spellId: "102342",
          spellName: "Ironbark",
          cooldownSeconds: 60,
          maxChargesDetected: 1,
          casts: [{ timeSeconds: 10 }],
        } as unknown as IMajorCooldownInfo,
      ];
      expect(computeReadyNames(69.49, ownerCasts, [])).toEqual([]);
      expect(computeReadyNames(69.5, ownerCasts, [])).toEqual(["Ironbark"]);
    });
  });

  // ── 4. computeOnCDDisplayNames ──────────────────────────────────────────────
  describe("computeOnCDDisplayNames", () => {
    it("空态: 无 any CD配置 -> 返回空数组", () => {
      expect(computeOnCDDisplayNames(10, [], [])).toEqual([]);
    });

    it("典型态: 提取在冷却中的CD(队友带 playerLabel 前缀)", () => {
      const ownerCDs = [
        {
          spellId: "102342",
          spellName: "Ironbark",
          cooldownSeconds: 60,
          maxChargesDetected: 1,
          casts: [{ timeSeconds: 10 }],
        } as unknown as IMajorCooldownInfo,
      ];
      const teammateCDs = [
        {
          cds: [
            {
              spellId: "1022",
              spellName: "Sacrifice",
              cooldownSeconds: 120,
              maxChargesDetected: 1,
              casts: [{ timeSeconds: 15 }],
            } as unknown as IMajorCooldownInfo,
          ],
          playerLabel: "2",
        },
      ];
      // Query t=80: Ironbark is back up (not part of cd), Sacrifice is still on CD (2:Sacrifice)
      expect(computeOnCDDisplayNames(80, ownerCDs, teammateCDs)).toEqual([
        "2:Sacrifice",
      ]);
    });

    it("边界态: 冷却恰好转好边界", () => {
      const ownerCDs = [
        {
          spellId: "102342",
          spellName: "Ironbark",
          cooldownSeconds: 60,
          maxChargesDetected: 1,
          casts: [{ timeSeconds: 10 }],
        } as unknown as IMajorCooldownInfo,
      ];
      // Cast at 10s, 60s CD -> back up at 70s
      // t=69.49: earliestSlotReady(70) > 69.99 (true) -> still on cooldown
      expect(computeOnCDDisplayNames(69.49, ownerCDs, [])).toEqual([
        "Ironbark",
      ]);
      // t=69.50: earliestSlotReady(70) > 70.00 (false) -> cooldown finished
      expect(computeOnCDDisplayNames(69.5, ownerCDs, [])).toEqual([]);
    });
  });

  // ── 5. buildPlayerLoadout ───────────────────────────────────────────────────
  describe("buildPlayerLoadout", () => {
    it("空info/极简配置下优雅降级", () => {
      const owner = makeUnit("player-1", { name: "Player1" });
      const enemyCDTimeline = {
        players: [],
        alignedBurstWindows: [],
      } as unknown as IEnemyCDTimeline;
      const res = buildPlayerLoadout(
        owner,
        "Restoration Druid",
        [],
        [],
        enemyCDTimeline,
      );

      expect(res.text).toContain("<player_loadout>");
      expect(res.text).toContain(
        '<unit id="1" name="Player1" spec="Restoration Druid" role="log owner">',
      );
      expect(res.text).toContain("<cooldowns>none tracked</cooldowns>");
      expect(res.text).toContain("</player_loadout>");
      expect(res.friendlyIdMap.get("Player1")).toBe(1);
    });

    it("典型态: 携带天赋/PVP技能、未使用CD标签、队友CD、敌方CD时间轴与技能组", () => {
      // 1246126 Call of Ohn'ahra (Restoration Druid PvP Talent), maps to abilitySpellId: 33786
      const owner = makeUnit("player-1", {
        name: "Player1",
        info: { pvpTalents: ["1246126"] },
        spellCastEvents: [], // 33786 never cast -> should carry [UNUSED]
      });

      const ownerCDs = [
        {
          spellId: "102342",
          spellName: "Ironbark",
          cooldownSeconds: 60,
          maxChargesDetected: 1,
          neverUsed: true,
        } as unknown as IMajorCooldownInfo,
      ];

      const teammateCDs = [
        {
          player: makeUnit("player-2", { name: "Teammate1" }),
          spec: "Holy Paladin",
          cds: [
            {
              spellId: "1022",
              spellName: "Sacrifice",
              cooldownSeconds: 120,
              maxChargesDetected: 2,
              neverUsed: false,
            } as unknown as IMajorCooldownInfo,
          ],
        },
      ];

      const enemyCDTimeline = {
        players: [
          {
            playerName: "Enemy1",
            specName: "Frost Mage",
            offensiveCDs: [
              {
                spellId: "31884",
                spellName: "Combustion",
                cooldownSeconds: 120,
                castTimeSeconds: 10,
                buffEndSeconds: 20,
                availableAgainAtSeconds: 130,
              },
            ],
          },
        ],
        alignedBurstWindows: [],
      } as unknown as IEnemyCDTimeline;

      const enemies = [
        makeUnit("enemy-1", {
          name: "Enemy1",
          spec: CombatUnitSpec.Mage_Frost,
        }),
      ];
      const enemyCooldowns = [
        {
          player: enemies[0],
          cds: [
            {
              spellId: "45438",
              spellName: "Ice Block",
              cooldownSeconds: 240,
              maxChargesDetected: 1,
              neverUsed: true,
            } as unknown as IMajorCooldownInfo,
          ],
        },
      ];

      const res = buildPlayerLoadout(
        owner,
        "Restoration Druid",
        ownerCDs,
        teammateCDs,
        enemyCDTimeline,
        enemies,
        enemyCooldowns,
      );

      // Assert friendly ID assignment
      expect(res.friendlyIdMap.get("Player1")).toBe(1);
      expect(res.friendlyIdMap.get("Teammate1")).toBe(2);
      expect(res.enemyIdMap.get("Enemy1")).toBe(3);

      // Assert the content fields
      expect(res.text).toContain(
        '<unit id="1" name="Player1" spec="Restoration Druid" role="log owner">',
      );
      expect(res.text).toContain(
        "<cooldowns>Ironbark [60s] [UNUSED]</cooldowns>",
      );
      expect(res.text).toContain(
        "<pvp_toolkit>Call of Ohn'ahra (Nature's Swiftness → instant Cyclone) [UNUSED]</pvp_toolkit>",
      );

      expect(res.text).toContain(
        '<unit id="2" name="Teammate1" spec="Holy Paladin" role="teammate">',
      );
      expect(res.text).toContain(
        "<cooldowns>Sacrifice [120s, 2 Charges]</cooldowns>",
      );

      expect(res.text).toContain(
        '<unit id="3" name="Enemy1" spec="Frost Mage" role="enemy">',
      );
      // Contains the union of the enemyCDTimeline and enemyCooldowns kits
      expect(res.text).toContain("Ice Block [240s] [UNUSED]");
      expect(res.text).toContain("Combustion [120s]");
    });
  });

  // ── 6. buildResourceSnapshot ────────────────────────────────────────────
  describe("buildResourceSnapshot with real fixture", () => {
    it("使用真实 units 驱动 buildResourceSnapshot: 验证 Discipline Priest 及 Atonements/focus/enemy/cc 等输出结构与资源字段", () => {
      const match = loadLegacyMatchFixture();
      const units = Object.values(match.units).filter((u) => u.name && u.spec);

      // Extract information from the real match.units
      const friends = units.filter(
        (u) => u.reaction === CombatUnitReaction.Hostile,
      ); // treat Hostile as friends so the Priest becomes the owner
      const enemies = units.filter(
        (u) => u.reaction === CombatUnitReaction.Friendly,
      );

      const owner = friends.find(
        (p) => specToString(p.spec) === "Discipline Priest",
      )!;
      const ownerSpec = specToString(owner.spec);

      const ownerCDs = extractMajorCooldowns(owner, match);
      const teammateCDs = friends
        .filter((p) => p.id !== owner.id)
        .map((p) => ({
          player: p,
          spec: specToString(p.spec),
          cds: extractMajorCooldowns(p, match),
        }));

      const ccTrinketSummaries = friends.map((p) =>
        analyzePlayerCCAndTrinket(p, enemies, match, []),
      );

      const enemyCDTimeline = reconstructEnemyCDTimeline(
        enemies,
        match,
        owner,
        friends,
      );

      const playerIdMap = new Map<string, number>([
        [owner.name, 1],
        [teammateCDs[0].player.name, 2],
      ]);

      const resText = buildResourceSnapshot({
        timeSeconds: 10,
        ownerCDs,
        ownerName: owner.name,
        ownerSpec,
        teammateCDs,
        ccTrinketSummaries,
        enemyCDTimeline,
        playerIdMap,
        matchStartMs: match.startTime,
        ownerUnit: owner,
      });

      // Verify the Atonements resource output for the Discipline Priest
      expect(resText).toContain("Atonements: 0");
      // Verify the focus field and its mapped ID
      expect(resText).toContain("focus:2");
      // Verify the enemy CD information
      expect(resText).toContain("enemy:Combustion/Fire Mage");
      // Verify the CC information
      // Counterspell locks for 5 s (official DB2 PvP duration, 2026-09-04;
      // the corpus bin mode had said 6, the old 3 s fallback rendered "-1s"
      // here for the same fixture)
      expect(resText).toContain("cc:1/Counterspell-3s[kick]");
      expect(resText).toContain("2/Rake-1s[stun]");
    });

    it("用例证明: 采样时刻必须与渲染网格一致，证明小数秒输入与 floor 后整数秒输入产出相同快照", () => {
      const match = loadLegacyMatchFixture();
      const units = Object.values(match.units).filter((u) => u.name && u.spec);

      const friends = units.filter(
        (u) => u.reaction === CombatUnitReaction.Hostile,
      );
      const enemies = units.filter(
        (u) => u.reaction === CombatUnitReaction.Friendly,
      );

      const owner = friends.find(
        (p) => specToString(p.spec) === "Discipline Priest",
      )!;
      const ownerSpec = specToString(owner.spec);

      const ownerCDs = extractMajorCooldowns(owner, match);
      const teammateCDs = friends
        .filter((p) => p.id !== owner.id)
        .map((p) => ({
          player: p,
          spec: specToString(p.spec),
          cds: extractMajorCooldowns(p, match),
        }));

      const ccTrinketSummaries = friends.map((p) =>
        analyzePlayerCCAndTrinket(p, enemies, match, []),
      );

      const enemyCDTimeline = reconstructEnemyCDTimeline(
        enemies,
        match,
        owner,
        friends,
      );

      const playerIdMap = new Map<string, number>([
        [owner.name, 1],
        [teammateCDs[0].player.name, 2],
      ]);

      const params10_0 = {
        timeSeconds: 10.0,
        ownerCDs,
        ownerName: owner.name,
        ownerSpec,
        teammateCDs,
        ccTrinketSummaries,
        enemyCDTimeline,
        playerIdMap,
        matchStartMs: match.startTime,
        ownerUnit: owner,
      };

      const params10_2 = {
        ...params10_0,
        timeSeconds: 10.2, // fractional-second input; must produce the same snapshot as the whole second 10.0
      };

      const snapshot10_0 = buildResourceSnapshot(params10_0);
      const snapshot10_2 = buildResourceSnapshot(params10_2);

      // Verify the two are byte-identical at render precision
      expect(snapshot10_2).toBe(snapshot10_0);
    });
  });
});
