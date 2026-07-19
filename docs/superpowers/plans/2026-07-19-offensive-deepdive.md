# 进攻深挖(非死亡 finding 深挖)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让深挖轮也覆盖 5 类窗口式非死亡 finding,用与死亡镜像的进攻证据(目标血线/敌方防御免疫/我方对敌奶 CC/大招对齐),并保底 1 个深挖席位给它。

**Architecture:** 在 `deepDive.ts` 里加一个兄弟构建器 `buildOffensiveDeepDivePack`(输出同 `DeepDivePack` 形状)+ 纯映射核 `offensivePackItems` + 门 `hasOffensiveCoachableSignal` + 分类器 `classifyFindingKind`;renderer 保底 1 席、合并进同一次 `deepen()`。生存(死亡)路径完全不动。谓词单源:进攻证据全部消费 `analyzeBurstLedger` / `analyzeOutgoingCCChains`(与 `candidateFindings` 同源)。

**Tech Stack:** TypeScript monorepo。analysis(`packages/analysis`)、desktop main/renderer(`packages/desktop`)、eval 谐波(`packages/eval/scripts`)。vitest 测试。

## Global Constraints

- **谓词单源铁律**:进攻 pack 只消费 `analyzeBurstLedger(player, allies, enemies, combat)` / `analyzeOutgoingCCChains(friendlies, enemies, combat)`,不新算事实。
- **占位符纪律**:深挖正文数字必须是 `{{key.field}}` 占位符;facts 里名字用 `sn()` 去 realm 数字;结构化数值拆独立占位字段,不编进 key 名。
- **类型检查**:`npm run typecheck`(绝不 `tsc -b`)。
- **desktop 改动 push 前**:`npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet`。
- **构建器在 `packages/analysis` 内**,相对 import 取 utils;新 export 经 `export *` barrel 自动带出。
- **eval**:responder/judge 一律 sonnet;跨 AI = sonnet + gemini(agy);agy 输出**重定向到文件**(勿 `| tail`)。
- **scope**:仅 5 类窗口式非死亡 —— `unconverted-burst` / `burst-into-immunity` / `off-target-in-window` / `juked-kick` / `dr-clipped-cc`。`cd-waste` 排除(whole-round + 生存类,无窗口锚点)。

## 现有代码锚点(verbatim,供实现者对齐)

`packages/analysis/src/analysis/deepDive.ts`:

- `export const DEEP_DIVE_MAX = 2; export const PACK_BEFORE_S = 30; export const PACK_AFTER_S = 10; const PACK_MAX_ITEMS = 14;`
- `const fmt = (n) => Number.isInteger(n) ? String(n) : n.toFixed(1);`
- `const sn = (name) => name.split("-")[0] ?? name;`
- `PackItem.kind: "cc" | "defensive" | "enemy-cd" | "hp" | "dispel" | "position"`
- `interface DeepDivePack { findingIndex; anchorFrom; anchorTo; items: PackItem[]; facts: Record<string,string>; }`
- `buildDeepDivePrompt(packs, findings, specName, ownerName?)` — 每 pack 一段,item 列成 `key=pN kind=K facts={k=v,...}`,尾部 HARD RULES。

`packages/analysis/src/utils/burstLedger.ts`:

```ts
interface IBurstDefensiveHit {
  spellId;
  spellName: string;
  overlapSeconds: number;
  isImmunity: boolean;
}
interface IBurstLedgerEntry {
  fromSeconds: number;
  toSeconds: number;
  spells: Array<{ spellId; spellName: string; castTimeSeconds: number }>;
  totalDamage: number;
  damageByTarget: Array<{ unitId; unitName: string; damage: number }>;
  dominantTarget: {
    unitId;
    unitName: string;
    hpStartPct: number | null;
    hpEndPct: number | null;
    damage: number;
    defensivesHit: IBurstDefensiveHit[];
    died: boolean;
  } | null;
  allyCDsOverlapping: Array<{ playerName: string; spellName: string }>;
}
function analyzeBurstLedger(
  player,
  allies,
  enemies,
  combat,
): IBurstLedgerEntry[]; // 自动 a.id!==player.id 排除 player
```

`packages/analysis/src/utils/drAnalysis.ts`:

```ts
interface IOutgoingCCApplication {
  atSeconds: number;
  durationSeconds;
  spellName;
  casterName: string;
  drInfo: IDRInfo;
}
interface IOutgoingCCChain {
  targetName: string;
  targetSpec: string;
  applications: IOutgoingCCApplication[];
  hasWastedApplications: boolean;
}
function analyzeOutgoingCCChains(
  friendlies,
  enemies,
  combat,
): IOutgoingCCChain[];
```

`packages/analysis/src/utils/cooldowns.ts`:`isHealerSpec(spec)`。
`packages/analysis/src/analysis/auditFindings.ts`:`export const SEVERITY_RANK = { high:0, med:1, low:2 };`
`packages/analysis/src/analysis/types.ts`:`CandidateEvent { id; type: string; t; unitNames; spell?; facts }`;`Finding { eventIds: string[]; severity; category; title; explanation; deepDive? }`。
候选类型(`candidateFindings.ts`)与自带 facts:见 spec 背景表。

---

### Task 1: PackItem kind 扩展 + `hasOffensiveCoachableSignal` 门

**Files:**

- Modify: `packages/analysis/src/analysis/deepDive.ts`(PackItem.kind union;新增 `OFFENSIVE_KINDS` 集合 + `hasOffensiveCoachableSignal`)
- Test: `packages/analysis/src/analysis/deepDive.test.ts`(追加 describe 块)

**Interfaces:**

- Produces: `export function hasOffensiveCoachableSignal(items: PackItem[]): boolean`;扩展后的 `PackItem.kind` 含 `"target-hp" | "enemy-defensive" | "immunity" | "our-cc" | "our-cd" | "off-target" | "juked-kick" | "dr-clip"`。

- [ ] **Step 1: 写失败测试**(追加到 `deepDive.test.ts` 末尾)

```ts
import { hasOffensiveCoachableSignal } from "./deepDive";

describe("hasOffensiveCoachableSignal(进攻信号门,进攻深挖)", () => {
  const item = (kind: string, facts: Record<string, string>) =>
    ({ key: "p1", kind, t: 1, label: "", unitNames: [], facts }) as never;
  it("目标触底 + 防御/免疫接了 = 信号", () => {
    expect(
      hasOffensiveCoachableSignal([
        item("target-hp", { role: "enemy-target", hp: "22" }),
        item("immunity", { role: "enemy", spell: "Divine Shield" }),
      ]),
    ).toBe(true);
    expect(
      hasOffensiveCoachableSignal([
        item("target-hp", { role: "enemy-target", hp: "20" }),
        item("enemy-defensive", { role: "enemy", spell: "Ice Barrier" }),
      ]),
    ).toBe(true);
  });
  it("off-target / juked / dr-clip 各自即信号", () => {
    expect(
      hasOffensiveCoachableSignal([
        item("off-target", { role: "owner", onTargetPct: "40" }),
      ]),
    ).toBe(true);
    expect(
      hasOffensiveCoachableSignal([
        item("juked-kick", { role: "owner", kick: "Kick" }),
      ]),
    ).toBe(true);
    expect(
      hasOffensiveCoachableSignal([
        item("dr-clip", { role: "owner", dr: "Immune" }),
      ]),
    ).toBe(true);
  });
  it("目标没触底 / 只有 target-hp 无防御 → 无信号", () => {
    expect(
      hasOffensiveCoachableSignal([
        item("target-hp", { role: "enemy-target", hp: "80" }),
        item("enemy-defensive", { role: "enemy", spell: "Ice Barrier" }),
      ]),
    ).toBe(false);
    expect(
      hasOffensiveCoachableSignal([
        item("target-hp", { role: "enemy-target", hp: "15" }),
      ]),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/analysis/src/analysis/deepDive.test.ts -t 进攻信号门`
Expected: FAIL — `hasOffensiveCoachableSignal is not a function`。

- [ ] **Step 3: 实现**(在 `deepDive.ts` 里,`hasCoachableSignal` 之后)

先把 `PackItem.kind` 改成:

```ts
  kind:
    | "cc" | "defensive" | "enemy-cd" | "hp" | "dispel" | "position"
    | "target-hp" | "enemy-defensive" | "immunity" | "our-cc" | "our-cd"
    | "off-target" | "juked-kick" | "dr-clip";
```

再加常量 + 门(阈值 `OFFENSIVE_HP_THRESHOLD = 35` spec 无关):

```ts
/** 进攻深挖:目标触底阈值(%);低于它 + 有防御/免疫接了 = 「该换/该等/该控奶」。 */
const OFFENSIVE_HP_THRESHOLD = 35;

/**
 * 进攻信号(进攻深挖门):非死亡候选已 pre-curate 为失误,门轻 —— 要求进攻故事在场:
 * 目标血线触底且有防御/免疫接了(该换/该等/该控奶),或 off-target/juked/dr-clip 各自即失误。
 */
export function hasOffensiveCoachableSignal(items: PackItem[]): boolean {
  const targetBottomed = items.some(
    (i) =>
      i.kind === "target-hp" && Number(i.facts.hp) <= OFFENSIVE_HP_THRESHOLD,
  );
  const answered = items.some(
    (i) => i.kind === "enemy-defensive" || i.kind === "immunity",
  );
  if (targetBottomed && answered) return true;
  return items.some(
    (i) =>
      i.kind === "off-target" ||
      i.kind === "juked-kick" ||
      i.kind === "dr-clip",
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/analysis/src/analysis/deepDive.test.ts`
Expected: PASS(含既有 hasCoachableSignal / auditDeepDives 用例)。

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add packages/analysis/src/analysis/deepDive.ts packages/analysis/src/analysis/deepDive.test.ts
git commit -m "feat(deepdive): 进攻信号门 hasOffensiveCoachableSignal + PackItem kind 扩展"
```

---

### Task 2: `offensivePackItems`(纯映射)+ `buildOffensiveDeepDivePack`(接谓词)

**Files:**

- Modify: `packages/analysis/src/analysis/deepDive.ts`
- Test: `packages/analysis/src/analysis/deepDive.test.ts`

**Interfaces:**

- Consumes: `IBurstLedgerEntry`(burstLedger.ts)、`IOutgoingCCChain`(drAnalysis.ts)、`hasOffensiveCoachableSignal`(Task 1)。
- Produces:
  - `export function offensivePackItems(input: OffensiveMapInput): Omit<PackItem, "key">[]`
  - `export function buildOffensiveDeepDivePack(combat: any, finding: Finding, findingIndex: number, candidates: CandidateEvent[], ownerName?: string): DeepDivePack | null`
  - `interface OffensiveMapInput { entries: IBurstLedgerEntry[]; healerChains: IOutgoingCCChain[]; candFacts: Record<string,string>[]; candTypes: string[]; ownerName?: string; inWin: (t:number)=>boolean; }`

- [ ] **Step 1: 写失败测试**(纯映射核,手搓 ledger entry)

```ts
import { offensivePackItems } from "./deepDive";
import type { IBurstLedgerEntry } from "../utils/burstLedger";

describe("offensivePackItems(进攻证据映射,纯函数)", () => {
  const entry: IBurstLedgerEntry = {
    fromSeconds: 40,
    toSeconds: 44,
    spells: [{ spellId: "1", spellName: "Combustion", castTimeSeconds: 40 }],
    totalDamage: 500000,
    damageByTarget: [
      { unitId: "e1", unitName: "Rdruid-Area52", damage: 500000 },
    ],
    dominantTarget: {
      unitId: "e1",
      unitName: "Rdruid-Area52",
      hpStartPct: 70,
      hpEndPct: 18,
      damage: 500000,
      defensivesHit: [
        {
          spellId: "9",
          spellName: "Ice Block",
          overlapSeconds: 2.5,
          isImmunity: true,
        },
      ],
      died: false,
    },
    allyCDsOverlapping: [
      { playerName: "Mate-Area52", spellName: "Power Infusion" },
    ],
  };
  const inWin = (t: number) => t >= 10 && t <= 50;

  it("burst-into-immunity:出 target-hp(start+end)+ immunity + our-cd,名字短名、role 正确", () => {
    const items = offensivePackItems({
      entries: [entry],
      healerChains: [],
      candFacts: [{ immunity: "Ice Block", overlap: "2.5" }],
      candTypes: ["burst-into-immunity"],
      ownerName: "Me-Area52",
      inWin,
    });
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("target-hp");
    expect(kinds).toContain("immunity");
    expect(
      items.find((i) => i.kind === "target-hp" && i.facts.hp === "18"),
    ).toBeTruthy();
    // 短名:realm 数字去掉,否则裸数字审计误杀
    expect(items.find((i) => i.facts.unit === "Rdruid")).toBeTruthy();
    expect(
      items.every(
        (i) => i.facts.unit === undefined || !/\d/.test(i.facts.unit),
      ),
    ).toBe(true);
    // 免疫 role=enemy
    expect(items.find((i) => i.kind === "immunity")!.facts.role).toBe("enemy");
  });

  it("healer CC 链在窗口内 → our-cc(role=owner);窗口外的丢弃", () => {
    const items = offensivePackItems({
      entries: [],
      candTypes: ["off-target-in-window"],
      candFacts: [
        {
          onTargetPct: "40",
          target: "Rdruid-Area52",
          offTarget: "Warr-Area52",
        },
      ],
      healerChains: [
        {
          targetName: "Hpal-Area52",
          targetSpec: "65",
          hasWastedApplications: false,
          applications: [
            {
              atSeconds: 42,
              durationSeconds: 3,
              spellName: "Polymorph",
              casterName: "Me-Area52",
              drInfo: { level: "Full" } as never,
            },
            {
              atSeconds: 99,
              durationSeconds: 3,
              spellName: "Ring of Frost",
              casterName: "Me-Area52",
              drInfo: { level: "Full" } as never,
            },
          ],
        },
      ],
      ownerName: "Me-Area52",
      inWin,
    });
    const cc = items.filter((i) => i.kind === "our-cc");
    expect(cc).toHaveLength(1); // 窗口外的 99s 被 inWin 丢
    expect(cc[0]!.facts.role).toBe("owner");
    // off-target 类型条:来自候选 facts
    const off = items.find((i) => i.kind === "off-target");
    expect(off!.facts.onTargetPct).toBe("40");
    expect(off!.facts.target).toBe("Warr"); // offTarget 短名
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run packages/analysis/src/analysis/deepDive.test.ts -t 进攻证据映射`
Expected: FAIL — `offensivePackItems is not a function`。

- [ ] **Step 3: 实现纯映射核 + 构建器**(在 `deepDive.ts`,`buildDeepDivePack` 之后)

先加 import:

```ts
import {
  analyzeBurstLedger,
  type IBurstLedgerEntry,
} from "../utils/burstLedger";
import {
  analyzeOutgoingCCChains,
  type IOutgoingCCChain,
} from "../utils/drAnalysis";
```

纯映射核:

```ts
export interface OffensiveMapInput {
  entries: IBurstLedgerEntry[];
  healerChains: IOutgoingCCChain[];
  candFacts: Record<string, string>[];
  candTypes: string[];
  ownerName?: string;
  inWin: (t: number) => boolean;
}

/** 进攻证据 → PackItem(纯):目标血线/敌方防御免疫/我方对敌奶 CC/大招对齐 + 类型专属条。 */
export function offensivePackItems(
  inp: OffensiveMapInput,
): Omit<PackItem, "key">[] {
  const raw: Omit<PackItem, "key">[] = [];
  const ownerShort = inp.ownerName ? sn(inp.ownerName) : undefined;
  const role = (name: string) =>
    ownerShort && sn(name) === ownerShort ? "owner" : "teammate";

  for (const e of inp.entries) {
    if (!inp.inWin(e.fromSeconds) && !inp.inWin(e.toSeconds)) continue;
    const t = e.dominantTarget;
    if (t) {
      // 目标血线:start(burst 起)+ end(burst 止),取自 ledger 已算值(谓词单源)
      if (t.hpStartPct != null && inp.inWin(e.fromSeconds))
        raw.push({
          kind: "target-hp",
          t: e.fromSeconds,
          label: `${sn(t.unitName)} HP`,
          unitNames: [t.unitName],
          facts: {
            t: fmt(e.fromSeconds),
            hp: String(t.hpStartPct),
            unit: sn(t.unitName),
            role: "enemy-target",
          },
        });
      if (t.hpEndPct != null && inp.inWin(e.toSeconds))
        raw.push({
          kind: "target-hp",
          t: e.toSeconds,
          label: `${sn(t.unitName)} HP`,
          unitNames: [t.unitName],
          facts: {
            t: fmt(e.toSeconds),
            hp: String(t.hpEndPct),
            unit: sn(t.unitName),
            role: "enemy-target",
          },
        });
      for (const d of t.defensivesHit) {
        raw.push({
          kind: d.isImmunity ? "immunity" : "enemy-defensive",
          t: e.fromSeconds,
          label: `${d.spellName}(${sn(t.unitName)})`,
          unitNames: [t.unitName],
          facts: {
            t: fmt(e.fromSeconds),
            spell: d.spellName,
            unit: sn(t.unitName),
            role: "enemy",
            ...(d.isImmunity ? { overlap: d.overlapSeconds.toFixed(1) } : {}),
          },
        });
      }
    }
    // 我方大招对齐(owner 自身 spells + ally 重叠)
    for (const s of e.spells)
      if (inp.inWin(s.castTimeSeconds))
        raw.push({
          kind: "our-cd",
          t: s.castTimeSeconds,
          label: `${s.spellName}`,
          unitNames: inp.ownerName ? [inp.ownerName] : [],
          facts: {
            t: fmt(s.castTimeSeconds),
            spell: s.spellName,
            unit: ownerShort ?? "owner",
            role: "owner",
          },
        });
    for (const a of e.allyCDsOverlapping)
      raw.push({
        kind: "our-cd",
        t: e.fromSeconds,
        label: `${a.spellName}(${sn(a.playerName)})`,
        unitNames: [a.playerName],
        facts: {
          t: fmt(e.fromSeconds),
          spell: a.spellName,
          unit: sn(a.playerName),
          role: role(a.playerName),
        },
      });
  }

  // 我方对敌奶 CC 链(窗口内)
  for (const chain of inp.healerChains)
    for (const app of chain.applications) {
      if (!inp.inWin(app.atSeconds)) continue;
      raw.push({
        kind: "our-cc",
        t: app.atSeconds,
        label: `${app.spellName} → ${sn(chain.targetName)}`,
        unitNames: [app.casterName],
        facts: {
          t: fmt(app.atSeconds),
          spell: app.spellName,
          unit: sn(chain.targetName),
          caster: sn(app.casterName),
          role: role(app.casterName),
        },
      });
    }

  // 类型专属条(承接候选自带 facts;名字短名)
  inp.candTypes.forEach((type, i) => {
    const cf = inp.candFacts[i] ?? {};
    const tt = Number(cf.t);
    if (type === "off-target-in-window")
      raw.push({
        kind: "off-target",
        t: Number.isFinite(tt) ? tt : 0,
        label: `脱靶`,
        unitNames: [],
        facts: {
          ...(cf.t ? { t: cf.t } : {}),
          role: "owner",
          ...(cf.onTargetPct ? { onTargetPct: cf.onTargetPct } : {}),
          ...(cf.offTarget ? { target: sn(cf.offTarget) } : {}),
        },
      });
    if (type === "juked-kick")
      raw.push({
        kind: "juked-kick",
        t: Number.isFinite(tt) ? tt : 0,
        label: `被骗踢`,
        unitNames: [],
        facts: {
          ...(cf.t ? { t: cf.t } : {}),
          role: "owner",
          ...(cf.kick ? { kick: cf.kick } : {}),
          ...(cf.fake ? { fake: cf.fake } : {}),
        },
      });
    if (type === "dr-clipped-cc")
      raw.push({
        kind: "dr-clip",
        t: Number.isFinite(tt) ? tt : 0,
        label: `踩 DR`,
        unitNames: [],
        facts: {
          ...(cf.t ? { t: cf.t } : {}),
          role: "owner",
          ...(cf.spell ? { spell: cf.spell } : {}),
          ...(cf.target ? { target: sn(cf.target) } : {}),
          ...(cf.dr ? { dr: cf.dr } : {}),
        },
      });
  });

  return raw;
}
```

构建器(接谓词 + 截断,截断复用死亡 pack 的靠焦点排序;窗口/单位识别复用死亡 pack 同款):

```ts
export function buildOffensiveDeepDivePack(
  combat: any,
  finding: Finding,
  findingIndex: number,
  candidates: CandidateEvent[],
  ownerName?: string,
): DeepDivePack | null {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const cands = (finding.eventIds ?? [])
    .map((id) => byId.get(id))
    .filter((c): c is CandidateEvent => !!c);
  const ts = cands
    .filter((c) => Number.isFinite(c.t) && c.t > 0)
    .map((c) => c.t);
  if (ts.length === 0) return null;
  const durS = ((combat?.endTime ?? 0) - (combat?.startTime ?? 0)) / 1000;
  const anchorFrom = Math.max(0, Math.min(...ts) - PACK_BEFORE_S);
  const anchorTo = Math.min(durS, Math.max(...ts) + PACK_AFTER_S);
  const inWin = (t: number) => t >= anchorFrom && t <= anchorTo;

  const units = Object.values(combat?.units ?? {}) as any[];
  const players = units.filter((u) => u.info);
  const friends = players.filter(
    (u) => u.reaction === CombatUnitReaction.Friendly,
  );
  const enemies = players.filter(
    (u) => u.reaction !== CombatUnitReaction.Friendly,
  );
  if (friends.length === 0 || enemies.length === 0) return null;
  const owner = ownerName
    ? friends.find((u) => u.name === ownerName)
    : undefined;
  if (!owner) return null;

  let entries: IBurstLedgerEntry[] = [];
  let healerChains: IOutgoingCCChain[] = [];
  try {
    entries = analyzeBurstLedger(owner, friends, enemies, combat);
  } catch {
    /* 无高级日志 */
  }
  try {
    const enemyHealers = new Set(
      enemies.filter((e) => isHealerSpec(e.spec)).map((e) => e.name),
    );
    healerChains = analyzeOutgoingCCChains(friends, enemies, combat).filter(
      (c) => enemyHealers.has(c.targetName),
    );
  } catch {
    /* 缺席 */
  }

  const raw = offensivePackItems({
    entries,
    healerChains,
    candFacts: cands.map((c) => c.facts),
    candTypes: cands.map((c) => c.type),
    ownerName,
    inWin,
  });
  if (raw.length === 0) return null;

  // 截断:靠近焦点时刻(复用死亡 pack 同逻辑)
  const focusT = Math.min(...ts);
  const items: PackItem[] = raw
    .sort((a, b) => Math.abs(a.t - focusT) - Math.abs(b.t - focusT))
    .slice(0, PACK_MAX_ITEMS)
    .sort((a, b) => a.t - b.t)
    .map((it, i) => ({ ...it, key: `p${i + 1}` }));

  const facts: Record<string, string> = {};
  for (const it of items)
    for (const [k, v] of Object.entries(it.facts)) facts[`${it.key}.${k}`] = v;
  return { findingIndex, anchorFrom, anchorTo, items, facts };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run packages/analysis/src/analysis/deepDive.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add packages/analysis/src/analysis/deepDive.ts packages/analysis/src/analysis/deepDive.test.ts
git commit -m "feat(deepdive): buildOffensiveDeepDivePack + 纯映射核 offensivePackItems"
```

---

### Task 3: 分类器 `classifyFindingKind` + prompt 进攻图例 + PROMPT_VERSION bump

**Files:**

- Modify: `packages/analysis/src/analysis/deepDive.ts`(`classifyFindingKind` + `buildDeepDivePrompt` 加进攻图例)
- Modify: `packages/desktop/src/main/ai.ts`(`PROMPT_VERSION` 11→12)
- Test: `packages/analysis/src/analysis/deepDive.test.ts`

**Interfaces:**

- Produces: `export function classifyFindingKind(finding: Finding, candidates: CandidateEvent[]): "survival" | "offensive"`

- [ ] **Step 1: 写失败测试**

```ts
import { classifyFindingKind } from "./deepDive";
import type { CandidateEvent } from "./types";

describe("classifyFindingKind(分发)", () => {
  const cand = (id: string, type: string): CandidateEvent => ({
    id,
    type,
    t: 10,
    unitNames: [],
    facts: {},
  });
  const cands = [
    cand("d1", "death"),
    cand("b1", "unconverted-burst"),
    cand("o1", "off-target-in-window"),
  ];
  const F = (eventIds: string[]): Finding => ({
    eventIds,
    severity: "high",
    category: "x",
    title: "x",
    explanation: "x",
  });
  it("death 候选 → survival", () => {
    expect(classifyFindingKind(F(["d1"]), cands)).toBe("survival");
  });
  it("非死亡候选 → offensive", () => {
    expect(classifyFindingKind(F(["b1"]), cands)).toBe("offensive");
    expect(classifyFindingKind(F(["o1"]), cands)).toBe("offensive");
  });
  it("混合平票偏 survival", () => {
    expect(classifyFindingKind(F(["d1", "b1"]), cands)).toBe("survival");
  });
});

describe("buildDeepDivePrompt 进攻图例", () => {
  it("含进攻 pack 时 prompt 印进攻条目说明", () => {
    const pack = {
      findingIndex: 0,
      anchorFrom: 0,
      anchorTo: 50,
      items: [
        {
          key: "p1",
          kind: "target-hp",
          t: 44,
          label: "",
          unitNames: [],
          facts: { t: "44", hp: "18", role: "enemy-target" },
        },
      ],
      facts: { "p1.t": "44", "p1.hp": "18", "p1.role": "enemy-target" },
    } as never;
    const findings = [
      {
        eventIds: ["b1"],
        severity: "high",
        category: "x",
        title: "爆发没打死",
        explanation: "x",
      },
    ] as never;
    const p = buildDeepDivePrompt([pack], findings, "Frost Mage", "Me-Area52");
    expect(p).toContain("kind=target-hp");
    expect(p).toContain("close it"); // 进攻教练框架关键词
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `npx vitest run packages/analysis/src/analysis/deepDive.test.ts -t 分发`
Expected: FAIL — `classifyFindingKind is not a function`。

- [ ] **Step 3: 实现**

分类器(`deepDive.ts`,含 `OFFENSIVE_CANDIDATE_TYPES` 集合):

```ts
const OFFENSIVE_CANDIDATE_TYPES = new Set([
  "unconverted-burst",
  "burst-into-immunity",
  "off-target-in-window",
  "juked-kick",
  "dr-clipped-cc",
]);

/** 分发:finding 引用候选多数派决定路由;平票偏 survival(死亡教练价值锚定更强)。 */
export function classifyFindingKind(
  finding: Finding,
  candidates: CandidateEvent[],
): "survival" | "offensive" {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  let off = 0,
    surv = 0;
  for (const id of finding.eventIds ?? []) {
    const t = byId.get(id)?.type;
    if (!t) continue;
    if (OFFENSIVE_CANDIDATE_TYPES.has(t)) off++;
    else surv++;
  }
  return off > surv ? "offensive" : "survival";
}
```

`buildDeepDivePrompt`:在 HARD RULES 里 `- kind=position …` 那行**之后**插入进攻图例 + 进攻框架(仅当任一 pack 含进攻 kind 时印,避免死亡-only 场噪音):

```ts
    ...(packs.some((p) => p.items.some((it) =>
      ["target-hp","enemy-defensive","immunity","our-cc","our-cd","off-target","juked-kick","dr-clip"].includes(it.kind)))
      ? [
        `- Offensive items (non-death findings): kind=target-hp = the enemy target's HP (hp) at that moment; kind=enemy-defensive / kind=immunity = what answered ${ownerShort}'s burst on that target (immunity has overlap seconds); kind=our-cc = ${ownerShort}'s team CC landed on the enemy healer; kind=our-cd = ${ownerShort}'s team offensive cooldown; kind=off-target = damage went to the wrong target (onTargetPct); kind=juked-kick = an interrupt spent on a fake cast (fake); kind=dr-clip = a CC landed on wasted DR (dr). You had the kill set up — coach what to change to close it (swap to the exposed target, hold burst past the immunity, lock their healer first), not survival.`,
      ]
      : []),
```

(插入位置:`buildDeepDivePrompt` 的 rules 数组里,`kind=position` 那条与 `If, after reviewing…` 那条之间,用扩展运算符展开。)

`packages/desktop/src/main/ai.ts` —— 把现有那行(当前 `= 11; // v9: HP/短名;v10: 可教信号门 + owner 锚定 + 干净窗口留白;v11: 走位信号(第四类)`)改版本号并**追加** `;v12` 段保留历史:

```ts
export const PROMPT_VERSION = 12; // v9: HP/短名;v10: 可教信号门 + owner 锚定 + 干净窗口留白;v11: 走位信号(第四类);v12: 进攻深挖(非死亡 finding)
```

- [ ] **Step 4: 跑确认通过**

Run: `npx vitest run packages/analysis/src/analysis/deepDive.test.ts`
Expected: PASS。

- [ ] **Step 5: typecheck + commit**

```bash
npm run typecheck
git add packages/analysis/src/analysis/deepDive.ts packages/analysis/src/analysis/deepDive.test.ts packages/desktop/src/main/ai.ts
git commit -m "feat(deepdive): classifyFindingKind 分发 + prompt 进攻图例 + PROMPT_VERSION 12"
```

---

### Task 4: renderer 保底进攻席位

**Files:**

- Modify: `packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.tsx`(deep-dive 触发 effect,行 ~250-289)

**Interfaces:**

- Consumes: `buildDeepDivePack` / `buildOffensiveDeepDivePack` / `hasCoachableSignal` / `hasOffensiveCoachableSignal` / `classifyFindingKind` / `DEEP_DIVE_MAX`(全 `@gladlog/analysis`)。

- [ ] **Step 1: 改 import**(在现有 `import { buildDeepDivePack, DEEP_DIVE_MAX, hasCoachableSignal, SEVERITY_RANK } from "@gladlog/analysis";` 里补三个)

```ts
import {
  buildDeepDivePack,
  buildOffensiveDeepDivePack,
  classifyFindingKind,
  DEEP_DIVE_MAX,
  hasCoachableSignal,
  hasOffensiveCoachableSignal,
  SEVERITY_RANK,
} from "@gladlog/analysis";
```

- [ ] **Step 2: 改选择逻辑**(替换现有 `for (const { f, i } of ranked) { … }` 循环体)

```ts
// 生存席:按严重度取 ≤DEEP_DIVE_MAX 个死亡类过门 pack(原逻辑,只加 survival 分流)
const survivalPacks: DeepDivePack[] = [];
const offensivePacks: DeepDivePack[] = [];
for (const { f, i } of ranked) {
  const kind = classifyFindingKind(f, input.candidates);
  if (kind === "survival") {
    if (survivalPacks.length >= DEEP_DIVE_MAX) continue;
    const pack = buildDeepDivePack(
      legacy,
      f,
      i,
      input.candidates,
      input.ownerName,
    );
    if (pack && hasCoachableSignal(pack.items)) survivalPacks.push(pack);
  } else {
    if (offensivePacks.length >= 1) continue; // OFFENSIVE_DEEP_DIVE_MAX = 1(保底一席)
    const pack = buildOffensiveDeepDivePack(
      legacy,
      f,
      i,
      input.candidates,
      input.ownerName,
    );
    if (pack && hasOffensiveCoachableSignal(pack.items))
      offensivePacks.push(pack);
  }
}
const packs = [...survivalPacks, ...offensivePacks];
```

(注意:`ranked` 已按 severity 排序,故进攻席取到的是最严重的那个过门非死亡 finding。`packs` 变量名沿用后续 `deepen({ packs })` 不变。)

- [ ] **Step 3: 跑 desktop 测试 + typecheck + lint**

```bash
npm test --workspace=packages/desktop && npm run typecheck && npx eslint packages/desktop/src --quiet
```

Expected: 全绿(既有 StructuredAnalysisPanel 相关测试不回归;新逻辑对无非死亡 finding 的场行为不变)。

- [ ] **Step 4: commit**

```bash
git add packages/desktop/src/renderer/src/report/components/StructuredAnalysisPanel.tsx
git commit -m "feat(deepdive): renderer 保底进攻深挖席位(survival≤2 + offensive≤1)"
```

---

### Task 5: 确定性扫描 `deepDiveOffensiveScan.ts`(大样本抓 bug)

**Files:**

- Create: `packages/eval/scripts/deepDiveOffensiveScan.ts`

**Interfaces:**

- Consumes: `extractCandidateFindings` / `buildOffensiveDeepDivePack` / `hasOffensiveCoachableSignal` / `classifyFindingKind` / `isHealerSpec` / `specToString`(`@gladlog/analysis`)。

- [ ] **Step 1: 写扫描脚本**(镜像 `deepDiveScan.ts`,对非死亡候选)

```ts
// 进攻深挖鲁棒性扫描(确定性):对每个非死亡候选跑 buildOffensiveDeepDivePack +
// hasOffensiveCoachableSignal,断言不变量、统计逐类型过门率、抓崩溃/残留数字。不调模型。
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  isHealerSpec,
  buildOffensiveDeepDivePack,
  hasOffensiveCoachableSignal,
  specToString,
  type Finding,
} from "@gladlog/analysis";

const OFFENSIVE = new Set([
  "unconverted-burst",
  "burst-into-immunity",
  "off-target-in-window",
  "juked-kick",
  "dr-clipped-cc",
]);
const NUMERIC_FIELDS = new Set(["t", "hp", "onTargetPct", "dr", "overlap"]);
const hasDigit = /\d/;

const dirs = process.argv.slice(2);
if (dirs.length === 0)
  throw new Error("usage: deepDiveOffensiveScan.ts <dir> [dir2 ...]");
let files: string[] = [];
for (const d of dirs)
  for (const f of readdirSync(d).filter((f) => f.endsWith(".txt")))
    files.push(join(d, f));
files = [...new Map(files.map((f) => [f.split("/").pop(), f])).values()];

let cands = 0,
  packBuilt = 0,
  gated = 0,
  packCrash = 0;
const bugs = { missingRole: 0, factsMismatch: 0, digitInName: [] as string[] };
const byType = new Map<string, { c: number; gated: number }>();
const packSizes: number[] = [];

for (const path of files) {
  const items: GladMatch[] = [];
  try {
    const p = new GladLogParser();
    p.on("match", (m: GladMatch) => items.push(m));
    p.on("shuffle", (sh: { rounds?: GladMatch[] }) => {
      for (const r of sh.rounds ?? []) items.push(r);
    });
    for (const line of readFileSync(path, "utf8").split("\n")) p.push(line);
    p.end();
  } catch {
    continue;
  }
  for (const m of items) {
    let legacy;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    const players = Object.values(legacy.units).filter((u) => u.info);
    const owner =
      players.find(
        (u) =>
          u.id === legacy.playerId &&
          u.reaction === CombatUnitReaction.Friendly,
      ) ??
      players.find(
        (u) =>
          isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
      );
    if (!owner) continue;
    let cs;
    try {
      cs = extractCandidateFindings(legacy, owner.id);
    } catch {
      continue;
    }
    for (const c of cs.filter((c) => OFFENSIVE.has(c.type))) {
      cands++;
      const st = byType.get(c.type) ?? { c: 0, gated: 0 };
      st.c++;
      const finding: Finding = {
        eventIds: [c.id],
        severity: "high",
        category: "offense",
        title: `${c.type}`,
        explanation: "x",
      };
      let pack;
      try {
        pack = buildOffensiveDeepDivePack(legacy, finding, 0, cs, owner.name);
      } catch {
        packCrash++;
        byType.set(c.type, st);
        continue;
      }
      if (pack) {
        packBuilt++;
        packSizes.push(pack.items.length);
        for (const it of pack.items) {
          if (it.facts.role === undefined) bugs.missingRole++;
          for (const [k, v] of Object.entries(it.facts))
            if (!NUMERIC_FIELDS.has(k) && hasDigit.test(v))
              bugs.digitInName.push(`${it.kind}.${k}=${v}`);
        }
        const expected = new Set<string>();
        for (const it of pack.items)
          for (const k of Object.keys(it.facts)) expected.add(`${it.key}.${k}`);
        if (expected.size !== Object.keys(pack.facts).length)
          bugs.factsMismatch++;
        if (hasOffensiveCoachableSignal(pack.items)) {
          gated++;
          st.gated++;
        }
      }
      byType.set(c.type, st);
    }
  }
}
const mean = (a: number[]) =>
  a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) : "0";
console.warn(
  `非死亡候选 ${cands} · 构包 ${packBuilt} · 过门 ${gated}(${packBuilt ? Math.round((100 * gated) / packBuilt) : 0}%) · 每包 mean ${mean(packSizes)} 条`,
);
console.warn(`崩溃:pack ${packCrash}`);
console.warn(
  `role 缺失 ${bugs.missingRole} · facts↔items 不一致 ${bugs.factsMismatch} · 名字残留数字 ${bugs.digitInName.length}`,
);
if (bugs.digitInName.length)
  console.warn(
    `  样例:${[...new Set(bugs.digitInName)].slice(0, 6).join(" · ")}`,
  );
console.warn("── 逐类型 ──");
for (const [t, s] of byType)
  console.warn(
    `  ${t.padEnd(22)} 候选 ${s.c} · 过门 ${s.c ? Math.round((100 * s.gated) / s.c) : 0}%`,
  );
```

- [ ] **Step 2: 跑扫描**(公开语料四目录)

```bash
npx tsx packages/eval/scripts/deepDiveOffensiveScan.ts \
  /Users/mingjianliu/code/gladlog-eval-private/corpus/deepdive-2v2 \
  /Users/mingjianliu/code/gladlog-eval-private/corpus/deepdive-220 \
  /Users/mingjianliu/code/gladlog-eval-private/corpus/deepdive-hi \
  /Users/mingjianliu/code/gladlog-eval-private/corpus/public-dps
```

Expected:`崩溃 pack 0`、`role 缺失 0`、`facts↔items 不一致 0`、`名字残留数字 0`。若非 0,回 Task 2 修(残留数字通常是漏 `sn()` 或数值字段没进 NUMERIC 白名单)。

- [ ] **Step 3: typecheck(eval)+ eslint + commit**

```bash
npm run typecheck --workspace=packages/eval && npx eslint packages/eval/scripts/deepDiveOffensiveScan.ts --quiet
git add packages/eval/scripts/deepDiveOffensiveScan.ts
git commit -m "test(eval): 进攻深挖确定性鲁棒性扫描(逐类型过门率 + 残留数字/崩溃断言)"
```

---

### Task 6: 大规模跨 AI A/B 价值 eval

**Files:**

- Create: `packages/eval/scripts/deepDiveOffensiveValueGen.ts`(镜像 `deepDivePositionValueGen.ts`,桶 = offensive vs survival 对照锚)
- Create: `packages/eval/scripts/deepDiveOffensiveValueAudit.ts`(镜像 `deepDivePositionValueAudit.ts`,从 prompt 回构 pack + auditDeepDives)

**Interfaces:**

- Consumes: 同 Task 5 的 analysis 导出 + `buildDeepDivePack` / `hasCoachableSignal` / `buildDeepDivePrompt` / `auditDeepDives`。

- [ ] **Step 1: 写生成器**(参照 `deepDivePositionValueGen.ts`,两桶:offensive = 非死亡过 `hasOffensiveCoachableSignal`;survival 对照 = 死亡过 `hasCoachableSignal`;各 `WANT_EACH` 个,混合洗牌出盲 prompt + `key.json`)

实现要点(不贴全,结构与 `deepDivePositionValueGen.ts` 一致,只替换构包/门):

- offensive 桶:`buildOffensiveDeepDivePack(legacy, finding{eventIds:[c.id]}, 0, cs, owner.name)` + `hasOffensiveCoachableSignal`,`c` 遍历非死亡候选。
- survival 桶:`buildDeepDivePack(...)` + `hasCoachableSignal`,`c` 遍历死亡候选。
- prompt 均 `buildDeepDivePrompt([pack],[finding],spec,owner.name)`。
- 输出 `prompts/NN.txt` + `key.json`(`{ord,bucket,spec}`),混合洗牌。

- [ ] **Step 2: 写审计器**(参照 `deepDivePositionValueAudit.ts`;从 prompt 回构 pack facts、跑 `auditDeepDives`、出 `judge-input.json` + `unblind.json`)

复用 `deepDivePositionValueAudit.ts` 的 `packFromPrompt` 正则(`key=(\S+) kind=(\S+) facts=\{(.*)\}`),逐 resp 跑 `auditDeepDives`,产出/留白/审计毙分桶统计。

- [ ] **Step 3: 生成盲 prompt**

```bash
OUT=/Users/mingjianliu/code/gladlog-eval-private/deepdive-offensive-value
rm -rf "$OUT"
npx tsx packages/eval/scripts/deepDiveOffensiveValueGen.ts \
  "/Users/mingjianliu/code/gladlog-eval-private/corpus/deepdive-2v2,/Users/mingjianliu/code/gladlog-eval-private/corpus/deepdive-220,/Users/mingjianliu/code/gladlog-eval-private/corpus/deepdive-hi,/Users/mingjianliu/code/gladlog-eval-private/corpus/public-dps" \
  "$OUT" 20
mkdir -p "$OUT/resp"
```

Expected:offensive N ≈ survival N ≈ 20,混合 ~40 prompt。

- [ ] **Step 4: 派 sonnet responder**(subagent,读每 prompt 产 deepDive JSON 到 `resp/NN.json`,干净窗口写 `[]`)—— 手法同走位 eval 的 responder。

- [ ] **Step 5: 审计 + 出盲评包**

```bash
npx tsx packages/eval/scripts/deepDiveOffensiveValueAudit.ts /Users/mingjianliu/code/gladlog-eval-private/deepdive-offensive-value
```

记录逐桶:产出率 / 诚实留白 / 审计毙。

- [ ] **Step 6: 跨 AI 盲评**(复用走位 eval 的 `JUDGE.md`;sonnet subagent → `judge-sonnet.json`,agy gemini → `judge-gemini.json`,输出重定向到文件)。

- [ ] **Step 7: 揭盲比均值**(offensive vs survival 对照,逐 judge + combined;零 filler 硬指标;逐类型)。

**决策规则:** 进攻深挖价值均值落在可行动区(≥3.5)且两 judge 零 ≤2 分 → 上线成立。若某类型系统性偏低/filler → 该类型收紧 `hasOffensiveCoachableSignal`(不做 spec 定制参数)。

- [ ] **Step 8: commit 两个 eval 脚本**

```bash
npm run typecheck --workspace=packages/eval && npx eslint packages/eval/scripts/deepDiveOffensiveValue*.ts --quiet
git add packages/eval/scripts/deepDiveOffensiveValueGen.ts packages/eval/scripts/deepDiveOffensiveValueAudit.ts
git commit -m "test(eval): 进攻深挖大规模跨 AI A/B 价值 eval(offensive vs survival 对照)"
```

---

## 收尾

全部 6 task 后:

- 更新 memory `gladlog-deepdive-value.md`:进攻深挖(非死亡 finding,5 类窗口式)已 landing + A/B 结果。
- 若 A/B 通过 → 报告用户价值数字;若某类型偏弱 → 报告 + 收紧建议。
- 版本仍在 main 未发布(打包 v0.0.12);发布是独立步骤。
