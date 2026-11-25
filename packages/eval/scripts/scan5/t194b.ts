/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t194b.ts — pipeline T194, count first: three settling counts. Each
 * asks the product's own producer / predicate and reads the log rows beside
 * it; none re-derives what the product computes.
 *
 *  - `noHealFoldRealPair` (218.6.5): `foldSamePressRows` (utils/pressRow.ts)
 *    folding two cast rows of one HEAL on two different targets into one
 *    press, for the prompt's owner. The rows handed to it are the ones
 *    `noHealStretchesBeforeFirstDeath` hands it (SUCCESS, no
 *    `isNoPlayerPressRow`); a folded pair is a row the fold dropped and the
 *    kept row of that spell before it. "Heal" is read off the log: the
 *    spell's name is on a heal / absorb row of the owner's this round
 *    (or `pressedHeals` holds its id), or each of the two rows has a direct
 *    heal row of the owner's on its own target in its own instant
 *    (`PRESS_LANDED_SAME_INSTANT_MS`).
 *    Population (`bump`): every such folded pair of heal rows on two targets.
 *    Kinds:
 *     · `folded pair of heals inside a printed stretch` — the dropped row
 *       lies strictly inside a stretch `noHealStretchesBeforeFirstDeath`
 *       returns and the prompt printed as `[YOU] [NO HEAL CAST]`. The
 *       producer cuts a stretch at every heal press it knows and lists every
 *       other press, so a row inside a stretch that is neither is a row the
 *       fold took off the line (a missing cut or a missing `pressed` entry).
 *     · `folded pair of heals, no printed line affected` (out of the total)
 *       — every other such pair.
 *
 *  - `kickDodgePress` (173.35): the owner's kicks `analyzeKickAudit` calls
 *    `juked` or `missed` (the `[KICK] your … — JUKED by fake … / hit nothing`
 *    lines and the `Kicks:` ledger), whose target had a cast bar begun inside
 *    `JUKE_LOOKBACK_MS` before the kick, with a target-dropping press of the
 *    KICKER's side between that bar's start and the kick. The presses are the
 *    ones `ownerCastBarOutcomes` hands `castBarOutcomesOf` as `dodgeMs`:
 *    SUCCESS rows of `TARGETED_CC_DODGE_SPELLS` and `feignDeathInstantsMs`.
 *    (The unit that pressed is the one the BAR may have been on, the kick
 *    target's own target — a START row names no target, so this is an upper
 *    bound on bars that lost their target.)
 *    Population (`bump`): every juked / missed kick of the owner's with a
 *    target and such a bar. Kinds: `juked, target pressed X` /
 *    `missed, target pressed X`. The detail carries what `castBarOutcomesOf`
 *    says of that bar when handed the same `dodgeMs`.
 *
 *  - `anotherSchoolIntersects` (207.8): the kick-eaten menu rows that say
 *    `postKick=acted on another school Ns later (X…)`, matched to the
 *    product's instance (`analyzePlayerCCAndTrinket().interruptInstances`,
 *    `postKick === "switched"`). X's cast row is read off the log (the
 *    owner's SUCCESS of that name at the stated delay) and its DB2 mask
 *    (`spellSchoolMask`) held against the locked mask (the interrupted
 *    spell's, as the producer reads it).
 *    Population (`bump`): every such printed row.
 *    Kinds: `X (mask a) inside a lock on mask b` — the masks share a bit and
 *    the press came before the modelled lock's end; `X (mask a) after a lock
 *    on mask b` — they share a bit, the press came after it;
 *    `press not found in the log` (out of the total) — the scan could not
 *    find X's row, nothing is said of the product.
 */
import { MANA_PRESSURE_LOW_PCT } from "@gladlog/analysis/src/analysis/candidates/mana";
import { spellSchoolMask } from "@gladlog/analysis/src/data/spellSchools";
import { pressedHeals } from "@gladlog/analysis/src/utils/cannotCastIntervals";
import {
  castBarOutcomesOf,
  castBarStartsOf,
  JUKE_LOOKBACK_MS,
} from "@gladlog/analysis/src/utils/castBarOutcomes";
import { PRESS_LANDED_SAME_INSTANT_MS } from "@gladlog/analysis/src/utils/castMissRows";
import { feignDeathInstantsMs } from "@gladlog/analysis/src/utils/castStopEvidence";
import {
  analyzePlayerCCAndTrinket,
  POST_KICK_WINDOW_S,
  TARGETED_CC_DODGE_SPELLS,
} from "@gladlog/analysis/src/utils/ccTrinketAnalysis";
import { analyzeKickAudit } from "@gladlog/analysis/src/utils/kickAudit";
import { noHealStretchesBeforeFirstDeath } from "@gladlog/analysis/src/utils/noHealCast";
import {
  foldSamePressRows,
  isNoPlayerPressRow,
} from "@gladlog/analysis/src/utils/pressRow";
import {
  fmtTime,
  NO_HEAL_CAST_LINE_TAG,
} from "@gladlog/analysis/src/utils/renderGrid";

import { ev, type IRoundCtx, nameOf, SUCCESS, tsOf } from "./ctx";

const NH = "noHealFoldRealPair";
const KD = "kickDodgePress";
const AS = "anotherSchoolIntersects";
export const CHECKS = [NH, KD, AS] as const;

const NH_PRINTED = "folded pair of heals inside a printed stretch";
const NH_UNPRINTED = "folded pair of heals, no printed line affected";
const AS_UNRESOLVED = "press not found in the log";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${NH}|${NH_UNPRINTED}`,
  `${AS}|${AS_UNRESOLVED}`,
]);

const FEIGN_DEATH_ID = "5384";

const sideOf = (ctx: IRoundCtx) => {
  const owner = ctx.owner;
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (p) => p.reaction !== owner.reaction,
  );
  return { friends, enemies };
};

// ── noHealFoldRealPair ──────────────────────────────────────────────────────
function noHealFold(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  const casts = (owner.spellCastEvents ?? []) as any[];
  // the rows the no-heal reader hands the fold
  const rows = casts.filter(
    (e) => ev(e) === SUCCESS && !isNoPlayerPressRow(e, casts),
  );
  const kept = new Set<any>(foldSamePressRows(rows));
  const dropped = rows.filter((r) => !kept.has(r));
  if (dropped.length === 0) return;

  const healIds = pressedHeals(owner);
  const healNames = new Set<string>(
    [...(owner.healOut ?? []), ...(owner.absorbsOut ?? [])]
      .map((r: any) => nameOf(r.spellId))
      .filter((n: string) => n !== ""),
  );
  const directHeals = ((owner.healOut ?? []) as any[]).filter(
    (h) => h.srcUnitId === owner.id && ev(h) !== "SPELL_PERIODIC_HEAL",
  );
  const landed = (e: any) =>
    directHeals.some(
      (h) =>
        h.destUnitId === e.destUnitId &&
        Math.abs(tsOf(h) - tsOf(e)) <= PRESS_LANDED_SAME_INSTANT_MS,
    );
  const byName = (e: any) =>
    healIds.has(String(e.spellId ?? "")) ||
    healNames.has(nameOf(e.spellId, e.spellName ?? ""));

  const pairs: Array<{ first: any; second: any; how: string }> = [];
  for (const second of dropped) {
    const first = [...kept]
      .filter((k) => k.spellId === second.spellId && tsOf(k) <= tsOf(second))
      .sort((a, b) => tsOf(b) - tsOf(a))[0];
    if (!first || first.destUnitId === second.destUnitId) continue;
    const named = byName(second);
    const both = landed(first) && landed(second);
    if (!named && !both) continue;
    pairs.push({
      first,
      second,
      how: `${named ? "a heal by its rows this round" : "no heal row under its name"}; own heal row on its target: first ${landed(first) ? "yes" : "no"}, second ${landed(second) ? "yes" : "no"}`,
    });
  }
  if (pairs.length === 0) return;

  // the stretches the product computes, and of those the ones the prompt
  // printed (asked only where a line is there)
  const tagged = ctx.lines.filter((l) => l.includes(NO_HEAL_CAST_LINE_TAG));
  const printed: Array<{ fromMs: number; toMs: number; line: string }> = [];
  if (tagged.length > 0) {
    const { friends, enemies } = sideOf(ctx);
    const deaths = (us: any[]) =>
      us
        .flatMap((p) =>
          ((p.deathRecords ?? []) as any[]).map((d) => ({
            name: p.name as string,
            atSeconds: (d.timestamp - ctx.start) / 1000,
          })),
        )
        .sort((a, b) => a.atSeconds - b.atSeconds);
    const sec = (ms: number) => (ms - ctx.start) / 1000;
    for (const s of noHealStretchesBeforeFirstDeath({
      owner,
      friends,
      enemies,
      allUnits: ctx.units,
      startMs: ctx.start,
      friendlyDeaths: deaths(friends),
      enemyDeaths: deaths(enemies),
      zoneId: ctx.legacy.startInfo?.zoneId,
      rawStreams: ctx.rawStreams(),
      lowManaPct: MANA_PRESSURE_LOW_PCT,
    })) {
      const head = `${fmtTime(sec(s.fromMs))}–${fmtTime(sec(s.toMs))}  ${NO_HEAL_CAST_LINE_TAG}`;
      const line = tagged.find((l) => l.trimStart().startsWith(head));
      if (line) printed.push({ fromMs: s.fromMs, toMs: s.toMs, line });
    }
  }

  for (const { first, second, how } of pairs) {
    ctx.bump(NH);
    const t = tsOf(second);
    const hit = printed.find((s) => t > s.fromMs && t < s.toMs);
    const name = nameOf(second.spellId, second.spellName ?? "");
    ctx.violate(
      NH,
      hit ? NH_PRINTED : NH_UNPRINTED,
      t,
      `${owner.id}#${second.spellId}#${t}`,
      `${name} on ${first.destUnitName ?? first.destUnitId ?? "?"} then ${t - tsOf(first)} ms later on ${second.destUnitName ?? second.destUnitId ?? "?"}, folded into one press (${how})`,
      hit?.line,
    );
  }
}

// ── kickDodgePress ──────────────────────────────────────────────────────────
function kickDodge(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  const { friends, enemies } = sideOf(ctx);
  if (enemies.length === 0) return;
  // the kicker's side's target-dropping presses, as `ownerCastBarOutcomes`
  // collects the `dodgeMs` of a unit's opponents
  const dodges: Array<{ ms: number; name: string; by: string }> =
    friends.flatMap((e) => [
      ...((e.spellCastEvents ?? []) as any[])
        .filter(
          (c) =>
            ev(c) === SUCCESS && TARGETED_CC_DODGE_SPELLS.has(c.spellId ?? ""),
        )
        .map((c) => ({
          ms: tsOf(c) as number,
          name: nameOf(c.spellId, c.spellName ?? ""),
          by: e.name as string,
        })),
      ...feignDeathInstantsMs(e).map((ms) => ({
        ms,
        name: nameOf(FEIGN_DEATH_ID, "Feign Death"),
        by: e.name as string,
      })),
    ]);
  const failed = ctx.rawStreams().castFailed;
  // the call the `[KICK]` lines are rendered from (timelineSections/kick.ts)
  for (const k of analyzeKickAudit(owner, enemies, ctx.legacy as never)) {
    if (k.result !== "juked" && k.result !== "missed") continue;
    if (!k.targetId) continue;
    const target = (ctx.units as any[]).find((u) => u.id === k.targetId);
    if (!target) continue;
    const kickS = k.atSeconds;
    const bar = castBarStartsOf(target, ctx.start)
      .filter((b) => b.t <= kickS && b.t >= kickS - JUKE_LOOKBACK_MS / 1000)
      .at(-1);
    if (!bar) continue;
    ctx.bump(KD);
    const fromMs = ctx.start + bar.t * 1000;
    const kickMs = ctx.start + kickS * 1000;
    const press = dodges.find((d) => d.ms >= fromMs - 1 && d.ms <= kickMs + 1);
    if (!press) continue;
    // what the product's cast-bar reader says of that bar with the presses
    const outcome = castBarOutcomesOf({
      unit: target,
      startMs: ctx.start,
      failed: failed.filter((f: any) => f.unitGuid === target.id),
      dodgeMs: dodges.map((d) => d.ms),
    }).find((o) => o.t === bar.t && o.id === bar.id);
    const end = outcome?.end;
    const near =
      end?.kind === "stopped"
        ? `stopped, near=${end.near}`
        : end?.kind === "none"
          ? `no end row, superseded near=${end.superseded?.near ?? "-"}`
          : (end?.kind ?? "?");
    const head = `${fmtTime(kickS)}  [KICK]   your ${k.kickSpellName}`;
    ctx.violate(
      KD,
      `${k.result}, target pressed ${press.name}`,
      kickMs,
      `${owner.id}#${Math.floor(kickS * 10)}`,
      `${k.kickSpellName} at ${kickS.toFixed(2)} on ${k.targetName ?? "?"} reads ${k.result}${k.jukedBySpellName ? ` by ${k.jukedBySpellName}` : ""}; its ${nameOf(bar.id, bar.name)} bar began ${bar.t.toFixed(2)} and ${press.by} pressed ${press.name} at ${((press.ms - ctx.start) / 1000).toFixed(2)} (castBarOutcomesOf with these presses: ${near})`,
      ctx.lines.find((l) => l.trimStart().startsWith(head)),
    );
  }
}

// ── anotherSchoolIntersects ─────────────────────────────────────────────────
function anotherSchool(ctx: IRoundCtx): void {
  if (!ctx.menu.includes("acted on another school")) return;
  const owner = ctx.owner;
  const { enemies } = sideOf(ctx);
  const enemyIds = new Set(enemies.map((e) => e.id));
  const rs = ctx.rawStreams();
  const summary = analyzePlayerCCAndTrinket(
    owner,
    enemies,
    ctx.legacy as never,
    (ctx.units as any[]).filter((u) => u.ownerId && enemyIds.has(u.ownerId)),
    rs.available ? rs.castFailed : undefined,
  );
  const rows = ctx.menu
    .split("\n")
    .filter(
      (l) =>
        l.includes("type=kick-eaten") && l.includes("acted on another school"),
    );
  const successes = ((owner.spellCastEvents ?? []) as any[])
    .filter((c) => ev(c) === SUCCESS)
    .sort((a, b) => tsOf(a) - tsOf(b));
  for (const inst of summary.interruptInstances) {
    if (inst.postKick !== "switched") continue;
    if (inst.switchSpellName == null || inst.switchDelayS == null) continue;
    const name = inst.switchSpellName;
    // the statement as the menu prints it (candidateFindings `postKickFact`)
    const said = `acted on another school ${inst.switchDelayS.toFixed(1)}s later (${name}`;
    const row = rows.find((l) => {
      const t = / t=([\d.]+)s /.exec(l);
      return (
        l.includes(said) &&
        t !== null &&
        Math.abs(Number(t[1]) - inst.atSeconds) <= 0.051
      );
    });
    if (!row) continue;
    ctx.bump(AS);
    const kickMs = ctx.start + inst.atSeconds * 1000;
    const fact = `${owner.id}#${Math.floor(inst.atSeconds * 10)}`;
    // the stated delay is the cast's bar start or its SUCCESS: the row is
    // the first SUCCESS of that name at or after it, inside the window
    const cast = successes.find(
      (c) =>
        tsOf(c) >= kickMs + inst.switchDelayS! * 1000 - 1 &&
        tsOf(c) <= kickMs + POST_KICK_WINDOW_S * 1000 + 1 &&
        nameOf(c.spellId, c.spellName ?? "") === name,
    );
    if (!cast) {
      ctx.violate(
        AS,
        AS_UNRESOLVED,
        kickMs,
        fact,
        `${name} +${inst.switchDelayS.toFixed(1)}s after the kick on ${inst.interruptedSpellName}: no SUCCESS row of that name found`,
        row,
      );
      continue;
    }
    const mask = spellSchoolMask(String(cast.spellId));
    const locked = spellSchoolMask(inst.interruptedSpellId);
    if (mask === undefined || locked === undefined) continue;
    if ((mask & locked) === 0) continue;
    const inLock = inst.switchDelayS < inst.lockoutDurationSeconds;
    ctx.violate(
      AS,
      `${name} (mask ${mask}) ${inLock ? "inside" : "after"} a lock on mask ${locked}`,
      kickMs,
      fact,
      `${name} ${cast.spellId} (mask ${mask}) ${inst.switchDelayS.toFixed(1)}s into a ${inst.lockoutDurationSeconds.toFixed(1)}s lock on ${inst.interruptedSpellName} ${inst.interruptedSpellId} (mask ${locked}): shared bits ${mask & locked}, open bits ${mask & ~locked}`,
      row,
    );
  }
}

export function run(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  noHealFold(ctx);
  kickDodge(ctx);
  anotherSchool(ctx);
}
