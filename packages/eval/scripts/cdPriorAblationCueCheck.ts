/**
 * cdPriorAblationCueCheck.ts — the targeted read behind the `[CD PRIOR]`
 * ablation probe (GH #54 (f) follow-up, 2026-09-04).
 *
 * promptAblationProbe's aggregate Jaccard sits inside the noise band for a
 * context line that appears in only some rounds and names ONE held cooldown;
 * this script re-derives, for the SAME rounds the probe sampled (same file
 * list, same round/owner selection, same prompt builder), which rounds
 * actually carried a `[CD PRIOR]` line and what it named, then asks the
 * narrow question: did the model's baseline answers name that held cooldown
 * (and the crossing second), and does the mention disappear when the line
 * is ablated?
 *
 *   tsx cdPriorAblationCueCheck.ts --raw <raw.json> --list <files.txt> --matches 24
 */
import {
  buildMatchContext,
  ensureAnalysisData,
  isHealerSpec,
} from "@gladlog/analysis";
import { CombatUnitReaction } from "@gladlog/parser-compat";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { parseLogCombats } from "../src/corpus/candidateMenu";
import { jaccard } from "../src/explore/promptLineTypes";

const arg = (f: string, d?: string) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : d;
};
const rawPath = arg("--raw")!;
const listPath = arg("--list")!;
const limit = Number(arg("--matches", "24"));

interface Row { match: string; variant: string; answer: string; topics: string[] }

async function main() {
  await ensureAnalysisData();
  const files = readFileSync(listPath, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
  const cues = new Map<string, Array<{ spell: string; t: string }>>();
  let count = 0;
  outer: for (const f of files) {
    let text = "";
    try { text = gunzipSync(readFileSync(f)).toString("utf8"); } catch { continue; }
    let combats: ReturnType<typeof parseLogCombats> = [];
    try { combats = parseLogCombats(text); } catch { continue; }
    for (const c of combats) {
      if (count >= limit) break outer;
      const players = (Object.values(c.legacy.units) as any[]).filter((u) => u.info);
      const friends = players.filter((u) => u.reaction === CombatUnitReaction.Friendly);
      const enemies = players.filter((u) => u.reaction !== CombatUnitReaction.Friendly);
      const owner = friends.find((u) => isHealerSpec(u.spec));
      const dur = (c.legacy.endTime - c.legacy.startTime) / 1000;
      if (!owner || dur < 120) continue;
      let prompt = "";
      try { prompt = buildMatchContext(c.legacy as never, friends as never, enemies as never, { owner } as never); } catch { continue; }
      if (!prompt.includes("[STATE]")) continue;
      const id = `${f.split("/").pop()?.slice(0, 8)}-${count}`;
      count++;
      const found: Array<{ spell: string; t: string }> = [];
      for (const l of prompt.split("\n")) {
        const m = l.match(/^\s*(\d+:\d\d)\s+\[CD PRIOR\]\s+.*?spends (.+?) at a median/);
        if (m) found.push({ spell: m[2]!.trim(), t: m[1]! });
      }
      cues.set(id, found);
    }
  }
  const rows: Row[] = JSON.parse(readFileSync(rawPath, "utf8"));
  const byMatch = new Map<string, Row[]>();
  for (const r of rows) (byMatch.get(r.match) ?? byMatch.set(r.match, []).get(r.match)!).push(r);
  let withLine = 0, baseN = 0, baseMention = 0, baseT = 0, ablN = 0, ablMention = 0, ablT = 0;
  const jWith: number[] = [], jWithout: number[] = [], floorWith: number[] = [];
  const detail: string[] = [];
  for (const [id, rs] of byMatch) {
    const cue = cues.get(id);
    const bases = rs.filter((r) => r.variant.startsWith("baseline") && !r.answer.startsWith("__ERROR__"));
    const abl = rs.find((r) => !r.variant.startsWith("baseline") && !r.answer.startsWith("__ERROR__"));
    if (!abl || bases.length === 0) continue;
    const jAvg = bases.reduce((a, b) => a + jaccard(new Set(b.topics), new Set(abl.topics)), 0) / bases.length;
    if (!cue || cue.length === 0) { jWithout.push(jAvg); continue; }
    withLine++;
    jWith.push(jAvg);
    for (let i = 0; i < bases.length; i++) for (let j = i + 1; j < bases.length; j++) floorWith.push(jaccard(new Set(bases[i]!.topics), new Set(bases[j]!.topics)));
    const mentions = (a: string) => cue.some((c) => a.includes(c.spell));
    const atT = (a: string) => cue.some((c) => a.includes(c.t));
    for (const b of bases) { baseN++; if (mentions(b.answer)) baseMention++; if (atT(b.answer)) baseT++; }
    ablN++; if (mentions(abl.answer)) ablMention++; if (atT(abl.answer)) ablT++;
    detail.push(`${id} ${cue.map((c) => `${c.spell}@${c.t}`).join(" | ")} · baseline names it ${bases.map((b) => (mentions(b.answer) ? "Y" : "n")).join("")} · ablated ${mentions(abl.answer) ? "Y" : "n"}`);
  }
  const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
  console.log(`rounds sampled ${byMatch.size}; with a [CD PRIOR] line ${withLine}; without ${jWithout.length}`);
  console.log(`Jaccard ablated-vs-baseline: with-line rounds ${mean(jWith).toFixed(3)} (n=${jWith.length}) · without-line rounds ${mean(jWithout).toFixed(3)} (n=${jWithout.length}) · baseline-vs-baseline floor on with-line rounds ${mean(floorWith).toFixed(3)} (n=${floorWith.length})`);
  console.log(`held cooldown named in the answer: baseline ${baseMention}/${baseN}, ablated ${ablMention}/${ablN}; crossing second cited: baseline ${baseT}/${baseN}, ablated ${ablT}/${ablN}`);
  console.log(detail.join("\n"));
}
main().catch((e) => { console.error(e); process.exit(1); });
