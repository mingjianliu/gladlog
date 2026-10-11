import { ensureAnalysisData } from "@gladlog/analysis";
import type { BurstWindowDecisionPoint } from "@gladlog/analysis/src/analysis/burstWindowDecisionPoints";
import { buildMomentSnapshotItems } from "@gladlog/analysis/src/analysis/momentSnapshot";
import {
  ccSpanLookup,
  formatBurstAnsweredLines,
} from "@gladlog/analysis/src/context/burstAnswered";
import { formatCcUseCount } from "@gladlog/analysis/src/context/ccUse";
import { formatPressedDuringNote } from "@gladlog/analysis/src/context/controlRejectedPresses";
import {
  dmgSpikeListLegend,
  emitDmgSpikeEntries,
  formatDmgSpikesNotListed,
} from "@gladlog/analysis/src/context/matchTimelineSections";
import {
  lookupBehaviorPrior,
  outcomePhrase,
} from "@gladlog/analysis/src/data/behaviorPrior";
import { CONTROL_FAILED_MISS_TYPES } from "@gladlog/analysis/src/utils/castMissRows";
import {
  ccAvoidedOutcomeText,
  ccLandedMatchWindowMs,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import type { CoverageManifest } from "../src/quality/coverageManifest";
import {
  checkBehaviorPriorConsistency,
  checkCcAvoidedLandedConsistency,
  checkCcAvoidedMissType,
  checkBurstAnsweredBeforeDeath,
  checkBurstAnsweredBottomConsistency,
  checkBurstAnsweredControlSpan,
  checkCcBookmarkConsistency,
  checkCcUseStartedCounts,
  checkDeathTrinketCcConsistency,
  checkDmgSpikeListCap,
  checkDuringExternalConsistency,
  checkForcedTrinketConsistency,
  checkFreeOfWindowConsistency,
  checkHeaderHpPromise,
  checkMatch,
  checkPeelOptionConsistency,
  checkPetCreditSide,
  checkPressedDuringControlNote,
  checkResNoChangeRowsPruned,
  checkSameSecondHpConsistency,
  checkSelfOnlyDefensiveClaims,
  checkSnapshotFactsConsistency,
} from "../src/quality/promptQualityCheck";
import { loadLegacyMatchFixture } from "./helpers/legacyFixture";

const entry = {
  ordinal: 1,
  matchId: "m1",
  spec: "Restoration Druid",
  result: "loss",
  file: "prompts/001-m1.txt",
};

const manifest = {
  players: [{ name: "Heals-Realm", spec: "Restoration Druid" }],
  deaths: [{ unitName: "Heals-Realm", reaction: "friendly", tRelSec: 42 }],
  ccApplied: [
    { spellId: "408", spellName: "Kidney Shot", spellNameEn: "Kidney Shot" },
  ],
  interrupts: [],
  dispels: [],
  counts: { trinketCasts: 1 },
} as unknown as CoverageManifest;

// 官方技能事实动态载入:门规用例断言 canHelpAnotherUnit 的具体取值,必须先 await
beforeAll(async () => {
  await ensureAnalysisData();
});

describe("promptQualityCheck.checkMatch", () => {
  it("友方死亡不在 prompt → hardFailure;在 → 覆盖 100%", () => {
    const miss = checkMatch(entry, "nothing here\njust lines", manifest);
    expect(miss.hardFailures.length).toBeGreaterThan(0);
    expect(miss.coverage.friendlyDeaths.present).toBe(0);

    const hit = checkMatch(
      entry,
      "[DEATH] 42s Heals died\nKidney Shot lands\ntrinketed out of it",
      manifest,
    );
    expect(hit.hardFailures).toEqual([]);
    expect(hit.coverage.friendlyDeaths.present).toBe(1);
    expect(hit.coverage.ccSpells.present).toBe(1);
    expect(hit.coverage.trinketCasts.present).toBe(1);
  });

  it("重复率:4 非空行含 1 对重复 → exactDuplicateRatio 0.25", () => {
    const q = checkMatch(
      entry,
      "[DEATH] Heals died\nKidney Shot\nsame line\nsame line",
      manifest,
    );
    expect(q.noise.exactDuplicateRatio).toBeCloseTo(0.25, 3);
  });

  it("模板重复率:数字归一化后重复计入 templateDuplicateRatio", () => {
    const q = checkMatch(
      entry,
      "[DEATH] Heals died at 42\n[HP] 100 at 1s\n[HP] 250 at 7s\nKidney Shot",
      manifest,
    );
    expect(q.noise.templateDuplicateRatio).toBeCloseTo(0.25, 3);
    expect(q.noise.exactDuplicateRatio).toBe(0);
  });

  it("bias 词典命中计数与样例行号", () => {
    const q = checkMatch(
      entry,
      "[DEATH] Heals died ok\nKidney Shot\nthat was catastrophic",
      manifest,
    );
    expect(q.labelBias.totalHits).toBe(1);
    expect(q.labelBias.hits[0].term).toBe("catastrophic");
    expect(q.labelBias.hits[0].sampleLines).toEqual([3]);
  });

  it("localized 与英文名任一命中即覆盖", () => {
    const zh = {
      ...manifest,
      ccApplied: [
        { spellId: "408", spellName: "腎擊", spellNameEn: "Kidney Shot" },
      ],
    } as unknown as CoverageManifest;
    const q = checkMatch(entry, "[DEATH] Heals died\nKidney Shot hit", zh);
    expect(q.coverage.ccSpells.present).toBe(1);
  });
});

describe("promptQualityCheck.checkSnapshotFactsConsistency", () => {
  it("无快照行(item 行都是旧式非快照 kind)的旧 prompt 返回 []", () => {
    const text = [
      "FINDING 0: [high] Test — because",
      "EVIDENCE PACK 0 (window 0s–10s; the ONLY additional evidence you may reference):",
      "  - key=p1 kind=hp facts={t=5, unit=Foo, role=owner, hp=80}",
      "  - key=p2 kind=cc facts={t=3, spell=Kidney Shot, unit=Foo, role=owner, duration=1.5, trinket=none}",
    ].join("\n");
    expect(checkSnapshotFactsConsistency(text)).toEqual([]);
  });

  it("hp-snap 与 hp 同秒同单位 HP 一致(差 1pp)→ 过", () => {
    const text = [
      "  - key=p1 kind=hp-snap facts={t0=10, t1=20, unit=Foo, role=owner, hpStart=80, hpEnd=60, hpMin=55}",
      "  - key=p2 kind=hp facts={t=10, unit=Foo, role=owner, hp=79}",
    ].join("\n");
    expect(checkSnapshotFactsConsistency(text)).toEqual([]);
  });

  it("hp-snap 与 hp 同秒同单位 HP 差 5pp → 违规", () => {
    const text = [
      "  - key=p1 kind=hp-snap facts={t0=10, t1=20, unit=Foo, role=owner, hpStart=80, hpEnd=60, hpMin=55}",
      "  - key=p2 kind=hp facts={t=10, unit=Foo, role=owner, hp=75}",
    ].join("\n");
    const violations = checkSnapshotFactsConsistency(text);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toMatch(/HP 不一致/);
  });

  it("不同秒或不同单位的 HP 差异不触发(负对照)", () => {
    const text = [
      "  - key=p1 kind=hp-snap facts={t0=10, t1=20, unit=Foo, role=owner, hpStart=80, hpEnd=60, hpMin=55}",
      "  - key=p2 kind=hp facts={t=11, unit=Foo, role=owner, hp=20}",
      "  - key=p3 kind=hp facts={t=10, unit=Bar, role=teammate, hp=5}",
    ].join("\n");
    expect(checkSnapshotFactsConsistency(text)).toEqual([]);
  });

  it("I-4 撞名负对照:同 t/role 下 kind=hp 本身两个不同值(撞名信号)→ 整键跳过,不报", () => {
    // Two different real players happen to share the short name "Foo" and
    // both are on the enemy side (role alone can't separate same-role
    // collisions) — the same-kind self-check must catch the disagreement
    // between the two "hp" readings and treat the whole t|role|unit key as
    // ambiguous, so the hp-snap line's otherwise-contradicting hpStart must
    // NOT be reported either.
    const text = [
      "  - key=p1 kind=hp facts={t=10, unit=Foo, role=enemy, hp=80}",
      "  - key=p2 kind=hp facts={t=10, unit=Foo, role=enemy, hp=20}",
      "  - key=p3 kind=hp-snap facts={t0=10, t1=15, unit=Foo, role=enemy, hpStart=50, hpEnd=50, hpMin=50}",
    ].join("\n");
    expect(checkSnapshotFactsConsistency(text)).toEqual([]);
  });

  it("I-4 负对照另一半:真单一单位同秒不一致仍报(未被撞名防线误吞)", () => {
    // Sanity companion to the ambiguity test above: with no colliding
    // same-kind reading, a genuine hp-snap/hp disagreement for one real unit
    // must still fire — the ambiguity guard must not swallow real cases.
    const text = [
      "  - key=p1 kind=hp-snap facts={t0=10, t1=20, unit=Foo, role=enemy, hpStart=80, hpEnd=60, hpMin=55}",
      "  - key=p2 kind=hp facts={t=10, unit=Foo, role=enemy, hp=20}",
    ].join("\n");
    const violations = checkSnapshotFactsConsistency(text);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toMatch(/HP 不一致/);
  });

  it("cd-ledger ready 与 immunity-available 同秒矛盾(该单位技能不在 ready 中)→ 违规", () => {
    const text = [
      "  - key=p1 kind=cd-ledger facts={t=10, unit=Foo, role=owner, ready=无, onCd=Ice Block、Kick}",
      "  - key=p2 kind=immunity-available facts={t=10, spell=Ice Block, unit=Foo, role=owner, inCc=no}",
    ].join("\n");
    const violations = checkSnapshotFactsConsistency(text);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toMatch(/immunity-available/);
  });

  it("I-3 负对照:cd-ledger 与 immunity-available 相差 5s(不同渲染秒)→ 不再报", () => {
    // cd-ledger samples at the window midpoint (t=10); immunity-available is
    // judged at the death instant (t=15) — 5s apart is exactly the class of
    // gap where the spell can legitimately have gone on/off cooldown in
    // between. Comparing across the mismatch used to be a false violation.
    const text = [
      "  - key=p1 kind=cd-ledger facts={t=10, unit=Foo, role=owner, ready=无, onCd=Ice Block、Kick}",
      "  - key=p2 kind=immunity-available facts={t=15, spell=Ice Block, unit=Foo, role=owner, inCc=no}",
    ].join("\n");
    expect(checkSnapshotFactsConsistency(text)).toEqual([]);
  });

  it("cd-ledger ready 与 external-available 同秒矛盾(按 holder 而非 unit 判定)→ 违规", () => {
    const text = [
      "  - key=p1 kind=cd-ledger facts={t=10, unit=Bar, role=teammate, ready=无, onCd=Ironbark}",
      "  - key=p2 kind=external-available facts={t=10, spell=Ironbark, unit=Foo, role=owner, holder=Bar, holderRole=teammate, holderCc=no}",
    ].join("\n");
    const violations = checkSnapshotFactsConsistency(text);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toMatch(/external-available/);
  });

  it("I-3 负对照:cd-ledger 与 external-available 相差 5s → 不再报", () => {
    const text = [
      "  - key=p1 kind=cd-ledger facts={t=10, unit=Bar, role=teammate, ready=无, onCd=Ironbark}",
      "  - key=p2 kind=external-available facts={t=15, spell=Ironbark, unit=Foo, role=owner, holder=Bar, holderRole=teammate, holderCc=no}",
    ].join("\n");
    expect(checkSnapshotFactsConsistency(text)).toEqual([]);
  });

  it("ready 列表里确实包含该技能 → 不矛盾,过", () => {
    const text = [
      "  - key=p1 kind=cd-ledger facts={t=10, unit=Foo, role=owner, ready=Ice Block, onCd=Kick}",
      "  - key=p2 kind=immunity-available facts={t=10, spell=Ice Block, unit=Foo, role=owner, inCc=no}",
    ].join("\n");
    expect(checkSnapshotFactsConsistency(text)).toEqual([]);
  });

  it("checkMatch 把快照矛盾计入 hardFailures(第六类)", () => {
    const text = [
      "[DEATH] Heals died\nKidney Shot lands\ntrinketed out of it",
      "  - key=p1 kind=hp-snap facts={t0=10, t1=20, unit=Foo, role=owner, hpStart=80, hpEnd=60, hpMin=55}",
      "  - key=p2 kind=hp facts={t=10, unit=Foo, role=owner, hp=75}",
    ].join("\n");
    const q = checkMatch(entry, text, manifest);
    expect(q.hardFailures.some((f) => f.includes("HP 不一致"))).toBe(true);
  });
});

describe("M-3: SNAPSHOT_ITEM_LINE 隐式契约 —— facts 值永不含 「, 」", () => {
  // SNAPSHOT_ITEM_LINE/parseFactsBlock splits the `facts={...}` block on the
  // literal ", " — safe only because no individual fact value ever contains
  // that substring itself (enumerated lists join with the Chinese "、"
  // specifically to avoid this). That's an implicit contract on
  // momentSnapshot's output, not something the parser enforces; pin it down
  // by building a real, diverse batch of items from the actual collector
  // (every kind: cd-ledger/aura-snap/pos-snap/dr-state/healing-gap/
  // activity-gap/hp-snap) against a real match fixture and asserting none of
  // it slips in a ", ".
  it("真实语料构造的一批 items,所有 facts 值都不含 「, 」子串", () => {
    const combat = loadLegacyMatchFixture();
    const units = Object.values(combat.units) as any[];
    const owner = units.find(
      (u) => u.info && u.reaction === CombatUnitReaction.Friendly,
    );
    expect(owner).toBeDefined();
    const durS = (combat.endTime - combat.startTime) / 1000;

    // Sweep the whole match in overlapping 20s windows so every kind gets a
    // real chance to fire at least once (a single window might miss e.g.
    // dr-state or healing-gap entirely).
    const items = [];
    for (let from = 0; from < durS; from += 15) {
      items.push(
        ...buildMomentSnapshotItems(
          combat,
          from,
          Math.min(durS, from + 20),
          owner.name,
        ),
      );
    }
    expect(items.length).toBeGreaterThan(0);

    let valuesChecked = 0;
    const kindsSeen = new Set<string>();
    for (const it of items) {
      kindsSeen.add(it.kind);
      for (const v of Object.values(it.facts)) {
        valuesChecked++;
        expect(v).not.toContain(", ");
      }
    }
    expect(valuesChecked).toBeGreaterThan(0);
    // Sanity: the sweep actually exercised more than just the always-present
    // cd-ledger kind, so this isn't a vacuous pass over one trivial shape.
    expect(kindsSeen.size).toBeGreaterThan(1);
  });
});

describe("promptQualityCheck.checkSelfOnlyDefensiveClaims (GH #28)", () => {
  // 用户报的原始形态:治疗牧师没死,死的是队友武僧,却在死亡前一秒印
  // 「绝望祷言 available but unused」—— 绝望祷言只能给自己加血。
  const teammateDeath = [
    "1:08  [HEALER CC]            1(HPriest) (Holy Priest) <- Freezing Trap",
    "1:10  [DEFENSIVE AVAILABLE]  1(HPriest): Desperate Prayer available but unused",
    "1:11  [KILL]                 2(WMonk) (Windwalker Monk) dead",
  ];

  it("队友的死 + 只能自愈的技能 → 硬失败", () => {
    const v = checkSelfOnlyDefensiveClaims(teammateDeath);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("Desperate Prayer");
    expect(v[0]).toContain("19236");
  });

  it("自己的死 + 自愈技能 → 不报(那正是该按的)", () => {
    expect(
      checkSelfOnlyDefensiveClaims([
        "1:10  [DEFENSIVE AVAILABLE]  1(HPriest): Desperate Prayer available but unused",
        "1:11  [KILL]                 1(HPriest) (Holy Priest) dead",
      ]),
    ).toEqual([]);
  });

  it("队友的死 + 够得着队友的技能 → 不报", () => {
    expect(
      checkSelfOnlyDefensiveClaims([
        "1:10  [DEFENSIVE AVAILABLE]  1(HPriest): Pain Suppression available but unused",
        "1:11  [KILL]                 2(WMonk) (Windwalker Monk) dead",
      ]),
    ).toEqual([]);
    expect(
      checkSelfOnlyDefensiveClaims([
        "1:10  [DEFENSIVE AVAILABLE]  3(WWarrior): Rallying Cry available but unused",
        "1:11  [KILL]                 2(WMonk) (Windwalker Monk) dead",
      ]),
    ).toEqual([]);
  });

  it("认不出的技能名 / 找不到死者行 → 不报(不能证实的不报)", () => {
    expect(
      checkSelfOnlyDefensiveClaims([
        "1:10  [DEFENSIVE AVAILABLE]  1(HPriest): Not A Real Spell available but unused",
        "1:11  [KILL]                 2(WMonk) (Windwalker Monk) dead",
      ]),
    ).toEqual([]);
    expect(checkSelfOnlyDefensiveClaims([teammateDeath[1]])).toEqual([]);
  });
});

describe("checkBehaviorPriorConsistency", () => {
  const line = (over: Partial<Record<string, string>> = {}) => {
    const ref = lookupBehaviorPrior("3v3", "healer", 0.25)!;
    const f = {
      t: "72.4",
      unit: "H",
      hpPct: "38",
      dmg2sPct: "25",
      attackers: "2",
      burst: "yes",
      refNNoResp: String(ref.nNoResp),
      refDeathNoResp: String(ref.deathNoRespPct),
      refNResp: String(ref.nResp),
      refDeathResp: String(ref.deathRespPct),
      refOutcome: outcomePhrase(ref.outcome),
      refOutcomeKey: ref.outcome,
      refTop: ref.top.map(([k, v]) => `${k} ${v}%`).join("; "),
      cellKey: ref.cellKey,
      fellBack: ref.fellBack ? "yes" : "no",
      ...over,
    };
    return `  - id=crisis-no-response:H:72 type=crisis-no-response t=72.4s units=H facts={${Object.entries(
      f,
    )
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}}`;
  };
  it("accepts a line whose reference numbers match the table", () => {
    expect(checkBehaviorPriorConsistency([line()])).toEqual([]);
  });
  it("rejects a planted wrong refDeathNoResp", () => {
    const ref = lookupBehaviorPrior("3v3", "healer", 0.25)!;
    const out = checkBehaviorPriorConsistency([
      line({ refDeathNoResp: String(ref.deathNoRespPct + 1) }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/refDeathNoResp/);
  });
  it("rejects a planted wrong refOutcomeKey (spec §1c)", () => {
    const ref = lookupBehaviorPrior("3v3", "healer", 0.25)!;
    const wrong: "ownDeath10s" | "teamDeath15s" =
      ref.outcome === "ownDeath10s" ? "teamDeath15s" : "ownDeath10s";
    const out = checkBehaviorPriorConsistency([line({ refOutcomeKey: wrong })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/refOutcomeKey/);
  });
  it("rejects a planted wrong refOutcome phrase (must be outcomePhrase(ref.outcome), never the bare enum token)", () => {
    const ref = lookupBehaviorPrior("3v3", "healer", 0.25)!;
    const out = checkBehaviorPriorConsistency([
      line({ refOutcome: ref.outcome }), // the enum token pasted verbatim — exactly the bug this fixes
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/refOutcome/);
  });
  it("rejects a refTop that is not the table's", () => {
    expect(
      checkBehaviorPriorConsistency([line({ refTop: "wall 99%" })]),
    ).toHaveLength(1);
  });
  it("rejects a cellKey the lookup would not have chosen for dmg2sPct", () => {
    // dmg2sPct alone selects a different bin (<10% vs >=20% for 3v3|healer),
    // so every ref-derived field drifts together, not just cellKey — assert
    // "rejected" rather than an exact message count (the <10% bin no longer
    // exists after gate 5, so this always falls back to the star cell).
    expect(
      checkBehaviorPriorConsistency([line({ dmg2sPct: "5" })]).length,
    ).toBeGreaterThan(0);
  });
  it("rejects a cellKey whose role token is neither healer nor dps (spec §1d, GH #59) — fails closed instead of defaulting to healer", () => {
    const out = checkBehaviorPriorConsistency([
      line({ cellKey: "3v3|warrior|>=20%" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/role/);
    expect(out[0]).toMatch(/warrior/);
  });
  it("rejects a line whose dmg2sPct is missing/non-numeric instead of letting NaN fall through", () => {
    const out = checkBehaviorPriorConsistency([line({ dmg2sPct: "n/a" })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/缺 dmg2sPct/);
  });
});

describe("checkPetCreditSide — a summon-cast CC credited to the wrong side (GH #99)", () => {
  const roster = [
    '  <unit id="1" name="Me-Realm" spec="Restoration Shaman" role="log owner">',
    '  <unit id="3" name="Mate-Realm" spec="Enhancement Shaman" role="teammate">',
    '  <unit id="6" name="Enemy-Realm" spec="Restoration Shaman" role="enemy">',
  ];

  it("flags a [CC ON TEAM] line crediting a teammate's summon", () => {
    // The exact 2026-09-15 baseline shape: a teammate rendered as stunning his
    // own team, because both shamans' totems carry the same unit name.
    const out = checkPetCreditSide([
      ...roster,
      "0:32  [CC ON TEAM]   1(RShaman) ← Capacitor Totem (by 3(EShaman)'s pet) | 3s [DR: Stun Full]",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("CC ON TEAM");
  });

  it("flags a [CC ON ENEMY] line credited to an enemy's summon", () => {
    const out = checkPetCreditSide([
      ...roster,
      "1:40  [CC ON ENEMY]   6(RShaman) ← Capacitor Totem (by 6(RShaman)'s pet) (1s)",
    ]);
    expect(out).toHaveLength(1);
  });

  it("passes when each side credits the other", () => {
    expect(
      checkPetCreditSide([
        ...roster,
        "0:32  [CC ON TEAM]   1(RShaman) ← Capacitor Totem (by 6(RShaman)'s pet) | 3s",
        "1:40  [CC ON ENEMY]   6(RShaman) ← Capacitor Totem (by 3(EShaman)'s pet) (1s)",
      ]),
    ).toEqual([]);
  });

  it("FT-T14: 换了称呼(totem / guardian)的召唤物,记错边照样报", () => {
    for (const kind of ["totem", "guardian", "pet"]) {
      expect(
        checkPetCreditSide([
          ...roster,
          `0:32  [CC ON TEAM]   1(RShaman) ← Capacitor Totem (by 3(EShaman)'s ${kind}) | 3s [DR: Stun Full]`,
        ]),
      ).toHaveLength(1);
      expect(
        checkPetCreditSide([
          ...roster,
          `0:32  [CC ON TEAM]   1(RShaman) ← Capacitor Totem (by 6(RShaman)'s ${kind}) | 3s`,
        ]),
      ).toEqual([]);
    }
  });

  it("says nothing about a credit that never resolved to an id", () => {
    expect(
      checkPetCreditSide([
        ...roster,
        "0:32  [CC ON TEAM]   1(RShaman) ← Capacitor Totem (by [pet]) | 3s",
      ]),
    ).toEqual([]);
  });

  it("flags an [ENEMY TRINKET] line crediting an enemy's pet", () => {
    const out = checkPetCreditSide([
      ...roster,
      "0:45  [ENEMY TRINKET]   6(RShaman) used PvP trinket out of Capacitor Totem (by 6(RShaman)'s pet) (target at 31% HP)",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(
      "line 4: [ENEMY TRINKET] credits enemy pet 6, must be friendly",
    );
  });

  it("passes an [ENEMY TRINKET] line crediting a teammate's pet", () => {
    expect(
      checkPetCreditSide([
        ...roster,
        "0:45  [ENEMY TRINKET]   6(RShaman) used PvP trinket out of Capacitor Totem (by 3(EShaman)'s pet) (target at 31% HP)",
      ]),
    ).toEqual([]);
  });
});

describe("checkHeaderHpPromise — an HP floor promised in a header binds the lines under it (GH #99)", () => {
  const killWindow =
    "  [KILL WINDOW] 1:29–1:47 on Fury Warrior (Todory-MoonGuard-US): you cast no CC; your damage on it 480k; free 15s of 18s, team min HP 32%.";

  it("flags the pre-fix header over a window that reports 32%", () => {
    const out = checkHeaderHpPromise([
      "HEALER OFFENSE (slack-gated facts — team ≥85% HP, no enemy offensive CDs active, you un-CC-d):",
      killWindow,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("team min HP 32%");
  });

  it("passes under the header that promises nothing", () => {
    expect(
      checkHeaderHpPromise([
        "HEALER OFFENSE (each line states the condition it holds under):",
        "  Slack time (team ≥85% HP, no enemy offensive CDs active, you un-CC-d): 21s across 2 segment(s); 0s with zero offensive output.",
        killWindow,
      ]),
    ).toEqual([]);
  });

  it("a blank line ends the block a header opened", () => {
    expect(
      checkHeaderHpPromise([
        "HEALER OFFENSE (slack-gated facts — team ≥85% HP, no enemy offensive CDs active, you un-CC-d):",
        "  Slack time: 21s across 2 segment(s).",
        "",
        killWindow,
      ]),
    ).toEqual([]);
  });
});

describe("checkSameSecondHpConsistency", () => {
  // User ruling 2026-09-30 (triage A21, enemy-def F-E11): `[ENEMY DEF]` and
  // `[ENEMY TRINKET]` print the target's HP at the press, the signed
  // exception to the render grid — these three shapes used to be flagged
  // against the same-second [STATE] tick and are now exempt
  // (`PRESS_HP_LINE_TAGS`).
  it("does not compare an [ENEMY DEF] external's (target at N% HP) with [STATE]", () => {
    expect(
      checkSameSecondHpConsistency([
        "0:15  [STATE]   friends 1(HPriest):99 / enemies 2(ERogue):80",
        "0:15  [ENEMY DEF]   3(HPriest) (Holy Priest): Pain Suppression → 2(ERogue) (target at 24% HP)",
      ]),
    ).toEqual([]);
  });

  it("does not compare an [ENEMY DEF] self wall's (at N% HP) with [STATE]", () => {
    expect(
      checkSameSecondHpConsistency([
        "0:20  [STATE]   friends 1(HPriest):99 / enemies 2(ERogue):70",
        "0:20  [ENEMY DEF]   2(ERogue) (Subtlety Rogue): Cloak of Shadows (immune) (at 28% HP)",
      ]),
    ).toEqual([]);
  });

  it("does not compare an [ENEMY TRINKET]'s (target at N% HP) with [STATE]", () => {
    expect(
      checkSameSecondHpConsistency([
        "0:25  [STATE]   friends 1(HPriest):99 / enemies 2(ERogue):90",
        "0:25  [ENEMY TRINKET]   2(ERogue) used PvP trinket (target at 31% HP)",
      ]),
    ).toEqual([]);
  });

  it("still flags a [DMG SPIKE] endpoint on the same second as an exempt press line", () => {
    const out = checkSameSecondHpConsistency([
      "0:15  [STATE]   friends 1(HPriest):99 / enemies 2(ERogue):80",
      "0:15  [ENEMY DEF]   3(HPriest) (Holy Priest): Pain Suppression → 2(ERogue) (target at 24% HP)",
      "0:15–0:25  [DMG SPIKE]   2(ERogue) (Subtlety Rogue): 0.9M in 10s (90k DPS) (24% -> 60% HP)",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("[DMG SPIKE]");
  });
});

describe("checkResNoChangeRowsPruned — a zero-loss [RES] rdy:Δ cd:— row may not survive rendering (GH #99 item 5)", () => {
  const stateA =
    "0:55  [STATE]   friends 1(MMonk):91 2(UDKnight):96 / enemies 4(BDruid):75";
  const stateB =
    "0:58  [STATE]   friends 1(MMonk):88 2(UDKnight):68 / enemies 4(BDruid):70";
  const full = "      [RES] rdy:Revival,Life Cocoon  cd:—  focus:2";

  it("flags a no-change row whose focus the surviving neighbours already show", () => {
    const out = checkResNoChangeRowsPruned([
      stateA,
      full,
      stateB,
      "      [RES] rdy:Δ  cd:—  focus:2",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("line 4");
  });

  it("passes when the row is the only place a focus switch exists", () => {
    expect(
      checkResNoChangeRowsPruned([
        stateA,
        full,
        stateB,
        "      [RES] rdy:Δ  cd:—  focus:3",
      ]),
    ).toEqual([]);
  });

  it("a cc: entry covered by its own landing line's duration is not a unique fact", () => {
    const landing =
      "0:56  [CC ON TEAM]   3(FMage) ← Incapacitating Roar (by 4(BDruid)) | 4s [DR: Disorient Full]";
    expect(
      checkResNoChangeRowsPruned([
        stateA,
        full,
        landing,
        stateB,
        "      [RES] rdy:Δ  cd:—  focus:2  cc:3/Incapacitating Roar-2s[disorient]",
      ]),
    ).toHaveLength(1);
    // Same row, but the landing line's 4 s ended before 0:58 → the CC state is unique, row stays.
    expect(
      checkResNoChangeRowsPruned([
        stateA,
        full,
        "0:50  [CC ON TEAM]   3(FMage) ← Incapacitating Roar (by 4(BDruid)) | 4s [DR: Disorient Full]",
        stateB,
        "      [RES] rdy:Δ  cd:—  focus:2  cc:3/Incapacitating Roar-2s[disorient]",
      ]),
    ).toEqual([]);
  });
});

describe("checkForcedTrinketConsistency — [FORCED TRINKET] agrees with the trinket, attempt and CC lines (GH #69)", () => {
  const legend = [
    '  <unit id="1" name="Pionrag-Mal\'Ganis-US" spec="Arms Warrior" role="log owner">',
    '  <unit id="5" name="Zenkitty-Illidan-US" spec="Discipline Priest" role="enemy">',
  ];
  const trinket =
    "0:16  [ENEMY TRINKET]   5(DPriest) used PvP trinket out of Leg Sweep (by 2(MMonk)) [friendly offensive CD active] (target at 92% HP)";
  const you =
    "0:17  [YOU] [CC]   Intimidating Shout → 4(UDKnight) (41% HP), 5(DPriest) [2 enemies] [DR: Disorient Full]";
  const ccOn =
    "0:17  [CC ON ENEMY]   5(DPriest) ← Intimidating Shout (by 1(AWarrior)) (6s)";
  const attempt =
    "  [0:13–0:26] on Zenkitty-Illidan-US — Leg Sweep opener (Full DR), 2 stuns | opportunity: trinket up (no softer target) | team focus 31% (0.31M on target inside it, 0.46M incl. the 5 s after) | FAILED: target trinketed out";
  const line =
    "0:16  [FORCED TRINKET]  5(DPriest) used PvP trinket inside your team's kill attempt [0:13–0:26] on them → 0:17 your Intimidating Shout landed on 5(DPriest) 1 s later (6s)";
  const ok = [...legend, trinket, you, ccOn, attempt, line];
  const swap = (to: string) => ok.map((l) => (l === line ? to : l));
  it("passes a consistent line", () => {
    expect(checkForcedTrinketConsistency(ok)).toEqual([]);
  });
  it("needs the log owner's [CC ON ENEMY] aura line; a cast line is not evidence (codex astra)", () => {
    expect(
      checkForcedTrinketConsistency(ok.filter((l) => l !== ccOn)),
    ).toHaveLength(1);
    const byMate = ccOn.replace("(by 1(AWarrior))", "(by 2(MMonk))");
    expect(
      checkForcedTrinketConsistency(ok.map((l) => (l === ccOn ? byMate : l))),
    ).toHaveLength(1);
  });
  it("fails an invented duration — even with the cast line present — and one the aura line contradicts", () => {
    expect(
      checkForcedTrinketConsistency(swap(line.replace("(6s)", "(99s)"))),
    ).toHaveLength(1);
    const shortAura = ccOn.replace("(6s)", "(1s)");
    expect(
      checkForcedTrinketConsistency(
        ok.map((l) => (l === ccOn ? shortAura : l)),
      ),
    ).toHaveLength(1);
  });
  it("accepts the Tremor-ended aura form with the same duration", () => {
    const tremor =
      "0:17  [CC ON ENEMY]   5(DPriest) ← Intimidating Shout (by 1(AWarrior)) | enemy Tremor Totem from 6(RShaman) ended this CC after 6s (cut short — it had not expired)";
    expect(
      checkForcedTrinketConsistency(ok.map((l) => (l === ccOn ? tremor : l))),
    ).toEqual([]);
    expect(
      checkForcedTrinketConsistency(
        ok.map((l) =>
          l === ccOn ? tremor.replace("after 6s", "after 5s") : l,
        ),
      ),
    ).toHaveLength(1);
  });
  it("cc-dr F-CE1: accepts the aura line with its outgoing-chain DR tag, both forms", () => {
    const tagged = ccOn.replace("(6s)", "(6s) [DR: Disorient Full]");
    expect(
      checkForcedTrinketConsistency(ok.map((l) => (l === ccOn ? tagged : l))),
    ).toEqual([]);
    const tremorTagged =
      "0:17  [CC ON ENEMY]   5(DPriest) ← Intimidating Shout (by 1(AWarrior)) [DR: Disorient Full] | enemy Tremor Totem from 6(RShaman) ended this CC after 6s (cut short — it had not expired)";
    expect(
      checkForcedTrinketConsistency(
        ok.map((l) => (l === ccOn ? tremorTagged : l)),
      ),
    ).toEqual([]);
    // the duration is still checked behind the tag
    expect(
      checkForcedTrinketConsistency(
        ok.map((l) => (l === ccOn ? tagged.replace("(6s)", "(1s)") : l)),
      ),
    ).toHaveLength(1);
  });
  it("FT-T08 step 3c: accepts the aura line with its logged-end clause; the duration is still checked behind it", () => {
    for (const note of [
      " | broken by 2(MMonk)'s Rising Sun Kick",
      " | broken by 3(BMHunter)'s pet's melee hit",
      " | dispelled by 6(RShaman)'s Purify Spirit",
      " | ended at their death",
    ]) {
      const noted = `${ccOn} [DR: Disorient Full]${note}`;
      expect(
        checkForcedTrinketConsistency(ok.map((l) => (l === ccOn ? noted : l))),
      ).toEqual([]);
      expect(
        checkForcedTrinketConsistency(
          ok.map((l) => (l === ccOn ? noted.replace("(6s)", "(1s)") : l)),
        ),
      ).toHaveLength(1);
    }
    // a clause the producer does not write is not waved through
    expect(
      checkForcedTrinketConsistency(
        ok.map((l) => (l === ccOn ? `${ccOn} | whatever` : l)),
      ),
    ).toHaveLength(1);
  });
  it("fails a missing trinket or attempt line", () => {
    expect(
      checkForcedTrinketConsistency(ok.filter((l) => l !== trinket)),
    ).toHaveLength(1);
    expect(
      checkForcedTrinketConsistency(ok.filter((l) => l !== attempt)),
    ).toHaveLength(1);
  });
  it("fails a wrong gap, a gap over the window, a short duration, another target, malformed text, and more than the cap", () => {
    expect(
      checkForcedTrinketConsistency(
        swap(line.replace("1 s later", "2 s later")),
      ),
    ).toHaveLength(1);
    expect(
      checkForcedTrinketConsistency(
        swap(line.replace("0:16  [FORCED", "0:12  [FORCED")),
      ),
    ).not.toEqual([]);
    expect(
      checkForcedTrinketConsistency(swap(line.replace("(6s)", "(1s)"))),
    ).toHaveLength(1);
    expect(
      checkForcedTrinketConsistency(
        swap(line.replace("landed on 5(DPriest)", "landed on 4(UDKnight)")),
      ),
    ).toHaveLength(1);
    expect(
      checkForcedTrinketConsistency(swap(`${line} nonsense`)),
    ).toHaveLength(1);
    expect(
      checkForcedTrinketConsistency([...ok, line]).length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("checkCcBookmarkConsistency — [CC BOOKMARK] lines agree with the burst / spike / cast lines (GH #77 part 2)", () => {
  const burst = "  Burst #1 — 0:33–0:50 | Kingsbane + Deathmark";
  const spike =
    "0:47–0:57  [DMG SPIKE]   3(RPaladin) (Retribution Paladin): 0.86M in 10s (86k DPS) (86% -> 64% HP, -2%/s, low 32% @0:55)";
  const counts = "  Counts: Kidney Shot cast 2× (first 0:31) · Blind not cast";
  const off =
    "0:35–0:46  [CC BOOKMARK]  Blind → 6(DPriest): during your Burst #1 (0:33–0:50) on 4(BDruid), their healer was not CC'd | at 0:35: 4.1yd, DR Full, 6(DPriest) PvP trinket ready";
  const def =
    "0:48–0:55  [CC BOOKMARK]  Blind → 4(BDruid): 4(BDruid) did 81% of 3(RPaladin)'s damage taken in the [DMG SPIKE] 0:47–0:57 | at 0:48: 5.9yd, DR Full, 4(BDruid) PvP trinket on cooldown";
  const kidney = [
    "0:31  [YOU] [CC]   Kidney Shot → Herbivore (92% HP)",
    "1:09  [YOU] [CC]   Kidney Shot → Smokenoob (100% HP)",
  ];
  const ok = [burst, spike, counts, ...kidney, off, def];
  it("passes consistent lines", () => {
    expect(checkCcBookmarkConsistency(ok)).toEqual([]);
  });
  it("fails a missing or mismatched burst / spike", () => {
    expect(
      checkCcBookmarkConsistency(ok.filter((l) => l !== burst)),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency(ok.filter((l) => l !== spike)),
    ).toHaveLength(1);
  });
  it("fails a short span, a wrong 'at', a low share, a trinket about another unit", () => {
    const swap = (from: string, to: string) =>
      ok.map((l) => (l === off ? to : l === from ? to : l));
    expect(
      checkCcBookmarkConsistency(
        ok.map((l) =>
          l === off
            ? off
                .replace("0:35–0:46", "0:43–0:46")
                .replace("at 0:35", "at 0:43")
            : l,
        ),
      ),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency(
        ok.map((l) => (l === off ? off.replace("at 0:35", "at 0:36") : l)),
      ),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency(
        ok.map((l) => (l === def ? def.replace("81%", "55%") : l)),
      ),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency(
        ok.map((l) =>
          l === off ? off.replace(", 6(DPriest) PvP", ", 5(UDKnight) PvP") : l,
        ),
      ),
    ).toHaveLength(1);
    void swap;
  });
  it("fails malformed data lines (and counts them toward the cap), 50% DR, trailing text", () => {
    expect(
      checkCcBookmarkConsistency(
        ok.map((l) => (l === off ? off.replace("DR Full", "DR 50%") : l)),
      ),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency(
        ok.map((l) => (l === off ? `${off} nonsense` : l)),
      ),
    ).toHaveLength(1);
    const junk = "1:30–1:40  [CC BOOKMARK]  Blind → 6(DPriest): whatever";
    expect(
      checkCcBookmarkConsistency([...ok, junk]).length,
    ).toBeGreaterThanOrEqual(2); // malformed + over cap
  });
  it("fails a target already CC'd inside the span and an own cast inside it", () => {
    expect(
      checkCcBookmarkConsistency([
        ...ok,
        "0:40  [CC ON ENEMY]   6(DPriest) ← Fear (by 2(DPriest)) (3s)",
      ]),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency([
        ...ok,
        "0:32  [CC ON ENEMY]   6(DPriest) ← Fear (by 2(DPriest)) (6s)",
      ]),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency([
        ...ok,
        "0:30  [CC ON ENEMY]   6(DPriest) ← Fear (by 2(DPriest)) (3s)",
      ]),
    ).toEqual([]);
    // FT-T08 step 3c (agy review): a tail the producer does not write is a failure of its own —
    // it used to swallow the span and pass
    expect(
      checkCcBookmarkConsistency([
        ...ok,
        "0:30  [CC ON ENEMY]   6(DPriest) ← Fear (by 2(DPriest)) (3s) | whatever",
      ]),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency([
        ...ok,
        "0:30  [CC ON ENEMY]   6(DPriest) ← Fear (by 3(RShaman)'s pet) [DR: Disorient Full] | enemy Tremor Totem from 6(RShaman) ended this CC after 2s (cut short — it had not expired)",
      ]),
    ).toEqual([]);
    // FT-T08 step 3c: the span is still read behind a logged-end clause
    expect(
      checkCcBookmarkConsistency([
        ...ok,
        "0:40  [CC ON ENEMY]   6(DPriest) ← Fear (by 2(DPriest)) (3s) [DR: Disorient Full] | broken by 1(ARogue)'s Eviscerate",
      ]),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency([
        ...ok,
        "0:30  [CC ON ENEMY]   6(DPriest) ← Fear (by 2(DPriest)) (3s) | broken by 1(ARogue)'s Eviscerate",
      ]),
    ).toEqual([]);
    // FT-T09: `<1s`, a CC the round ended on, and an own-press end are producer forms; the span
    // behind "still on them when the round ended" is still read
    for (const tail of [
      "(<1s) [DR: Disorient Full] | broken by Shadow Word: Death",
      "(3s) | ended by their PvP trinket",
      "(still on them when the round ended, <1s in) [DR: Disorient Full]",
      "(still on them when the round ended, 3s in)",
    ])
      expect(
        checkCcBookmarkConsistency([
          ...ok,
          `0:30  [CC ON ENEMY]   6(DPriest) ← Fear (by 2(DPriest)) ${tail}`,
        ]),
      ).toEqual([]);
    expect(
      checkCcBookmarkConsistency([
        ...ok,
        "0:40  [CC ON ENEMY]   6(DPriest) ← Fear (by 2(DPriest)) (still on them when the round ended, 3s in)",
      ]),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency([
        ...ok,
        "0:40  [YOU] [CC]   Blind → Smokenoob (90% HP)",
      ]).length,
    ).toBeGreaterThanOrEqual(2); // inside span + "not cast"
  });
  it("fails counts contradicted by rendered casts", () => {
    expect(
      checkCcBookmarkConsistency(
        ok.map((l) =>
          l === counts ? counts.replace("cast 2×", "cast 1×") : l,
        ),
      ),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency(
        ok.map((l) =>
          l === counts ? counts.replace("first 0:31", "first 0:40") : l,
        ),
      ),
    ).toHaveLength(1);
    expect(
      checkCcBookmarkConsistency(
        ok.map((l) =>
          l === counts ? counts.replace("cast 2×", "cast 999×") : l,
        ),
      ),
    ).toEqual([]); // omissions allowed
  });
});

describe("checkCcUseStartedCounts — CC USE `cast bar started N×, went off M×` (FT-T16 D15 2c)", () => {
  const line = (...items: string[]) => [`  Counts: ${items.join(" · ")}`];
  const roar = "Incapacitating Roar cast 2× (first 0:26)";
  it("passes what the producer writes, and the plain-form gate does not call it malformed", () => {
    const items = [
      { spellId: "99", spellName: "Incapacitating Roar", casts: 2, first: 26 },
      { spellId: "106898", spellName: "Stampeding Roar", casts: 0 },
      { spellId: "33786", spellName: "Cyclone", casts: 0, started: 4 },
      {
        spellId: "118",
        spellName: "Polymorph",
        casts: 11,
        first: 32,
        started: 14,
      },
      // every bar went off / more casts than bars: the plain form
      {
        spellId: "113724",
        spellName: "Ring of Frost",
        casts: 1,
        first: 77,
        started: 1,
      },
      { spellId: "5782", spellName: "Fear", casts: 3, first: 9, started: 2 },
    ].map((c) =>
      formatCcUseCount({
        spellId: c.spellId,
        spellName: c.spellName,
        casts: c.casts,
        firstCastS: c.first ?? null,
        castBarsStarted: c.started,
      }),
    );
    expect(items).toEqual([
      roar,
      "Stampeding Roar not cast",
      "Cyclone cast bar started 4×, went off 0×",
      "Polymorph cast bar started 14×, went off 11× (first 0:32)",
      "Ring of Frost cast 1× (first 1:17)",
      "Fear cast 3× (first 0:09)",
    ]);
    expect(checkCcUseStartedCounts(line(...items))).toEqual([]);
    expect(checkCcBookmarkConsistency(line(...items))).toEqual([]);
  });
  it("fails went off ≥ started — that entry must read `cast N×`", () => {
    expect(
      checkCcUseStartedCounts(
        line(roar, "Cyclone cast bar started 4×, went off 4× (first 0:19)"),
      ),
    ).toHaveLength(1);
    expect(
      checkCcUseStartedCounts(
        line(roar, "Cyclone cast bar started 4×, went off 5× (first 0:19)"),
      ),
    ).toHaveLength(1);
    expect(
      checkCcUseStartedCounts(line("Cyclone cast bar started 0×, went off 0×")),
    ).toHaveLength(1);
  });
  it("fails a `(first m:ss)` that disagrees with the went-off count", () => {
    expect(
      checkCcUseStartedCounts(
        line("Cyclone cast bar started 4×, went off 0× (first 0:19)"),
      ),
    ).toHaveLength(1);
    expect(
      checkCcUseStartedCounts(line("Cyclone cast bar started 4×, went off 2×")),
    ).toHaveLength(1);
  });
  it("fails two entries for one spell", () => {
    expect(
      checkCcUseStartedCounts(
        line("Cyclone not cast", "Cyclone cast bar started 4×, went off 0×"),
      ),
    ).toHaveLength(1);
    expect(
      checkCcUseStartedCounts(
        line(
          "Cyclone cast 2× (first 0:19)",
          "Cyclone cast bar started 4×, went off 2× (first 0:19)",
        ),
      ),
    ).toHaveLength(1);
  });
  it("fails a went-off count the rendered [YOU] [CC] lines contradict", () => {
    const walk = "Sleep Walk cast bar started 5×, went off 1× (first 0:36)";
    const cast = (t: string) => `${t}  [YOU] [CC]   Sleep Walk → 4(BDruid)`;
    expect(checkCcUseStartedCounts([...line(walk), cast("0:36")])).toEqual([]);
    // two rendered casts against "went off 1×"
    expect(
      checkCcUseStartedCounts([...line(walk), cast("0:36"), cast("1:10")]),
    ).toHaveLength(1);
    // a rendered cast before the stated first
    expect(checkCcUseStartedCounts([...line(walk), cast("0:20")])).toHaveLength(
      1,
    );
    // a rendered cast of a spell that "went off 0×"
    expect(
      checkCcUseStartedCounts([
        ...line("Sleep Walk cast bar started 5×, went off 0×"),
        cast("0:36"),
      ]),
    ).toHaveLength(1);
  });
  it("the prototype's wording (`started N×, completed M×`) is a malformed entry", () => {
    const old = line(roar, "Cyclone started 4×, completed 0×");
    expect(checkCcUseStartedCounts(old)).toEqual([]);
    expect(checkCcBookmarkConsistency(old)).toHaveLength(1);
  });
});

describe("checkPeelOptionConsistency — a [PEEL OPTION] line must agree with the death and CC lines (GH #77)", () => {
  const death =
    "2:29  [DEATH]  3(FDKnight) (Frost Death Knight — friendly) (Unused: Anti-Magic Zone) | dampening: 46%";
  const peel =
    "2:23–2:29  [PEEL OPTION]  1(RPaladin) Hammer of Justice → 4(ARogue): usable 7 s, not used | 4(ARogue) did 71% of 3(FDKnight)'s damage taken in the 10 s before dying at 2:29 | at 2:23: 4.0yd, DR Full, 4(ARogue) PvP trinket on cooldown";
  it("passes a consistent line", () => {
    expect(checkPeelOptionConsistency([death, peel])).toEqual([]);
  });
  it("fails without the matching [DEATH] line", () => {
    expect(checkPeelOptionConsistency([peel])).toHaveLength(1);
  });
  it("fails when the same CC landed on that target inside the window", () => {
    expect(
      checkPeelOptionConsistency([
        death,
        peel,
        "2:25  [CC ON ENEMY]   4(ARogue) ← Hammer of Justice (by 1(RPaladin)) (3s)",
      ]),
    ).toHaveLength(1);
  });
  it("fails on a span outside the window or a count the span cannot hold", () => {
    expect(
      checkPeelOptionConsistency([
        death,
        peel.replace("2:23–2:29", "2:10–2:29"),
      ]),
    ).toHaveLength(1);
    expect(
      checkPeelOptionConsistency([
        death,
        peel.replace("usable 7 s", "usable 9 s"),
      ]),
    ).toHaveLength(1);
    expect(
      checkPeelOptionConsistency([death, peel.replace("DR Full", "DR Immune")]),
    ).toHaveLength(1);
  });
  it("fails a row that does not parse instead of skipping it (audit 121c)", () => {
    // The pre-121c layout: DR without its snapshot time.
    const old =
      "2:23–2:29  [PEEL OPTION]  1(RPaladin) Hammer of Justice → 4(ARogue): usable 7 s, not used | 4.0yd, DR Full | 4(ARogue) did 71% of 3(FDKnight)'s damage taken in the 10 s before dying at 2:29";
    const out = checkPeelOptionConsistency([death, old]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("格式不符");
    // a mangled time prefix is still a PEEL row
    for (const bad of [
      peel.replace("2:23–2:29", "2:23-2:29"),
      peel.replace("2:23–2:29  ", ""),
    ]) {
      const r = checkPeelOptionConsistency([death, bad]);
      expect(r).toHaveLength(1);
      expect(r[0]).toContain("格式不符");
    }
  });
  it("fails a snapshot not taken at the span's first second, or facts about someone else", () => {
    expect(
      checkPeelOptionConsistency([death, peel.replace("at 2:23:", "at 2:26:")]),
    ).toHaveLength(1);
    expect(
      checkPeelOptionConsistency([
        death,
        peel.replace(", 4(ARogue) PvP trinket", ", 5(DWarlock) PvP trinket"),
      ]),
    ).toHaveLength(1);
    expect(
      checkPeelOptionConsistency([
        death,
        peel.replace("4(ARogue) did 71%", "5(DWarlock) did 71%"),
      ]),
    ).toHaveLength(1);
  });
  it("accepts a line with no trinket fact (no PvP trinket equipped)", () => {
    expect(
      checkPeelOptionConsistency([
        death,
        peel.replace(", 4(ARogue) PvP trinket on cooldown", ""),
      ]),
    ).toEqual([]);
  });
});

describe("checkCcAvoidedLandedConsistency — a CC that landed cannot also have 'not landed' (GH #105)", () => {
  const avoided =
    "0:45  [CC AVOIDED?]   2(EShaman): Mortal Coil (by 5(DWarlock)) did not land; Grounding Totem (own) active";
  it("flags a same-second landed twin", () => {
    const out = checkCcAvoidedLandedConsistency([
      avoided,
      "0:45  [CC ON TEAM]   2(EShaman) ← Mortal Coil (by 5(DWarlock)) | 0s [DR: Incapacitate Full] | 15.9yd from caster [CLEANSED]",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("line 1");
  });

  it("parses a spell name that itself contains a colon", () => {
    expect(
      checkCcAvoidedLandedConsistency([
        "1:10  [CC AVOIDED?]   1(HPaladin): Holy Word: Chastise (by 4(HPriest)) did not land; Divine Shield (own) active",
        "1:10  [CC ON TEAM]   1(HPaladin) ← Holy Word: Chastise (by 4(HPriest)) | 3s",
      ]),
    ).toHaveLength(1);
  });

  it("does not flag a landed line one rendered second away (the real gap may exceed the window), another target, or another spell", () => {
    expect(
      checkCcAvoidedLandedConsistency([
        avoided,
        "0:46  [CC ON TEAM]   2(EShaman) ← Mortal Coil (by 5(DWarlock)) | 3s",
        "0:45  [CC ON TEAM]   1(RDruid) ← Mortal Coil (by 5(DWarlock)) | 3s",
        "0:45  [CC ON TEAM]   2(EShaman) ← Fear (by 5(DWarlock)) | 3s",
      ]),
    ).toEqual([]);
  });

  // FT-T16 (user decision D14, 2026-10-10): a control with a landing delay
  // is paired as far after its cast as it can land — the gate reads the
  // producer's own window for the name the line prints.
  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const delayed = (spell: string, gapS: number) => [
    `6:56  [CC AVOIDED?]   1(PEvoker): ${spell} (by 6(RShaman)) did not land; Nullifying Shroud (own) active`,
    `${fmt(416 + gapS)}  [CC ON TEAM]   1(PEvoker) ← ${spell} (by 6(RShaman)'s totem) | 1s [DR: Stun 50%]`,
  ];

  it("141470d0: `6:56 Capacitor Totem did not land` with the same totem's stun at 6:58 is a contradiction", () => {
    const out = checkCcAvoidedLandedConsistency(delayed("Capacitor Totem", 2));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("line 1");
    expect(out[0]).toContain("6:58");
  });

  it("flags exactly the rendered gaps the producer's window makes certain: d + 1 <= after, per spell", () => {
    const certain = (spell: string) =>
      [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(
        (d) => checkCcAvoidedLandedConsistency(delayed(spell, d)).length > 0,
      );
    // no delay: the 1.5 s default, the same second only
    expect(certain("Mortal Coil")).toEqual([0]);
    // Capacitor Totem lands up to 4.5 s after the cast, Sigil of Misery 3 s,
    // Ring of Frost 10.5 s (the ring's life)
    expect(certain("Capacitor Totem")).toEqual([0, 1, 2, 3]);
    expect(certain("Sigil of Misery")).toEqual([0, 1, 2]);
    expect(certain("Ring of Frost")).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // … and those bounds are the producer's function, not a copy of it
    for (const spell of [
      "Mortal Coil",
      "Capacitor Totem",
      "Sigil of Misery",
      "Ring of Frost",
    ])
      expect(Math.max(...certain(spell)), spell).toBe(
        Math.floor(ccLandedMatchWindowMs(spell).afterMs / 1000 - 1),
      );
  });

  it("a delayed landing on another unit, or of another spell, is not this line's twin", () => {
    const [avoidedLine] = delayed("Capacitor Totem", 2);
    expect(
      checkCcAvoidedLandedConsistency([
        avoidedLine!,
        "6:58  [CC ON TEAM]   2(RDruid) ← Capacitor Totem (by 6(RShaman)'s totem) | 3s",
        "6:58  [CC ON TEAM]   1(PEvoker) ← Hex (by 6(RShaman)) | 3s",
      ]),
    ).toEqual([]);
  });

  it("reads the `logged <TYPE>` form the same way (FT-T16 D15 3c)", () => {
    const logged = avoided.replace("did not land", "logged IMMUNE");
    expect(
      checkCcAvoidedLandedConsistency([
        logged,
        "0:45  [CC ON TEAM]   2(EShaman) ← Mortal Coil (by 5(DWarlock)) | 3s",
      ]),
    ).toHaveLength(1);
    expect(checkCcAvoidedLandedConsistency([logged])).toEqual([]);
  });
});

describe("checkCcAvoidedMissType — `[CC AVOIDED?] … logged <TYPE>` names a miss type that means the control failed (FT-T16 D15 3c)", () => {
  // the producer's own wording of the half the gate re-parses
  const line = (outcome: string) =>
    `0:40  [CC AVOIDED?]   1(BDruid): Hammer of Justice (by 5(RPaladin)) ${outcome}; Precognition (own) active`;
  it("passes both forms the producer writes, for every type it admits", () => {
    expect(checkCcAvoidedMissType([line(ccAvoidedOutcomeText({}))])).toEqual(
      [],
    );
    expect(CONTROL_FAILED_MISS_TYPES.size).toBeGreaterThan(1);
    for (const loggedMissType of CONTROL_FAILED_MISS_TYPES)
      expect(
        checkCcAvoidedMissType([
          line(ccAvoidedOutcomeText({ loggedMissType })),
        ]),
        loggedMissType,
      ).toEqual([]);
    // a spell name with a colon, a totem's source label
    expect(
      checkCcAvoidedMissType([
        "1:10  [CC AVOIDED?]   1(HPaladin): Holy Word: Chastise (by 4(HPriest)) logged IMMUNE; Divine Shield (own) active",
        "6:56  [CC AVOIDED?]   1(PEvoker): Capacitor Totem (by 6(RShaman)) did not land; Nullifying Shroud (own) active",
      ]),
    ).toEqual([]);
  });
  it("fails ABSORB, an unknown type and a missing type", () => {
    for (const bad of ["logged ABSORB", "logged undefined", "logged immune"]) {
      const out = checkCcAvoidedMissType([line(bad)]);
      expect(out, bad).toHaveLength(1);
      expect(out[0]).toContain("line 1");
    }
  });
  it("fails a first half that is neither form", () => {
    for (const bad of ["was avoided", "logged", "landed"])
      expect(checkCcAvoidedMissType([line(bad)]), bad).toHaveLength(1);
  });
  it("says nothing about other lines", () => {
    expect(
      checkCcAvoidedMissType([
        "0:40  [CC ON TEAM]   1(BDruid) ← Hammer of Justice (by 5(RPaladin)) | 5s",
        "0:41  [TEAM] [CD]   3(DKnight): Death Grip → 5(RPaladin) — did not land (IMMUNE)",
      ]),
    ).toEqual([]);
  });
});

describe("checkPressedDuringControlNote — `| pressed during it:` names the log owner's own kit cooldowns (FT-T16, D13)", () => {
  const roster = [
    '  <unit id="1" name="Ingbumb-Illidan-US" spec="Discipline Priest" role="log owner">',
    "    <cooldowns>Desperate Prayer [90s, lasts 10s], Fade [20s], Invoke Xuen, the White Tiger [120s] [UNUSED], Avenging Wrath [PASSIVE], Psychic Scream [30s] [UNUSED — started 2×, never finished]</cooldowns>",
    '  <unit id="2" name="Mate-Illidan-US" spec="Frost Mage" role="teammate">',
    "    <cooldowns>Ice Block [240s, lasts 10s]</cooldowns>",
  ];
  // the producer's own writer: the gate reads what it prints
  const note = (...items: Array<[string, number]>) =>
    formatPressedDuringNote(
      items.map(([spellName, count], i) => ({
        spellId: String(i),
        spellName,
        count,
        firstSeconds: i,
      })),
    );
  const cc = (unit: string, tail: string) =>
    `0:20  [CC ON TEAM]   ${unit} ← Rake (by 3(FDruid)) | 6s [DR: Stun Full] | 5yd from caster${tail}`;

  it("passes the owner's line, on [CC ON TEAM] and on [SILENCE], a comma inside a spell name included", () => {
    expect(
      checkPressedDuringControlNote([
        ...roster,
        cc("1(DPriest)", note(["Desperate Prayer", 12], ["Fade", 3])),
        cc("1(DPriest)", note(["Invoke Xuen, the White Tiger", 1])),
        `0:40  [SILENCE]   1(DPriest) ← Silence (by 4(SPriest)) | 3s${note(["Psychic Scream", 2])}`,
        // a line without the clause is not this gate's
        cc("2(FMage)", ""),
      ]),
    ).toEqual([]);
  });

  it("flags the clause on a teammate's line — only the recorder has refused presses", () => {
    const out = checkPressedDuringControlNote([
      ...roster,
      cc("2(FMage)", note(["Ice Block", 2])),
    ]);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toContain("line 5");
  });

  it("flags a spell that is not in the owner's <cooldowns>, one that has no button there, one named twice, a zero count", () => {
    for (const tail of [
      note(["Power Word: Shield", 16]),
      note(["Avenging Wrath", 2]),
      note(["Fade", 2], ["Fade", 1]),
      note(["Fade", 0]),
    ])
      expect(
        checkPressedDuringControlNote([...roster, cc("1(DPriest)", tail)]),
        tail,
      ).toHaveLength(1);
  });

  it("flags the clause anywhere but the end of a [CC ON TEAM] / [SILENCE] line, and a malformed list", () => {
    for (const line of [
      cc("1(DPriest)", `${note(["Fade", 3])} [CLEANSED]`),
      cc("1(DPriest)", " | pressed during it: Fade"),
      cc("1(DPriest)", " | pressed during it: Fade ×3,Desperate Prayer ×1"),
      `0:20  [YOU] [CD]   Fade${note(["Fade", 3])}`,
    ])
      expect(
        checkPressedDuringControlNote([...roster, line]),
        line,
      ).toHaveLength(1);
  });

  it("without a log-owner unit the ownership checks say nothing; the format is still checked", () => {
    expect(
      checkPressedDuringControlNote([cc("1(DPriest)", note(["Fade", 3]))]),
    ).toEqual([]);
    expect(
      checkPressedDuringControlNote([
        cc("1(DPriest)", " | pressed during it: Fade"),
      ]),
    ).toHaveLength(1);
  });
});

describe("checkDuringExternalConsistency — the [ENEMY DEF] during-it annotation must agree with itself (GH #91)", () => {
  const ok =
    "0:54  [ENEMY DEF]   6(RDruid) (Restoration Druid): Ironbark → 5(DDHunter) (11.0s) (target at 21% HP) | during it: 3(SHunter) 13k on target · 15% of their enemy-player damage · direct 0k / periodic 13k · damage in 5 of 11 s · longest gap 6 s; 1(AWarrior) 0k on target · no damage on any enemy player · 0 of 11 s";
  it("passes a consistent annotation", () => {
    expect(checkDuringExternalConsistency([ok])).toEqual([]);
  });
  it("flags direct + periodic ≠ total, K > M, and a window longer than the observed aura", () => {
    expect(
      checkDuringExternalConsistency([
        ok.replace("direct 0k / periodic 13k", "direct 5k / periodic 13k"),
      ]),
    ).toHaveLength(1);
    // K > M, and with K = 12 the gap bound M − K is negative, so G = 6 fails too: two findings on one segment.
    expect(
      checkDuringExternalConsistency([
        ok.replace("damage in 5 of 11 s", "damage in 12 of 11 s"),
      ]),
    ).toHaveLength(2);
    expect(
      checkDuringExternalConsistency([ok.replace("(11.0s)", "(9.0s)")]),
    ).toHaveLength(2); // both segments' M=11 > 10
  });
  it("accepts the absorbed tag (Touch of Karma shape) as part of the total field", () => {
    expect(
      checkDuringExternalConsistency([
        ok
          .replace("13k on target ·", "0k on target (+350k absorbed) ·")
          .replace("direct 0k / periodic 13k", "direct 0k / periodic 0k"),
      ]),
    ).toEqual([]);
  });
  it("FT-T02b follow-up: accepts the deferred tag, alone and after the absorbed one (the writer's three forms)", () => {
    for (const tag of ["(+6k deferred)", "(+2k absorbed, +6k deferred)"])
      expect(
        checkDuringExternalConsistency([
          ok.replace("13k on target ·", `13k on target ${tag} ·`),
        ]),
      ).toEqual([]);
    // a form the writer does not produce is still unparsable
    expect(
      checkDuringExternalConsistency([
        ok.replace(
          "13k on target ·",
          "13k on target (+6k deferred, +2k absorbed) ·",
        ),
      ]).length,
    ).toBeGreaterThan(0);
  });
  it("round 2: accepts the in-school and immune fields, and flags in-school above the total", () => {
    const r2 = ok.replace(
      "direct 0k / periodic 13k",
      "direct 0k / periodic 13k · 9k (69%) of it in the wall's school · 2 hits immune",
    );
    expect(checkDuringExternalConsistency([r2])).toEqual([]);
    expect(
      checkDuringExternalConsistency([r2.replace("9k (69%)", "40k (300%)")]),
    ).toHaveLength(1);
  });
  it("ignores [ENEMY DEF] lines without the annotation and lines of other kinds", () => {
    expect(
      checkDuringExternalConsistency([
        "0:54  [ENEMY DEF]   6(RDruid) (Restoration Druid): Ironbark → 5(DDHunter) (11.0s)",
        "0:55  [STATE]   x",
      ]),
    ).toEqual([]);
  });
});

describe("checkDeathTrinketCcConsistency — the death line's trinket tag vs [CC ON TEAM] (F-E28, A28)", () => {
  const death = (tag: string) =>
    `2:53  [DEATH]  1(UDKnight) (Unholy Death Knight — friendly)${tag}`;
  const bare = " (PvP Trinket available)";
  const none = " (PvP Trinket available; no breakable CC in the last 10 s)";
  it("a 1 s Lasso 5 s before (82a2d681) is not breakable: the 'none' form passes, the bare tag fails", () => {
    const lasso =
      "2:48  [CC ON TEAM]   1(UDKnight) ← Lightning Lasso (by 5(EShaman)) | 1s [DR: Stun Full]";
    expect(checkDeathTrinketCcConsistency([lasso, death(none)])).toEqual([]);
    expect(checkDeathTrinketCcConsistency([lasso, death(bare)])).toHaveLength(
      1,
    );
  });
  it("a 5 s Kidney Shot 7 s before (539b6ed0) is breakable, also when a trinket cut it short", () => {
    const ks =
      "2:46  [CC ON TEAM]   1(UDKnight) ← Kidney Shot (by 4(ARogue)) | 5s [DR: Stun Full] | 3.1yd from caster";
    expect(checkDeathTrinketCcConsistency([ks, death(bare)])).toEqual([]);
    expect(checkDeathTrinketCcConsistency([ks, death(none)])).toHaveLength(1);
    const broken =
      "2:40  [CC ON TEAM]   1(UDKnight) ← Kidney Shot (by 4(ARogue)) [DR: Stun Full] | trinket broke this CC after 3s (cut short — it had not expired)";
    expect(checkDeathTrinketCcConsistency([broken, death(bare)])).toEqual([]);
  });
  it("FT-T09: a CC the round ended on is read by its printed seconds; `<1s` is never breakable", () => {
    const cut =
      "2:50  [CC ON TEAM]   1(UDKnight) ← Kidney Shot (by 4(ARogue)) | still on them when the round ended, 3s in [DR: Stun Full]";
    expect(checkDeathTrinketCcConsistency([cut, death(bare)])).toEqual([]);
    expect(checkDeathTrinketCcConsistency([cut, death(none)])).toHaveLength(1);
    const blip =
      "2:50  [CC ON TEAM]   1(UDKnight) ← Kidney Shot (by 4(ARogue)) | <1s [DR: Stun Full] | ended by their PvP trinket";
    expect(checkDeathTrinketCcConsistency([blip, death(none)])).toEqual([]);
    expect(checkDeathTrinketCcConsistency([blip, death(bare)])).toHaveLength(1);
  });
  it("a CC ending more than 10 s before, or on another player, does not count", () => {
    const old = "2:22  [CC ON TEAM]   1(UDKnight) ← Fear (by 6(AWarlock)) | 8s";
    const other = "2:50  [CC ON TEAM]   2(RDruid) ← Fear (by 6(AWarlock)) | 8s";
    expect(checkDeathTrinketCcConsistency([old, other, death(none)])).toEqual(
      [],
    );
  });
});

describe("checkBurstAnsweredBottomConsistency — the credit line's bottom second (F-B3)", () => {
  const roster =
    '  <unit id="1" name="Sgarbossa-Tortheldrin-US" spec="Windwalker Monk" role="log owner">';
  const line = (at: string) =>
    `0:04  [BURST ANSWERED]   enemy opened The Hunt (Havoc Demon Hunter Irridanz-Sargeras-US): Botobumps-Illidan-US answered with Earthgrab 0.6s before it opened; Sgarbossa-Tortheldrin-US bottomed at 42% at ${at}`;
  // FT-T03 (user ruling 2026-10-10, D7): the bottom is a trough — the true
  // minimum inside the window — so the tick of its second may read ABOVE it
  // (it was red: the bottom had to be that tick). A tick below it stays red.
  it("passes when the same-second [STATE] is at or above the bottom, fails when it is below", () => {
    expect(
      checkBurstAnsweredBottomConsistency([
        roster,
        "0:55  [STATE]   friends 1(WMonk):42 / enemies 4(HDHunter):90",
        line("0:55"),
      ]),
    ).toEqual([]);
    expect(
      checkBurstAnsweredBottomConsistency([
        roster,
        "0:55  [STATE]   friends 1(WMonk):47 / enemies 4(HDHunter):90",
        line("0:55"),
      ]),
    ).toEqual([]);
    expect(
      checkBurstAnsweredBottomConsistency([
        roster,
        "0:55  [STATE]   friends 1(WMonk):40 / enemies 4(HDHunter):90",
        line("0:55"),
      ]),
    ).toHaveLength(1);
  });
  it("FT-T03: no tick from the line's second to the bottom's second reads below it; `dead` at the bottom's second fails; later ticks are not judged", () => {
    const tick = (at: string, v: number | "dead") =>
      `${at}  [STATE]   friends 1(WMonk):${v} / enemies 4(HDHunter):90`;
    const f = checkBurstAnsweredBottomConsistency([
      roster,
      tick("0:30", 35),
      line("0:55"),
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("0:30 的 [STATE] 为 35");
    expect(
      checkBurstAnsweredBottomConsistency([
        roster,
        tick("0:55", "dead"),
        line("0:55"),
      ]),
    ).toHaveLength(1);
    // before the window opened (0:03) and after the bottom (0:58): not judged
    expect(
      checkBurstAnsweredBottomConsistency([
        roster,
        tick("0:03", 10),
        tick("0:58", 10),
        line("0:55"),
      ]),
    ).toEqual([]);
  });
  it("a bottom before the line's own second fails", () => {
    expect(
      checkBurstAnsweredBottomConsistency([roster, line("0:03")]),
    ).toHaveLength(1);
  });
  it("FT board item: 行里是花名册标签(1(WMonk))时照样核对同秒 [STATE]", () => {
    const labelled = (pct: number) =>
      `0:04  [BURST ANSWERED]   enemy opened The Hunt (4(HDHunter)): 2(RShaman) answered with Earthgrab 0.6s before it opened; 1(WMonk) bottomed at ${pct}% at 0:55`;
    const state =
      "0:55  [STATE]   friends 1(WMonk):42 / enemies 4(HDHunter):90";
    expect(
      checkBurstAnsweredBottomConsistency([roster, state, labelled(42)]),
    ).toEqual([]);
    expect(
      checkBurstAnsweredBottomConsistency([roster, state, labelled(47)]),
    ).toHaveLength(1);
  });
});

describe("checkBurstAnsweredBeforeDeath — the credited answer precedes the pressured unit's death (T12 ⑧ i)", () => {
  // The lines are rendered by the producer, so the gate reads the wording the
  // prompt carries — not a copy of it.
  const labels = {
    friendly: (n: string) => (n === "Warrior-R" ? "2(AWarrior)" : "3(PEvoker)"),
    enemy: () => "4(HDHunter)",
  };
  const rendered = (latencySec: number, died = true) => {
    const point = {
      tSec: 105,
      leadCd: {
        spellId: "370965",
        spellName: "The Hunt",
        casterName: "Hunter-R",
        casterSpec: "Havoc Demon Hunter",
        castSec: 105,
      },
      extraCds: [],
      pressured: {
        unitId: "f2",
        name: "Warrior-R",
        minHpPct: 20,
        minHpSec: 109,
        startHpPct: 90,
        startHpSec: 105,
        died,
      },
      responded: true,
      feasible: true,
      anyFriendlyDeath: died,
      friendlyOutcomes: [],
      responseCasts: [
        {
          category: "healCd",
          spellId: "370960",
          spellName: "Emerald Communion",
          casterName: "Evoker-R",
          casterId: "f3",
          tSec: 110,
          latencySec,
        },
      ],
    } as unknown as BurstWindowDecisionPoint;
    const [e] = formatBurstAnsweredLines([point], undefined, labels);
    return `1:45  ${e!.line}`;
  };
  const death = (at: string) =>
    `${at}  [DEATH]  2(AWarrior) (Arms Warrior — friendly)`;

  it("the producer's line is the one the gate reads", () => {
    expect(rendered(5.1)).toBe(
      "1:45  [BURST ANSWERED]   enemy opened The Hunt (4(HDHunter)): 3(PEvoker) answered with Emerald Communion in 5.1s; 2(AWarrior) bottomed at 20% at 1:49 — 2(AWarrior) still died",
    );
  });
  it("an answer the grid proves came after the death fails", () => {
    // opened 1:45 or later, +6.1 s ≥ 1:51.05; the death is before 1:51
    expect(
      checkBurstAnsweredBeforeDeath([death("1:50"), rendered(6.1)]),
    ).toHaveLength(1);
    expect(
      checkBurstAnsweredBeforeDeath([rendered(7.9), death("1:50")]),
    ).toHaveLength(1);
  });
  it("an answer that can precede the death passes — the death's own second is beyond the grid", () => {
    // 483f7433's own numbers (5.1 s, death at 1:50.385) are inside one second:
    // the raw-instant tests in analysis pin that case
    expect(
      checkBurstAnsweredBeforeDeath([death("1:50"), rendered(5.1)]),
    ).toEqual([]);
    expect(
      checkBurstAnsweredBeforeDeath([death("1:50"), rendered(6.0)]),
    ).toEqual([]);
    expect(
      checkBurstAnsweredBeforeDeath([death("1:52"), rendered(6.1)]),
    ).toEqual([]);
  });
  it("reads the unit's EARLIEST [DEATH] line, and only that unit's", () => {
    expect(
      checkBurstAnsweredBeforeDeath([
        death("1:50"),
        death("3:10"),
        rendered(6.1),
      ]),
    ).toHaveLength(1);
    expect(
      checkBurstAnsweredBeforeDeath([
        "1:46  [DEATH]  3(PEvoker) (Preservation Evoker — friendly)",
        rendered(6.1),
      ]),
    ).toEqual([]);
  });
  it("a line whose pressured unit did not die is not read", () => {
    expect(
      checkBurstAnsweredBeforeDeath([death("1:46"), rendered(6.1, false)]),
    ).toEqual([]);
  });
});

describe("checkBurstAnsweredControlSpan — a credited control's length is its [CC ON ENEMY] line's (T12 ⑧ i)", () => {
  const HEX_AT_MS = 46_300;
  const labels = {
    friendly: (n: string) =>
      n === "Shaman-R"
        ? "3(RShaman)"
        : n === "Me-R"
          ? "1(HPriest)"
          : "2(AWarrior)",
    enemy: (n: string) => (n === "Paladin-R" ? "5(RPaladin)" : "4(AWarrior)"),
  };
  /** the producer's line for a Hex 1.2 s into a window opened at 0:45, with
   * the span it reads off a CC instance of `durationSeconds` */
  const rendered = (
    durationSeconds: number,
    over: { casterName?: string; latencySec?: number } = {},
  ) => {
    const point = {
      tSec: 45,
      leadCd: {
        spellId: "107574",
        spellName: "Avatar",
        casterName: "Warrior-E",
        casterSpec: "Arms Warrior",
        castSec: 45,
      },
      extraCds: [],
      pressured: {
        unitId: "f2",
        name: "Warrior-R",
        minHpPct: 35,
        minHpSec: 50,
        startHpPct: 90,
        startHpSec: 45,
        died: false,
      },
      responded: true,
      feasible: true,
      anyFriendlyDeath: false,
      friendlyOutcomes: [],
      responseCasts: [
        {
          category: "control",
          spellId: "51514",
          spellName: "Hex",
          casterName: over.casterName ?? "Shaman-R",
          casterId: "f3",
          destId: "e2",
          tSec: 46,
          latencySec: over.latencySec ?? 1.2,
          landed: true,
          controlOn: {
            unitId: "e2",
            unitName: "Paladin-R",
            auras: [{ spellId: "51514", atMs: HEX_AT_MS }],
          },
        },
      ],
    } as unknown as BurstWindowDecisionPoint;
    const [e] = formatBurstAnsweredLines(
      [point],
      undefined,
      labels,
      ccSpanLookup(
        [
          {
            playerName: "Paladin-R",
            ccInstances: [
              {
                spellId: "51514",
                atSeconds: HEX_AT_MS / 1000,
                durationSeconds,
              },
            ],
          },
        ] as never,
        0,
      ),
    );
    return `0:45  ${e!.line}`;
  };
  const roster =
    '  <unit id="1" name="Me-R" spec="Holy Priest" role="log owner">';
  const landing = (at: string, tail: string, by = "3(RShaman)") =>
    `${at}  [CC ON ENEMY]   5(RPaladin) ← Hex (by ${by})${tail}`;

  it("the producer's line is the one the gate reads", () => {
    expect(rendered(2.1)).toBe(
      "0:45  [BURST ANSWERED]   enemy opened Avatar (4(AWarrior)): 3(RShaman) answered with Hex on 5(RPaladin) (2s) in 1.2s; 2(AWarrior) bottomed at 35% at 0:50",
    );
  });
  it("the same span on the [CC ON ENEMY] line passes; a different one fails", () => {
    expect(
      checkBurstAnsweredControlSpan([
        roster,
        rendered(2.1),
        landing("0:46", " (2s) | broken by damage from 2(AWarrior)"),
      ]),
    ).toEqual([]);
    const bad = checkBurstAnsweredControlSpan([
      roster,
      rendered(2.1),
      landing("0:46", " (5s)"),
    ]);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toContain("(2s)");
    expect(bad[0]).toContain("(5s)");
  });
  it("reads the other forms the span takes: <1s, the round ending on it, a Tremor break", () => {
    expect(
      checkBurstAnsweredControlSpan([
        roster,
        rendered(0.2),
        landing("0:46", " (<1s)"),
      ]),
    ).toEqual([]);
    expect(
      checkBurstAnsweredControlSpan([
        roster,
        rendered(0.2),
        landing("0:46", " (1s)"),
      ]),
    ).toHaveLength(1);
    expect(
      checkBurstAnsweredControlSpan([
        roster,
        rendered(2.1),
        landing(
          "0:46",
          " | enemy Tremor Totem from 4(AWarrior) ended this CC after 2s (cut short — it had not expired)",
        ),
      ]),
    ).toEqual([]);
    expect(
      checkBurstAnsweredControlSpan([
        roster,
        rendered(2.1),
        landing(
          "0:46",
          " | enemy Tremor Totem from 4(AWarrior) ended this CC after 4s (cut short — it had not expired)",
        ),
      ]),
    ).toHaveLength(1);
  });
  it("only a landing whose second can be this application's is compared", () => {
    // opened 0:45, +1.2 s, the aura from 0.1 s before the press to 3 s after
    // it: seconds 0:46 … 0:50. A re-Hex at 0:51 is another application.
    expect(
      checkBurstAnsweredControlSpan([
        roster,
        rendered(2.1),
        landing("0:51", " (5s)"),
        landing("0:45", " (5s)"),
      ]),
    ).toEqual([]);
    expect(
      checkBurstAnsweredControlSpan([
        roster,
        rendered(2.1),
        landing("0:50", " (5s)"),
      ]),
    ).toHaveLength(1);
    // two applications in reach: one of them carrying the span is enough
    expect(
      checkBurstAnsweredControlSpan([
        roster,
        rendered(2.1),
        landing("0:46", " (2s)"),
        landing("0:49", " (5s)"),
      ]),
    ).toEqual([]);
  });
  it("another caster's Hex, another target's, or no [CC ON ENEMY] line at all proves nothing", () => {
    expect(
      checkBurstAnsweredControlSpan([
        roster,
        rendered(2.1),
        landing("0:46", " (5s)", "2(AWarrior)"),
        "0:46  [CC ON ENEMY]   4(AWarrior) ← Hex (by 3(RShaman)) (5s)",
        "0:46  [CC ON ENEMY]   5(RPaladin) ← Polymorph (by 3(RShaman)) (5s)",
      ]),
    ).toEqual([]);
    expect(checkBurstAnsweredControlSpan([roster, rendered(2.1)])).toEqual([]);
  });
  it("the log owner's own control is not read — its [CC ON ENEMY] lines are not all of its applications", () => {
    expect(
      checkBurstAnsweredControlSpan([
        roster,
        rendered(2.1, { casterName: "Me-R" }),
        landing("0:46", " (5s)", "1(HPriest)"),
      ]),
    ).toEqual([]);
  });
});

describe("checkDmgSpikeListCap — the [DMG SPIKE] cap and the line counting what it dropped (D4)", () => {
  // Every line is the producer's: the entry lines from `emitDmgSpikeEntries`,
  // the legend sentence and the count line from their own formatters.
  type W = [fromS: number, totalDamage: number, name?: string];
  const bucket = ([fromSeconds, totalDamage, name = "Warrior-R"]: W) => ({
    fromSeconds,
    toSeconds: fromSeconds + 10,
    totalDamage,
    targetName: name,
    targetSpec: name === "Warrior-R" ? "Arms Warrior" : "Havoc Demon Hunter",
  });
  const pid = (n: string) =>
    n === "Warrior-R" ? "3(AWarrior)" : "2(HDHunter)";
  const entries = (ws: W[]) => {
    const out: string[] = [];
    emitDmgSpikeEntries({
      pressureWindows: ws.map(bucket),
      friends: [],
      matchStartMs: 0,
      pid,
      addEntry: (_t, ...ls) => out.push(...ls),
    });
    return out;
  };
  const count = (ws: W[]) =>
    formatDmgSpikesNotListed({
      notListed: ws.map(bucket),
      matchEndSeconds: 600,
      pid,
    })!;
  const FIVE: W[] = [
    [10, 900_000],
    [20, 850_000, "Hunter-R"],
    [30, 800_000],
    [40, 750_000, "Hunter-R"],
    [50, 700_000],
  ];
  const DROPPED: W[] = [
    [60, 600_000, "Hunter-R"],
    [70, 350_000],
  ];
  const prompt = (listed: W[], dropped: W[] | null = DROPPED) => [
    "MATCH TIMELINE",
    dmgSpikeListLegend(),
    ...(dropped ? [count(dropped)] : []),
    "",
    ...entries(listed),
  ];

  it("the producer's lines are the ones the gate reads, and a consistent prompt passes", () => {
    const p = prompt(FIVE);
    expect(p[2]).toBe(
      "    Not listed this round: 2 more [DMG SPIKE] windows of 0.30M or more (largest: 0.60M on 2(HDHunter) at 1:00–1:10).",
    );
    expect(p[4]).toBe(
      "0:10–0:20  [DMG SPIKE]   3(AWarrior) (Arms Warrior): 0.90M in 10s (90k DPS)",
    );
    expect(checkDmgSpikeListCap(p)).toEqual([]);
    // no window past the cap: no count line, nothing to check
    expect(checkDmgSpikeListCap(prompt(FIVE, null))).toEqual([]);
    expect(checkDmgSpikeListCap(prompt(FIVE.slice(0, 3), null))).toEqual([]);
  });

  it("more lines than the cap fail; a line quoted a second time is not a second window", () => {
    const six = checkDmgSpikeListCap(
      prompt([...FIVE, [60, 600_000, "Hunter-R"]], null),
    );
    expect(six).toHaveLength(1);
    expect(six[0]).toContain("6");
    const p = prompt(FIVE, null);
    expect(checkDmgSpikeListCap([...p, `  ${p[3]}`, p[3]!])).toEqual([]);
  });

  it("a count line beside a list that is not full fails", () => {
    expect(checkDmgSpikeListCap(prompt(FIVE.slice(0, 4)))).toHaveLength(1);
  });

  it("the largest unlisted window cannot outrank a listed one", () => {
    const f = checkDmgSpikeListCap(prompt(FIVE, [[60, 720_000, "Hunter-R"]]));
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("0.72M");
    expect(f[0]).toContain("0.70M");
    // equal to the smallest listed total is in rank order
    expect(
      checkDmgSpikeListCap(prompt(FIVE, [[60, 700_000, "Hunter-R"]])),
    ).toEqual([]);
  });

  it("the largest unlisted window cannot overlap a listed line of the same unit", () => {
    // 0:15–0:25 on the warrior overlaps the listed 0:10–0:20
    expect(checkDmgSpikeListCap(prompt(FIVE, [[15, 600_000]]))).toHaveLength(1);
    // the same seconds on the other unit, or touching bounds, are fine
    expect(
      checkDmgSpikeListCap(prompt(FIVE, [[5, 600_000, "Hunter-R"]])),
    ).toEqual([]);
    expect(checkDmgSpikeListCap(prompt(FIVE, [[60, 600_000]]))).toEqual([]);
  });

  it("the count line sits under the legend sentence, once", () => {
    const p = prompt(FIVE);
    const moved = [p[0]!, p[1]!, "", p[2]!, ...p.slice(4)];
    expect(checkDmgSpikeListCap(moved)).toHaveLength(1);
    const twice = [...p.slice(0, 3), p[1]!, p[2]!, ...p.slice(3)];
    expect(checkDmgSpikeListCap(twice)).toHaveLength(1);
  });

  it("a hand-edited threshold or a largest under it fails", () => {
    const p = prompt(FIVE);
    const at = (text: string) => [...p.slice(0, 2), text, ...p.slice(3)];
    expect(
      checkDmgSpikeListCap(
        at(p[2]!.replace("of 0.30M or more", "of 0.50M or more")),
      ),
    ).toHaveLength(1);
    expect(
      checkDmgSpikeListCap(
        at(p[2]!.replace("largest: 0.60M", "largest: 0.20M")),
      ),
    ).toHaveLength(1);
  });
});

describe("checkFreeOfWindowConsistency (F-C11)", () => {
  it("free X s of Y s with X > Y fails; X ≤ Y passes", () => {
    expect(
      checkFreeOfWindowConsistency(["  0:40–0:56 … free 17s of 16s"]),
    ).toHaveLength(1);
    expect(
      checkFreeOfWindowConsistency(["  0:40–0:56 … free 16s of 16s"]),
    ).toEqual([]);
  });
});
