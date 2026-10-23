/* eslint-disable @typescript-eslint/no-explicit-any -- the scan walks the untyped legacy parse objects (match.units, auraEvents, damageOut) by the hundred */
/**
 * corpusFactScan3.ts — corpus-wide deterministic fact checks, batch 3
 * (fact4 F17, 2026-10-22): the classes of the round-4 double audit
 * (`runs/fact4-2026-10-22`), searched over a whole acceptanceCapture capture
 * (`<dir>/s<k>/{context,findings}/`). The same harness as
 * `corpusFactScan2.ts` (file loop, parse cache, pid mapping, `unmapped` →
 * exit 1, `--examples N`, distinct-fact counting). Every check derives its
 * fact from the log rows directly — never through the analysis predicate it
 * audits. Tables read here are lookups only: English names, cast ↔ effect
 * aura, the official mitigation table's percentages, DR categories, the
 * offensive cooldown id list.
 *
 *  - `enemyDefForward` (D6 / D19 / D62): an enemy player's own aura of a
 *    `MITIGATION_TABLE` row of at least `MITIGATION_WALL_MIN_PCT` (a wall,
 *    an immunity, a deflection — the table's percentage, read as data;
 *    a cast-keyed row through its logged aura), APPLIED by the unit on
 *    itself inside the round while it lived: an `[ENEMY DEF]` line of that
 *    unit naming the spell is printed at its second ± 1. Aspect of the
 *    Turtle's 71 lines → 0 in 03a355dcd is the shape.
 *  - `burstAnswerPress` (D32): a `[BURST ANSWERED] … N(Spec) answered with
 *    X {in Ls | Ls before it opened}` line. The unit has a SUCCESS row of a
 *    spell printed X at the instant the latency places (the line's second
 *    ± its rounding) that is a PRESS — not a channel tick: a row of the same
 *    id ≤ 1.05 s before it, in a run another id of the spell opened (a
 *    channel's ticks come ~1 s apart). `tick`:
 *    every row there is a tick (Divine Hymn's last 64844 tick, 4accb068 r3
 *    0:40). `noRow`: no row at all (an answer timed at a control's aura) —
 *    measured, not in the total.
 *  - `hardCastOrder` (D21): an `[ENEMY HARD CAST] … (Ts cast, went off)`
 *    line with no miss type. Its completion's cluster — the caster's
 *    completions of the spell at that target, chained while ≤ 2.5 s apart —
 *    and the result rows (damage, miss) of the spell from the caster at the
 *    target inside [first completion, last + 2.5 s]: with at least as many
 *    rows as completions, none of them went off (3ab80597 r3 2:13).
 *  - `crisisCc` (D28): a `crisis-no-response` menu row at t. The owner's
 *    control auras from an enemy source (an enemy player or a unit it owns;
 *    a DR family other than Disarm) cover more than 2 s of [t, t + 3 s] —
 *    the row says the player was free (4184d534 1:54, Void Nova 79 ms in).
 *  - `crisisBurst` (D9): a `crisis-no-response` row printing `burst=no`
 *    while an enemy player's own aura of an `OFFENSIVE_CD_SPELL_IDS` cast
 *    (its id or a same-named effect aura) was up at t (2d25d01a 4:34,
 *    Avenging Wrath 4:15–4:39).
 *
 *   npx tsx packages/eval/scripts/corpusFactScan3.ts <captureDir> [--examples N] [--archive-dir <dir>] [--json <path>]
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import {
  castsOfEffectAura,
  effectAurasOfCast,
} from "@gladlog/analysis/src/data/castEffectAuras";
import {
  MITIGATION_TABLE,
  MITIGATION_WALL_MIN_PCT,
  SELF_WALL_AURA_TO_CAST_ID,
} from "@gladlog/analysis/src/data/mitigationData";
import {
  ccFullDurationSeconds,
  getEnglishSpellName,
} from "@gladlog/analysis/src/data/spellEffectData";
import spellEffectGenerated from "@gladlog/analysis/src/data/spellEffectGenerated.json";
import { isEnemyCdWindowSpell } from "@gladlog/analysis/src/utils/cooldowns";
import {
  drCategoryOfCast,
  getDRCategory,
} from "@gladlog/analysis/src/utils/drAnalysis";
import { OFFENSIVE_CD_SPELL_IDS } from "@gladlog/analysis/src/utils/spellDanger";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import { LogEvent, toLegacyMatch } from "@gladlog/parser-compat";

const dir = process.argv[2];
if (!dir) {
  console.error(
    "usage: corpusFactScan3.ts <captureDir> [--examples N] [--archive-dir <dir>] [--json <path>]",
  );
  process.exit(2);
}
const argOf = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const ARCHIVE_DIR = argOf("--archive-dir") ?? "";
const EXAMPLES = Number(argOf("--examples") ?? 5);
const JSON_OUT = argOf("--json");
const unmapped: string[] = [];

const CHECKS = [
  "enemyDefForward",
  "burstAnswerPress",
  "hardCastOrder",
  "crisisCc",
  "crisisBurst",
] as const;
type Check = (typeof CHECKS)[number];
/** kinds counted but kept out of a check's violation total */
const OUT_OF_TOTAL = new Set(["burstAnswerPress|noRow"]);
interface IViolation {
  check: Check;
  kind: string;
  where: string;
  archive: string;
  round: number;
  offMs: number;
  /** owner-independent identity of the fact (distinct counting) */
  fact: string;
  detail: string;
  line?: string;
}
const checked = new Map<string, number>();
const violations: IViolation[] = [];
const bump = (c: string, n = 1) => checked.set(c, (checked.get(c) ?? 0) + n);

const nameOf = (id: string | undefined, fallback = ""): string =>
  id ? getEnglishSpellName(id, fallback) : fallback;
const fmtS = (sec: number): string => {
  const t = Math.max(0, Math.floor(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const secOf = (mss: string): number => {
  const [m, s] = mss.split(":");
  return Number(m) * 60 + Number(s);
};
const ev = (a: any): string => a.logLine?.event;
const tsOf = (a: any): number => a.logLine?.timestamp ?? a.timestamp;
const APPLIED = LogEvent.SPELL_AURA_APPLIED as string;
const REMOVED = LogEvent.SPELL_AURA_REMOVED as string;
const SUCCESS = LogEvent.SPELL_CAST_SUCCESS as string;
const START = LogEvent.SPELL_CAST_START as string;

/** every English name a row of `id` may be printed under */
const aliasCache = new Map<string, Set<string>>();
const aliasesOf = (id: string): Set<string> => {
  let s = aliasCache.get(id);
  if (!s) {
    s = new Set([nameOf(id)]);
    for (const c of castsOfEffectAura(id)) s.add(nameOf(c));
    for (const a of effectAurasOfCast(id)) s.add(nameOf(a));
    const cast = SELF_WALL_AURA_TO_CAST_ID[id];
    if (cast) s.add(nameOf(cast));
    s.delete("");
    aliasCache.set(id, s);
  }
  return s;
};
const official = spellEffectGenerated as Record<
  string,
  { durationSeconds?: number }
>;
const officialS = (id: string): number | undefined => {
  const d =
    official[id]?.durationSeconds ??
    official[SELF_WALL_AURA_TO_CAST_ID[id] ?? ""]?.durationSeconds;
  return typeof d === "number" && d > 0 ? d : undefined;
};
/** the table row an aura is read under: itself, or its cast's (Blur) */
const tableRowOf = (auraId: string) =>
  MITIGATION_TABLE[auraId] ??
  (SELF_WALL_AURA_TO_CAST_ID[auraId]
    ? MITIGATION_TABLE[SELF_WALL_AURA_TO_CAST_ID[auraId]!]
    : undefined);
/** controls: a DR family of their own (Disarm aside: it stops no cast) */
const CC_FAMILIES = new Set([
  "Stun",
  "Incapacitate",
  "Disorient",
  "Silence",
  "Horror",
]);
const isControl = (id: string | undefined): boolean =>
  !!id &&
  (CC_FAMILIES.has(getDRCategory(id)) || CC_FAMILIES.has(drCategoryOfCast(id)));
/** the offensive cooldowns' casts and their same-named effect auras */
const OFFENSIVE_AURA_IDS = new Set<string>();
/** filled after `ensureAnalysisData` (the cooldown lookup reads the data) */
function fillOffensiveAuraIds(): void {
  for (const id of OFFENSIVE_CD_SPELL_IDS) {
    // a burst cooldown is what the enemy-CD timeline tracks (its membership
    // lookup: an official cooldown of 30–360 s) — not Shadow Dance, which no
    // timeline line names as one
    if (!isEnemyCdWindowSpell(id)) continue;
    OFFENSIVE_AURA_IDS.add(id);
    for (const a of effectAurasOfCast(id))
      if (nameOf(a) === nameOf(id)) OFFENSIVE_AURA_IDS.add(a);
  }
}

function parseFile(path: string): GladMatch[] {
  const raw = readFileSync(path);
  const text = (path.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  const parser = new GladLogParser();
  const items: GladMatch[] = [];
  parser.on("match", (m) => items.push(m));
  parser.on("shuffle", (s) => items.push(...(s.rounds as never[])));
  for (const line of text.split("\n")) parser.push(line);
  parser.end();
  return items;
}

/** [from, to] ms intervals of `rows` (APPLIED → the next REMOVED of the same
 * id and source; unclosed → capped) */
function intervalsOf(
  rows: any[],
  capMs: (id: string) => number,
): Array<{ id: string; src: string; from: number; to: number }> {
  const out: Array<{ id: string; src: string; from: number; to: number }> = [];
  const open = new Map<string, number>();
  for (const a of [...rows].sort((x, y) => tsOf(x) - tsOf(y))) {
    const k = `${a.spellId}|${a.srcUnitId}`;
    if (ev(a) === APPLIED) {
      if (!open.has(k)) open.set(k, tsOf(a));
    } else if (ev(a) === REMOVED && open.has(k)) {
      out.push({
        id: a.spellId,
        src: a.srcUnitId,
        from: open.get(k)!,
        to: tsOf(a),
      });
      open.delete(k);
    }
  }
  for (const [k, from] of open) {
    const [id, src] = k.split("|") as [string, string];
    out.push({ id, src, from, to: from + capMs(id) });
  }
  return out;
}
/** ms of [a, b] covered by the intervals */
function coveredMs(
  ivs: Array<{ from: number; to: number }>,
  a: number,
  b: number,
): number {
  const cl = ivs
    .map((i) => ({ from: Math.max(a, i.from), to: Math.min(b, i.to) }))
    .filter((i) => i.to > i.from)
    .sort((x, y) => x.from - y.from);
  let sum = 0;
  let cur: { from: number; to: number } | undefined;
  for (const i of cl) {
    if (!cur || i.from > cur.to) {
      if (cur) sum += cur.to - cur.from;
      cur = { ...i };
    } else cur.to = Math.max(cur.to, i.to);
  }
  if (cur) sum += cur.to - cur.from;
  return sum;
}

await ensureAnalysisData();
fillOffensiveAuraIds();
const files: Array<{
  shard: string;
  name: string;
  fileNo: number;
  round: number;
}> = [];
for (const shard of readdirSync(dir).filter((d) => /^s\d+$/.test(d))) {
  const cdir = join(dir, shard, "context");
  for (const name of readdirSync(cdir)) {
    const m = /^(\d+)-(\d+)-(\d+)\.txt$/.exec(name);
    if (m) files.push({ shard, name, fileNo: +m[1]!, round: +m[2]! });
  }
}
files.sort((a, b) =>
  a.shard === b.shard ? a.fileNo - b.fileNo : a.shard < b.shard ? -1 : 1,
);

let cacheKey = "";
let cacheItems: GladMatch[] = [];
let contexts = 0;
for (const f of files) {
  const text = readFileSync(join(dir, f.shard, "context", f.name), "utf8");
  const findingsPath = join(dir, f.shard, "findings", f.name);
  const menu = existsSync(findingsPath)
    ? readFileSync(findingsPath, "utf8")
    : "";
  const [archive, ownerName] = text.split("\n", 2);
  if (!archive || !ownerName) continue;
  const key = `${f.shard}:${archive}`;
  if (key !== cacheKey) {
    try {
      cacheItems = parseFile(
        archive.startsWith("/") ? archive : resolve(ARCHIVE_DIR, archive),
      );
    } catch {
      cacheItems = [];
    }
    cacheKey = key;
  }
  const item = cacheItems[f.round - 1];
  if (!item) {
    unmapped.push(`${f.shard}/${f.name} (${archive})`);
    continue;
  }
  let legacy: ReturnType<typeof toLegacyMatch>;
  try {
    legacy = toLegacyMatch({ ...item, rawLines: [] } as GladMatch);
  } catch {
    unmapped.push(`${f.shard}/${f.name} (toLegacyMatch threw)`);
    continue;
  }
  contexts++;
  const lines = text.split("\n");
  const units = Object.values(legacy.units ?? {}) as any[];
  const byName = new Map(units.map((u) => [u.name, u]));
  const pidName = new Map<string, string>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"/.exec(l);
    if (u) pidName.set(u[1]!, u[2]!);
  }
  const pidOf = new Map<string, string>();
  for (const [pid, name] of pidName) pidOf.set(name, pid);
  const unitOfPid = (pid: string | undefined): any =>
    pid ? byName.get(pidName.get(pid) ?? "") : undefined;
  const owner = byName.get(ownerName);
  if (!owner) continue;
  const start: number = legacy.startTime;
  const end: number = legacy.endTime;
  const where = `${f.shard}/${f.name}`;
  const roundKey = `${archive}#${f.round}`;
  const players = units.filter((u) => u.info);
  const enemies = players.filter((u) => u.reaction !== owner.reaction);
  const enemySrc = new Set<string>(enemies.map((u) => u.id));
  for (const u of units)
    if (u.ownerId && enemySrc.has(u.ownerId)) enemySrc.add(u.id);
  const violate = (
    check: Check,
    kind: string,
    atMs: number,
    factId: string,
    detail: string,
    line?: string,
  ) =>
    violations.push({
      check,
      kind,
      where,
      archive,
      round: f.round,
      offMs: atMs - start,
      fact: `${roundKey}#${check}#${kind}#${factId}`,
      detail,
      ...(line ? { line } : {}),
    });
  const firstDeathMs = (u: any): number =>
    Math.min(
      Infinity,
      ...((u.deathRecords ?? []) as any[]).map((d) => d.timestamp),
    );

  // ── enemyDefForward ──
  for (const e of enemies) {
    const pid = pidOf.get(e.name);
    if (!pid) continue;
    const dies = firstDeathMs(e);
    const seen = new Set<string>();
    for (const a of (e.auraEvents ?? []) as any[]) {
      if (ev(a) !== APPLIED || a.srcUnitId !== e.id || a.destUnitId !== e.id)
        continue;
      const id = String(a.spellId ?? "");
      const row = tableRowOf(id);
      if (!row || row.pct < MITIGATION_WALL_MIN_PCT) continue;
      const ts = tsOf(a);
      if (ts < start || ts > end || ts >= dies) continue;
      const sec = Math.floor((ts - start) / 1000);
      const k = `${id}@${sec}`;
      if (seen.has(k)) continue;
      seen.add(k);
      bump("enemyDefForward");
      const names = aliasesOf(id);
      const re = new RegExp(`^\\d+:\\d\\d\\s+\\[ENEMY DEF\\]\\s+${pid}\\(`);
      // a re-application inside a printed line's run is that line's (an
      // Obsidian Scales echo 2 s after the press): look back the official
      // duration
      const back = Math.ceil(officialS(id) ?? 1);
      const secs: number[] = [];
      for (let s = sec - back; s <= sec + 1; s++) secs.push(s);
      const ok = secs.some((s) =>
        lines.some(
          (l) =>
            l.startsWith(`${fmtS(s)}  `) &&
            re.test(l) &&
            [...names].some((n) => l.includes(n)),
        ),
      );
      if (!ok)
        violate(
          "enemyDefForward",
          `noLine:${nameOf(id)}`,
          ts,
          `${e.id}:${id}:${sec}`,
          `${pid} ${nameOf(id)} (${row.pct}%${row.deflectsDirectAttacks ? " deflect" : ""}) applied ${fmtS(sec)} — no [ENEMY DEF] line`,
        );
    }
  }

  // ── burstAnswerPress ──
  for (const l of lines) {
    if (!/^\d+:\d\d\s+\[BURST ANSWERED\]/.test(l)) continue;
    const m =
      /\): (\d+)\([A-Za-z]+\) answered with (.+?) (?:in ([\d.]+)s|([\d.]+)s before it opened)/.exec(
        l,
      );
    if (!m) continue;
    const u = unitOfPid(m[1]);
    if (!u) continue;
    const spell = m[2]!.split(/ on \d+\(| \(/)[0]!.trim();
    const S = secOf(l.split(/\s+/)[0]!);
    const lat = Number(m[3] ?? m[4]);
    const sign = m[3] !== undefined ? 1 : -1;
    // the press instant the line places, with the rounding of both numbers
    const lo = start + (S + sign * lat - 0.06) * 1000;
    const hi = start + (S + 1 + sign * lat + 0.06) * 1000;
    bump("burstAnswerPress");
    const rows = ((u.spellCastEvents ?? []) as any[]).filter(
      (c) =>
        ev(c) === SUCCESS &&
        nameOf(String(c.spellId ?? ""), c.spellName) === spell,
    );
    const inWin = rows.filter((c) => tsOf(c) >= lo && tsOf(c) <= hi);
    if (inWin.length === 0) {
      violate(
        "burstAnswerPress",
        "noRow",
        lo,
        `${u.id}:${spell}:${S}`,
        `${m[1]} ${spell} @${fmtS(S)}`,
        l,
      );
      continue;
    }
    // a channel tick: the same id ≤ 1.05 s before it, inside a run that a
    // press of another id of the spell opened (Divine Hymn 64843 → 64844
    // ×n); two presses of one id 0.7 s apart (Disable) are two presses
    const isPress = (c: any) =>
      !(
        rows.some(
          (o) =>
            o !== c &&
            String(o.spellId) === String(c.spellId) &&
            tsOf(o) < tsOf(c) &&
            tsOf(c) - tsOf(o) <= 1050,
        ) &&
        rows.some(
          (o) =>
            String(o.spellId) !== String(c.spellId) &&
            tsOf(o) < tsOf(c) &&
            tsOf(c) - tsOf(o) <= 10_000,
        )
      );
    if (!inWin.some(isPress))
      violate(
        "burstAnswerPress",
        "tick",
        tsOf(inWin[0]),
        `${u.id}:${spell}:${S}`,
        `${m[1]} ${spell} @${fmtS(S)}: every row there is a tick (${inWin.map((c) => c.spellId).join(",")})`,
        l,
      );
  }

  // ── hardCastOrder ──
  for (const l of lines) {
    const m =
      /^(\d+:\d\d)\s+\[ENEMY HARD CAST\]\s+(\d+)\([A-Za-z]+\): (.+?)(?: → (\d+)\([A-Za-z]+\))? \(([\d.]+)s cast, went off\)$/.exec(
        l,
      );
    if (!m) continue;
    const caster = unitOfPid(m[2]);
    if (!caster) continue;
    const S = secOf(m[1]!);
    const spell = m[3]!;
    const startRow = ((caster.castStartEvents ?? []) as any[]).find(
      (c) =>
        ev(c) === START &&
        nameOf(String(c.spellId ?? ""), c.spellName) === spell &&
        Math.floor((tsOf(c) - start) / 1000) === S,
    );
    if (!startRow) continue;
    const sid = String(startRow.spellId);
    const comps = ((caster.spellCastEvents ?? []) as any[])
      .filter((c) => ev(c) === SUCCESS && String(c.spellId) === sid)
      .sort((a, b) => tsOf(a) - tsOf(b));
    const comp = comps.find((c) => tsOf(c) >= tsOf(startRow));
    if (!comp || !comp.destUnitId) continue;
    bump("hardCastOrder");
    const dest = comp.destUnitId;
    const mine = comps.filter((c) => c.destUnitId === dest).map(tsOf);
    // the cluster: completions chained ≤ 2.5 s apart around this one
    let i0 = mine.indexOf(tsOf(comp));
    let i1 = i0;
    while (i0 > 0 && mine[i0]! - mine[i0 - 1]! <= 2500) i0--;
    while (i1 < mine.length - 1 && mine[i1 + 1]! - mine[i1]! <= 2500) i1++;
    const from = mine[i0]!;
    const to = mine[i1]! + 2500;
    const nComp = i1 - i0 + 1;
    const results = [
      ...((caster.damageOut ?? []) as any[]).filter(
        (d) => String(d.spellId) === sid && d.destUnitId === dest,
      ),
      ...((caster.missesOut ?? []) as any[]).filter(
        (d) => String(d.spellId) === sid && d.destUnitId === dest,
      ),
    ].filter((r) => tsOf(r) >= from && tsOf(r) <= to);
    if (results.length >= nComp)
      violate(
        "hardCastOrder",
        "wentOffWithRows",
        tsOf(comp),
        `${caster.id}:${sid}:${tsOf(comp)}`,
        `${m[2]} ${spell} ${m[1]}: ${nComp} completion(s), ${results.length} result row(s) in the cluster, yet "went off"`,
        l,
      );
  }

  // ── crisisCc / crisisBurst ──
  const capMs = (id: string) => ((ccFullDurationSeconds(id) ?? 8) + 1) * 1000;
  const ownerCc = intervalsOf(
    ((owner.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.destUnitId === owner.id &&
        enemySrc.has(a.srcUnitId) &&
        isControl(String(a.spellId ?? "")),
    ),
    capMs,
  );
  const enemyBurstUp = enemies.flatMap((e) =>
    intervalsOf(
      ((e.auraEvents ?? []) as any[]).filter(
        (a) =>
          a.srcUnitId === e.id &&
          a.destUnitId === e.id &&
          OFFENSIVE_AURA_IDS.has(String(a.spellId ?? "")),
      ),
      () => 40_000,
    ),
  );
  for (const l of menu.split("\n")) {
    const m =
      /id=crisis-no-response:[^ ]+ type=crisis-no-response t=(\d+)s .*?burst=(yes|no)/.exec(
        l,
      );
    if (!m) continue;
    const t = start + Number(m[1]) * 1000;
    bump("crisisCc");
    const cov = coveredMs(ownerCc, t, t + 3000);
    if (cov > 2000)
      violate(
        "crisisCc",
        "ccInWindow",
        t,
        `${owner.id}:${m[1]}`,
        `t=${m[1]}: enemy control covers ${(cov / 1000).toFixed(1)} s of the 3 s window (${ownerCc
          .filter((i) => i.to > t && i.from < t + 3000)
          .map((i) => nameOf(i.id))
          .join(", ")})`,
      );
    bump("crisisBurst");
    const up = enemyBurstUp.filter((i) => i.from <= t && t < i.to);
    if (m[2] === "no" && up.length > 0)
      violate(
        "crisisBurst",
        "noWhileUp",
        t,
        `${owner.id}:${m[1]}`,
        `t=${m[1]}: burst=no while ${up.map((i) => nameOf(i.id)).join(", ")} up`,
      );
  }
}

// ── report ──
const say = (s: string) => console.log(s);
say(`corpusFactScan3 ${resolve(dir)}: ${contexts} contexts`);
for (const c of CHECKS) {
  const all = violations.filter((v) => v.check === c);
  const vs = all.filter((v) => !OUT_OF_TOTAL.has(`${c}|${v.kind}`));
  const distinct = new Set(vs.map((v) => v.fact));
  say(
    `${c}: checked ${checked.get(c) ?? 0} / violations ${vs.length} (distinct facts ${distinct.size})`,
  );
  const kinds = new Map<string, IViolation[]>();
  for (const v of all) kinds.set(v.kind, [...(kinds.get(v.kind) ?? []), v]);
  for (const [k, ks] of [...kinds].sort((a, b) => b[1].length - a[1].length)) {
    const kd = new Set(ks.map((v) => v.fact)).size;
    say(
      `  ${k}: ${ks.length} (distinct ${kd})${OUT_OF_TOTAL.has(`${c}|${k}`) ? "  [not in the total]" : ""}`,
    );
    for (const v of ks.slice(0, EXAMPLES))
      say(`    ${v.where} r${v.round} +${v.offMs}ms ${v.detail}`);
  }
}
if (JSON_OUT) {
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        capture: resolve(dir),
        contexts,
        checked: Object.fromEntries(checked),
        violations,
      },
      null,
      1,
    ),
  );
  say(`wrote ${JSON_OUT}`);
}
if (unmapped.length > 0) {
  console.error(`UNMAPPED contexts: ${unmapped.length}`);
  for (const u of unmapped.slice(0, 10)) console.error(`    ${u}`);
  process.exit(1);
}
