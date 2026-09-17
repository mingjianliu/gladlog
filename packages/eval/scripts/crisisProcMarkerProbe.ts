/**
 * crisisProcMarkerProbe.ts — BACKLOG #43 step 1 (2026-09-17): "怎么认出这是
 * 触发不是主动按 — 逐个用日志核实,不要猜".
 *
 * The low-HP protection procs the M6 triage named carry their own marker
 * aura in the log (the internal-cooldown buff): Well-Honed Instincts 382912
 * (→ Frenzied Regeneration 22842), Dream Guide 1278914 (→ Regrowth 8936 /
 * 1264664). Guided Prayer 404357 and Last Resort 209258 have NO observed
 * sibling id — this probe reports them as undetectable unless a pattern
 * appears. For each marker application on a player: who applied it (self?),
 * the owner's [STATE] HP at that instant, and whether the triggered spell's
 * SPELL_CAST_SUCCESS follows within ±1 s (so the predicate can subtract that
 * cast from the owner's own presses).
 *
 * Usage: npx tsx packages/eval/scripts/crisisProcMarkerProbe.ts --manifest <m> [--every 50]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { gridHpPct } from "@gladlog/analysis/src/utils/cooldowns";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";
import { readFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

const a = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = a.indexOf(k);
  return i >= 0 ? (a[i + 1] ?? d) : d;
};
const manifest = arg("--manifest", "");
const every = Number(arg("--every", "50"));

const MARKERS: Record<string, { name: string; triggers: string[] }> = {
  "382912": { name: "Well-Honed Instincts", triggers: ["22842"] },
  "1278914": { name: "Dream Guide", triggers: ["8936", "1264664"] },
};
// Guided Prayer: a Word of Glory 85673 cast on self at <= 25 % HP is the only
// candidate pattern; count it separately, never treat it as detection.
const WOG = "85673";

await ensureAnalysisData();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);

const t: Record<string, any> = {
  files: files.length,
  rounds: 0,
  markers: {} as Record<
    string,
    {
      applied: number;
      selfSourced: number;
      hpKnown: number;
      hpLe40: number;
      hpBuckets: Record<string, number>;
      triggerCastWithin1s: number;
      triggerCastWithin3s: number;
      noTriggerCast: number;
    }
  >,
  wogSelfLe25: 0,
  wogSelfAll: 0,
};
const examples: any[] = [];

for (const f of files) {
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  let text: string;
  try {
    const raw = readFileSync(resolve(f));
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  for (const m of items) {
    let legacy: any;
    try {
      legacy = toLegacyMatch({ ...m, rawLines: [] } as GladMatch);
    } catch {
      continue;
    }
    t.rounds++;
    for (const u of Object.values(legacy.units ?? {}) as any[]) {
      if (!u.info) continue;
      const casts = ((u.spellCastEvents ?? []) as any[]).filter(
        (c) => c.logLine?.event === LogEvent.SPELL_CAST_SUCCESS,
      );
      for (const ev of (u.auraEvents ?? []) as any[]) {
        if (ev.logLine?.event !== LogEvent.SPELL_AURA_APPLIED) continue;
        if (ev.destUnitId !== u.id) continue;
        const mk = MARKERS[String(ev.spellId)];
        if (!mk) continue;
        const row = (t.markers[mk.name] ??= {
          applied: 0,
          selfSourced: 0,
          hpKnown: 0,
          hpLe40: 0,
          hpBuckets: {},
          triggerCastWithin1s: 0,
          triggerCastWithin3s: 0,
          noTriggerCast: 0,
        });
        row.applied++;
        if (ev.srcUnitId === u.id) row.selfSourced++;
        const hp = gridHpPct(u, ev.timestamp);
        if (hp !== null) {
          row.hpKnown++;
          if (hp <= 40) row.hpLe40++;
          const b = `${Math.floor(hp / 10) * 10}s`;
          row.hpBuckets[b] = (row.hpBuckets[b] ?? 0) + 1;
        }
        const near = (ms: number) =>
          casts.some(
            (c) =>
              mk.triggers.includes(String(c.spellId)) &&
              Math.abs(c.timestamp - ev.timestamp) <= ms,
          );
        if (near(1000)) row.triggerCastWithin1s++;
        else if (near(3000)) row.triggerCastWithin3s++;
        else row.noTriggerCast++;
        if (examples.length < 20)
          examples.push({
            file: f.split("/").slice(-1)[0],
            unit: u.name,
            marker: mk.name,
            tSec: Math.round((ev.timestamp - legacy.startTime) / 1000),
            hp,
            src: ev.srcUnitId === u.id ? "self" : ev.srcUnitId,
            triggerCastGapMs:
              casts
                .filter((c) => mk.triggers.includes(String(c.spellId)))
                .map((c) => c.timestamp - ev.timestamp)
                .sort((x, y) => Math.abs(x) - Math.abs(y))[0] ?? null,
          });
      }
      for (const c of casts) {
        if (String(c.spellId) !== WOG || c.destUnitId !== u.id) continue;
        t.wogSelfAll++;
        const hp = gridHpPct(u, c.timestamp);
        if (hp !== null && hp <= 25) t.wogSelfLe25++;
      }
    }
  }
}
process.stdout.write(JSON.stringify({ ...t, examples }, null, 2) + "\n");
