/**
 * shieldAtCrisisExampleGen.ts — value-gate example generator (GH #100
 * direction 2, result recorded as NEGATIVE in docs/log-observability-audit.md, 2026-09-20). For the product's own
 * healer crisis decision points (crisisDecisionPoints — the predicate behind
 * crisis-no-response), read the advanced-block remaining-absorb slot
 * (advancedSlotScan.ts: slot+9) nearest the crossing and show what the coach
 * sees today next to what the log also says. No model calls, no new predicate.
 *
 * Usage: npx tsx packages/eval/scripts/shieldAtCrisisExampleGen.ts --manifest <txt> [--offset 0] [--limit 120]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { crisisDecisionPoints } from "@gladlog/analysis/src/analysis/crisisDecisionPoints";
import { isHealerSpec } from "@gladlog/analysis/src/utils/cooldowns";
import { fmtTime } from "@gladlog/analysis/src/utils/renderGrid";
import { GladLogParser, parseLine } from "@gladlog/parser";
import {
  CombatUnitReaction,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
/** Sample must be this close to the crossing to be quoted at all. */
const SAMPLE_TOLERANCE_MS = 1000;

type ShieldSample = { t: number; absorb: number; maxHp: number };

async function main(): Promise<void> {
  await ensureAnalysisData();
  const files = readFileSync(flag("--manifest")!, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(Number(flag("--offset") ?? 0))
    .slice(0, Number(flag("--limit") ?? 120));

  const bands = { none: 0, under10: 0, from10to25: 0, over25: 0, noSample: 0 };
  const roleCounts = () => ({
    dangerousFeasible: { ...bands },
    accused: { ...bands }, // dangerous && feasible && !responded
    accusedDied10s: { ...bands },
  });
  const counts = { files: 0, healer: roleCounts(), dps: roleCounts() };
  const examples: Array<{ score: number; text: string }> = [];

  for (const path of files) {
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => {
        for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
      });
      for (const line of lines) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    counts.files++;

    const shields = new Map<string, ShieldSample[]>();
    for (const line of lines) {
      const p = parseLine(line);
      const a = p?.advanced;
      if (!p || !a || !a.actorGuid.startsWith("Player-")) continue;
      const at = p.params.indexOf(a.actorGuid, 8);
      if (at < 0) continue;
      const absorb = Number(p.params[at + 9]);
      if (!Number.isFinite(absorb) || !(a.maxHp > 0)) continue;
      const list = shields.get(a.actorGuid) ?? [];
      list.push({ t: p.timestamp, absorb, maxHp: a.maxHp });
      shields.set(a.actorGuid, list);
    }
    const shieldAt = (guid: string, tMs: number): ShieldSample | null => {
      let best: ShieldSample | null = null;
      for (const s of shields.get(guid) ?? []) {
        if (Math.abs(s.t - tMs) > SAMPLE_TOLERANCE_MS) continue;
        if (!best || Math.abs(s.t - tMs) < Math.abs(best.t - tMs)) best = s;
      }
      return best;
    };

    for (const combat of combats) {
      const players: any[] = Object.values(combat?.units ?? {}).filter(
        (u: any) => u.info,
      );
      for (const owner of players) {
        if (owner.reaction !== CombatUnitReaction.Friendly) continue;
        const role = isHealerSpec(owner.spec) ? "healer" : "dps";
        let points;
        try {
          points = crisisDecisionPoints(owner, combat, role);
        } catch {
          continue;
        }
        for (const p of points) {
          if (!p.dangerous || !p.feasible) continue;
          const s = shieldAt(owner.id, p.tMs);
          const pct = s ? s.absorb / s.maxHp : NaN;
          const band: keyof typeof bands = !s
            ? "noSample"
            : pct === 0
              ? "none"
              : pct < 0.1
                ? "under10"
                : pct < 0.25
                  ? "from10to25"
                  : "over25";
          counts[role].dangerousFeasible[band]++;
          if (p.responded) continue;
          counts[role].accused[band]++;
          if (p.diedWithin10s) counts[role].accusedDied10s[band]++;
          if (s && pct >= 0.1)
            examples.push({
              score: pct,
              text:
                `${path.split("/").at(-1)} · ${owner.name?.split("-")[0]} (${role})\n` +
                `  TODAY  ${fmtTime(p.tSec)}  crisis-no-response: HP ${Math.round(p.hpPct)}%, took ${Math.round(p.dmg2s * 100)}% of max HP in 2s, ${p.attackers2s} attackers, no response in 3s\n` +
                `  +LOG   ${fmtTime(p.tSec)}  remaining absorb on them at that sample: ${Math.round(pct * 100)}% of max HP (${s.absorb} / ${s.maxHp}), sample ${s.t - p.tMs} ms from the crossing → HP + shield = ${Math.round(p.hpPct + pct * 100)}%\n` +
                `  OUTCOME died within 10 s: ${p.diedWithin10s ? "yes" : "no"}`,
            });
        }
      }
    }
  }
  examples.sort((a, b) => b.score - a.score);
  console.log(JSON.stringify(counts, null, 2));
  console.log(
    `\n${examples.length} accused points with shield >= 10% of max HP; top 6 and 3 from the middle:\n`,
  );
  const mid = Math.floor(examples.length / 2);
  for (const e of [...examples.slice(0, 6), ...examples.slice(mid, mid + 3)])
    console.log(e.text + "\n");
}
void main();
