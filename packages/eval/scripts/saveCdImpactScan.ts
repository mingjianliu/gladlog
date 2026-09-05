/**
 * saveCdImpactScan.ts — "how big and how fast is this save cooldown, in the
 * hands of the healers who press it" (GH #63 phase B, user-approved
 * 2026-09-04: measure before signing anything).
 *
 * The roster question — which cooldowns count as SAVE tools for cd-hoarded /
 * [CD PRIOR] — reduces to one measurement: in the crisis window the product
 * judges, did pressing it change what happened to the lowest friendly? Two
 * axes, both measured here per press, for the auto-roster AND the
 * rejected-for-review candidates of healerSaveCdGenerated.json:
 *
 *  magnitude — protection delivered to the lowest-HP alive friendly in the
 *    5 s after the press, as % of that unit's max HP: the healer's effective
 *    healing on them + absorbs on them + damage the pressed spell's official
 *    mitigation prevented (taken × pct/(100−pct)) when the spell reached
 *    them. Amplifiers (Nature's Swiftness, Avenging Wrath, …) are measured by
 *    the same rule — the healing they amplified lands in the same window —
 *    against CONTROL moments: seconds in the same round where the lowest
 *    friendly sat at a similar HP (±5 pp) with no candidate press nearby,
 *    same healer, same 5 s rule. `delta` = press − control is the amplifier
 *    increment and, for direct tools, the honest "more than you'd have
 *    healed anyway".
 *  latency — seconds from the press to the first heal/absorb landing on
 *    that friendly (0 for a mitigation that applies at press).
 *  outcome — the friendly's death within 10 s after the press vs after the
 *    control moments (same caveat as every outcome probe: descriptive).
 *
 *   scan    tsx saveCdImpactScan.ts scan --manifest <file> --out <rows.jsonl>
 *             [--every N] [--offset N] [--limit N]
 *   report  tsx saveCdImpactScan.ts report --in <rows.jsonl> [--min-n 30]
 *   talents tsx saveCdImpactScan.ts talents --in <rows.jsonl> [--min-n 100] [--top 4]
 *             # per (spec, spell): which of the healer's talent entries shift
 *             # Δ the most (presses WITH the talent vs WITHOUT, each arm
 *             # ≥ min-n) — the "does Avenging Crusader's free Holy Light
 *             # talent make it bigger" question, answered from data
 *
 * Shared predicates: target selection is `lowestFriendlyGridHp` (the
 * [CD PRIOR] engine's, i.e. the [STATE] tick's sampler), the "somebody
 * needed it" door is `CD_TRIGGER_NEEDED_HP_PCT`, mitigation % is the
 * official `abilityProfile`.
 */
import { ensureAnalysisData, heroBuildGroupOf, isHealerSpec, specToString } from "@gladlog/analysis";
import {
  CD_TRIGGER_NEEDED_HP_PCT,
  lowestFriendlyGridHp,
} from "@gladlog/analysis/src/analysis/cdTriggerPrior";
import { abilityProfile } from "@gladlog/analysis/src/data/abilityProfile";
import ROSTER from "@gladlog/analysis/src/data/healerSaveCdGenerated.json";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import TALENT_ID_MAP from "@gladlog/analysis/src/data/talentIdMap.json";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { GladLogParser } from "@gladlog/parser";
import {
  CombatUnitReaction,
  LogEvent,
  toLegacyMatch,
  toLegacyShuffle,
} from "@gladlog/parser-compat";
import { appendFileSync, closeSync, openSync, readFileSync, readSync } from "fs";
import { basename } from "path";
import { gunzipSync } from "zlib";

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (f: string, d: number): number => Number(flag(f) ?? d);

export const IMPACT_WINDOW_MS = 5_000;
export const OUTCOME_WINDOW_MS = 10_000;
/** control moment: lowest friendly within this many pp of the press's hp0 */
const CONTROL_HP_TOL = 5;
/** no candidate press by the same healer within this many s of a control */
const CONTROL_QUIET_S = 5;
const CONTROLS_PER_PRESS = 3;

interface Row {
  matchId: string;
  spec: string;
  spellId: string;
  spellName: string;
  hp0: number;
  targetIsSelf: boolean;
  /** the healer's talent entry ids (COMBATANT_INFO id2) — for the
   * talent-enhancement split (report `talents`): which talents shift Δ */
  talents: number[];
  heroTree: string;
  press: { protectionPct: number; healPct: number; absorbPct: number; preventedPct: number; latencyS: number | null; died10: boolean };
  control: { protectionPct: number; died10: number; n: number } | null;
}

function candidatesOf(specName: string): Set<string> {
  const r = (ROSTER as any).specs?.[specName]?.spells ?? [];
  const rej = (ROSTER as any).rejectedForReview?.[specName] ?? [];
  return new Set<string>([...r, ...rej].map((e: any) => String(e.spellId)));
}

function maxHpAt(unit: any, tMs: number): number | null {
  let best: any = null;
  for (const a of unit.advancedActions ?? []) {
    if (a.advancedActorId && a.advancedActorId !== unit.id) continue;
    const d = Math.abs(a.timestamp - tMs);
    if (d <= 3000 && (!best || d < Math.abs(best.timestamp - tMs))) best = a;
  }
  return best?.advancedActorMaxHp ?? null;
}

function protectionIn(
  healer: any,
  target: any,
  fromMs: number,
  toMs: number,
  mitigationPct: number | undefined,
): { heal: number; absorb: number; prevented: number; firstMs: number | null } {
  let heal = 0;
  let absorb = 0;
  let taken = 0;
  let firstMs: number | null = null;
  for (const e of healer.healOut ?? []) {
    if (e.destUnitId !== target.id) continue;
    if (e.timestamp < fromMs || e.timestamp > toMs) continue;
    const amt = Math.max(0, e.effectiveAmount ?? e.amount ?? 0);
    heal += amt;
    if (amt > 0 && (firstMs === null || e.timestamp < firstMs)) firstMs = e.timestamp;
  }
  for (const e of target.absorbsIn ?? []) {
    if (e.timestamp < fromMs || e.timestamp > toMs) continue;
    absorb += Math.max(0, e.absorbedAmount ?? 0);
    if ((e.absorbedAmount ?? 0) > 0 && (firstMs === null || e.timestamp < firstMs)) firstMs = e.timestamp;
  }
  for (const e of target.damageIn ?? []) {
    if (e.timestamp < fromMs || e.timestamp > toMs) continue;
    taken += Math.abs(e.effectiveAmount ?? e.amount ?? 0);
  }
  const prevented =
    mitigationPct && mitigationPct > 0 && mitigationPct < 100
      ? (taken * mitigationPct) / (100 - mitigationPct)
      : mitigationPct === 100
        ? taken
        : 0;
  return { heal, absorb, prevented, firstMs };
}

function diedWithin(unit: any, fromMs: number, toMs: number): boolean {
  return (unit.deathRecords ?? []).some((d: any) => d.timestamp > fromMs && d.timestamp <= toMs);
}

function scan(): void {
  const manifest = flag("--manifest");
  const out = flag("--out");
  if (!manifest || !out) {
    console.error("usage: scan --manifest <file> --out <rows.jsonl> [--every N] [--offset N] [--limit N]");
    process.exit(1);
  }
  let files = readFileSync(manifest, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const every = num("--every", 1);
  const offset = num("--offset", 0);
  const limit = num("--limit", 0);
  if (offset) files = files.slice(offset);
  if (every > 1) files = files.filter((_, i) => i % every === 0);
  if (limit) files = files.slice(0, limit);
  let scanned = 0;
  let rows = 0;
  for (const path of files) {
    let text: string;
    try {
      const raw = readFileSync(path);
      text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
    } catch {
      continue;
    }
    const combats: any[] = [];
    try {
      const parser = new GladLogParser();
      parser.on("match", (m: any) => combats.push(toLegacyMatch(m)));
      parser.on("shuffle", (sh: any) => {
        for (const r of toLegacyShuffle(sh).rounds ?? []) combats.push(r);
      });
      for (const line of text.split("\n")) parser.push(line);
      parser.end();
    } catch {
      continue;
    }
    scanned++;
    const matchId = basename(path).replace(/\.txt\.gz$|\.gz$|\.txt$/, "");
    const lines: string[] = [];
    for (const c of combats) {
      if ((c.startTime ?? 0) < PATCH_121_GOLIVE_EPOCH_MS) continue;
      const startMs: number = c.startTime;
      const lastSec = Math.floor((c.endTime - startMs) / 1000);
      const units: any[] = Object.values(c.units ?? {});
      for (const h of units) {
        if (!h.info || !isHealerSpec(h.spec)) continue;
        if (h.reaction !== CombatUnitReaction.Friendly && h.reaction !== CombatUnitReaction.Hostile) continue;
        const spec = specToString(h.spec);
        const cands = candidatesOf(spec);
        if (cands.size === 0) continue;
        const friends = units.filter((u) => u.info && u.reaction === h.reaction);
        const presses = (h.spellCastEvents ?? [])
          .filter((e: any) => e.logLine?.event === LogEvent.SPELL_CAST_SUCCESS && e.spellId && cands.has(e.spellId))
          .sort((a: any, b: any) => a.timestamp - b.timestamp);
        if (presses.length === 0) continue;
        const pressSecs = presses.map((e: any) => (e.timestamp - startMs) / 1000);
        // lowest-friendly series once per healer (friends differ by side)
        const series: Array<{ hpPct: number; unit: any } | null> = [];
        for (let s = 0; s <= lastSec; s++) series.push(lowestFriendlyGridHp(friends, startMs, s));
        for (const e of presses) {
          const t = e.timestamp;
          const sec = Math.floor((t - startMs) / 1000);
          if (sec < 0 || sec > lastSec) continue;
          const low = series[sec];
          if (!low || low.hpPct >= CD_TRIGGER_NEEDED_HP_PCT) continue;
          const target = low.unit;
          const maxHp = maxHpAt(target, t);
          if (!maxHp) continue;
          const p = abilityProfile(e.spellId);
          const reaches = p.reachesAlly || target.id === h.id;
          const mit = reaches ? p.mitigationPct : undefined;
          const w = protectionIn(h, target, t, t + IMPACT_WINDOW_MS, mit);
          const latencyS = mit && mit > 0 ? 0 : w.firstMs === null ? null : (w.firstMs - t) / 1000;
          // controls: same healer, lowest friendly within ±5 pp, no candidate press within ±5 s, ≥10 s from this press
          const ctrl: Array<{ protectionPct: number; died10: boolean }> = [];
          const order = [...Array(lastSec + 1).keys()].sort((a, b) => Math.abs(a - sec) - Math.abs(b - sec));
          for (const s of order) {
            if (ctrl.length >= CONTROLS_PER_PRESS) break;
            if (Math.abs(s - sec) < 10) continue;
            const l = series[s];
            if (!l || Math.abs(l.hpPct - low.hpPct) > CONTROL_HP_TOL) continue;
            if (pressSecs.some((ps: number) => Math.abs(ps - s) <= CONTROL_QUIET_S)) continue;
            const tm = startMs + s * 1000;
            const mh = maxHpAt(l.unit, tm);
            if (!mh) continue;
            const cw = protectionIn(h, l.unit, tm, tm + IMPACT_WINDOW_MS, undefined);
            ctrl.push({
              protectionPct: (100 * (cw.heal + cw.absorb)) / mh,
              died10: diedWithin(l.unit, tm, tm + OUTCOME_WINDOW_MS),
            });
          }
          const row: Row = {
            matchId,
            spec,
            spellId: e.spellId,
            spellName: getEnglishSpellName(e.spellId, e.spellName),
            hp0: low.hpPct,
            targetIsSelf: target.id === h.id,
            talents: (h.info?.talents ?? []).filter(Boolean).map((t: any) => t.id2),
            heroTree: heroBuildGroupOf(h.info?.talents),
            press: {
              protectionPct: (100 * (w.heal + w.absorb + w.prevented)) / maxHp,
              healPct: (100 * w.heal) / maxHp,
              absorbPct: (100 * w.absorb) / maxHp,
              preventedPct: (100 * w.prevented) / maxHp,
              latencyS,
              died10: diedWithin(target, t, t + OUTCOME_WINDOW_MS),
            },
            control: ctrl.length
              ? {
                  protectionPct: ctrl.reduce((a, x) => a + x.protectionPct, 0) / ctrl.length,
                  died10: ctrl.filter((x) => x.died10).length / ctrl.length,
                  n: ctrl.length,
                }
              : null,
          };
          lines.push(JSON.stringify(row));
          rows++;
        }
      }
    }
    if (lines.length) appendFileSync(out, lines.join("\n") + "\n");
    if (scanned % 200 === 0) console.error(`scanned ${scanned} files, ${rows} presses`);
  }
  console.error(`done: ${scanned} files, ${rows} presses → ${out}`);
}

/** Stream the rows file: the full-archive run is 860k rows / >512 MB, past
 * Node's single-string limit, so `readFileSync` cannot be used here. */
function readRowsSync(inPath: string, keep: (r: Row) => boolean = () => true): Row[] {
  const rows: Row[] = [];
  const fd = openSync(inPath, "r");
  const buf = Buffer.alloc(1 << 24);
  let rest = "";
  for (;;) {
    const n = readSync(fd, buf, 0, buf.length, null);
    if (n <= 0) break;
    rest += buf.toString("utf8", 0, n);
    let i;
    while ((i = rest.indexOf("\n")) >= 0) {
      const l = rest.slice(0, i);
      rest = rest.slice(i + 1);
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l) as Row;
        if (keep(r)) rows.push(r);
      } catch {
        /* torn */
      }
    }
  }
  closeSync(fd);
  if (rest.trim()) {
    try {
      const r = JSON.parse(rest) as Row;
      if (keep(r)) rows.push(r);
    } catch {
      /* torn */
    }
  }
  return rows;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

function report(): void {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: report --in <rows.jsonl> [--min-n N]");
    process.exit(1);
  }
  const minN = num("--min-n", 30);
  const rows: Row[] = readRowsSync(inPath);
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.spec}|${r.spellName} (${r.spellId})`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  console.log(`presses ${rows.length} (lowest friendly < ${CD_TRIGGER_NEEDED_HP_PCT}% at the press)`);
  console.log("");
  console.log("| spec | spell | n | hp0 p50 | protection 5s p50 (% max HP) | of which heal / absorb / prevented | control 5s p50 | Δ (press − control) | latency p50 s | died ≤10s press | died ≤10s control |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|");
  const keys = [...groups.keys()].sort((a, b) => {
    const sa = a.split("|")[0]!;
    const sb = b.split("|")[0]!;
    if (sa !== sb) return sa < sb ? -1 : 1;
    return groups.get(b)!.length - groups.get(a)!.length;
  });
  for (const k of keys) {
    const g = groups.get(k)!;
    if (g.length < minN) continue;
    const [spec, spell] = k.split("|");
    const prot = median(g.map((r) => r.press.protectionPct));
    const heal = median(g.map((r) => r.press.healPct));
    const abs = median(g.map((r) => r.press.absorbPct));
    const prev = median(g.map((r) => r.press.preventedPct));
    const withCtrl = g.filter((r) => r.control);
    const ctrl = withCtrl.length ? median(withCtrl.map((r) => r.control!.protectionPct)) : NaN;
    const lat = g.filter((r) => r.press.latencyS !== null).map((r) => r.press.latencyS as number);
    const died = g.filter((r) => r.press.died10).length / g.length;
    const diedC = withCtrl.length ? withCtrl.reduce((a, r) => a + r.control!.died10, 0) / withCtrl.length : NaN;
    const f = (x: number, d = 1) => (Number.isNaN(x) ? "—" : x.toFixed(d));
    console.log(
      `| ${spec} | ${spell} | ${g.length} | ${f(median(g.map((r) => r.hp0)), 0)} | ${f(prot)} | ${f(heal)} / ${f(abs)} / ${f(prev)} | ${f(ctrl)} | ${f(prot - ctrl)} | ${lat.length ? f(median(lat)) : "—"} (${lat.length}/${g.length} landed) | ${f(100 * died)}% | ${f(100 * diedC)}% |`,
    );
  }
}

/** id2 (talent entry id, as COMBATANT_INFO reports it) → name / spellId, from
 * the same talentIdMap.json `findHeroTalent` reads. */
function talentEntryNames(): Map<number, string> {
  const out = new Map<number, string>();
  for (const tree of TALENT_ID_MAP as any[])
    for (const bucket of ["classNodes", "specNodes", "heroNodes", "subTreeNodes"])
      for (const node of tree[bucket] ?? [])
        for (const e of node.entries ?? []) if (e?.id) out.set(e.id, `${e.name}${e.spellId ? ` [${e.spellId}]` : ""}`);
  return out;
}

function talents(): void {
  const inPath = flag("--in");
  if (!inPath) {
    console.error("usage: talents --in <rows.jsonl> [--min-n N] [--top K]");
    process.exit(1);
  }
  const minN = num("--min-n", 100);
  const top = num("--top", 4);
  /** --entry <id2>: always print this talent entry's split (e.g. Hand of
   * Divinity 133501 for Avenging Crusader), even if it is not a top shift. */
  const forced = flag("--entry") ? Number(flag("--entry")) : null;
  const rows: Row[] = readRowsSync(inPath, (r) => Array.isArray(r.talents));
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.spec}|${r.spellName} (${r.spellId})`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const delta = (g: Row[]): number => {
    const withCtrl = g.filter((r) => r.control);
    return median(g.map((r) => r.press.protectionPct)) - median(withCtrl.map((r) => r.control!.protectionPct));
  };
  const names = talentEntryNames();
  console.log(`presses with talent data: ${rows.length}`);
  console.log("");
  console.log("| spec | spell | n | Δ all | talent entry (id2) | n with / without | Δ with | Δ without | shift |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (g.length < 2 * minN) continue;
    const [spec, spell] = k.split("|");
    const all = delta(g);
    const ids = new Map<number, number>();
    for (const r of g) for (const t of new Set(r.talents)) ids.set(t, (ids.get(t) ?? 0) + 1);
    const shifts: Array<{ id: number; nWith: number; nWithout: number; dWith: number; dWithout: number }> = [];
    for (const [id, nWith] of ids) {
      const nWithout = g.length - nWith;
      if (nWith < minN || nWithout < minN) continue;
      const w = g.filter((r) => r.talents.includes(id));
      const wo = g.filter((r) => !r.talents.includes(id));
      shifts.push({ id, nWith, nWithout, dWith: delta(w), dWithout: delta(wo) });
    }
    shifts.sort((a, b) => Math.abs(b.dWith - b.dWithout) - Math.abs(a.dWith - a.dWithout));
    // hero tree split as well (the study's own axis)
    const trees = new Map<string, Row[]>();
    for (const r of g) (trees.get(r.heroTree) ?? trees.set(r.heroTree, []).get(r.heroTree)!).push(r);
    const treeNote = [...trees.entries()]
      .filter(([, rs]) => rs.length >= minN)
      .map(([t, rs]) => `${t}: Δ${delta(rs).toFixed(1)} (n=${rs.length})`)
      .join("; ");
    if (treeNote) console.log(`| ${spec} | ${spell} | ${g.length} | ${all.toFixed(1)} | hero tree | — | — | — | ${treeNote} |`);
    const shown = shifts.slice(0, top);
    if (forced !== null) {
      const f = shifts.find((x) => x.id === forced);
      if (f && !shown.includes(f)) shown.push(f);
    }
    for (const sh of shown)
      console.log(
        `| ${spec} | ${spell} | ${g.length} | ${all.toFixed(1)} | ${names.get(sh.id) ?? "?"} (${sh.id}) | ${sh.nWith} / ${sh.nWithout} | ${sh.dWith.toFixed(1)} | ${sh.dWithout.toFixed(1)} | ${(sh.dWith - sh.dWithout).toFixed(1)} |`,
      );
  }
}

(async () => {
  await ensureAnalysisData();
  if (cmd === "scan") scan();
  else if (cmd === "report") report();
  else if (cmd === "talents") talents();
  else {
    console.error("usage: scan | report | talents");
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
