/**
 * pressFactScan.ts — F15 (fact1215, 2026-10-16): re-derive press facts from
 * the parsed log and require the rendered line, over an existing
 * acceptanceCapture `--context-dir` capture (cap605: `<dir>/s<k>/context/`).
 *
 * The LLM fact audit only DISCOVERS a class; this makes it complete across
 * the corpus and keeps it fixed. Each check derives the fact from the log
 * events directly — never through the analysis predicate it audits:
 *
 *  - `allyScales` (C1): a SPELL_CAST_SUCCESS of Obsidian Scales 363916 whose
 *    dest is another unit carrying an APPLIED / REFRESH of 363916 from the
 *    caster within 0.5 s (Flameshaper's ally copy). Required: a line at the
 *    cast's second naming the ally — `[YOU] [CD]` / `[TEAM] [CD]` for a
 *    friendly caster, `[ENEMY DEF]` for an enemy one — `Obsidian Scales →
 *    <ally pid>(`.
 *  - `timeStop` / `treeOfLife` / `havocMeta` (C6): a friendly player's press
 *    — Time Stop 378441; Incarnation: Tree of Life 33891 whose cast applies
 *    the 117679 form buff in the same instant (a shift back into the form is
 *    no press); Metamorphosis' 200166 landing. Required: the owner's
 *    `[YOU] [CD]   <name>` or the teammate's `[TEAM] [CD]   <pid>(…): <name>`
 *    at that second.
 *  - `noPressCopy` / `pressedNotTagged` (C5, 2026-10-18): an enemy's own
 *    wall aura (`MITIGATION_AURA_IDS` by `wallTableIdOfAura`) APPLIED on
 *    itself. With no SPELL_CAST_SUCCESS of the wall, the aura or a cast
 *    whose effect it is (`castsOfEffectAura`) from 1 s before to 50 ms after
 *    it, its `[ENEMY DEF]` line (aura second, pid, name) must read `[no press
 *    logged]` and not `— removed early`; with one, it must not read `[no press
 *    logged]`.
 *  - `procWith` (C5): a friendly Radiant Glory Avenging Wrath activation
 *    (454351 SUCCESS) in the ms of a Wake of Ashes 255937 press, when the
 *    round has two or more such pairs. Its `[PROC]` line must read `(with
 *    Wake of Ashes)`.
 *  - `enemyUtilityPress` (C7, 2026-10-18): an enemy's SUCCESS of Champion's
 *    Spear 376079, Smoke Bomb 212182 or Tremor Totem 8143 inside the round.
 *    An `[ENEMY UTILITY]` line at its second (pid, name) must say it.
 *  - `auraOnlyAW` (C5): an enemy's 454351 aura APPLIED, while none is up,
 *    with no 454351 SUCCESS within ±0.5 s. An `[ENEMY CD]` line at its second must name
 *    `Avenging Wrath (no press)`.
 *
 * The context file's first two lines are the archive path and the owner;
 * its name is `<fileNo>-<round>-<owner#>` (acceptanceCapture.ts). Pids are
 * read from the context's own `<unit id="N" name="…">` tags.
 *
 *   npx tsx packages/eval/scripts/pressFactScan.ts <captureDir> [--examples N] [--archive-dir <dir>]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { ensureAnalysisData } from "@gladlog/analysis";
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { AURA_REBROADCAST_GAP_MS } from "@gladlog/analysis/src/utils/auraIntervals";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import {
  MITIGATION_AURA_IDS,
  wallTableIdOfAura,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { GladLogParser, type GladMatch } from "@gladlog/parser";
import {
  type IAuraEvent,
  type ISpellEvent,
  LogEvent,
  toLegacyMatch,
} from "@gladlog/parser-compat";

const dir = process.argv[2];
if (!dir) {
  console.error(
    "usage: pressFactScan.ts <captureDir> [--examples N] [--archive-dir <dir>]",
  );
  process.exit(2);
}
const exIdx = process.argv.indexOf("--examples");
// relative manifest paths are written as given: resolve them the way
// acceptanceCapture.ts did (`--archive-dir`)
const adIdx = process.argv.indexOf("--archive-dir");
const ARCHIVE_DIR = adIdx > 0 ? (process.argv[adIdx + 1] ?? "") : "";
/** contexts that could not be mapped back to a parsed round — any one fails
 * the run (codex review 20-F15-01: a silent skip read as "0 missing") */
const unmapped: string[] = [];
const EXAMPLES = exIdx > 0 ? Number(process.argv[exIdx + 1]) : 5;
const ALLY_COPY_MS = 500;
const FORM_BUFF_MS = 50;

const fmt = (s: number): string => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

/** Champion's Spear, Smoke Bomb, Tremor Totem (fact1215 C7) */
const ENEMY_UTILITY_IDS = new Set(["376079", "212182", "8143"]);

type Check =
  | "allyScales"
  | "timeStop"
  | "treeOfLife"
  | "havocMeta"
  | "noPressCopy"
  | "pressedNotTagged"
  | "procWith"
  | "auraOnlyAW"
  | "enemyUtilityPress";
const expected = new Map<Check, number>();
const missing = new Map<Check, string[]>();
const bump = (c: Check) => expected.set(c, (expected.get(c) ?? 0) + 1);
const miss = (c: Check, s: string) => {
  const l = missing.get(c) ?? [];
  l.push(s);
  missing.set(c, l);
};

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

await ensureAnalysisData();
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
  const pidOf = new Map<string, { pid: string; role: string }>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"[^>]*role="([^"]+)"/.exec(l);
    if (u) pidOf.set(u[2]!, { pid: u[1]!, role: u[3]! });
  }
  const units = Object.values(legacy.units ?? {}) as any[];
  const byId = new Map(units.map((u) => [u.id, u]));
  const start = legacy.startTime;
  const at = (ts: number) => fmt((ts - start) / 1000);
  const has = (t: string, pred: (l: string) => boolean) =>
    lines.some((l) => l.startsWith(`${t}  `) && pred(l));
  const where = `${f.shard}/${f.name}`;

  for (const u of units) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    const friendly = me.role !== "enemy";
    const isOwner = u.name === ownerName;
    for (const c of u.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      const ts = c.logLine.timestamp;
      if (ts < start || ts > legacy.endTime) continue;
      const t = at(ts);
      if (c.spellId === "363916" && c.destUnitId && c.destUnitId !== u.id) {
        const d = byId.get(c.destUnitId);
        const copy = (d?.auraEvents ?? []).some(
          (a: any) =>
            a.spellId === "363916" &&
            a.srcUnitId === u.id &&
            a.destUnitId === d.id &&
            (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
              a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
            Math.abs(a.logLine.timestamp - ts) <= ALLY_COPY_MS,
        );
        const dp = d && pidOf.get(d.name);
        if (copy && dp) {
          bump("allyScales");
          const tag = friendly
            ? isOwner
              ? "[YOU] [CD]"
              : `[TEAM] [CD]   ${me.pid}(`
            : `[ENEMY DEF]   ${me.pid}(`;
          if (
            !has(
              t,
              (l) =>
                l.includes(tag) && l.includes(`Obsidian Scales → ${dp.pid}(`),
            )
          )
            miss("allyScales", `${where} ${t} ${u.name} → ${d.name} (${tag})`);
        }
      }
      if (!friendly) continue;
      const press = (check: Check, name: string) => {
        bump(check);
        const ok = isOwner
          ? has(t, (l) => l.includes(`[YOU] [CD]   ${name}`))
          : has(
              t,
              (l) =>
                l.includes(`[TEAM] [CD]   ${me.pid}(`) &&
                l.includes(`: ${name}`),
            );
        if (!ok) miss(check, `${where} ${t} ${u.name} ${name}`);
      };
      if (c.spellId === "378441") press("timeStop", "Time Stop");
      if (c.spellId === "200166") press("havocMeta", "Metamorphosis");
      if (
        c.spellId === "33891" &&
        (u.auraEvents ?? []).some(
          (a: any) =>
            a.spellId === "117679" &&
            a.destUnitId === u.id &&
            (a.logLine.event === LogEvent.SPELL_AURA_APPLIED ||
              a.logLine.event === LogEvent.SPELL_AURA_REFRESH) &&
            Math.abs(a.logLine.timestamp - ts) <= FORM_BUFF_MS,
        )
      )
        press("treeOfLife", "Incarnation: Tree of Life");
    }
  }

  // ── C5: aura copies, proc triggers, aura-only Avenging Wrath ────────────
  const successes = (u: { spellCastEvents?: ISpellEvent[] }) =>
    (u.spellCastEvents ?? []).filter(
      (c) => c.logLine.event === LogEvent.SPELL_CAST_SUCCESS,
    );
  for (const u of units) {
    const me = pidOf.get(u.name);
    if (!me) continue;
    const casts = successes(u);
    if (me.role === "enemy") {
      for (const a of (u.auraEvents ?? []) as IAuraEvent[]) {
        if (a.logLine.event !== LogEvent.SPELL_AURA_APPLIED) continue;
        if (a.srcUnitId !== u.id || a.destUnitId !== u.id || !a.spellId)
          continue;
        const ts = a.logLine.timestamp;
        if (ts < start || ts > legacy.endTime) continue;
        const t = at(ts);
        // aura-only Avenging Wrath — an APPLIED while no 454351 aura is up
        // (one re-applied over an open one is that one: 92-4 0:56)
        if (a.spellId === "454351") {
          let open = false;
          for (const x of (u.auraEvents ?? []) as IAuraEvent[]) {
            if (x === a) break;
            if (x.spellId !== "454351" || x.destUnitId !== u.id) continue;
            if (x.logLine.event === LogEvent.SPELL_AURA_APPLIED) open = true;
            else if (x.logLine.event === LogEvent.SPELL_AURA_REMOVED)
              open = false;
          }
          if (open) continue;
          const cast = casts.some(
            (c) =>
              c.spellId === "454351" &&
              Math.abs(c.logLine.timestamp - ts) <= 500,
          );
          if (!cast) {
            bump("auraOnlyAW");
            if (
              !has(
                t,
                (l) =>
                  l.includes(`[ENEMY CD]`) &&
                  l.includes(`${me.pid}(`) &&
                  l.includes("Avenging Wrath (no press)"),
              )
            )
              miss("auraOnlyAW", `${where} ${t} ${u.name}`);
          }
          continue;
        }
        const tableId = wallTableIdOfAura(a.spellId);
        if (!MITIGATION_AURA_IDS.has(tableId)) continue;
        // an application that continues an aura already up — no REMOVED
        // since the last APPLIED, or one within the re-send gap — is that
        // aura's, which its own line speaks for (2:52 Barkskin press, the
        // aura re-sent at 2:53); also after the unit's death
        {
          let lastApplied: number | undefined;
          let lastRemoved: number | undefined;
          for (const x of (u.auraEvents ?? []) as IAuraEvent[]) {
            if (x === a) break;
            if (x.spellId !== a.spellId || x.destUnitId !== u.id) continue;
            if (x.logLine.event === LogEvent.SPELL_AURA_APPLIED)
              lastApplied = x.logLine.timestamp;
            else if (x.logLine.event === LogEvent.SPELL_AURA_REMOVED)
              lastRemoved = x.logLine.timestamp;
          }
          // an application never seen to end holds only its official
          // length (codex 20-F15-34: a Barkskin at 10 s with no REMOVED
          // and another at 40 s are two)
          const lenS = buffFullDurationForCaster(a.spellId, u, lastApplied);
          const continues =
            lastApplied !== undefined &&
            (lastRemoved === undefined || lastRemoved < lastApplied
              ? lenS === undefined || ts - lastApplied <= lenS * 1000
              : ts - lastRemoved <= AURA_REBROADCAST_GAP_MS);
          const dead = ((u.deathRecords ?? []) as Array<{ timestamp: number }>)
            .some((d) => d.timestamp <= ts);
          if (continues || dead) continue;
        }
        const ids = new Set([
          tableId,
          a.spellId,
          ...castsOfEffectAura(a.spellId),
        ]);
        const pressed = casts.some(
          (c) =>
            ids.has(c.spellId) &&
            ts - c.logLine.timestamp <= 1000 &&
            c.logLine.timestamp - ts <= 50,
        );
        const name = getEnglishSpellName(a.spellId, a.spellName);
        const line = lines.find(
          (l) =>
            l.startsWith(`${t}  [ENEMY DEF]   ${me.pid}(`) &&
            l.includes(`: ${name} (`),
        );
        // counted whether or not its line is there (codex 20-F15-25: a
        // deleted line left the denominator) — a missing line is a miss
        if (!pressed) {
          bump("noPressCopy");
          if (
            !line ||
            !line.includes("[no press logged]") ||
            line.includes("— removed early")
          )
            miss(
              "noPressCopy",
              `${where} ${t} ${u.name} ${name}${line ? "" : " (no line)"}`,
            );
        } else if (line) {
          bump("pressedNotTagged");
          if (line.includes("[no press logged]"))
            miss("pressedNotTagged", `${where} ${t} ${u.name} ${name}`);
        }
      }
    } else {
      const pairs = casts
        .filter((c) => c.spellId === "454351")
        .filter((c) =>
          casts.some(
            (w) =>
              w.spellId === "255937" &&
              Math.abs(w.logLine.timestamp - c.logLine.timestamp) <= 1,
          ),
        );
      if (pairs.length < 2) continue;
      // Wake must be the one cast that shares the most activations' ms,
      // strictly (codex 20-F15-25: a Gladiator's Badge macro'd into every
      // pair ties it, and no trigger is named then)
      const activations = casts.filter((c) => c.spellId === "454351");
      const shared = new Map<string, number>();
      for (const act of activations) {
        const names = new Set(
          casts
            .filter(
              (o) =>
                o !== act &&
                o.spellId !== "454351" &&
                Math.abs(o.logLine.timestamp - act.logLine.timestamp) <= 1,
            )
            .map((o) => getEnglishSpellName(o.spellId, o.spellName)),
        );
        for (const n of names) shared.set(n, (shared.get(n) ?? 0) + 1);
      }
      const wake = shared.get("Wake of Ashes") ?? 0;
      if ([...shared].some(([n, k]) => n !== "Wake of Ashes" && k >= wake))
        continue;
      const isOwner = u.name === ownerName;
      const procLineAt = (t: string) =>
        lines.find(
          (l) =>
            l.startsWith(`${t}  `) &&
            (isOwner
              ? l.includes("[YOU] [PROC]   Avenging Wrath")
              : l.includes(`[TEAM] [PROC]   ${me.pid}(`) &&
                l.includes(": Avenging Wrath")),
        );
      for (const c of activations) {
        const ts = c.logLine.timestamp;
        if (ts < start || ts > legacy.endTime) continue;
        const t = at(ts);
        const procLine = procLineAt(t);
        bump("procWith");
        // a paired activation says it, an unpaired one does not (codex
        // 20-F15-25); a missing line is a miss
        const shouldSay = pairs.includes(c);
        if (
          !procLine ||
          procLine.includes("(with Wake of Ashes)") !== shouldSay
        )
          miss(
            "procWith",
            `${where} ${t} ${u.name}${procLine ? "" : " (no line)"}${shouldSay ? "" : " (unpaired)"}`,
          );
      }
    }
  }

  // enemyUtilityPress (C7): an enemy's press of a roster Utility row no
  // other enemy family prints (the three the audit found)
  for (const u of units) {
    const me = pidOf.get(u.name);
    if (!me || me.role !== "enemy") continue;
    for (const c of u.spellCastEvents ?? []) {
      if (c.logLine.event !== LogEvent.SPELL_CAST_SUCCESS) continue;
      if (!ENEMY_UTILITY_IDS.has(c.spellId)) continue;
      const ts = c.logLine.timestamp;
      if (ts < start || ts > legacy.endTime) continue;
      const t = at(ts);
      bump("enemyUtilityPress");
      const name = getEnglishSpellName(c.spellId, c.spellName);
      if (
        !has(
          t,
          (l) =>
            l.startsWith(`${t}  [ENEMY UTILITY]   ${me.pid}(`) &&
            l.includes(`: ${name}`),
        )
      )
        miss("enemyUtilityPress", `${where} ${t} ${u.name} ${name}`);
    }
  }
}

console.log(`contexts: ${contexts}`);
for (const c of [
  "allyScales",
  "timeStop",
  "treeOfLife",
  "havocMeta",
  "noPressCopy",
  "pressedNotTagged",
  "procWith",
  "auraOnlyAW",
  "enemyUtilityPress",
] as Check[]) {
  const m = missing.get(c) ?? [];
  console.log(`${c}: expected ${expected.get(c) ?? 0}, missing ${m.length}`);
  for (const s of m.slice(0, EXAMPLES)) console.log(`    ${s}`);
}
if (unmapped.length > 0) {
  console.error(`UNMAPPED contexts: ${unmapped.length}`);
  for (const u of unmapped.slice(0, 10)) console.error(`    ${u}`);
  process.exit(1);
}
