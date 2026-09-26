/**
 * trinketBreakOrderScan — when a player presses the PvP trinket, how far is the
 * removal of the CC it broke from the cast, and on which side?
 *
 * Why it exists (reliability round 2 W2f, dece, 2026-09-26): `[ENEMY TRINKET]
 * used PvP trinket out of Howl of Terror` rendered for a Howl that Starsurge
 * had already broken (SPELL_AURA_BROKEN_SPELL 37.898, REMOVED 37.899) before
 * the Medallion cast at 38.051. `bindBreakToWindow` accepts a cast up to
 * TRINKET_BREAK_TOLERANCE_MS (250) AFTER the CC's removal. This scan measures
 * `removeMs − castMs` for every CC aura (ccSpellIds) removed on the trinketing
 * unit within ±1 s of a Gladiator's Medallion cast, split by how the aura left
 * (BROKEN / BROKEN_SPELL = damage broke it; plain REMOVED), so the tolerance on
 * the "removed before the cast" side can be set from data.
 *
 *   npx tsx packages/eval/scripts/trinketBreakOrderScan.ts --manifest <m> [--every 30]
 */
import { ensureAnalysisData } from "@gladlog/analysis";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { GladLogParser } from "@gladlog/parser";
import {
  LogEvent,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { arg, argOf } from "./lib/cli";

const TRINKET = "336126"; // Gladiator's Medallion (the on-use every PvP trinket item resolves to)

async function main(): Promise<void> {
  const manifest = arg("--manifest", "");
  if (!manifest) {
    console.error("usage: --manifest <file> [--every N]");
    process.exit(2);
  }
  const every = argOf("--every", 30);
  await ensureAnalysisData();
  const files = readFileSync(manifest, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % every === 0);
  /** kind → bucketed (removeMs − castMs) in 25 ms bins */
  const hist = new Map<string, Map<number, number>>();
  let casts = 0;
  let castsWithCc = 0;
  for (const path of files) {
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parser.on("shuffle", (sh: any) => {
        for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
      });
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    for (const combat of combats) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const u of Object.values(combat?.units ?? {}) as any[]) {
        if (!u.info) continue;
        for (const c of u.spellCastEvents ?? []) {
          if (
            c.logLine?.event !== LogEvent.SPELL_CAST_SUCCESS ||
            c.spellId !== TRINKET
          )
            continue;
          casts++;
          const castMs = c.logLine.timestamp as number;
          let any = false;
          for (const a of u.auraEvents ?? []) {
            const ev = a.logLine?.event;
            if (!a.spellId || !ccSpellIds.has(a.spellId)) continue;
            const isBroken =
              ev === LogEvent.SPELL_AURA_BROKEN ||
              ev === LogEvent.SPELL_AURA_BROKEN_SPELL;
            if (!isBroken && ev !== LogEvent.SPELL_AURA_REMOVED) continue;
            const d = (a.logLine.timestamp as number) - castMs;
            if (Math.abs(d) > 1000) continue;
            any = true;
            const kind = isBroken ? "broken (damage)" : "removed";
            const bin = Math.floor(d / 25) * 25;
            const h = hist.get(kind) ?? new Map<number, number>();
            h.set(bin, (h.get(bin) ?? 0) + 1);
            hist.set(kind, h);
          }
          if (any) castsWithCc++;
        }
      }
    }
  }
  console.log(
    `files ${files.length} · trinket casts ${casts} · with a CC aura leaving within ±1 s ${castsWithCc}`,
  );
  for (const [kind, h] of hist) {
    const total = [...h.values()].reduce((x, y) => x + y, 0);
    console.log(
      `\n== ${kind}: ${total} (removeMs − castMs, 25 ms bins; negative = left BEFORE the cast)`,
    );
    for (const [bin, n] of [...h].sort((x, y) => x[0] - y[0]))
      if (bin >= -500 && bin <= 500)
        console.log(`  ${String(bin).padStart(5)} ms  ${n}`);
    const before = [...h]
      .filter(([b]) => b < -25)
      .reduce((x, [, n]) => x + n, 0);
    console.log(
      `  left more than 25 ms before the cast: ${before} (${((before / total) * 100).toFixed(1)} %)`,
    );
  }
}

void main();
