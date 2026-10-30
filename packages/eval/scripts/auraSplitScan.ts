/**
 * FT-T08 scan: is one aura application still split in two?
 *
 * The game re-broadcasts some auras: SPELL_AURA_REMOVED and SPELL_AURA_APPLIED
 * of the same spell, source and target back to back, with no new cast — one
 * continuous aura (`dropAuraRebroadcasts`). The log's timestamps carry four
 * decimals, so the two lines of one re-broadcast can sit on either side of a
 * millisecond boundary (f4da82c5: one Sleep Walk cast, REMOVED 10.1853 and
 * APPLIED 10.1863, rendered as two `(0s)` CC lines).
 *
 * Per match / shuffle round, over the player units' `buildAuraIntervals`:
 *   SPLIT   two intervals of one spell from one source (by GUID) on one unit,
 *           the second starting within the re-broadcast gap after the first
 *           ended (both ends logged, not inferred)             → must be 0
 * and the gap histogram up to 50 ms, CC auras apart, so the bound can be
 * re-read on a new corpus.
 *   EARLY   an interval that ends at a SPELL_AURA_BROKEN[_SPELL] line while
 *           the aura's own SPELL_AURA_REMOVED follows on that unit within
 *           1 s with no APPLIED in between — the aura was still on (FT-T08
 *           step 2: Frost Nova, Ice Nova and Freeze log a BROKEN_SPELL per
 *           damaging hit and stay ~0.5 s longer); with the seconds cut off
 *                                                              → must be 0
 *
 * Usage: npx tsx packages/eval/scripts/auraSplitScan.ts [--show] <raw.txt | dir>...
 * Exit code 1 when SPLIT or EARLY is non-zero.
 *
 * The scan itself (`cutShortMs`, `scanLegacy`, `itemsOfRawText`) is exported
 * for test/auraSplitScan.test.ts; `scanLegacy` takes the interval builder as
 * a parameter so the test can hand it intervals the product predicate would
 * never produce (a split) and watch the class fire. Only the `process.argv`
 * guard at the bottom runs the CLI.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { ensureAnalysisData } from "@gladlog/analysis";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import * as auraIntervals from "@gladlog/analysis/src/utils/auraIntervals";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { type IArenaMatch, type ICombatUnit, toLegacyMatch } from "@gladlog/parser-compat";

// The literal is only a stand-in so the scan can print the BEFORE number on a
// commit that predates the constant; from FT-T08 on it is the export.
export const GAP_MS: number =
  (auraIntervals as { AURA_REBROADCAST_GAP_MS?: number })
    .AURA_REBROADCAST_GAP_MS ?? 1;
export const EDGES = [0, 1, 2, 5, 10, 50];

function rawFiles(arg: string): string[] {
  if (!statSync(arg).isDirectory()) return [arg];
  const out: string[] = [];
  for (const entry of readdirSync(arg).sort()) {
    const p = path.join(arg, entry);
    if (statSync(p).isDirectory()) out.push(...rawFiles(p));
    else if (entry === "raw.txt") out.push(p);
  }
  return out;
}

/** How many ms before its aura's REMOVED the interval ends, when it ends on
 * a BROKEN line (0 = it does not). Independent of the product predicate. */
export function cutShortMs(
  events: readonly {
    spellId?: string | null;
    timestamp: number;
    logLine: { event: string };
  }[],
  startMs: number,
  iv: auraIntervals.IAuraInterval,
): number {
  const endMs = Math.round(startMs + iv.toS * 1000);
  const mine = events.filter((e) => e.spellId === iv.spellId);
  const at = (e: { timestamp: number }) => Math.abs(e.timestamp - endMs) < 1;
  if (mine.some((e) => at(e) && e.logLine.event === "SPELL_AURA_REMOVED"))
    return 0;
  if (
    !mine.some((e) => at(e) && e.logLine.event.startsWith("SPELL_AURA_BROKEN"))
  )
    return 0;
  for (const e of mine) {
    if (e.timestamp <= endMs) continue;
    if (e.timestamp - endMs > 1000) break;
    if (e.logLine.event === "SPELL_AURA_APPLIED") return 0;
    if (e.logLine.event === "SPELL_AURA_REMOVED") return e.timestamp - endMs;
  }
  return 0;
}

export interface AuraSplitTally {
  rounds: number;
  intervals: number;
  split: number;
  splitCc: number;
  otherSource: number;
  ambiguous: number;
  early: number;
  earlyMs: number;
  hist: number[];
  histCc: number[];
  bySpell: Map<string, number>;
  earlyBySpell: Map<string, number>;
  /** `--show` lines, in scan order. */
  shows: string[];
}

export const newAuraSplitTally = (): AuraSplitTally => ({
  rounds: 0,
  intervals: 0,
  split: 0,
  splitCc: 0,
  otherSource: 0,
  ambiguous: 0,
  early: 0,
  earlyMs: 0,
  hist: EDGES.map(() => 0),
  histCc: EDGES.map(() => 0),
  bySpell: new Map(),
  earlyBySpell: new Map(),
  shows: [],
});

export function addAuraSplitTally(into: AuraSplitTally, t: AuraSplitTally) {
  for (const k of [
    "rounds",
    "intervals",
    "split",
    "splitCc",
    "otherSource",
    "ambiguous",
    "early",
    "earlyMs",
  ] as const)
    into[k] += t[k];
  t.hist.forEach((n, i) => (into.hist[i]! += n));
  t.histCc.forEach((n, i) => (into.histCc[i]! += n));
  for (const [k, n] of t.bySpell) into.bySpell.set(k, (into.bySpell.get(k) ?? 0) + n);
  for (const [k, n] of t.earlyBySpell)
    into.earlyBySpell.set(k, (into.earlyBySpell.get(k) ?? 0) + n);
  into.shows.push(...t.shows);
}

export const isClean = (t: AuraSplitTally): boolean =>
  t.split === 0 && t.early === 0;

/**
 * One match / shuffle round, already converted to the legacy shape. `opts`:
 *  - `intervalsOf` — the aura-interval builder (the product's
 *    `buildAuraIntervals` by default; a test hands in intervals);
 *  - `gapMs` — the re-broadcast bound (`GAP_MS` by default);
 *  - `matchId` — only for the `--show` lines.
 */
export function scanLegacy(
  legacy: Pick<IArenaMatch, "startTime" | "endTime" | "units">,
  opts: {
    intervalsOf?: (
      u: ICombatUnit,
      legacy: Pick<IArenaMatch, "startTime" | "endTime" | "units">,
    ) => auraIntervals.IAuraInterval[];
    gapMs?: number;
    matchId?: string;
  } = {},
): AuraSplitTally {
  const intervalsOf =
    opts.intervalsOf ?? ((u, l) => auraIntervals.buildAuraIntervals(u, l));
  const gapMs = opts.gapMs ?? GAP_MS;
  const matchId = opts.matchId ?? "?";
  const t = newAuraSplitTally();
  t.rounds = 1;
  for (const u of Object.values(legacy.units)) {
    if (!u.info) continue;
    const last = new Map<string, auraIntervals.IAuraInterval>();
    // An interval names its source by NAME only; two pets called "Beast"
    // handing Mortal Wounds to each other are two sources. The source GUIDs
    // of the REMOVED that closed one interval and the APPLIED that opened
    // the next are read off the events themselves.
    const sourcesAt = (spellId: string, event: string, atS: number) =>
      new Set(
        (u.auraEvents ?? [])
          .filter(
            (e) =>
              e.spellId === spellId &&
              (e.logLine.event as string) === event &&
              Math.abs((e.timestamp - legacy.startTime) / 1000 - atS) < 5e-4,
          )
          .map((e) => e.srcUnitId),
      );
    for (const iv of intervalsOf(u, legacy)) {
      t.intervals++;
      if (!iv.inferredEnd) {
        const cut = cutShortMs(u.auraEvents ?? [], legacy.startTime, iv);
        if (cut > 0) {
          t.early++;
          t.earlyMs += cut;
          const n = `${getEnglishSpellName(iv.spellId, iv.spellName)} (${iv.spellId})`;
          t.earlyBySpell.set(n, (t.earlyBySpell.get(n) ?? 0) + 1);
          t.shows.push(
            `  EARLY ${matchId} ${u.name} ${n} ${iv.fromS.toFixed(3)}–${iv.toS.toFixed(3)} cut ${cut} ms`,
          );
        }
      }
      const key = `${iv.spellId}|${iv.srcUnitName}`;
      const prev = last.get(key);
      last.set(key, iv);
      if (!prev || prev.inferredEnd || iv.inferredStart) continue;
      // events past the round's end are clamped onto it: a zero-length
      // interval sitting on the clamp is no second application
      if (iv.fromS === iv.toS && prev.toS === iv.fromS) continue;
      const gap = Math.round((iv.fromS - prev.toS) * 1000);
      if (gap < 0 || gap > EDGES[EDGES.length - 1]!) continue;
      const cc = ccSpellIds.has(iv.spellId);
      const b = EDGES.findIndex((e) => gap <= e);
      t.hist[b]!++;
      if (cc) t.histCc[b]!++;
      if (gap > gapMs) continue;
      const closedBy = sourcesAt(iv.spellId, "SPELL_AURA_REMOVED", prev.toS);
      const openedBy = sourcesAt(iv.spellId, "SPELL_AURA_APPLIED", iv.fromS);
      if (![...closedBy].some((id) => openedBy.has(id))) {
        t.otherSource++;
        continue;
      }
      // several sources of one name closing and opening in the same ms:
      // which REMOVED belongs to which interval cannot be read back
      if (closedBy.size !== 1 || openedBy.size !== 1) {
        t.ambiguous++;
        continue;
      }
      t.split++;
      if (cc) t.splitCc++;
      const name = `${getEnglishSpellName(iv.spellId, iv.spellName)} (${iv.spellId}${cc ? ", CC" : ""})`;
      t.bySpell.set(name, (t.bySpell.get(name) ?? 0) + 1);
      t.shows.push(
        `  SPLIT ${matchId} ${u.name} ${name} ${prev.fromS.toFixed(3)}–${prev.toS.toFixed(3)} | ${iv.fromS.toFixed(3)}–${iv.toS.toFixed(3)}`,
      );
    }
  }
  return t;
}

/** The matches / shuffle rounds of one raw log's text, as the CLI reads a
 * file; each converted to the legacy shape (a round the conversion rejects
 * is left out, as the CLI leaves it out). */
export function itemsOfRawText(
  text: string,
): Array<{ id: string; legacy: IArenaMatch }> {
  const items: GladMatch[] = [];
  const p = new GladLogParser();
  p.on("match", (m: GladMatch) => items.push(m));
  p.on("shuffle", (sh) => {
    for (const r of sh.rounds) items.push(r as never);
  });
  for (const line of text.split("\n")) p.push(line);
  p.end();
  const out: Array<{ id: string; legacy: IArenaMatch }> = [];
  for (const m of items) {
    try {
      out.push({ id: m.id, legacy: toLegacyMatch({ ...m, rawLines: [] } as GladMatch) });
    } catch {
      continue;
    }
  }
  return out;
}

async function main(): Promise<void> {
  await ensureAnalysisData();
  const SHOW = process.argv.includes("--show");
  const args = process.argv.slice(2).filter((a) => a !== "--show");
  if (args.length === 0) {
    console.error("usage: auraSplitScan.ts [--show] <raw.txt | dir>...");
    process.exit(2);
  }

  const total = newAuraSplitTally();
  let files = 0;
  for (const file of args.flatMap(rawFiles)) {
    files++;
    const ft = newAuraSplitTally();
    for (const { id, legacy } of itemsOfRawText(readFileSync(file, "utf8")))
      addAuraSplitTally(ft, scanLegacy(legacy, { matchId: id }));
    if (SHOW) for (const s of ft.shows) console.log(s);
    addAuraSplitTally(total, ft);
    if (ft.split > 0 || ft.early > 0)
      console.log(
        `${path.basename(path.dirname(file))} SPLIT=${ft.split} EARLY=${ft.early}`,
      );
  }

  console.log(
    `\n=== ${files} files, ${total.rounds} matches / rounds, ${total.intervals} aura intervals on players; re-broadcast gap ≤ ${GAP_MS} ms ===`,
  );
  console.log(
    "interval → next interval of the same aura, gap ≤ms: " +
      EDGES.map((e, i) => `${e}:${total.hist[i]}`).join("  "),
  );
  console.log(
    "  of which CC auras: " +
      EDGES.map((e, i) => `${e}:${total.histCc[i]}`).join("  "),
  );
  console.log(
    `SPLIT ${total.split} (CC auras ${total.splitCc}); back-to-back intervals from two different sources of one name, not counted: ${total.otherSource}; several sources in the same ms, not counted: ${total.ambiguous}`,
  );
  for (const [name, n] of [...total.bySpell.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20))
    console.log(`  ${n}  ${name}`);
  console.log(
    `EARLY ${total.early} intervals end on a BROKEN line before their REMOVED — ${(total.earlyMs / 1000).toFixed(1)} s cut off in total`,
  );
  for (const [name, n] of [...total.earlyBySpell.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12))
    console.log(`  ${n}  ${name}`);
  process.exit(isClean(total) ? 0 : 1);
}

if (process.argv[1]?.includes("auraSplitScan")) void main();
