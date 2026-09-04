/**
 * kickLockoutScan.ts — observed school-lockout length per kick id (GH #62).
 *
 * Role since 2026-09-04: the VERIFICATION table for `kickLockoutSeconds`
 * (data/spellEffectData.ts), which answers from the official DB2 PvP duration
 * of the kick spell (SpellMisc.PvPDurationIndex via genSpellEffects) first.
 * GH #62 built this scan believing DB2 had no lockout field; it does, and the
 * generated table already carried Kick = 3. The scan stays because the
 * official value must be re-checked against the log each season: after
 * `SPELL_INTERRUPT` the victim cannot cast the locked school, and players
 * re-cast the moment it unlocks — so the gap from the interrupt to the
 * victim's FIRST subsequent `SPELL_CAST_START` / `SPELL_CAST_SUCCESS` whose
 * school mask overlaps the locked school clusters tightly at the lockout
 * length (0.5 s bins, lower edge). `test/kickLockout.test.ts` gates on the
 * p25 (|official − p25| ≤ 0.5 s, n ≥ 100) — the bin mode can sit one bin
 * late (Counterspell mode 6, p25 5.04, official 5).
 *
 * Output: `packages/analysis/src/data/kickLockoutObservedGenerated.json`
 * (consumed by `kickLockoutSeconds`; listed in `writeManifest.ts`). Only kick
 * ids with ≥ MIN_N pairs and a mode ≥ MIN_LOCKOUT_S are written; everything
 * else falls through to the official value / 3 s. Re-run each season
 * (update-wow-data §6b-pre-5).
 *
 * Usage:
 *   npx tsx packages/eval/scripts/kickLockoutScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt \
 *     [--every 30] [--out packages/analysis/src/data/kickLockoutObservedGenerated.json]
 *
 * 2026-09-02 (S2 archive, every 30th file = 605 files, 6,134 interrupts, 5,322
 * pairs): Counterspell 6, Spell Lock 5, Quell 4, Wind Shear 2, Shambling Rush 2,
 * every other kick 3 — melee kicks are genuinely 3 s in 12.1, so the old
 * fallback was right by accident for them and wrong for the five above.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { gunzipSync } from "zlib";

const MIN_N = 20;
const MIN_LOCKOUT_S = 1.5;
const BIN_S = 0.5;
const MAX_GAP_S = 20;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    manifest: "",
    every: 30,
    // Relative to the repo root (every eval CLI is run from there)
    out: resolve(
      "packages/analysis/src/data/kickLockoutObservedGenerated.json",
    ),
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest") out.manifest = args[++i] ?? "";
    else if (args[i] === "--every") out.every = Number(args[++i]);
    else if (args[i] === "--out") out.out = resolve(args[++i] ?? "");
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: kickLockoutScan.ts --manifest <path> [--every N] [--out <json>]",
    );
    process.exit(1);
  }
  return out;
}

const TS = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)/;
function tsMs(line: string): number | null {
  const m = TS.exec(line);
  if (!m) return null;
  return Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6], +m[7]);
}

const quantile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

function modeBinLowerEdge(gaps: number[]): number | null {
  const counts = new Map<number, number>();
  for (const g of gaps) {
    if (g < MIN_LOCKOUT_S) continue;
    const edge = Math.floor(g / BIN_S) * BIN_S;
    counts.set(edge, (counts.get(edge) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestN = 0;
  for (const [edge, n] of counts) {
    if (n > bestN || (n === bestN && best !== null && edge < best)) {
      best = edge;
      bestN = n;
    }
  }
  return best;
}

const args = parseArgs();
const all = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
const files = all.filter((_, i) => i % args.every === 0);

const stats = new Map<string, { name: string; gaps: number[] }>();
let interrupts = 0;
let paired = 0;
let read = 0;
for (const f of files) {
  let text: string;
  try {
    const raw = readFileSync(f);
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  read++;
  const pending = new Map<
    string,
    { at: number; school: number; kick: string }
  >();
  for (const line of text.split("\n")) {
    const sep = line.indexOf("  ");
    if (sep < 0) continue;
    const body = line.slice(sep + 2);
    if (body.startsWith("ARENA_MATCH_")) {
      pending.clear();
      continue;
    }
    if (body.startsWith("SPELL_INTERRUPT,")) {
      const p = body.split(",");
      const dst = p[5];
      const kick = p[9];
      const name = (p[10] ?? "").replace(/"/g, "");
      const school = Number(p[14]);
      const at = tsMs(line);
      if (at === null || !Number.isFinite(school) || school === 0) continue;
      interrupts++;
      if (!stats.has(kick)) stats.set(kick, { name, gaps: [] });
      pending.set(dst, { at, school, kick });
      continue;
    }
    if (
      body.startsWith("SPELL_CAST_START,") ||
      body.startsWith("SPELL_CAST_SUCCESS,")
    ) {
      const p = body.split(",");
      const pend = pending.get(p[1]);
      if (!pend) continue;
      const school = Number(p[11]);
      if (!Number.isFinite(school) || (school & pend.school) === 0) continue; // another school is not locked
      const at = tsMs(line);
      if (at === null) continue;
      pending.delete(p[1]);
      const gap = (at - pend.at) / 1000;
      if (gap < 0 || gap > MAX_GAP_S) continue;
      paired++;
      stats.get(pend.kick)!.gaps.push(gap);
    }
  }
}

const entries: Record<
  string,
  { name: string; lockoutSeconds: number; n: number; p25: number; p50: number }
> = {};
const skipped: string[] = [];
for (const [id, s] of [...stats.entries()].sort(
  (a, b) => b[1].gaps.length - a[1].gaps.length,
)) {
  const sorted = [...s.gaps].sort((a, b) => a - b);
  const mode = modeBinLowerEdge(sorted);
  if (sorted.length < MIN_N || mode === null) {
    skipped.push(`${id} ${s.name} (n=${sorted.length})`);
    continue;
  }
  entries[id] = {
    name: s.name,
    lockoutSeconds: mode,
    n: sorted.length,
    p25: Number(quantile(sorted, 0.25).toFixed(2)),
    p50: Number(quantile(sorted, 0.5).toFixed(2)),
  };
}

const doc = {
  generatedAt: new Date().toISOString(),
  generator: "packages/eval/scripts/kickLockoutScan.ts",
  manifest: args.manifest.replace(/^.*\/corpus\//, "corpus/"),
  every: args.every,
  files: read,
  interrupts,
  paired,
  rule: `first same-school cast after SPELL_INTERRUPT; ${BIN_S}s-bin mode (lower edge) over gaps >= ${MIN_LOCKOUT_S}s; n >= ${MIN_N}`,
  entries,
};
writeFileSync(args.out, JSON.stringify(doc, null, 2) + "\n");
console.log(
  `files=${read} interrupts=${interrupts} paired=${paired} entries=${Object.keys(entries).length} → ${args.out}`,
);
for (const [id, e] of Object.entries(entries))
  console.log(
    `  ${id}\t${e.name}\t${e.lockoutSeconds}s\tn=${e.n}\tp25=${e.p25}\tp50=${e.p50}`,
  );
if (skipped.length) console.log(`skipped (fallback 3s): ${skipped.join(", ")}`);
