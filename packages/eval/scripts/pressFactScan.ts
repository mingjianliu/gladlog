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
 *    whose effect it is (`castsOfEffectAura`) from 1 s before to `AURA_BEFORE_CAST_MAX_S` after
 *    it, its `[ENEMY DEF]` line (aura second, pid, name) must read `[no press
 *    logged]` and not `— removed early`; with one, it must not read `[no press
 *    logged]`. `unseenPressTagged` (fix-F16, 2026-10-21): an application the
 *    product's `hiddenPressMs` reads as a press made while unseen must read
 *    `[pressed while unseen]` instead.
 *  - `procWith` (C5): a friendly Radiant Glory Avenging Wrath activation
 *    (454351 SUCCESS) with a Wake of Ashes 255937 press from
 *    `PROC_TRIGGER_LEAD_MS` before it to 1 ms after (round-1 retest idx 79:
 *    12–14 ms leads are real triggers), when the
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
import { ensureAnalysisData } from "@gladlog/analysis";
import { PROC_TRIGGER_LEAD_MS } from "@gladlog/analysis/src/context/timelineSections/enemyCd";
import { castsOfEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import { getEnglishSpellName } from "@gladlog/analysis/src/data/spellEffectData";
import { AURA_REBROADCAST_GAP_MS } from "@gladlog/analysis/src/utils/auraIntervals";
import { buffFullDurationForCaster } from "@gladlog/analysis/src/utils/buffDuration";
import {
  AURA_BEFORE_CAST_MAX_S,
  MITIGATION_AURA_IDS,
  SAVE_CAST_AURA_PAIR_S,
  wallTableIdOfAura,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { hiddenPressMs } from "@gladlog/analysis/src/utils/hiddenPress";
import { castRowActivationMs } from "@gladlog/analysis/src/utils/offensiveAuraOccurrences";
import { shuffleRoundEndMs } from "@gladlog/analysis/src/utils/roundEnd";
import {
  type IAuraEvent,
  type ISpellEvent,
  LogEvent,
} from "@gladlog/parser-compat";

import {
  type IContext,
  type IScan,
  type IScanOpts,
  isMainScan,
  runScanCli,
} from "./verify/scan";

let EXAMPLES = 5;
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
  | "unseenPressTagged"
  | "procWith"
  | "auraOnlyAW"
  | "enemyUtilityPress";
let expected = new Map<Check, number>();
let missing = new Map<Check, string[]>();
const bump = (c: Check) => expected.set(c, (expected.get(c) ?? 0) + 1);
const miss = (c: Check, s: string) => {
  const l = missing.get(c) ?? [];
  l.push(s);
  missing.set(c, l);
};

/** a trigger press up to `PROC_TRIGGER_LEAD_MS` before the activation, or
 * in its ms */
const besideProc = (triggerMs: number, actMs: number): boolean =>
  triggerMs >= actMs - PROC_TRIGGER_LEAD_MS &&
  triggerMs <= actMs + AURA_REBROADCAST_GAP_MS;

await ensureAnalysisData();
let contexts = 0;
function runRound(ctx: IContext): void {
  const { f, ownerName, legacy, lines, units } = ctx;
  contexts++;
  const pidOf = new Map<string, { pid: string; role: string }>();
  for (const l of lines) {
    const u = /<unit id="(\d+)" name="([^"]+)"[^>]*role="([^"]+)"/.exec(l);
    if (u) pidOf.set(u[2]!, { pid: u[1]!, role: u[3]! });
  }
  const byId = new Map(units.map((u) => [u.id, u]));
  const start = legacy.startTime;
  // a Solo Shuffle round is over at its first death (`shuffleRoundEndMs`,
  // the product's cut): a press at or after it is not in the round and has
  // no line (GH #177 item 17: wide's one allyScales miss, an Obsidian Scales
  // 29 ms after the round-ending death)
  const shuffleEnd = shuffleRoundEndMs(legacy, units);
  const outOfRound = (ts: number) =>
    ts < start ||
    ts > legacy.endTime ||
    (shuffleEnd !== undefined && ts >= shuffleEnd);
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
      if (outOfRound(ts)) continue;
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
                l.includes(tag) &&
                // friendly: on its caster, with the copy named (fact8 D23);
                // enemy: `[ENEMY DEF]` names the copy's holder
                (l.includes(`Obsidian Scales → ${dp.pid}(`) ||
                  (l.includes("Obsidian Scales") &&
                    l.includes(`% copy → ${dp.pid}(`))),
            )
          )
            miss("allyScales", `${where} ${t} ${u.name} → ${d.name} (${tag})`);
        }
      }
      if (!friendly) continue;
      // `t`: the second the product dates the press at
      const press = (check: Check, name: string, t: string = at(ts)) => {
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
      // the Metamorphosis press is dated at its activation, not at the
      // 200166 landing row (`castRowActivationMs` — GH #203)
      if (c.spellId === "200166")
        press(
          "havocMeta",
          "Metamorphosis",
          at(castRowActivationMs(u, c.spellId, ts)),
        );
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
        if (outOfRound(ts)) continue;
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
          // open by row order, not by comparing the two stamps: a form that
          // re-sends itself logs REMOVED then APPLIED in one millisecond, and
          // an APPLIED over that still-open aura is the same aura (GH #173
          // item 13: Ancient of Lore re-applied 1.7 s after such a pair)
          let open = false;
          for (const x of (u.auraEvents ?? []) as IAuraEvent[]) {
            if (x === a) break;
            if (x.spellId !== a.spellId || x.destUnitId !== u.id) continue;
            if (x.logLine.event === LogEvent.SPELL_AURA_APPLIED) {
              lastApplied = x.logLine.timestamp;
              open = true;
            } else if (x.logLine.event === LogEvent.SPELL_AURA_REMOVED) {
              lastRemoved = x.logLine.timestamp;
              open = false;
            }
          }
          // an application never seen to end holds only its official
          // length (codex 20-F15-34: a Barkskin at 10 s with no REMOVED
          // and another at 40 s are two)
          const lenS = buffFullDurationForCaster(a.spellId, u, lastApplied);
          const continues =
            lastApplied !== undefined &&
            (open || lastRemoved === undefined
              ? lenS === undefined || ts - lastApplied <= lenS * 1000
              : ts - lastRemoved <= AURA_REBROADCAST_GAP_MS);
          const dead = (
            (u.deathRecords ?? []) as Array<{ timestamp: number }>
          ).some((d) => d.timestamp <= ts);
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
            // the product's own aura-before-cast lag (shared predicate:
            // 150 ms since corpusFactScan batch 1)
            c.logLine.timestamp - ts <= AURA_BEFORE_CAST_MAX_S * 1000,
        );
        // a real press landing on a copy that went up just before it: the
        // press's REFRESH sits on its cast row (fact7 D27, `splitAtRepressRefresh`;
        // the product drops the tag, this check had not followed — 3-3-43 2:18)
        const refreshedByPress =
          !pressed &&
          casts.some(
            (c) =>
              ids.has(c.spellId) &&
              c.logLine.timestamp > ts &&
              c.logLine.timestamp - ts <= SAVE_CAST_AURA_PAIR_S * 1000 &&
              (u.auraEvents ?? []).some(
                (r: {
                  spellId?: string;
                  logLine: { event: string; timestamp: number };
                }) =>
                  r.spellId === a.spellId &&
                  r.logLine.event === LogEvent.SPELL_AURA_REFRESH &&
                  Math.abs(r.logLine.timestamp - c.logLine.timestamp) <= 20,
              ),
          );
        if (refreshedByPress) continue;
        const name = getEnglishSpellName(a.spellId, a.spellName);
        const line = lines.find(
          (l) =>
            l.startsWith(`${t}  [ENEMY DEF]   ${me.pid}(`) &&
            l.includes(`: ${name} (`),
        );
        // counted whether or not its line is there (codex 20-F15-25: a
        // deleted line left the denominator) — a missing line is a miss
        // a press the unit made while unseen (D35, the product's own
        // `hiddenPressMs`: an aura new in the batch that re-states the unit)
        // is a press, tagged `[pressed while unseen]` — not a copy (23-2
        // 1:35: Aura Mastery 31821 in a 20-row re-listing with Dampening,
        // ran its 8 s)
        const unseen =
          !pressed &&
          [...ids].some((id) =>
            hiddenPressMs(u, id, start).some((ms) => Math.abs(ms - ts) <= 5),
          );
        if (unseen) {
          bump("unseenPressTagged");
          if (
            !line ||
            !line.includes("[pressed while unseen]") ||
            line.includes("[no press logged]")
          )
            miss(
              "unseenPressTagged",
              `${where} ${t} ${u.name} ${name}${line ? "" : " (no line)"}`,
            );
        } else if (!pressed) {
          bump("noPressCopy");
          // a healing major's aura has its own line (fact8 class 5)
          const healLine = lines.some(
            (l) =>
              l.startsWith(`${t}  [ENEMY HEAL CD]   ${me.pid}(`) &&
              l.endsWith(`: ${name} (no press)`),
          );
          if (
            !healLine &&
            (!line ||
              !line.includes("[no press logged]") ||
              line.includes("— removed early"))
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
              besideProc(w.logLine.timestamp, c.logLine.timestamp),
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
                besideProc(o.logLine.timestamp, act.logLine.timestamp),
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
        if (outOfRound(ts)) continue;
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
      if (outOfRound(ts)) continue;
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

function report(): void {
  console.log(`contexts: ${contexts}`);
  for (const c of [
    "allyScales",
    "timeStop",
    "treeOfLife",
    "havocMeta",
    "noPressCopy",
    "pressedNotTagged",
    "unseenPressTagged",
    "procWith",
    "auraOnlyAW",
    "enemyUtilityPress",
  ] as Check[]) {
    const m = missing.get(c) ?? [];
    console.log(`${c}: expected ${expected.get(c) ?? 0}, missing ${m.length}`);
    for (const s of m.slice(0, EXAMPLES)) console.log(`    ${s}`);
  }
}

const state = () => ({ contexts, expected, missing });
export const scan: IScan<ReturnType<typeof state>> = {
  name: "pressFactScan",
  configure(o: IScanOpts) {
    EXAMPLES = o.examples;
  },
  run: runRound,
  report,
  state,
  load(s: ReturnType<typeof state>) {
    ({ contexts, expected, missing } = s);
  },
};

if (isMainScan(import.meta.url)) await runScanCli(scan);
