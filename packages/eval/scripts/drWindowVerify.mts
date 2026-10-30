/* DR 重置窗口实证(BACKLOG #24-1 判据;12.1 换代验证,可对新下载复跑加固):
 *   A) 同单位同 DR 类相邻 CC 的 removal→apply 间隔分桶:16.5–19.5s 桶
 *      (新旧规则的判定分歧区)的第二段时长贴近 8–15.5s 桶(两代都 50%)
 *      则 20s 规则生效;贴近 25–60s 桶(两代都满时长)则仍是 16s。
 *      主判晕类(不吃伤害打断)。
 *   B) parser 冒烟:逐场解析是否抛错。
 *   C) 名表覆盖:观测 spellId 是否都在 spellNames 生成物里。
 * 用法:DOWNLOADS_DIR=<dir> npx tsx packages/eval/scripts/drWindowVerify.mts
 * 首跑 2026-08-12(30 场开服首日):Stun A 桶 med 1.5(n=5)≈ C 桶 1.5(n=25)
 * ≠ B 桶 3.0(n=155)→ 20s 规则实锤;parse 0 错;1673 id 名表 0 缺。 */
import { DR_CATEGORY_MAP } from "@gladlog/analysis";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { readFileSync } from "fs";
import { join } from "path";

import spellNames from "../../analysis/src/data/spellNames.json";

const DIR =
  process.env.DOWNLOADS_DIR ??
  `${process.env.HOME}/code/gladlog-eval-private/downloads/3v3-rall-allspecs`;
const CUTOVER = Date.UTC(2026, 7, 11, 22, 0, 0);

const manifest = JSON.parse(readFileSync(join(DIR, "manifest.json"), "utf8"));
const entries: { fileName: string; startTime: number }[] = Array.isArray(
  manifest,
)
  ? manifest
  : Object.values(manifest);

type Inst = { apply: number; remove: number; spellId: number };
const byBucket: Record<string, number[]> = {
  A_16_19: [],
  C_8_15: [],
  B_25_60: [],
};
const byBucketStun: Record<string, number[]> = {
  A_16_19: [],
  C_8_15: [],
  B_25_60: [],
};
let kept = 0;
let skippedPrePatch = 0;
let parseErrors = 0;
const seenIds = new Set<number>();
const names = spellNames as Record<string, string>;

for (const e of entries) {
  if (e.startTime < CUTOVER) {
    skippedPrePatch++;
    continue;
  }
  kept++;
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  try {
    for (const line of readFileSync(join(DIR, e.fileName), "utf8").split("\n"))
      parser.push(line);
    parser.end();
  } catch (err) {
    parseErrors++;
    console.error(
      `parse error in ${e.fileName}:`,
      (err as Error).message?.slice(0, 120),
    );
    continue;
  }
  for (const m of items) {
    for (const u of Object.values(m.units)) {
      const perCat = new Map<string, Inst[]>();
      for (const arr of [u.casts, u.auraEvents, u.actionsOut] as const)
        for (const ev of arr ?? [])
          if (ev.spellId) seenIds.add(Number(ev.spellId));
      const open = new Map<string, number>();
      for (const a of u.auraEvents ?? []) {
        const sid = Number(a.spellId);
        const cat = DR_CATEGORY_MAP[String(sid)];
        if (!cat) continue;
        const key = `${cat}:${sid}`;
        if (a.eventName === "SPELL_AURA_APPLIED") open.set(key, a.timestamp);
        else if (a.eventName === "SPELL_AURA_REMOVED" && open.has(key)) {
          const apply = open.get(key)!;
          open.delete(key);
          const list = perCat.get(cat) ?? [];
          list.push({ apply, remove: a.timestamp, spellId: sid });
          perCat.set(cat, list);
        }
      }
      for (const [cat, list] of perCat) {
        list.sort((x, y) => x.apply - y.apply);
        for (let i = 1; i < list.length; i++) {
          const gap = (list[i].apply - list[i - 1].remove) / 1000;
          const dur = (list[i].remove - list[i].apply) / 1000;
          const bucket =
            gap >= 16.5 && gap <= 19.5
              ? "A_16_19"
              : gap >= 8 && gap <= 15.5
                ? "C_8_15"
                : gap >= 25 && gap <= 60
                  ? "B_25_60"
                  : null;
          if (!bucket) continue;
          byBucket[bucket].push(dur);
          if (cat === "Stun") byBucketStun[bucket].push(dur);
        }
      }
    }
  }
}

const stats = (xs: number[]) => {
  if (!xs.length) return "n=0";
  const s = [...xs].sort((a, b) => a - b);
  const q = (f: number) => s[Math.floor(f * (s.length - 1))].toFixed(1);
  return `n=${s.length} med=${q(0.5)} p90=${q(0.9)}`;
};
console.log(
  `matches kept(12.1)=${kept} skipped(pre-patch)=${skippedPrePatch} parseErrors=${parseErrors}`,
);
console.log("ALL categories:");
for (const b of Object.keys(byBucket))
  console.log(`  ${b}: ${stats(byBucket[b])}`);
console.log("STUN only (unbreakable, primary judgment):");
for (const b of Object.keys(byBucketStun))
  console.log(`  ${b}: ${stats(byBucketStun[b])}`);
const missing = [...seenIds].filter((i) => !(String(i) in names));
console.log(
  `spell ids seen=${seenIds.size} missing-from-spellNames=${missing.length}`,
);
console.log("sample missing:", missing.slice(0, 10).join(","));
