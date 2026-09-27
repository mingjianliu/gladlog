/**
 * talentCoverageDoc.ts — writes docs/talent-coverage-gaps.md: every talent
 * effect the audit found that the product's logic does NOT carry, with the
 * evidence and what a fix would need, so the next person debugging a
 * talent-shaped coaching error starts from the list instead of from scratch.
 *
 * User 2026-09-27: 「把没按进逻辑的问题至少document下来 之后可以不用从头debug」.
 *
 * Inputs (eval-private, talent impact audit; regenerate them first when the
 * game build or the code moves):
 *   <audit>/structured.json   talentImpactAudit.ts --out <audit>     (DB2 rows × consumers)
 *   <audit>/joined.json       talentClaimsJoin.ts --out <audit>      (tooltip reading × code)
 *   <audit>/mechanismAudit.json + mechanism-queue.json               (per-item code verdicts)
 *   <audit>/impossible.final.json(l)  ledgerImpossibleCastScan.ts    (corpus forward check)
 *   <audit>/mitigation-scan.txt       mitigationTalentScan.ts output
 *   reports/talent-integration-2026-09-13/durationTalent.*.json      (duration corpus split)
 * Coverage is re-derived from the CURRENT code tables (imports below), not
 * trusted from the inputs: an effect counts as carried when a product table
 * names the (talent, spell) pair.
 *
 * Usage: npx tsx packages/eval/scripts/talentCoverageDoc.ts [--audit <dir>]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import CONDITIONAL from "@gladlog/analysis/src/data/conditionalCooldownsGenerated.json";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import {
  BUFF_DURATION_TALENT_MODIFIERS,
  CC_DURATION_TALENT_MODIFIERS,
} from "@gladlog/analysis/src/data/spellEffectData";
import { TALENT_MITIGATION_MODIFIERS } from "@gladlog/analysis/src/data/talentMitigationModifiers";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  FREE_RECAST_WINDOWS,
} from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import {
  CD_TALENT_MODIFIERS,
  PER_RANK_COOLDOWN_TALENTS,
  RULED_COOLDOWN_VALUES,
} from "@gladlog/analysis/src/utils/talentModifiers";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const HOME =
  process.env.GLADLOG_EVAL_HOME ??
  join(process.env.HOME ?? "", "code/gladlog-eval-private");
const AUDIT = arg(
  "--audit",
  join(HOME, "reports/talent-impact-audit-2026-09-27-postfix"),
);
const OUT = resolve("docs/talent-coverage-gaps.md");
const DATA = resolve("packages/analysis/src/data");
const read = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

/**
 * Mechanism-audit items (mechanismAudit.json `n`) resolved since the audit
 * ran, with how. Everything else with a GAP / UNCLEAR verdict is open.
 */
const MECHANISM_RESOLVED: Record<number, string> = {
  143: "已修 18b648ea(驱散类型按天赋判断)",
  161: "已修 18b648ea(危机应对认控制施法 id)",
  165: "已修 18b648ea(驱散类型按天赋判断)",
  172: "已修 18b648ea(驱散类型按天赋判断)",
  188: "已修 18b648ea(复仇者之盾移出打断套件)",
  204: "已修 18b648ea(驱散类型按天赋判断)",
  244: "已修 18b648ea(打断优先级认免疫打断光环)",
  250: "已修 18b648ea(驱散类型按天赋判断)",
  291: "已修 18b648ea(剑刃风暴施法锁定)",
  292: "已修 18b648ea(剑刃风暴施法锁定)",
  151: "不做 —— 用户 2026-09-26「碎玉闪电击退有点太tricky了」",
  260: "不做 —— 用户 2026-09-26「地震的击倒我怎么没见过 好像没人用」",
  261: "不做 —— 同 #260",
  232: "待裁 —— 用户 2026-09-26「打进去 尤其是给晕 等于白打 我觉得先不裁定 有点复杂」",
  233: "待裁 —— 同 #232",
};

interface Unit {
  talent: string;
  talentName: string;
  className: string;
  hop: number;
  carrier: string;
  carrierName: string;
  activation: string;
  kind: string;
  opName?: string;
  pvpValue: number;
  target: string;
  targetName: string;
  via: string;
  targetTables: string[];
  targetObserved: boolean;
  pickRate: number | null;
  status: string;
  reason?: string;
}
interface Joined {
  talent: string;
  talentZh: string;
  talentEn: string;
  className: string;
  pick: number | null;
  effect: {
    target?: string;
    kind?: string;
    change?: string;
    value?: string | null;
    condition?: string;
    coachFact?: string;
  };
  ids: string[];
  tables: string[];
  status: string;
}

const pct = (p: number | null | undefined) =>
  p == null ? "?" : `${Math.round(p * 100)}%`;
const cell = (s: unknown) =>
  String(s ?? "")
    .replace(/\|/g, "／")
    .replace(/\s+/g, " ")
    .trim();

async function main(): Promise<void> {
  await ensureAnalysisData();
  const zh = read<Record<string, string>>(
    join(DATA, "spellNamesZhGenerated.json"),
  );
  const en = read<Record<string, string>>(join(DATA, "spellNames.json"));
  const nm = (id: string) =>
    `${zh[id] ?? ""}${zh[id] && en[id] ? " / " : ""}${en[id] ?? ""} (${id})`;
  const structured = read<{ build: string; units: Unit[] }>(
    join(AUDIT, "structured.json"),
  );
  const joined = read<Joined[]>(join(AUDIT, "joined.json"));
  const mech = read<
    Array<{ n: number; verdict: string; evidence: string; consequence: string }>
  >(join(AUDIT, "mechanismAudit.json"));
  const queue = read<
    Array<{
      n: number;
      talent: string;
      talentName: string;
      class: string;
      pick: number | null;
      kind: string;
      target: string;
      change: string;
    }>
  >(join(AUDIT, "mechanism-queue.json"));
  const impossible = read<{
    files: number;
    totalCasts: number;
    totalImpossible: number;
    spells: Array<{
      id: string;
      name: string;
      casts: number;
      impossible: number;
      floorExplained: number;
      cooldowns: Record<string, number>;
      specs: Record<string, number>;
    }>;
  }>(join(AUDIT, "impossible.final.json"));
  const floors = read<{ floors: Record<string, unknown> }>(
    join(DATA, "cdRecastFloorGenerated.json"),
  ).floors;
  const floorSpells = new Set(Object.keys(floors).map((k) => k.split("|")[0]!));
  const durationScan = new Map<
    string,
    { verdict: string; holders: number; non: number }
  >();
  for (const f of [
    "durationTalent.full-2026-09-14.json",
    "durationTalent.cc-every3.json",
    "durationTalent.inventory-2026-09-22.json",
  ])
    try {
      for (const r of read<{
        rows: Array<{
          talent: string;
          target: string;
          verdict: string;
          holders: { cells: number };
          nonHolders: { cells: number };
        }>;
      }>(join(HOME, "reports/talent-integration-2026-09-13", f)).rows)
        durationScan.set(`${r.talent}|${r.target}`, {
          verdict: r.verdict,
          holders: r.holders.cells,
          non: r.nonHolders.cells,
        });
    } catch {
      /* optional input */
    }

  // current-code coverage
  const conditional = (
    CONDITIONAL as { byTarget: Record<string, Array<{ carrier: string }>> }
  ).byTarget;
  const cdCarried = (target: string, talent: string) =>
    (CD_TALENT_MODIFIERS[target] ?? []).some((m) => m.talentSpellId === talent);
  const scriptedCarried = (talent: string, ids: string[]) =>
    (FREE_RECAST_WINDOWS[talent] &&
      ids.includes(FREE_RECAST_WINDOWS[talent]!.spellId)) ||
    (EVENT_COOLDOWN_REDUCTIONS[talent] &&
      ids.some((i) => EVENT_COOLDOWN_REDUCTIONS[talent]!.targets.includes(i)));
  const durationCarried = (target: string, talent: string) =>
    [
      ...(BUFF_DURATION_TALENT_MODIFIERS[target] ?? []),
      ...(CC_DURATION_TALENT_MODIFIERS[target] ?? []),
    ].some((m) => m.talentSpellId === talent);
  const mitigationCarried = (aura: string, talent: string) =>
    TALENT_MITIGATION_MODIFIERS.some(
      (m) => m.auraSpellId === aura && m.talentSpellId === talent,
    );
  const impossibleBySpell = new Map(impossible.spells.map((s) => [s.id, s]));
  const relevant = (p: number | null) => (p ?? 1) >= 0.05;

  const L: string[] = [];
  const h = (s: string) => L.push("", s, "");
  L.push(
    "# 天赋覆盖缺口",
    "",
    "> 由 `packages/eval/scripts/talentCoverageDoc.ts` 生成,**不要手改**;改完代码或换赛季后按文末「重跑」一节重新生成。",
    "",
    `DB2 build ${structured.build}。这份清单回答一个问题:**哪些天赋效果产品的逻辑没接住**。遇到「教练说技能好了但其实没好」「说能驱散但其实不能」这类现象,先在这里按天赋名或技能名搜;每条都写了证据和修它需要什么。已经接住的效果不在这里(见 \`docs/predicate-index.md\` 与各手工表)。`,
    "",
    "判断「接住」的口径是**当前代码里的表**:冷却 / 充能看 `CD_TALENT_MODIFIERS`、`PER_RANK_COOLDOWN_TALENTS`、`RULED_COOLDOWN_VALUES`、`talentScriptedCooldowns.ts`、`conditionalCooldownsGenerated.json`、最早可用下限 `cdRecastFloorGenerated.json`;持续看 `BUFF_DURATION_TALENT_MODIFIERS` / `CC_DURATION_TALENT_MODIFIERS`;减伤看 `TALENT_MITIGATION_MODIFIERS`;机制类看逐条代码核对(`mechanismAudit.json`)。",
  );

  // ---- 1. corpus: what still misfires
  h("## 1. 语料里仍然会误判的冷却(按「不可能施放」数排序)");
  L.push(
    `\`ledgerImpossibleCastScan.ts\`:${impossible.files} 场、${impossible.totalCasts.toLocaleString()} 次施放里,产品认为「还在冷却」但玩家按出来了的 **${impossible.totalImpossible}** 次(修复前 752)。每一行都是一个没被模型解释的冷却来源;「下限兜住」是被最早可用下限归为「可能已好」的次数(不算误判)。`,
    "",
    "| 技能 | 施放 | 不可能施放 | 下限兜住 | 模型冷却 | 阅读到的相关天赋(未接) |",
    "|---|---|---|---|---|---|",
  );
  const claimsBySpell = new Map<string, Joined[]>();
  for (const j of joined)
    for (const i of j.ids)
      (claimsBySpell.get(i) ?? claimsBySpell.set(i, []).get(i)!).push(j);
  for (const s of impossible.spells
    .filter((x) => x.impossible > 0)
    .slice(0, 40)) {
    const related = (claimsBySpell.get(s.id) ?? [])
      .filter((j) => /^cooldown|^charges/.test(j.effect.kind ?? ""))
      .filter(
        (j) => !cdCarried(s.id, j.talent) && !scriptedCarried(j.talent, j.ids),
      )
      .map(
        (j) =>
          `${j.talentZh}(${j.effect.kind}${j.effect.value ? " " + j.effect.value : ""}${j.effect.condition && j.effect.condition !== "always" ? ";" + j.effect.condition : ""})`,
      );
    L.push(
      `| ${cell(nm(s.id))} | ${s.casts} | ${s.impossible} | ${s.floorExplained} | ${cell(Object.keys(s.cooldowns).slice(0, 3).join(" "))} | ${cell([...new Set(related)].slice(0, 4).join(";") || "—")} |`,
    );
  }

  // ---- 2. cooldown effects read but not in the model
  h("## 2. 读到了、但冷却模型里没有的冷却效果");
  L.push(
    "逐条阅读(工具提示)里的按事件减 CD / 重置 / 恢复速率 / 静态改冷却 / 加充能,目标技能被产品某张表点名、天赋选取率 ≥ 5%。「兜底」列:下限表里有这个技能 = 动态缩短已被「可能已好」吸收,只是不精确;空 = 模型完全不知道。",
    "",
    "| 职业 | 天赋 | 选取率 | 类型 | 目标 → id | 效果 | 条件 | 兜底 | 语料不可能施放 |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  const seenCd = new Set<string>();
  for (const j of joined
    .filter((x) =>
      [
        "cooldownOnEvent",
        "cooldownReset",
        "cooldownRate",
        "cooldownFlat",
        "cooldownPct",
        "charges",
      ].includes(x.effect.kind ?? ""),
    )
    .filter((x) => x.tables.length && relevant(x.pick))
    .sort((a, b) => (b.pick ?? 0) - (a.pick ?? 0))) {
    const ids = j.ids;
    if (ids.some((i) => cdCarried(i, j.talent))) continue;
    if (scriptedCarried(j.talent, ids)) continue;
    if (
      PER_RANK_COOLDOWN_TALENTS.has(j.talent) ||
      RULED_COOLDOWN_VALUES[j.talent]
    )
      continue;
    if (
      ids.some((i) =>
        (conditional[i] ?? []).some((m) => m.carrier === j.talent),
      )
    )
      continue;
    const key = `${j.talent}|${j.effect.target}|${j.effect.kind}`;
    if (seenCd.has(key)) continue;
    seenCd.add(key);
    const imp = ids.map((i) => impossibleBySpell.get(i)).find((x) => x);
    L.push(
      `| ${cell(j.className)} | ${cell(`${j.talentZh} / ${j.talentEn} (${j.talent})`)} | ${pct(j.pick)} | ${j.effect.kind} | ${cell(j.effect.target)} → ${cell(ids.slice(0, 3).join(","))} | ${cell(j.effect.change)} ${cell(j.effect.value ?? "")} | ${cell(j.effect.condition === "always" ? "" : j.effect.condition)} | ${ids.some((i) => floorSpells.has(i)) ? "下限" : ""} | ${imp ? `${imp.impossible}/${imp.casts}` : "不在台账"} |`,
    );
  }

  // ---- 3. buff-conditional DB2 rows
  h("## 3. 只在 buff 期间生效、而模型没收的冷却行(DB2)");
  L.push(
    "`genConditionalCooldowns.ts` 只收目标在冷却台账里、且能归为「恢复速率」或「单层施放快照」的行;下面是剩下的(目标不在台账,或是充能技能上的快照型修改 —— 后者按设计不收,见该脚本头注释)。",
    "",
    "| 携带 buff | 目标 | 修改 | 状态 |",
    "|---|---|---|---|",
  );
  const seenCond = new Set<string>();
  for (const u of structured.units.filter(
    (x) =>
      (x.kind === "cooldown" || x.kind === "charges") &&
      x.status === "conditional",
  )) {
    const k = `${u.carrier}|${u.target}|${u.opName}|${u.pvpValue}`;
    if (seenCond.has(k)) continue;
    seenCond.add(k);
    const carried = (conditional[u.target] ?? []).some(
      (m) => m.carrier === u.carrier,
    );
    if (carried) continue;
    L.push(
      `| ${cell(nm(u.carrier))} | ${cell(u.target === "(unresolved)" ? "(无追踪目标)" : nm(u.target))} | ${u.kind}${u.opName ? "/" + u.opName : ""} ${u.pvpValue} | ${impossibleBySpell.has(u.target) ? "目标在台账,未收(充能快照或速率外编码)" : "目标不在冷却台账"} |`,
    );
  }

  // ---- 4. duration
  h("## 4. 持续时间修改(DB2 行,没进持续表)");
  L.push(
    "只影响「日志缺 REMOVED 时按模型时长回退」的光环区间(约 11% 的光环应用没有 REMOVED)。扫描 = `durationTalentScan.ts` 的判定;**「0 持有者」多半是施法 id 与光环 id 对不上,不是被否决** —— 修法是补光环别名后重扫。",
    "",
    "| 天赋 | 选取率 | 目标 | 修改 | 扫描判定 | 持有者 / 非持有者样本 |",
    "|---|---|---|---|---|---|",
  );
  const seenDur = new Set<string>();
  for (const u of structured.units
    .filter((x) => x.kind === "duration" && x.status === "gap")
    .filter(
      (x) => x.targetTables.length && x.targetObserved && relevant(x.pickRate),
    )
    .sort((a, b) => (b.pickRate ?? 0) - (a.pickRate ?? 0))) {
    if (durationCarried(u.target, u.talent)) continue;
    const k = `${u.talent}|${u.target}`;
    if (seenDur.has(k)) continue;
    seenDur.add(k);
    const sc = durationScan.get(k);
    L.push(
      `| ${cell(u.talentName)} (${u.talent}) | ${pct(u.pickRate)} | ${cell(nm(u.target))} | ${u.pvpValue} | ${cell(sc?.verdict ?? "未扫")} | ${sc ? `${sc.holders} / ${sc.non}` : "—"} |`,
    );
  }

  // ---- 5. mitigation
  h("## 5. 减伤数值");
  L.push(
    "DB2 在减伤光环的「减伤那一项」上的修改,以及 `mitigationTalentScan.ts` 的语料结果(预期 = 持有者承伤比)。「在带内」才会被提升进 `TALENT_MITIGATION_MODIFIERS`。",
    "",
    "| 光环 | 天赋 | DB2 修改 | 状态 |",
    "|---|---|---|---|",
  );
  for (const u of structured.units.filter(
    (x) => x.kind === "value" && x.status === "gap" && relevant(x.pickRate),
  )) {
    if (mitigationCarried(u.target, u.talent)) continue;
    L.push(
      `| ${cell(nm(u.target))} | ${cell(u.talentName)} (${u.talent}) | ${u.opName} ${u.pvpValue} | 未接(多数改的不是减伤那一项:受疗 / 移速 / 耐力;逐条见 structured.json) |`,
    );
  }
  L.push("", "语料扫描(新赛季归档每 10 场,2026-09-26):", "", "```");
  for (const line of readFileSync(
    join(AUDIT, "mitigation-scan.txt"),
    "utf8",
  ).split("\n"))
    if (/stay unvalidated/.test(line))
      L.push(line.replace(/\s+/g, " ").slice(0, 240));
  L.push("```");

  // ---- 6. mechanisms
  const open = mech.filter(
    (m) => !["MODELLED", "NOT-MODELLED-HARMLESS"].includes(m.verdict),
  );
  h("## 6. 机制类(控制中可用、驱散、打断、触发、额外效果……)");
  const counts: Record<string, number> = {};
  for (const m of mech) counts[m.verdict] = (counts[m.verdict] ?? 0) + 1;
  L.push(
    `297 条与教练判断相关、选取率 ≥ 5% 的机制效果逐条对到代码(2026-09-26,agy 核对前 15 条 CONFIRMED):${Object.entries(
      counts,
    )
      .map(([k, v]) => `${k} ${v}`)
      .join(
        "、",
      )}。下面是有缺口 / 待查的,带当前处理状态;\`NOT-MODELLED-HARMLESS\`(没建模、但没有任何判断依赖它)的 187 条见 \`mechanismAudit.json\`。`,
    "",
    "| # | 天赋 | 目标 | 判定 | 会怎样错 | 处理 |",
    "|---|---|---|---|---|---|",
  );
  for (const m of open) {
    const q = queue[m.n]!;
    L.push(
      `| ${m.n} | ${cell(q.talentName)} (${q.talent}) | ${cell(q.target)} | ${m.verdict} | ${cell(m.consequence).slice(0, 220)} | ${cell(MECHANISM_RESOLVED[m.n] ?? "**未修**")} |`,
    );
  }

  // ---- 7. no consumer at all
  h("## 7. 产品没有消费方的修改类型");
  const noCons: Record<string, number> = {};
  for (const u of structured.units)
    if (u.status === "noConsumer") {
      const k = `${u.kind}${u.opName ? "/" + u.opName : ""}`;
      noCons[k] = (noCons[k] ?? 0) + 1;
    }
  L.push(
    "这些修改 DB2 里有,但产品没有任何地方预测对应的量,所以谈不上「读错」;一旦有新功能开始预测它们(比如按施法时间判断能不能读完),要先回来接。",
    "",
    ...Object.entries(noCons)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `- ${k}:${v} 行`),
    "",
    "射程 / 半径的缺口(`spellReachGenerated` 没收)大多命中的是没有射程的自身技能;实质的只有滚石 → 震荡波半径 +6 码、星界支配 → 台风半径 +5 码。",
  );

  // ---- 8. rulings + how to rerun
  h("## 8. 裁决与待办");
  L.push(
    "- 静电充能 265046:每级 −10 秒(用户 2026-09-26「嗯 改成10」,语料 55 / 45.0 / 35.0 秒),`RULED_COOLDOWN_VALUES`。",
    "- 圣光决断 146956:自律期间可开圣盾(用户确认;语料持有者 90 / 1,100 次圣盾在自律中,非持有者 0 / 93)。",
    "- 正义召唤 → 复仇十字军(模型 30 秒,语料地板 45 秒):BACKLOG §62,用户自查。",
    "- 闪避 / 佯攻 + 飘忽不定 20%:语料确凿,待减伤裁定(BACKLOG §63)。",
    "- 碎玉闪电击退算控制应对、地震击倒:用户裁不做。",
    "- 参照表过期(未逐次重跑,GH #115):`behaviorPriorGenerated`、打断优先级参照、爆发 / 同步窗口参照。",
  );
  h("## 重跑");
  L.push(
    "```bash",
    "# 1. 天赋总表(新 build 时)",
    "DATAGEN_BUILD=<build> TALENT_CATALOG_OUT=$GLADLOG_EVAL_HOME/reports/<dir>/catalog npx tsx packages/eval/scripts/talentCatalog.ts",
    "# 2. 结构化对账 + 阅读结论合并(阅读用 method/READER.md 分包派子代理,产出 <dir>/claims/*.jsonl)",
    "npx tsx packages/eval/scripts/talentImpactAudit.ts --out $GLADLOG_EVAL_HOME/reports/<dir>",
    "npx tsx packages/eval/scripts/talentClaimsJoin.ts --out $GLADLOG_EVAL_HOME/reports/<dir>",
    "# 3. 语料前向检查(一次只跑一个全库扫描)",
    "npx tsx packages/eval/scripts/ledgerImpossibleCastScan.ts --manifest <manifest> --every 10 --out <dir>/impossible.final.jsonl > <dir>/impossible.final.json",
    "# 4. 本文档",
    "npx tsx packages/eval/scripts/talentCoverageDoc.ts --audit $GLADLOG_EVAL_HOME/reports/<dir>",
    "```",
    "",
    "产物(私有仓):`reports/talent-impact-audit-2026-09-26/`(修复前快照,含阅读方法与校准)、`reports/talent-impact-audit-2026-09-27-postfix/`(本文档的输入)、`runs/talent-impact-fixes-2026-09-26/`(验收采集)。",
    "",
  );
  writeFileSync(OUT, L.join("\n"));
  // repo formatting, so a regenerated file diffs only where content moved
  execFileSync("npx", ["prettier", "--write", OUT], { stdio: "ignore" });
  console.log(`wrote ${OUT} (${L.length} lines)`);
}

void main();
