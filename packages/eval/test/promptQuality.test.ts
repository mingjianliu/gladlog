import { ensureAnalysisData } from "@gladlog/analysis";
import { buildMomentSnapshotItems } from "@gladlog/analysis/src/analysis/momentSnapshot";
import {
  lookupBehaviorPrior,
  outcomePhrase,
} from "@gladlog/analysis/src/data/behaviorPrior";
import { CombatUnitReaction } from "@gladlog/parser-compat";

import type { CoverageManifest } from "../src/quality/coverageManifest";
import {
  checkBehaviorPriorConsistency,
  checkMatch,
  checkPetCreditSide,
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

  it("says nothing about a credit that never resolved to an id", () => {
    expect(
      checkPetCreditSide([
        ...roster,
        "0:32  [CC ON TEAM]   1(RShaman) ← Capacitor Totem (by [pet]) | 3s",
      ]),
    ).toEqual([]);
  });
});
