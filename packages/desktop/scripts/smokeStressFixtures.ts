// 压测样本冒烟:对 dev/local/stress-*.json 逐个跑核心 derive 函数,
// 任一抛异常/产出空 roster 即非零退出。配套 make-report-fixture.mjs 生成的
// 野生边界样本(CN 名、超长对局、shuffle 回合、无坐标),不开浏览器验证渲染层。
//   npx tsx packages/desktop/scripts/smokeStressFixtures.ts
/* eslint-disable no-console */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { deriveDeathRecaps } from "../src/renderer/src/report/derive/deathRecap";
import { deriveReplay } from "../src/renderer/src/report/derive/replay";
import { deriveRoster } from "../src/renderer/src/report/derive/roster";
import { deriveStatsTable } from "../src/renderer/src/report/derive/statsTable";
import { deriveSummary } from "../src/renderer/src/report/derive/summary";
import { deriveTimeline } from "../src/renderer/src/report/derive/timeline";
import type { ReportSource } from "../src/renderer/src/report/derive/types";

const dir = join(__dirname, "..", "dev", "local");
if (!existsSync(dir)) {
  console.log("no dev/local — nothing to smoke");
  process.exit(0);
}
const files = readdirSync(dir).filter(
  (f) =>
    f.startsWith("stress-") && f.endsWith(".json") && f !== "stress-index.json",
);
let failed = 0;
for (const f of files) {
  try {
    const src = JSON.parse(readFileSync(join(dir, f), "utf-8")) as ReportSource;
    const roster = deriveRoster(src);
    const summary = deriveSummary(src);
    const timeline = deriveTimeline(src);
    const replay = deriveReplay(src);
    const deaths = deriveDeathRecaps(src);
    const stats = deriveStatsTable(src);
    if (roster.length === 0) throw new Error("empty roster");
    console.log(
      `ok ${f}: roster=${roster.map((t) => t.players.length).join("+")} summary=${summary.length} hpSeries=${timeline.series.length} adv=${timeline.hasAdvanced} replayTracks=${replay.tracks.length} deaths=${deaths.length} stats=${stats.length}`,
    );
  } catch (e) {
    failed++;
    console.error(
      `FAIL ${f}: ${String((e as Error)?.stack ?? e).slice(0, 300)}`,
    );
  }
}
process.exit(failed > 0 ? 1 : 0);
