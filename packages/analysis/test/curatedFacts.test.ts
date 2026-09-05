import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  costNormPhrase,
  CURATED_ABILITY_FACTS,
  PROPOSED_FACTS,
} from "../src/data/curatedAbilityFacts";
import { ensureAnalysisData } from "../src/data/ensure";
import {
  canHelpAnotherUnit,
  THROUGHPUT_EMPOWER_DEFENSIVE_IDS,
  USABLE_WHILE_CC_CONDITIONAL,
  USABLE_WHILE_CC_GAP_IDS,
  USABLE_WHILE_CC_SPELL_IDS,
  USABLE_WHILE_FEARED_GAP_IDS,
  USABLE_WHILE_FEARED_SPELL_IDS,
} from "../src/utils/cooldowns";

// 官方技能事实(targeting / schools / abilityEffects)自 2026-08-22 起动态载入
// (见 spellTargetingGenerated.ts 头部:静态 import 会把 230 kB 压进 renderer 主
// chunk)。谓词在数据到位前按空表回答,所以任何**断言这些谓词具体取值**的地方都
// 必须先 await 聚合入口 —— 不 await 也可能碰巧过(微任务先解决),那是时序侥幸。
beforeAll(async () => {
  await ensureAnalysisData();
});

describe("curated ability facts sign-off", () => {
  it("every entry carries a user approval stamp", () => {
    for (const f of CURATED_ABILITY_FACTS) {
      expect(f.approved, `${f.id} ${f.claim}`).toMatch(
        /^\d{4}-\d{2}-\d{2} user$/,
      );
      expect(f.source.length, `${f.id} source`).toBeGreaterThan(0);
    }
  });
  it("ids are unique per claim kind", () => {
    const keys = CURATED_ABILITY_FACTS.map(
      (f) => `${f.kind}:${f.id}:${f.claim}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * Cross-file equality: cooldowns.ts' USABLE_WHILE_CC_CONDITIONAL and
 * curatedAbilityFacts.ts' "usable_while_cc_conditional" entries are two
 * independent hard-coded copies of the same fact (the gating requiresTalent
 * id) — one is the signed record, the other is the executable predicate. A
 * comment promising "the value stays in sync" is not a check (CLAUDE.md
 * 门规谓词即规范: same fact needs a shared/checked predicate, not a
 * convention). Generic over the current entries — a future addition to
 * either side without the other is caught automatically, no test edit
 * needed.
 */
describe("requiresTalent stays equal across curatedAbilityFacts.ts and cooldowns.ts", () => {
  const conditionalCurated = CURATED_ABILITY_FACTS.filter(
    (f) => f.kind === "usable_while_cc_conditional",
  );

  it("every CURATED conditional entry's requiresTalent matches USABLE_WHILE_CC_CONDITIONAL[id]", () => {
    for (const f of conditionalCurated) {
      const wired = USABLE_WHILE_CC_CONDITIONAL[f.id];
      expect(
        wired,
        `${f.id} (${f.claim}) has no cooldowns.ts wiring`,
      ).toBeDefined();
      expect(wired?.requiresTalent, `${f.id} requiresTalent mismatch`).toBe(
        f.requiresTalent,
      );
    }
  });

  it("every USABLE_WHILE_CC_CONDITIONAL key has a matching CURATED_ABILITY_FACTS entry (reverse direction)", () => {
    for (const id of Object.keys(USABLE_WHILE_CC_CONDITIONAL)) {
      const signed = conditionalCurated.find((f) => f.id === id);
      expect(
        signed,
        `${id} is wired in cooldowns.ts but not signed off`,
      ).toBeDefined();
      expect(signed?.requiresTalent, `${id} requiresTalent mismatch`).toBe(
        USABLE_WHILE_CC_CONDITIONAL[id].requiresTalent,
      );
    }
  });
});

/**
 * Cross-file wiring for the usable-while-CC hand layers (finding #2,
 * 2026-08-14 final review; reshaped 2026-09-04, BACKLOG #41 (8)): every id a
 * hand gap layer carries must have a signed record, and every signed record
 * must be honoured by the predicate consumers read. Since the generator reads
 * the NAMED bits, the stunned gap layer is empty and its signed facts (498 /
 * 403876 / 51490) are honoured by the GENERATED set instead — the test pins
 * "signed ⇒ in USABLE_WHILE_CC_SPELL_IDS", not "signed ⇒ in the gap layer".
 */
describe("usable-while-CC hand layers <-> signed facts (cooldowns.ts <-> curatedAbilityFacts.ts)", () => {
  const stunGap = CURATED_ABILITY_FACTS.filter(
    (f) => f.kind === "usable_while_cc_gap",
  );
  const stunGapIds = new Set(stunGap.map((f) => f.id));
  const fearGap = CURATED_ABILITY_FACTS.filter(
    (f) => f.kind === "usable_while_feared_gap",
  );
  const fearGapIds = new Set(fearGap.map((f) => f.id));

  it("every id in USABLE_WHILE_CC_GAP_IDS has a signed usable_while_cc_gap entry", () => {
    for (const id of USABLE_WHILE_CC_GAP_IDS) {
      expect(
        stunGapIds.has(id),
        `${id} is in cooldowns.ts USABLE_WHILE_CC_GAP_IDS but not signed off`,
      ).toBe(true);
    }
  });

  it("every signed usable_while_cc_gap entry is honoured by USABLE_WHILE_CC_SPELL_IDS (generated named bits ∪ gap layer)", () => {
    for (const f of stunGap) {
      expect(
        USABLE_WHILE_CC_SPELL_IDS.has(f.id),
        `${f.id} (${f.claim}) is signed off but not usable-while-stunned in cooldowns.ts`,
      ).toBe(true);
    }
  });

  it("every id in USABLE_WHILE_FEARED_GAP_IDS has a signed usable_while_feared_gap entry", () => {
    for (const id of USABLE_WHILE_FEARED_GAP_IDS) {
      expect(
        fearGapIds.has(id),
        `${id} is in cooldowns.ts USABLE_WHILE_FEARED_GAP_IDS but not signed off`,
      ).toBe(true);
    }
  });

  it("every signed usable_while_feared_gap entry is honoured by USABLE_WHILE_FEARED_SPELL_IDS (generated named bit 177 ∪ gap layer)", () => {
    for (const f of fearGap) {
      expect(
        USABLE_WHILE_FEARED_SPELL_IDS.has(f.id),
        `${f.id} (${f.claim}) is signed off but not usable-while-feared in cooldowns.ts`,
      ).toBe(true);
    }
  });
});

describe("proposed ability facts (pending sign-off, not CI-enforced)", () => {
  it("carries no approval stamp yet (would be a lie if it did)", () => {
    for (const f of PROPOSED_FACTS) {
      expect("approved" in f, `${f.id} ${f.claim}`).toBe(false);
      expect(f.source.length, `${f.id} source`).toBeGreaterThan(0);
    }
  });
  it("ids are unique per claim kind", () => {
    const keys = PROPOSED_FACTS.map((f) => `${f.kind}:${f.id}:${f.claim}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * costNormPhrase (#25, 2026-08-14 挂账清理 Task D): the single-sourced short
 * phrase for a cost_norm-kind entry. This is the guard that lets
 * candidateFindings.ts's defensive-suggestion facts (death-unused-defensive /
 * cd-waste) attach a costNorm caveat without hand-deriving wording from
 * `claim` at each call site.
 */
describe("costNormPhrase(#25 cost_norm 守护注短语单源)", () => {
  it("642(圣盾术,在册 cost_norm)→ 返回非空短语", () => {
    expect(costNormPhrase("642")).toBeTruthy();
  });
  it("45438(寒冰屏障,在册 cost_norm)→ 返回非空短语", () => {
    expect(costNormPhrase("45438")).toBeTruthy();
  });
  it("同一 kind 下所有在册 cost_norm 条目返回值相同(单源短语,不逐条分叉措辞)", () => {
    const costNormIds = CURATED_ABILITY_FACTS.filter(
      (f) => f.kind === "cost_norm",
    ).map((f) => f.id);
    const phrases = new Set(costNormIds.map((id) => costNormPhrase(id)));
    expect(phrases.size).toBe(1);
  });
  it("不在册技能(如 Astral Shift 108271)→ 返回 null", () => {
    expect(costNormPhrase("108271")).toBeNull();
  });
});

/**
 * Import-boundary test (mechanized version of a code-review "Important"
 * finding): PROPOSED_FACTS is a staging area for unsigned claims. If any
 * consumer imported it directly, an unapproved claim could leak into the
 * pipeline's behavior with nothing but a source-comment promise standing in
 * the way — "don't rely on comments" is the whole point of the sign-off
 * discipline (CLAUDE.md 门规谓词即规范: shared facts need a shared, checked
 * gate, not a convention). This scans real file text rather than trusting
 * that nobody adds an import later.
 */
describe("PROPOSED_FACTS import boundary", () => {
  const SRC_DIR = path.resolve(__dirname, "../src");
  const OWN_FILE = "data/curatedAbilityFacts.ts";

  function listTsFiles(dir: string, base = ""): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const rel = base ? `${base}/${entry}` : entry;
      if (statSync(abs).isDirectory()) {
        out.push(...listTsFiles(abs, rel));
      } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
        out.push(rel);
      }
    }
    return out;
  }

  it("no file under src/ other than curatedAbilityFacts.ts itself imports PROPOSED_FACTS", () => {
    const offenders: string[] = [];
    for (const rel of listTsFiles(SRC_DIR)) {
      if (rel === OWN_FILE) continue;
      const text = readFileSync(path.join(SRC_DIR, rel), "utf-8");
      if (/\bPROPOSED_FACTS\b/.test(text)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * throughput_role(2026-08-22 用户裁定,GH #29):签字册与
 * `THROUGHPUT_EMPOWER_DEFENSIVE_IDS` 是**派生关系**,不是两份手抄。这两条用例
 * 把方向钉死,免得哪天有人又在 cooldowns.ts 里手写一条没签字的 id。
 */
describe("THROUGHPUT_EMPOWER_DEFENSIVE_IDS 由签字册 throughput_role 派生", () => {
  const signed = CURATED_ABILITY_FACTS.filter(
    (f) => f.kind === "throughput_role",
  ).map((f) => f.id);

  it("派生集合与签字条目逐一对应(两个方向)", () => {
    expect([...THROUGHPUT_EMPOWER_DEFENSIVE_IDS].sort()).toEqual(
      [...signed].sort(),
    );
  });

  it("每条 throughput_role 都带用户签字戳与出处", () => {
    for (const f of CURATED_ABILITY_FACTS.filter(
      (x) => x.kind === "throughput_role",
    )) {
      expect(f.approved).toMatch(/^\d{4}-\d{2}-\d{2} user$/);
      expect(f.source).toContain("用户裁定");
    }
  });

  it("消费方语义:产出型 CD 不被「自保技能救不了队友」那道门滤掉", () => {
    for (const id of signed) {
      expect(canHelpAnotherUnit(id, "Defensive")).toBe(true);
    }
  });
});
