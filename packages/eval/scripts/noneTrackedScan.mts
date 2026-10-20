/* 白名单腐烂检查(update-wow-data 步骤 7 口径)——对一个 fetchPvpLogs 下载目录
 * 逐场构建 match context,按专精统计 <cooldowns> 块 none-tracked 率 + [DR: spell:
 * 回退渲染计数。看分母:小样本只报极端异常,结论性检查要攒够语料。
 * 用法:DOWNLOADS_DIR=<dir> npx tsx packages/eval/scripts/noneTrackedScan.mts
 * 首跑 2026-08-12(12.1 开服首日,30 场):22 专精 179 块全 0%、DR 回退 0。 */
import { buildMatchContext, ensureAnalysisData } from "@gladlog/analysis";
import { readFileSync } from "fs";
import { join } from "path";

import { parseLogCombats } from "../src/corpus/candidateMenu";

const DIR =
  process.env.DOWNLOADS_DIR ??
  `${process.env.HOME}/code/gladlog-eval-private/downloads/3v3-rall-allspecs`;
const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
const entries: { fileName: string }[] = Array.isArray(manifest)
  ? manifest
  : Object.values(manifest);

await ensureAnalysisData();

const total = new Map<string, number>();
const none = new Map<string, number>();
const bump = (m: Map<string, number>, k: string) =>
  m.set(k, (m.get(k) ?? 0) + 1);
const drFallback = new Map<string, number>();

for (const e of entries) {
  let combats;
  try {
    combats = parseLogCombats(readFileSync(join(DIR, e.fileName), "utf8"));
  } catch {
    continue;
  }
  for (const { legacy } of combats) {
    const units = Object.values(legacy.units) as any[];
    const players = units.filter((u) => u.info);
    const friends = players.filter((u) => u.reaction === 1);
    const enemies = players.filter((u) => u.reaction === 2);
    if (!friends.length || !enemies.length) continue;
    let ctx: string;
    try {
      ctx = buildMatchContext(legacy as never, friends, enemies, {
      });
    } catch (err) {
      console.error("context error:", (err as Error).message?.slice(0, 100));
      continue;
    }
    for (const m of ctx.matchAll(/\[DR: (spell:\d+)/g)) bump(drFallback, m[1]);
    const lines = ctx.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes("<cooldowns>")) continue;
      let spec = "?";
      for (let j = i; j >= Math.max(0, i - 6); j--) {
        const m = lines[j].match(/spec="([^"]+)"/);
        if (m) {
          spec = m[1];
          break;
        }
      }
      bump(total, spec);
      if (lines[i].includes("<cooldowns>none tracked")) bump(none, spec);
    }
  }
}

const rows = [...total.entries()]
  .map(([spec, t]) => ({ spec, t, n: none.get(spec) ?? 0 }))
  .sort((a, b) => b.n / b.t - a.n / a.t);
console.log(
  `DR fallback renders ([DR: spell:<id>]): ${[...drFallback.entries()].map(([k, v]) => `${k}×${v}`).join(", ") || "none"}`,
);
console.log("spec | none-tracked / total | rate");
for (const r of rows)
  console.log(`${r.spec} | ${r.n}/${r.t} | ${((100 * r.n) / r.t).toFixed(0)}%`);
