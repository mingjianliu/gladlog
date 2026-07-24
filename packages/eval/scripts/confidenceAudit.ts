/**
 * 候选证据置信度审计(常驻工具,2026-07-24):findings 的数字全是确定性
 * facts,置信度实际取决于各候选类型背后谓词的数据质量。本脚本在全量语料上
 * 量化每类候选关键 facts 的「观测 vs 推断」占比:
 *
 *  - missed-cleanse / missed-purge 的可解性主张:该 debuff/buff 的 spellId
 *    在语料里**真的被任何人驱散/偷取过**吗?(DB2 说 Magic ≠ 实战可解 ——
 *    从未被观测解除、却频繁出现的 id,"你该解掉它" 是低置信主张)
 *  - cc-locked 的 trinketState 分布(available_unused 是推断最重的档)
 *  - kick-eaten:纯硬事件(SPELL_INTERRUPT),天然满置信,作对照锚
 *
 * Usage: npx tsx packages/eval/scripts/confidenceAudit.ts --manifest <file>
 */
import { readFileSync } from "fs";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import {
  toLegacyMatch,
  CombatUnitReaction,
  LogEvent,
} from "@gladlog/parser-compat";
import { extractCandidateFindings, isHealerSpec } from "@gladlog/analysis";

const argv = process.argv.slice(2);
const mIdx = argv.indexOf("--manifest");
if (mIdx < 0) {
  console.error("Usage: confidenceAudit --manifest <file>");
  process.exit(1);
}
const files = readFileSync(argv[mIdx + 1]!, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

// 语料观测:被驱散/偷取过的 spellId → 次数(任意一方、任意对局)
const dispelledIds = new Map<string, number>();
// 候选引用:type → spellId → { 候选数, 场次样本 }
const cleanseCands = new Map<string, { n: number; name: string }>();
const purgeCands = new Map<string, { n: number; name: string }>();
const trinketStates = new Map<string, number>();
let matches = 0;
let kickEaten = 0;
let ccLocked = 0;
const ccLockedDur: number[] = [];

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of readFileSync(f, "utf8").split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    try {
      const legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
      const units = Object.values(legacy.units);
      // 观测面:全场所有 SPELL_DISPEL / SPELL_STOLEN 的被除 id
      for (const u of units)
        for (const a of u.actionOut ?? []) {
          const ev = a.logLine?.event;
          if (ev !== LogEvent.SPELL_DISPEL && ev !== LogEvent.SPELL_STOLEN)
            continue;
          const removed = (a as { extraSpellId?: string }).extraSpellId;
          if (removed)
            dispelledIds.set(removed, (dispelledIds.get(removed) ?? 0) + 1);
        }

      const players = units.filter((u) => u.info);
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
      matches++;
      for (const c of extractCandidateFindings(legacy, owner.id)) {
        if (c.type === "missed-cleanse" && c.spellId) {
          const e = cleanseCands.get(c.spellId) ?? {
            n: 0,
            name: c.spell ?? "",
          };
          e.n++;
          cleanseCands.set(c.spellId, e);
        } else if (c.type === "missed-purge" && c.spellId) {
          const e = purgeCands.get(c.spellId) ?? { n: 0, name: c.spell ?? "" };
          e.n++;
          purgeCands.set(c.spellId, e);
        } else if (c.type === "cc-locked") {
          ccLocked++;
          const st = c.facts.trinketState ?? "?";
          trinketStates.set(st, (trinketStates.get(st) ?? 0) + 1);
          ccLockedDur.push(Number(c.facts.duration));
        } else if (c.type === "kick-eaten") kickEaten++;
      }
    } catch {
      /* 坏场跳过 */
    }
  }
}

function reportSide(
  label: string,
  cands: Map<string, { n: number; name: string }>,
) {
  const total = [...cands.values()].reduce((s, e) => s + e.n, 0);
  const verified = [...cands.entries()].filter(([id]) => dispelledIds.has(id));
  const unverified = [...cands.entries()].filter(
    ([id]) => !dispelledIds.has(id),
  );
  const vN = verified.reduce((s, [, e]) => s + e.n, 0);
  console.log(
    `\n${label}: 候选 ${total} 条 / ${cands.size} 个 id;` +
      `语料实证可解 ${vN} 条(${((100 * vN) / Math.max(1, total)).toFixed(0)}%)`,
  );
  console.log(`  从未被观测解除的 id(低置信,按候选数排):`);
  for (const [id, e] of unverified.sort((a, b) => b[1].n - a[1].n).slice(0, 12))
    console.log(`    ${id} ${e.name} ×${e.n}`);
  console.log(`  实证 top:`);
  for (const [id, e] of verified.sort((a, b) => b[1].n - a[1].n).slice(0, 6))
    console.log(
      `    ${id} ${e.name} ×${e.n}(语料被解 ${dispelledIds.get(id)} 次)`,
    );
}

// --emit-table:把观测集写成 analysis 的生成数据文件(update-wow-data 流程)
const eIdx = argv.indexOf("--emit-table");
if (eIdx >= 0) {
  const rows = [...dispelledIds.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `  "${id}", // ×${n}`)
    .join("\n");
  const body = `/**
 * 语料实证可解 id 集(生成文件,勿手编):在全量语料里被 SPELL_DISPEL /
 * SPELL_STOLEN 真实解除过的 spellId。missed-cleanse / missed-purge 候选的
 * 可解性主张以此为门 —— DB2 的 dispelType 是"理论可解",这里是"实战有人
 * 解过"。从未被观测解除的 id(如 Paralysis/Intimidating Shout/Blessing of
 * Sacrifice)不出候选:"你该解掉它"在语料层站不住。
 *
 * 重新生成:npx tsx packages/eval/scripts/confidenceAudit.ts \\
 *   --manifest $GLADLOG_EVAL_HOME/corpus/manifest-fullscale.txt --emit-table \\
 *   > packages/analysis/src/data/dispelObservedGenerated.ts
 * 语料快照:${matches} 场,${dispelledIds.size} 个 id(2026-07-24)。
 */
export const CORPUS_OBSERVED_DISPEL_IDS: ReadonlySet<string> = new Set([
${rows}
]);
`;
  process.stdout.write(body);
  process.exit(0);
}

console.log(
  `matches=${matches};语料观测到被驱散/偷取的不同 spellId:${dispelledIds.size}`,
);
reportSide("missed-cleanse(可解性主张)", cleanseCands);
reportSide("missed-purge(可 purge 主张)", purgeCands);
console.log(`\ncc-locked: ${ccLocked} 条;trinketState 分布:`);
for (const [st, n] of [...trinketStates.entries()].sort((a, b) => b[1] - a[1]))
  console.log(
    `  ${st}: ${n}(${((100 * n) / Math.max(1, ccLocked)).toFixed(0)}%)`,
  );
ccLockedDur.sort((a, b) => a - b);
console.log(
  `  duration p50=${ccLockedDur[Math.floor(ccLockedDur.length / 2)] ?? "-"}s max=${ccLockedDur[ccLockedDur.length - 1] ?? "-"}s(APPLIED→REMOVED 观测对)`,
);
console.log(`kick-eaten: ${kickEaten} 条(SPELL_INTERRUPT 硬事件,满置信锚)`);
