/**
 * silenceCastScan.ts — does a silence stop what DB2 says it stops? Measured
 * from the log, for the reading `intervalBlocksSpell` takes (FT-R1011c
 * follow-up, 2026-10-14).
 *
 * The product's reading: a silence aura (`isSilenceOnlyAura`: the official
 * DR silence family, not hard CC) stops a spell unless DB2 says a silence
 * does not prevent it (`isUnsilenceableCast`: a SpellCategories row with no
 * silence bit in PreventionType). A spell with the bit (`isSilenceableCast`)
 * and one with no row stay stopped.
 *
 * Method, per log: every silence aura on a player (APPLIED → REMOVED, any
 * source but the player), and every SPELL_CAST_SUCCESS by that player
 * strictly inside it (APPLIED + 100 ms < cast < REMOVED − 50 ms: the two
 * rows of one instant can be logged in either order). Each cast is put in
 * one class — silenceable / unsilenceable / no row — and counted against
 * every SUCCESS of that class by players in the same files (the per-10k
 * rate is the comparison; the class sizes differ by an order of magnitude).
 *
 * Expected: silenceable ≈ 0 per 10k, unsilenceable well above it. FLAG
 * when silenceable reaches `FLAG_PER_10K` — the bit no longer means what the
 * reading takes it to mean.
 *
 * 2026-10-14, 605 files (manifest-archive-2026-08-28-newseason, every 30):
 * silenceable 2 inside / 372,600 (0.05 per 10k — Blessing of Protection ×2),
 * unsilenceable 2,368 / 336,561 (70 per 10k: Judgment, Crusading Strikes,
 * Dark Pact, Stormstrike, Barkskin …), no row 123 / 44,370 (28 per 10k: pet
 * commands, proc rows — no evidence either way, so the reading keeps them
 * stopped).
 *
 * Usage (repo root):
 *   npx tsx packages/eval/scripts/silenceCastScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-2026-08-28-newseason.txt \
 *     [--every 30] [--top 15]
 *
 * The scan itself (`klassOf`, `scanLogText`, `perTenK`, `isFlagged`) is
 * exported for test/silenceCastScan.test.ts; only the `process.argv` guard at
 * the bottom runs the CLI.
 */
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { isSilenceOnlyAura } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import { parseRawTimestamp } from "@gladlog/analysis/src/utils/rawStreams";
import {
  isSilenceableCast,
  isUnsilenceableCast,
} from "@gladlog/analysis/src/utils/spellMechanics";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

export const FLAG_PER_10K = 1;
export const LEAD_MS = 100;
export const LAG_MS = 50;

export type Klass = "silenceable" | "unsilenceable" | "no row";
export const KLASSES: readonly Klass[] = ["silenceable", "unsilenceable", "no row"];
export const klassOf = (spellId: string): Klass =>
  isSilenceableCast(spellId)
    ? "silenceable"
    : isUnsilenceableCast(spellId)
      ? "unsilenceable"
      : "no row";

export interface SilenceCastCounts {
  /** SUCCESSes strictly inside a silence on their caster, per class. */
  inside: Map<Klass, number>;
  /** Every SUCCESS by a player, per class — the rate's denominator. */
  total: Map<Klass, number>;
  /** Inside-silence casts per class, by `"<name> <id>"`. */
  bySpell: Map<Klass, Map<string, number>>;
}

export const newCounts = (): SilenceCastCounts => ({
  inside: new Map(),
  total: new Map(),
  bySpell: new Map(),
});

export function addCounts(into: SilenceCastCounts, c: SilenceCastCounts): void {
  for (const [k, n] of c.inside) into.inside.set(k, (into.inside.get(k) ?? 0) + n);
  for (const [k, n] of c.total) into.total.set(k, (into.total.get(k) ?? 0) + n);
  for (const [k, m] of c.bySpell) {
    const cur = into.bySpell.get(k) ?? new Map<string, number>();
    for (const [s, n] of m) cur.set(s, (cur.get(s) ?? 0) + n);
    into.bySpell.set(k, cur);
  }
}

/** Inside-silence casts of a class per 10,000 of its SUCCESSes (0 with none). */
export function perTenK(c: SilenceCastCounts, k: Klass): number {
  const n = c.inside.get(k) ?? 0;
  const d = c.total.get(k) ?? 0;
  return d ? (n / d) * 1e4 : 0;
}

/** The FLAG: silenceable casts went out inside silences at ≥ FLAG_PER_10K. */
export const isFlagged = (c: SilenceCastCounts): boolean =>
  perTenK(c, "silenceable") >= FLAG_PER_10K;

/** One raw log's text, read the way the CLI reads a file: the scan's own
 * line split (it needs only the event name, the two GUIDs, the spell id and
 * name), not the parser's. */
export function scanLogText(text: string): SilenceCastCounts {
  const c = newCounts();
  const casts: Array<{ t: number; src: string; id: string; name: string }> =
    [];
  const openAt = new Map<string, number>();
  const silenced = new Map<string, Array<[number, number]>>();
  for (const line of text.split("\n")) {
    const sep = line.indexOf("  ");
    if (sep < 0) continue;
    const body = line.slice(sep + 2);
    const ev = body.slice(0, body.indexOf(","));
    if (
      ev !== "SPELL_CAST_SUCCESS" &&
      ev !== "SPELL_AURA_APPLIED" &&
      ev !== "SPELL_AURA_REMOVED"
    )
      continue;
    const p = body.split(",");
    const t = parseRawTimestamp(line.slice(0, sep));
    if (t === null || p.length < 12) continue;
    const src = p[1] ?? "";
    const dst = p[5] ?? "";
    const id = p[9] ?? "";
    if (ev === "SPELL_CAST_SUCCESS") {
      if (src.startsWith("Player-"))
        casts.push({ t, src, id, name: (p[10] ?? "").replace(/"/g, "") });
      continue;
    }
    if (!dst.startsWith("Player-") || src === dst || !isSilenceOnlyAura(id))
      continue;
    const k = `${dst}|${id}`;
    if (ev === "SPELL_AURA_APPLIED") openAt.set(k, t);
    else {
      const a = openAt.get(k);
      if (a === undefined) continue;
      openAt.delete(k);
      silenced.set(dst, [...(silenced.get(dst) ?? []), [a, t]]);
    }
  }
  for (const cast of casts) {
    const k = klassOf(cast.id);
    c.total.set(k, (c.total.get(k) ?? 0) + 1);
    const spans = silenced.get(cast.src);
    if (!spans?.some(([a, b]) => a + LEAD_MS < cast.t && cast.t < b - LAG_MS))
      continue;
    c.inside.set(k, (c.inside.get(k) ?? 0) + 1);
    const m = c.bySpell.get(k) ?? new Map<string, number>();
    const key = `${cast.name} ${cast.id}`;
    m.set(key, (m.get(key) ?? 0) + 1);
    c.bySpell.set(k, m);
  }
  return c;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { manifest: "", every: 30, top: 15 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--manifest") out.manifest = args[++i] ?? "";
    else if (args[i] === "--every") out.every = Number(args[++i]);
    else if (args[i] === "--top") out.top = Number(args[++i]);
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: silenceCastScan.ts --manifest <path> [--every N] [--top N]",
    );
    process.exit(1);
  }
  return out;
}

async function main() {
  await ensureAnalysisData();
  const args = parseArgs();
  const files = readFileSync(args.manifest, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((_, i) => i % args.every === 0);

  const total = newCounts();
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
    addCounts(total, scanLogText(text));
  }

  console.log(`silenceCastScan: ${read} files`);
  for (const k of KLASSES) {
    const n = total.inside.get(k) ?? 0;
    const d = total.total.get(k) ?? 0;
    console.log(
      `  ${k.padEnd(13)} inside ${String(n).padStart(6)} / ${String(d).padStart(8)}  ${perTenK(total, k).toFixed(2)} per 10k`,
    );
    const top = [...(total.bySpell.get(k) ?? new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, args.top)
      .map(([s, x]) => `${s} ×${x}`);
    if (top.length) console.log(`      ${top.join(", ")}`);
  }
  console.log(
    isFlagged(total)
      ? `FLAG: silenceable casts went out inside silences at ≥ ${FLAG_PER_10K} per 10k — re-check the PreventionType reading`
      : "OK: the silence bit separates the casts a silence stops",
  );
}

if (process.argv[1]?.includes("silenceCastScan")) void main();
