/**
 * drShareScan.ts — do two CC flavours share a DR category? Measured from the
 * log, not asserted by a table.
 *
 * Born 2026-09-25 (reliability audit C5): `DR_CATEGORY_MAP` overrode DB2 for
 * 33786 Cyclone (DB2 Disorient → own "Cyclone" category) and 99 Incapacitating
 * Roar (DB2 Incapacitate → "Disorient"). GH #33 unified every consumer onto
 * the override without ever testing the override against the game; on the
 * five audited matches Cyclone after a Disorient-category CC landed at full
 * duration 0/34 times, and Roar after Disorient landed full 6 times — both
 * overrides contradicted. User ruling 2026-09-24: follow DB2 after a corpus
 * scan. This is that scan, kept runnable for the season refresh
 * (update-wow-data.md §7b).
 *
 * Method, per player target: every hard-CC application (APPLIED → REMOVED
 * lifetime) and every CC `SPELL_MISSED … IMMUNE`. For an application X at t,
 * its predecessors are the applications on the same target whose lifetime
 * ended within the DR reset window (`drResetMsAt`) before t (or is still running). The pair is kept
 * only when ALL predecessors belong to ONE flavour F that differs from X's own
 * flavour (a same-spell or mixed-flavour predecessor makes the attribution
 * ambiguous). A flavour is the DB2 DR category (`DR_CATEGORIES_GENERATED`),
 * except the spells under test, which are their own flavour. X's outcome is
 * its lifetime over its full duration (`ccFullDurationSeconds`):
 *   full ≥ 0.85 · half 0.40–0.60 · immune (SPELL_MISSED IMMUNE) · other
 *   (breaks, dispels, trinkets — not evidence either way).
 * If X and F share a DR, "full" is impossible (the second CC in a category is
 * at most 50 %); if they don't, X after F looks like X with no predecessor.
 * The no-predecessor row is printed as that baseline.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/drShareScan.ts \
 *     --manifest $GLADLOG_EVAL_HOME/corpus/manifest-archive-<date>.txt [--every 30] [--spells 33786,99]
 */
import { DR_CATEGORIES_GENERATED } from "@gladlog/analysis/src/data/drCategoriesGenerated";
import {
  ccFullDurationSeconds,
  getEnglishSpellName,
} from "@gladlog/analysis/src/data/spellEffectData";
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import { ensureAnalysisData } from "@gladlog/analysis/src/data/ensure";
import { drResetMsAt } from "@gladlog/analysis/src/utils/drAnalysis";
import { readFileSync } from "fs";
import { gunzipSync } from "zlib";

function parseArgs() {
  const a = process.argv.slice(2);
  const out = { manifest: "", every: 30, spells: ["33786", "99"] };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--manifest") out.manifest = a[++i] ?? "";
    else if (a[i] === "--every") out.every = Number(a[++i]);
    else if (a[i] === "--spells")
      out.spells = (a[++i] ?? "").split(",").filter(Boolean);
  }
  if (!out.manifest || !Number.isFinite(out.every) || out.every < 1) {
    console.error(
      "usage: drShareScan.ts --manifest <path> [--every N] [--spells 33786,99]",
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

await ensureAnalysisData();
const args = parseArgs();
const UNDER_TEST = new Set(args.spells);
// DB2's own category per id (the generated table is category → ids)
const db2Cat: Record<string, string> = {};
for (const [cat, ids] of Object.entries(DR_CATEGORIES_GENERATED))
  for (const id of ids) db2Cat[id] = cat;
const flavour = (id: string): string | undefined =>
  UNDER_TEST.has(id)
    ? `${getEnglishSpellName(id, id)} (${id})`
    : db2Cat[id] !== undefined
      ? db2Cat[id]
      : undefined;

type Outcome = "full" | "half" | "immune" | "other";
const tally = new Map<string, Record<Outcome, number>>();
const bump = (key: string, o: Outcome) => {
  let t = tally.get(key);
  if (!t) tally.set(key, (t = { full: 0, half: 0, immune: 0, other: 0 }));
  t[o]++;
};

interface App {
  spell: string;
  at: number;
  end: number; // Infinity while running
  immune: boolean;
}

const files = readFileSync(args.manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % args.every === 0);

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
  // per target: every application in time order (closed or open)
  let byDst = new Map<string, App[]>();
  const open = new Map<string, App>();
  const judge = () => {
    for (const apps of byDst.values()) {
      for (let i = 0; i < apps.length; i++) {
        const x = apps[i]!;
        const fx = flavour(x.spell);
        if (fx === undefined) continue;
        const preds = apps
          .slice(0, i)
          .filter((p) => !p.immune && p.end >= x.at - drResetMsAt(x.at));
        let outcome: Outcome;
        if (x.immune) outcome = "immune";
        else {
          const full = ccFullDurationSeconds(x.spell);
          if (full === undefined || !Number.isFinite(x.end)) continue;
          const r = (x.end - x.at) / 1000 / full;
          outcome =
            r >= 0.85 ? "full" : r >= 0.4 && r <= 0.6 ? "half" : "other";
        }
        const fl = new Set(preds.map((p) => flavour(p.spell) ?? "?"));
        if (preds.length === 0) {
          if (UNDER_TEST.has(x.spell)) bump(`${fx} | (none)`, outcome);
          continue;
        }
        if (fl.size !== 1 || preds.some((p) => p.spell === x.spell)) continue;
        const F = [...fl][0]!;
        if (F === fx || F === "?") continue;
        const focal = [...UNDER_TEST].some(
          (id) => x.spell === id || preds.some((p) => p.spell === id),
        );
        if (focal) bump(`${fx} | after ${F}`, outcome);
      }
    }
    byDst = new Map();
    open.clear();
  };
  for (const line of text.split("\n")) {
    const sep = line.indexOf("  ");
    if (sep < 0) continue;
    const body = line.slice(sep + 2);
    if (body.startsWith("ARENA_MATCH_START")) {
      judge();
      continue;
    }
    const isAura = body.startsWith("SPELL_AURA_");
    const isMiss = body.startsWith("SPELL_MISSED,");
    if (!isAura && !isMiss) continue;
    const p = body.split(",");
    const ev = p[0];
    const dst = p[5] ?? "";
    const spell = p[9] ?? "";
    if (!dst.startsWith("Player-") || !ccSpellIds.has(spell)) continue;
    if (db2Cat[spell] === undefined && !UNDER_TEST.has(spell)) continue;
    const at = tsMs(line);
    if (at === null) continue;
    const list = byDst.get(dst) ?? [];
    byDst.set(dst, list);
    if (isMiss) {
      if (p[12] === "IMMUNE") list.push({ spell, at, end: at, immune: true });
      continue;
    }
    const key = `${p[1]}|${dst}|${spell}`;
    if (ev === "SPELL_AURA_APPLIED" || ev === "SPELL_AURA_REFRESH") {
      const prev = open.get(key);
      if (prev) prev.end = at;
      const app: App = { spell, at, end: Infinity, immune: false };
      list.push(app);
      open.set(key, app);
    } else if (
      ev === "SPELL_AURA_REMOVED" ||
      ev === "SPELL_AURA_BROKEN" ||
      ev === "SPELL_AURA_BROKEN_SPELL"
    ) {
      const o = open.get(key);
      if (o) {
        o.end = at;
        open.delete(key);
      }
    }
  }
  judge();
}

console.log(
  `files=${read} (every ${args.every}) under test: ${[...UNDER_TEST].map((id) => `${id}=${getEnglishSpellName(id, id)} DB2 ${db2Cat[id] ?? "—"}`).join(", ")}`,
);
console.log(
  "X | predecessor flavour            n   full  half  immune  other  full%",
);
for (const [key, t] of [...tally.entries()].sort()) {
  const n = t.full + t.half + t.immune + t.other;
  console.log(
    `${key.padEnd(44)} ${String(n).padStart(5)} ${String(t.full).padStart(5)} ${String(t.half).padStart(5)} ${String(t.immune).padStart(7)} ${String(t.other).padStart(6)}  ${n ? ((100 * t.full) / n).toFixed(0).padStart(4) : "   -"}%`,
  );
}
