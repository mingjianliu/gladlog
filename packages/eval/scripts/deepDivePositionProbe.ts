// 走位信号可行性调查(确定性):对每个友方死亡锚点,除现有资源信号门外,再
// 算 owner 的走位失误(computeOwnerPositionEvents)是否落在死亡窗口内。核心问
// 题:被现有门跳过的窗口,有多少能被"走位失误"救回?低分 spec 是否救回更多?
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { toLegacyMatch, CombatUnitReaction } from "@gladlog/parser-compat";
import {
  extractCandidateFindings,
  isHealerSpec,
  isMeleeSpec,
  buildDeepDivePack,
  hasCoachableSignal,
  reconstructEnemyCDTimeline,
  extractMajorCooldowns,
  annotateDefensiveTimings,
  analyzePlayerCCAndTrinket,
  specToString,
  type Finding,
} from "@gladlog/analysis";
// 未从 index 导出(investigation 探针,不为此改生产 API):走源文件深路径。
import { computeOwnerPositionEvents } from "@gladlog/analysis/src/utils/positionAnalysis";

const PACK_BEFORE = 30;
const PACK_AFTER = 10;
const dirs = process.argv.slice(2);
let files: string[] = [];
for (const d of dirs)
  for (const f of readdirSync(d).filter((f) => f.endsWith(".txt")))
    files.push(join(d, f));
files = [...new Map(files.map((f) => [f.split("/").pop(), f])).values()];

let anchors = 0;
let resourcePass = 0; // 现有门过
let posMistake = 0; // 窗口内有走位失误
let recovered = 0; // 现有门跳过、但走位能救
const bySpec = new Map<
  string,
  { anchors: number; resPass: number; posAny: number; recovered: number }
>();
const S = (s: string) => {
  let v = bySpec.get(s);
  if (!v) {
    v = { anchors: 0, resPass: 0, posAny: 0, recovered: 0 };
    bySpec.set(s, v);
  }
  return v;
};
const MISTAKE_TYPES = new Set(["STAYED_IN", "MISSED_PUSH", "CD_OUT_OF_RANGE"]);

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
    const players = Object.values(legacy.units).filter((u: any) => u.info);
    const owner =
      players.find(
        (u: any) =>
          u.id === legacy.playerId &&
          u.reaction === CombatUnitReaction.Friendly,
      ) ??
      players.find(
        (u: any) =>
          isHealerSpec(u.spec) && u.reaction === CombatUnitReaction.Friendly,
      );
    if (!owner) continue;
    const spec = specToString((owner as any).spec);
    const enemies = players.filter(
      (u: any) => u.reaction !== CombatUnitReaction.Friendly,
    );
    const friends = players.filter(
      (u: any) => u.reaction === CombatUnitReaction.Friendly,
    );
    let cands, posEvents;
    try {
      cands = extractCandidateFindings(legacy, (owner as any).id);
      const tl = reconstructEnemyCDTimeline(enemies as any, legacy as any);
      const cds = annotateDefensiveTimings(
        extractMajorCooldowns(owner as any, legacy as any),
        owner as any,
        legacy as any,
        tl,
      );
      const ownerCC = analyzePlayerCCAndTrinket(
        owner as any,
        enemies as any,
        legacy as any,
        [],
      );
      posEvents = computeOwnerPositionEvents({
        owner: owner as any,
        enemies: enemies as any,
        combat: legacy as any,
        burstWindows: tl.alignedBurstWindows,
        ownerCooldowns: cds,
        ownerCCSummary: ownerCC,
        isHealer: isHealerSpec((owner as any).spec),
        ownerIsMelee: isMeleeSpec((owner as any).spec),
        friends: friends as any,
      });
    } catch {
      continue;
    }
    for (const d of cands.filter(
      (c) => c.type === "death" && c.facts.side === "friendly",
    )) {
      const st = S(spec);
      anchors++;
      st.anchors++;
      const finding: Finding = {
        eventIds: [d.id],
        severity: "high",
        category: "survival",
        title: "阵亡",
        explanation: "x",
      };
      let pack;
      try {
        pack = buildDeepDivePack(
          legacy,
          finding,
          0,
          cands,
          (owner as any).name,
        );
      } catch {
        continue;
      }
      if (!pack) continue;
      const resSig = hasCoachableSignal(pack.items);
      if (resSig) {
        resourcePass++;
        st.resPass++;
      }
      // 走位失误落在死亡窗口内?
      const from = d.t - PACK_BEFORE;
      const to = d.t + PACK_AFTER;
      const pos = posEvents.some(
        (e) =>
          MISTAKE_TYPES.has(e.type) &&
          e.atSeconds <= to &&
          (e.toSeconds ?? e.atSeconds) >= from,
      );
      if (pos) {
        posMistake++;
        st.posAny++;
      }
      if (!resSig && pos) {
        recovered++;
        st.recovered++;
      }
    }
  }
}

const pct = (a: number, b: number) =>
  b ? `${Math.round((100 * a) / b)}%` : "—";
console.warn(`死亡锚点 ${anchors}`);
console.warn(`现有资源门过:${pct(resourcePass, anchors)}`);
console.warn(`窗口内有走位失误:${pct(posMistake, anchors)}`);
console.warn(
  `★ 现有门跳过但走位能救:${recovered}(占全部锚点 ${pct(recovered, anchors)};占被跳过的 ${pct(recovered, anchors - resourcePass)})`,
);
console.warn("── 逐 spec(锚点≥8)──  资源过 | 走位覆盖 | 走位救回被跳过的");
for (const [spec, s] of [...bySpec.entries()]
  .filter(([, s]) => s.anchors >= 8)
  .sort((a, b) => a[1].resPass / a[1].anchors - b[1].resPass / b[1].anchors))
  console.warn(
    `  ${spec.padEnd(22)} 锚点${String(s.anchors).padStart(3)}  ${pct(s.resPass, s.anchors).padStart(4)} | ${pct(s.posAny, s.anchors).padStart(4)} | 救回 ${s.recovered}/${s.anchors - s.resPass}`,
  );
