/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t194a.ts — pipeline T194, count first: four settling counts of the
 * #218 triage. Each is written so that 0 means "nothing seen"; a kind says
 * what was seen. The lengths the product prices are the product's own
 * (`buffFullDurationForCaster` / `buffDurationOfApplication`, `logInstantOf`
 * / `logDatedAt`); what they are held against is the log's rows.
 *
 *  - `timelessDurationDiffers` (218.2.7): the readers that still ask
 *    `buffFullDurationForCaster` with no application time. Once per round,
 *    for every player's own SPELL_CAST_SUCCESS inside the round, the cast's
 *    id and each of its own effect auras (`ownEffectAurasOfCast`): the
 *    time-less length against `buffDurationOfApplication` at the cast's ms.
 *    Kind = the English name of the id priced. Counted (bump): every (cast,
 *    id) whose time-less length is defined. An EXPOSURE: it says which
 *    spells' lengths move with the application, not that a time-less reader
 *    was reached with one.
 *
 *  - `sacrificeKitLasts` (218.2.10): a kit row `Blessing of Sacrifice [… lasts
 *    Ns]` against the lives of the Sacrifice auras that unit applied this
 *    round (6940, and 199448 — Ultimate Sacrifice's), APPLIED → REMOVED on
 *    any unit with the kit's unit as source. A life is cut, and not read,
 *    when it has no REMOVED, ends at or past the round's end, was refreshed,
 *    or its holder or its source died inside it. Kinds: `kit Ns, longest
 *    full life Ms (aura <ids seen un-cut>)` when the longest un-cut life is
 *    more than 0.5 s off the kit's length (M to the whole second); out of
 *    the total `agrees` and `every life cut`. Counted: every such kit row
 *    whose unit applied at least one Sacrifice aura in the round (per owner
 *    context — the kit row is rendered once per prompt).
 *
 *  - `cheetahFoxPress` (218.3.6): a `[PRESS] … Aspect of the Cheetah (lasts
 *    Ns` line against the hunter's OWN series at that press — 186257 on the
 *    hunter, then 186258 within `PRESS_CHAIN_HANDOVER_MS` of its end, both
 *    with the hunter as source and holder — when the series is fully
 *    observed: both REMOVED rows logged, the last before the round's end,
 *    no death of the hunter and no next press of the button inside it.
 *    Kinds: `<reader>: printed Ns, own series ran Ms (second phase 13 s,
 *    Fox | second phase 9 s)` when they differ by more than 0.5 s, `<reader>:
 *    printed Ns, own second phase neither 9 nor 13 s` for a second phase of
 *    another length; `<reader>` is whose prompt the line is in (`hunter's
 *    own prompt`, `ally's prompt`, `enemy's prompt`). Out of the total:
 *    `agrees (…)` per second-phase reading. Counted: every Cheetah press
 *    line whose own series is fully observed.
 *
 *  - `statedInstantInZoneBand` (218.5.3): once per round, the round's stated
 *    instant (`logInstantOf(match, match.startTime)`, the readers' own call;
 *    a unit's clock when the match carries none) inside the band after a
 *    dated cutover where a stated instant is uncertain — asked of the
 *    product's own `logDatedAt` (the two `zoneBandTakes` sides answer
 *    differently only inside `STATED_ZONE_UNCERTAINTY_MS` after the cutover).
 *    Kind = the cutover constant's name. Out of the total: `no stated
 *    instant` (a round that carries no clock offset). Counted: every round.
 *    The cutovers are every exported `*_EPOCH_MS` of packages/analysis/src;
 *    `DR_RESET_CUTOVER_EPOCH_MS` and data/talentMitigationModifiers.ts's
 *    `HOTFIX_2026_08_25_EPOCH_MS` restate an instant listed here and are
 *    left out so one round is not counted twice for one instant.
 */
import { ownEffectAurasOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import { PRESS_CHAIN_HANDOVER_MS } from "@gladlog/analysis/src/data/pressEffectChains";
import { STORM_CONDUIT_HOTFIX_EPOCH_MS } from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import {
  buffDurationOfApplication,
  buffFullDurationForCaster,
} from "@gladlog/analysis/src/utils/buffDuration";
import { AURA_BEFORE_CAST_ROW_MAX_MS } from "@gladlog/analysis/src/utils/castRowLag";
import { PATCH_121_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/drAnalysis";
import { logDatedAt, logInstantOf } from "@gladlog/analysis/src/utils/logEra";
import {
  CALL_OF_OHNAHRA_HOTFIX_EPOCH_MS,
  HOTFIX_2026_08_18_EPOCH_MS,
  HOTFIX_2026_08_25_EPOCH_MS,
  HOTFIX_2026_09_01_EPOCH_MS,
  HOTFIX_2026_10_06_EPOCH_MS,
} from "@gladlog/analysis/src/utils/talentModifiers";
import { PATCH_1215_GOLIVE_EPOCH_MS } from "@gladlog/analysis/src/utils/talents";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

const TD = "timelessDurationDiffers";
const SK = "sacrificeKitLasts";
const CF = "cheetahFoxPress";
const ZB = "statedInstantInZoneBand";
export const CHECKS = [TD, SK, CF, ZB] as const;
/** whole checks out of the total (T314): the time-less length's exposure (its own header) */
export const MEASURED_ONLY: ReadonlySet<string> = new Set([TD]);

const SK_AGREES = "agrees";
const SK_ALL_CUT = "every life cut";
const CF_PHASES = {
  fox: "second phase 13 s, Fox",
  plain: "second phase 9 s",
  other: "second phase neither 9 nor 13 s",
} as const;
const ZB_NONE = "no stated instant";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${SK}|${SK_AGREES}`,
  `${SK}|${SK_ALL_CUT}`,
  ...Object.values(CF_PHASES).map((p) => `${CF}|agrees (${p})`),
  `${ZB}|${ZB_NONE}`,
]);
/** `kit Ns, longest full life Ms (…)` / `kit N–Ns, …`: the kind the row
 * builds when the longest un-cut life is off the kit */
const SK_OFF_KIND =
  /^kit (\d+(?:\.\d+)?)(?:–\d+(?:\.\d+)?)?s, longest full life (\d+)s /;
/**
 * A Sacrifice life shorter than the kit refutes nothing (T314, the audit's
 * 76/76 on the 605): an aura can end early but cannot outlive its length
 * (Game-Behaviour Rule 7), and T194 ruled the early ends "nothing wrong".
 * Out of the total; only a life past the kit stays in. M is rounded from a
 * life more than `DIFFERS_S` off the kit, so `M < kitMin` is exactly the
 * shorter side.
 */
export function outOfTotalKind(check: string, kind: string): boolean {
  if (check !== SK) return false;
  const m = SK_OFF_KIND.exec(kind);
  return m !== null && Number(m[2]) < Number(m[1]);
}

/** a length this far off another is a different length */
const DIFFERS_S = 0.5;
/** a death this close after an aura's REMOVED ended it */
const DEATH_SLACK_MS = 100;

const SACRIFICE_AURA_IDS: ReadonlySet<string> = new Set(["6940", "199448"]);
const CHEETAH_ID = "186257";
const CHEETAH_SECOND_ID = "186258";
const FOX_SECOND_S = 13;
const PLAIN_SECOND_S = 9;

const CUTOVERS: ReadonlyArray<readonly [string, number]> = [
  ["PATCH_121_GOLIVE_EPOCH_MS", PATCH_121_GOLIVE_EPOCH_MS],
  ["STORM_CONDUIT_HOTFIX_EPOCH_MS", STORM_CONDUIT_HOTFIX_EPOCH_MS],
  ["HOTFIX_2026_08_18_EPOCH_MS", HOTFIX_2026_08_18_EPOCH_MS],
  ["HOTFIX_2026_08_25_EPOCH_MS", HOTFIX_2026_08_25_EPOCH_MS],
  ["HOTFIX_2026_09_01_EPOCH_MS", HOTFIX_2026_09_01_EPOCH_MS],
  ["CALL_OF_OHNAHRA_HOTFIX_EPOCH_MS", CALL_OF_OHNAHRA_HOTFIX_EPOCH_MS],
  ["HOTFIX_2026_10_06_EPOCH_MS", HOTFIX_2026_10_06_EPOCH_MS],
  ["PATCH_1215_GOLIVE_EPOCH_MS", PATCH_1215_GOLIVE_EPOCH_MS],
];

const KIT_SACRIFICE =
  /Blessing of Sacrifice \[[^\]]*?lasts ([\d.]+)(?:–([\d.]+))?s\+?/;
const CHEETAH_LINE =
  /^\s*(\d+:\d\d)\s+(\[YOU\] )?\[PRESS\]\s+(?:(\d+)\([^)]*\) \([^)]*\): )?Aspect of the Cheetah \(lasts ([\d.]+)s/;

const s1 = (ms: number): string => (ms / 1000).toFixed(1);
const diedIn = (u: any, fromMs: number, toMs: number): boolean =>
  ((u?.deathRecords ?? []) as any[]).some(
    (d) => d.timestamp >= fromMs && d.timestamp <= toMs + DEATH_SLACK_MS,
  );
/** a unit's rows of an aura it holds from `srcId`, in time order */
const heldRows = (u: any, ids: ReadonlySet<string>, srcId: string): any[] =>
  ((u.auraEvents ?? []) as any[])
    .filter(
      (a) =>
        ids.has(String(a.spellId)) &&
        a.srcUnitId === srcId &&
        (a.destUnitId === undefined || a.destUnitId === u.id),
    )
    .sort((a, b) => tsOf(a) - tsOf(b));

/** a unit's kit row: the text of the `<cooldowns>` after its `<unit>` tag
 * (scan5/listGap.ts `kitOf`) */
function kitOf(lines: string[], name: string): string {
  const i = lines.findIndex((l) => l.includes(`name="${name}"`));
  if (i < 0) return "";
  for (let j = i; j < Math.min(i + 6, lines.length); j++)
    if (lines[j]!.includes("<cooldowns>")) return lines[j]!;
  return "";
}

export function run(ctx: IRoundCtx): void {
  if (ctx.firstOwnerOfRound) {
    timelessDurationDiffers(ctx);
    statedInstantInZoneBand(ctx);
  }
  sacrificeKitLasts(ctx);
  cheetahFoxPress(ctx);
}

function timelessDurationDiffers(ctx: IRoundCtx): void {
  for (const u of ctx.players as any[]) {
    const timeless = new Map<string, number | undefined>();
    for (const c of successesOf(u)) {
      if (!c.spellId) continue;
      const at = tsOf(c);
      if (at < ctx.start || at > ctx.roundEndAt) continue;
      const castId = String(c.spellId);
      for (const id of new Set([castId, ...ownEffectAurasOfCast(castId)])) {
        if (!timeless.has(id))
          timeless.set(id, buffFullDurationForCaster(id, u));
        const t0 = timeless.get(id);
        if (t0 === undefined) continue;
        ctx.bump(TD);
        const t1 = buffDurationOfApplication(id, u, at);
        if (t1 !== undefined && Math.abs(t1 - t0) < 1e-6) continue;
        ctx.violate(
          TD,
          nameOf(id, c.spellName ?? id),
          at,
          `${u.id}#${id}#${at}`,
          `${u.spec} ${nameOf(castId, c.spellName ?? castId)} ${castId}${id === castId ? "" : ` -> aura ${id}`} at +${at - ctx.start}ms: time-less ${t0} s, this application ${t1 ?? "undefined"} s`,
        );
      }
    }
  }
}

function sacrificeKitLasts(ctx: IRoundCtx): void {
  for (const pal of ctx.players as any[]) {
    const kit = kitOf(ctx.lines, pal.name);
    const m = KIT_SACRIFICE.exec(kit);
    if (!m) continue;
    const kitMin = Number(m[1]);
    const kitMax = m[2] !== undefined ? Number(m[2]) : kitMin;
    let lives = 0;
    let longestMs = -1;
    const fullIds = new Set<string>();
    const seenIds = new Set<string>();
    let firstAt = ctx.start;
    for (const holder of ctx.units as any[]) {
      let open: any;
      let refreshed = false;
      const byId = new Map<string, any[]>();
      for (const a of heldRows(holder, SACRIFICE_AURA_IDS, pal.id)) {
        const id = String(a.spellId);
        byId.set(id, [...(byId.get(id) ?? []), a]);
      }
      for (const [id, rows] of byId) {
        open = undefined;
        for (const a of rows) {
          const t = tsOf(a);
          if (ev(a) === APPLIED) {
            // a life left open by a second APPLIED has no end to read
            if (open !== undefined) lives++;
            open = t >= ctx.start && t <= ctx.roundEndAt ? a : undefined;
            refreshed = false;
            if (open !== undefined) {
              if (seenIds.size === 0) firstAt = t;
              seenIds.add(id);
            }
          } else if (ev(a) === REFRESH && open !== undefined) {
            refreshed = true;
          } else if (ev(a) === REMOVED && open !== undefined) {
            const from = tsOf(open);
            lives++;
            open = undefined;
            if (
              refreshed ||
              t >= ctx.roundEndAt ||
              diedIn(holder, from, t) ||
              diedIn(pal, from, t)
            )
              continue;
            fullIds.add(id);
            longestMs = Math.max(longestMs, t - from);
          }
        }
        if (open !== undefined) lives++;
      }
    }
    if (lives === 0) continue;
    ctx.bump(SK);
    const factId = `${pal.id}#sacrificeKit`;
    const kitText = m[2] !== undefined ? `${m[1]}–${m[2]}` : m[1]!;
    const seen = `aura ${[...seenIds].sort().join("+")}`;
    if (longestMs < 0) {
      ctx.violate(
        SK,
        SK_ALL_CUT,
        firstAt,
        factId,
        `${pal.spec} kit lasts ${kitText}s; ${lives} lives (${seen}), none un-cut`,
        kit,
      );
      continue;
    }
    const longestS = longestMs / 1000;
    const full = `aura ${[...fullIds].sort().join("+")}`;
    const agrees =
      longestS >= kitMin - DIFFERS_S && longestS <= kitMax + DIFFERS_S;
    ctx.violate(
      SK,
      agrees
        ? SK_AGREES
        : `kit ${kitText}s, longest full life ${Math.round(longestS)}s (${full})`,
      firstAt,
      factId,
      `${pal.spec} kit lasts ${kitText}s; ${lives} lives (${seen}), longest un-cut ${s1(longestMs)} s (${full})`,
      kit,
    );
  }
}

function cheetahFoxPress(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  const seenInSecond = new Map<string, number>();
  for (const line of ctx.lines) {
    const m = CHEETAH_LINE.exec(line);
    if (!m) continue;
    const hunter: any = m[2] ? ctx.owner : ctx.unitOfPid(m[3]);
    if (!hunter) continue;
    const sec = secOf(m[1]!);
    const printed = Number(m[4]);
    const presses = successesOf(hunter)
      .filter((c) => String(c.spellId) === CHEETAH_ID)
      .sort((a, b) => tsOf(a) - tsOf(b));
    // the k-th line of a second is its k-th press
    const ordKey = `${hunter.id}|${sec}`;
    const k = seenInSecond.get(ordKey) ?? 0;
    seenInSecond.set(ordKey, k + 1);
    const press = presses.filter(
      (c) => Math.floor((tsOf(c) - ctx.start) / 1000) === sec,
    )[k];
    if (!press) continue;
    const pressMs = tsOf(press);
    const nextPressMs = presses.map(tsOf).find((t) => t > pressMs) ?? Infinity;

    // the hunter's own series, on the rows
    const own = (id: string) => heldRows(hunter, new Set([id]), hunter.id);
    const head = own(CHEETAH_ID).find(
      (a) =>
        ev(a) === APPLIED &&
        Math.abs(tsOf(a) - pressMs) <= AURA_BEFORE_CAST_ROW_MAX_MS,
    );
    if (!head) continue;
    const headEnd = own(CHEETAH_ID).find(
      (a) => ev(a) === REMOVED && tsOf(a) >= tsOf(head),
    );
    if (!headEnd) continue;
    const second = own(CHEETAH_SECOND_ID).find(
      (a) =>
        ev(a) === APPLIED &&
        tsOf(a) >= tsOf(head) &&
        Math.abs(tsOf(a) - tsOf(headEnd)) <= PRESS_CHAIN_HANDOVER_MS,
    );
    if (!second) continue;
    const secondEnd = own(CHEETAH_SECOND_ID).find(
      (a) => ev(a) === REMOVED && tsOf(a) >= tsOf(second),
    );
    if (!secondEnd) continue;
    const endMs = tsOf(secondEnd);
    if (
      endMs >= ctx.roundEndAt ||
      nextPressMs <= endMs ||
      diedIn(hunter, tsOf(head), endMs)
    )
      continue;
    ctx.bump(CF);

    const firstMs = tsOf(headEnd) - tsOf(head);
    const secondMs = endMs - tsOf(second);
    const ranS = (firstMs + secondMs) / 1000;
    const phase =
      Math.abs(secondMs / 1000 - FOX_SECOND_S) <= DIFFERS_S
        ? CF_PHASES.fox
        : Math.abs(secondMs / 1000 - PLAIN_SECOND_S) <= DIFFERS_S
          ? CF_PHASES.plain
          : CF_PHASES.other;
    const reader =
      hunter.id === ctx.owner.id
        ? "hunter's own prompt"
        : hunter.reaction === ctx.owner.reaction
          ? "ally's prompt"
          : "enemy's prompt";
    const agrees = Math.abs(printed - ranS) <= DIFFERS_S;
    const kind = agrees
      ? `agrees (${phase})`
      : phase === CF_PHASES.other
        ? `${reader}: printed ${m[4]}s, own ${phase}`
        : `${reader}: printed ${m[4]}s, own series ran ${Math.round(ranS)}s (${phase})`;
    ctx.violate(
      CF,
      kind,
      pressMs,
      `${hunter.id}#${pressMs}#${agrees ? "agrees" : reader}`,
      `${hunter.spec} press +${pressMs - ctx.start}ms, ${reader}: printed ${m[4]} s; own ${CHEETAH_ID} ${s1(firstMs)} s + ${CHEETAH_SECOND_ID} ${s1(secondMs)} s = ${ranS.toFixed(1)} s`,
      line,
    );
  }
}

function statedInstantInZoneBand(ctx: IRoundCtx): void {
  ctx.bump(ZB);
  const legacy = ctx.legacy as any;
  const startMs: number = legacy.startTime;
  // the readers' own call (`logInstantOf(combat, combat.startTime)`,
  // utils/enemyCDs.ts); a unit carries the same offset (`logInstantOf(unit,
  // combat.startTime)`, utils/cooldowns.ts)
  let at = logInstantOf(legacy, startMs);
  if (typeof at !== "object")
    for (const u of ctx.players as any[]) {
      at = logInstantOf(u, startMs);
      if (typeof at === "object") break;
    }
  if (typeof at !== "object" || !Number.isFinite(at.statedMs)) {
    ctx.violate(
      ZB,
      ZB_NONE,
      ctx.start,
      "noStatedInstant",
      `round start ${startMs}: no clock offset on the match or its players`,
    );
    return;
  }
  const stated = at;
  for (const [name, cutoverEpochMs] of CUTOVERS) {
    // inside the band the product reads `zoneBandTakes`, and only there
    const side = (zoneBandTakes: "before" | "since") =>
      logDatedAt(
        { cutoverEpochMs, before: "before", since: "since", zoneBandTakes },
        stated,
      );
    if (side("before") === side("since")) continue;
    ctx.violate(
      ZB,
      name,
      ctx.start,
      name,
      `stated ${new Date(stated.statedMs).toISOString()}, ${Math.round((stated.statedMs - cutoverEpochMs) / 60_000)} min after ${name} (${new Date(cutoverEpochMs).toISOString()})`,
    );
  }
}
