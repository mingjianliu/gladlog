/* eslint-disable no-console */
/**
 * CLI: 白名单腐烂语料实证扫描(update-wow-data step 7 的挖矿工具)。
 *
 * 对野生语料原始日志做纯文本扫描,找"人群在用、但 SPELL_CATEGORIES 不认识"
 * 的高频法术 —— 新赛季技能重做/换 id 后策展白名单会静默失效,分析端对这类
 * 事件整体失明(manifest 与 prompt 同时漏,覆盖门抓不到,只能靠人群实证)。
 *
 * 三类事件:
 *   SPELL_AURA_APPLIED (DEBUFF, 玩家→玩家) —— 候选 CC/roots/disarms 缺口
 *   SPELL_INTERRUPT                        —— 候选 interrupts 缺口
 *   SPELL_DISPEL (施放法术侧)              —— 候选驱散法术缺口
 * 已在 SPELL_CATEGORIES(任意类型)的 id 视为已归类,不报。
 * 输出按"出现过的对局数"排序 —— 单场刷屏的 DoT 噪声天然沉底。
 *
 * Usage: tsx packages/eval/scripts/rotScan.ts --dir <logDir> [--top 60]
 */

import fs from "fs-extra";
import path from "path";

import { SPELL_CATEGORIES, getEnglishSpellName } from "@gladlog/analysis";

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { dir: "", top: 60 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--dir") out.dir = a[i + 1];
    else if (a[i] === "--top") out.top = Number(a[i + 1]);
  }
  if (!out.dir) {
    console.error("Usage: rotScan --dir <logDir> [--top N]");
    process.exit(1);
  }
  return out;
}

interface Tally {
  count: number;
  matches: Set<string>;
  name: string;
}

/** 引号感知的 CSV 拆分(法术名/单位名可含逗号的防御;绝大多数行走快路径)。 */
function splitCsv(s: string): string[] {
  if (!s.includes('"')) return s.split(",");
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of s) {
    if (ch === '"') inQ = !inQ;
    else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function main() {
  const { dir, top } = parseArgs();
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".txt"));
  const auras = new Map<string, Tally>();
  const kicks = new Map<string, Tally>();
  const dispels = new Map<string, Tally>();

  const bump = (m: Map<string, Tally>, id: string, name: string, f: string) => {
    const t = m.get(id) ?? { count: 0, matches: new Set<string>(), name };
    t.count++;
    t.matches.add(f);
    m.set(id, t);
  };

  let done = 0;
  for (const f of files) {
    const text = await fs.readFile(path.join(dir, f), "utf-8");
    for (const line of text.split("\n")) {
      // 快速预筛:三类事件之外的行直接跳过
      let ev: "aura" | "kick" | "dispel";
      if (line.includes("SPELL_AURA_APPLIED,")) ev = "aura";
      else if (line.includes("SPELL_INTERRUPT,")) ev = "kick";
      else if (line.includes("SPELL_DISPEL,")) ev = "dispel";
      else continue;

      const comma = line.indexOf(",");
      const body = line.slice(comma + 1); // src 起始的 CSV 体
      const fields = splitCsv(body);
      if (fields.length < 10) continue;
      const [srcGuid, srcName, , , dstGuid] = fields;
      const spellId = fields[8];
      const spellName = (fields[9] ?? "").replace(/^"|"$/g, "");
      if (!/^\d+$/.test(spellId)) continue;
      if (SPELL_CATEGORIES[spellId]) continue; // 已归类

      if (ev === "aura") {
        // 只看玩家/玩家宠物 → 玩家 的 DEBUFF:CC 候选集
        if (!dstGuid?.startsWith("Player-")) continue;
        if (!srcGuid?.startsWith("Player-") && !srcGuid?.startsWith("Pet-"))
          continue;
        if (fields[fields.length - 1]?.trim() !== "DEBUFF") continue;
        bump(auras, spellId, spellName, f);
      } else if (ev === "kick") {
        bump(kicks, spellId, spellName, f);
      } else {
        bump(dispels, spellId, spellName, f);
      }
    }
    done++;
    if (done % 200 === 0) console.log(`scan: ${done}/${files.length}`);
  }

  const report = (label: string, m: Map<string, Tally>, n: number) => {
    console.log(`\n===== ${label}(不在 SPELL_CATEGORIES;按对局数排序)=====`);
    const rows = [...m.entries()].sort(
      (a, b) => b[1].matches.size - a[1].matches.size,
    );
    for (const [id, t] of rows.slice(0, n)) {
      const en = getEnglishSpellName(id) || t.name;
      console.log(
        `${String(t.matches.size).padStart(5)} 场  ${String(t.count).padStart(6)} 次  ${id.padStart(7)}  ${en}`,
      );
    }
    console.log(`(共 ${rows.length} 个未归类 id)`);
  };

  console.log(`\nfiles=${files.length}`);
  report("DEBUFF 玩家→玩家(CC/roots/disarms 候选)", auras, top);
  report("SPELL_INTERRUPT 踢技能(interrupts 候选)", kicks, 20);
  report("SPELL_DISPEL 驱散法术(dispel 候选)", dispels, 20);
}

void main();
