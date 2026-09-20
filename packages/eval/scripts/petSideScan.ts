/** petSideScan.ts — 宠物/召唤物归因的边一致性扫描(GH #99)。
 *
 * 为什么存在:`[CC ON TEAM]` 行的施放者必须是**敌方**,`[CC ON ENEMY]` 行的必须是
 * **友方**。2026-09-20 之前 matchTimeline 的 actorLabel 按**名字**在 allUnits 里查
 * 召唤物的主人,而双方各有一个同名图腾时(两个萨满 → 两个 "Capacitor Totem")
 * `find` 取到的是单位表里排在前面的那个,于是整行归因到了错误的一边 —— 最露骨的
 * 一条是 `3(EShaman) ← Capacitor Totem (by 3(EShaman)'s pet)`,队友晕自己。修法是
 * 按事件自带的来源 GUID(`ICCInstance.sourceId` 等)解析,名字只作无 id 文档的兜底。
 *
 * 判据(与 packages/ev[a]l 的门规同口径,直接重解析已渲染的文本):
 *   [CC ON TEAM]  … (by N…'s pet) → N 必须是 role="enemy" 的单位
 *   [CC ON ENEMY] … (by N…'s pet) → N 必须是队友(role ≠ enemy)
 *
 * 基线数字(2026-09-15 baseline 的 309 份 prompt,修复前):跨边 48 条 / 16 份 prompt
 * (CC ON TEAM 记成友方 31、CC ON ENEMY 记成敌方 17);修复后同口径 0。
 * 本机库 200 场(2026-09-20)修复前 13 条 / 修复后 0 —— 见 GH #99 评论。
 *
 * 用法:npx tsx packages/eval/scripts/petSideScan.ts [场数=200]
 *(单进程跑,全库扫描一次只跑一个。)
 */
import {
  buildMatchContext,
  ensureAnalysisData,
  isHealerSpec,
} from "@gladlog/analysis";

import {
  DEFAULT_MATCH_DIR,
  loadIndex,
  loadLegacyRound,
  splitTeams,
} from "../src/explore/storeAccess";
import { checkPetCreditSide } from "../src/quality/promptQualityCheck";

const N_MATCHES = process.argv[2] !== undefined ? Number(process.argv[2]) : 200;

const UNIT_RE = /<unit id="(\d+)"[^>]*role="([^"]+)"/g;
const PET_RE = /\[(CC ON TEAM|CC ON ENEMY)\][^\n]*?\(by (\d+)\S*?'s pet\)/;
/** Every `(by …)` credit on a CC line, whatever shape it resolved to. */
const BY_RE =
  /\[(CC ON TEAM|CC ON ENEMY)\][^\n]*?\(by ([^()]*(?:\([^()]*\)[^()]*)*)\)/;

await ensureAnalysisData();
const rows = loadIndex(DEFAULT_MATCH_DIR);
const picked = N_MATCHES > 0 ? rows.slice(-N_MATCHES) : rows;

let rounds = 0;
let petCredits = 0;
let wrongSide = 0;
const shapes = new Map<string, number>();
const wrongRounds = new Set<string>();
const examples: string[] = [];

for (const row of picked) {
  const roundInfos: Array<{
    seq: number | undefined;
    legacy: ReturnType<typeof loadLegacyRound>["legacy"];
  }> = [];
  try {
    const first = loadLegacyRound(DEFAULT_MATCH_DIR, row.id, 0);
    if (first.kind === "shuffle") {
      roundInfos.push({ seq: 0, legacy: first.legacy });
      for (let i = 1; i < 12; i++) {
        try {
          roundInfos.push({
            seq: i,
            legacy: loadLegacyRound(DEFAULT_MATCH_DIR, row.id, i).legacy,
          });
        } catch {
          break;
        }
      }
    } else {
      roundInfos.push({ seq: undefined, legacy: first.legacy });
    }
  } catch {
    continue;
  }

  for (const r of roundInfos) {
    const { friends, enemies } = splitTeams(r.legacy);
    const owner = friends.find((u) => isHealerSpec(u.spec)) ?? friends[0];
    if (!owner) continue;
    let ctx: string;
    try {
      ctx = buildMatchContext(r.legacy, friends, enemies, { owner });
    } catch {
      continue;
    }
    rounds++;

    const side = new Map<string, string>();
    for (const m of ctx.matchAll(UNIT_RE))
      side.set(m[1]!, m[2] === "enemy" ? "enemy" : "friendly");

    for (const line of ctx.split("\n")) {
      const b = BY_RE.exec(line);
      if (b) {
        const label = b[2]!;
        const shape = label.endsWith("'s pet")
          ? "owner's pet"
          : label === "[pet]"
            ? "[pet] (unresolved, localized name)"
            : /^\d/.test(label)
              ? "player"
              : "raw unit name (unresolved)";
        shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
      }
      if (PET_RE.test(line)) petCredits++;
    }

    const wrong = checkPetCreditSide(ctx.split("\n"));
    if (wrong.length > 0) {
      wrongSide += wrong.length;
      wrongRounds.add(`${row.id}:${r.seq ?? ""}`);
      for (const w of wrong) {
        if (examples.length < 8) examples.push(`${row.id}:${r.seq ?? ""} ${w}`);
      }
    }
  }
}

console.log(`matches=${picked.length} rounds=${rounds}`);
console.log(`pet-credited CC lines: ${petCredits}`);
console.log(`WRONG SIDE: ${wrongSide} line(s) in ${wrongRounds.size} round(s)`);
for (const e of examples) console.log(`  ${e}`);
console.log("(by …) label shapes on CC lines:");
for (const [k, v] of [...shapes].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(v).padStart(5)}  ${k}`);
