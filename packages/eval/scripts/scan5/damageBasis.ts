/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, damageIn, absorbsIn) */
/**
 * scan5/damageBasis.ts — class 4 of the round-7 audit (fact7 F21): every
 * printed damage amount, share or price, against the rows. Three questions:
 * is the absorbed part in, is a redistribution left out, is a deferral
 * shield's row kept out of the sum (its negative corrections by absolute value
 * least of all).
 *
 * Log truth, rows only: `damageIn` (landed), `absorbsIn` (victim-keyed;
 * `spellId` = the shield, `attackerId` the hitter). The deferral shields and
 * the redistribution ids are written here again on purpose, so the check does
 * not inherit a change to the sets under audit.
 *
 *  - `duringExternalShare` (D6, D29): the `X% of their enemy-player damage` of
 *    a `| during it:` segment, against landed + absorbed + deferred on all
 *    enemy players inside the aura's span, up to its own REMOVED row (the
 *    printed length is rounded: a hit logged after that row sat past the wall
 *    and inside a span read as apply + `0.2s`, 7b07c1de r6 0:35, 160 ms). 96fb4d42
 *    0:55: 100 % printed, 73 % with the 117k put into another enemy's shields;
 *    163de8f1 1:37: 0 % printed for 70k all absorbed on the target.
 *  - `allyOverlapDeferral` (D22): a burst ledger `their top target in it: T
 *    N.NNM` that only matches with the deferral rows summed by magnitude.
 *    d2e6e70b: 1.29M printed, 1.28M true.
 *    The line does not say which span it summed, so a span that reads the
 *    figure with no deferral row clears the item: `toB − seconds` matched by
 *    magnitude while the press's own span read it clean (ms-exact on five
 *    rounds, 67 of 67 items landed + absorbed).
 *  - `spikeAbsorbedPart` (D49): a `[DMG SPIKE]` whose absorbed part prints as
 *    at least 0.01M with no `(X absorbed)`. 7acbefeb 1:05: 85k.
 *  - `topSourceRedistribution` (D54): a `Top sources:` entry that names a
 *    redistribution id as the unit's own damage. 7e7b1e51 0:28: Tempered in
 *    Battle (own) (79k).
 *  - `abilityIntoWallShare` (D53): a spell of ≥ 5 % of the player's damage on
 *    enemies, cast ≥ 3 times inside a listed wall, absent from the line.
 *    7e7b1e51 0:43: Fire Blast.
 *    The 5 % is the legend's: a hit a shield ate counts under its attack
 *    spell, deferral rows out. One wall's list is all its lines (Die by the
 *    Sword prints two), and a cast the wall does not stop is no cast into it:
 *    a school the immunity leaves out, or a wall's kill-live-gated part with
 *    the target at or below the gate. What a parry stops is read off the
 *    log's own PARRY rows first: a spell with one this round (any caster's by
 *    id, the caster's or its pet's by name: Kill Command's press 34026, its
 *    row 83381) is a spell a parry stops, whatever the tables say. Where the
 *    round holds no PARRY row of it the expected side is DB2 alone, the
 *    generated tables on the rows the spell landed as, then the press, so
 *    Final Verdict at 12 yd into Die by the Sword stays flagged with none.
 *    What the check can no longer see: a wrong DB2 row on a spell nobody
 *    parried this round. The tables are the product's too, so the check and
 *    the product then agree in error; reach no longer speaks for them. Only a
 *    PARRY row catches that. 59978653 r1 0:30 stayed flagged until Void Blast
 *    left the product's not-a-press list.
 *  - `postCcAbsorbedUnsaid` (D70): a missed-cleanse row whose 5 s after the
 *    control held ≥ 1k absorbed with no absorbed fact beside `postCcDamageK`.
 *    6ac699c9 0:25: 272k.
 *    The 5 s run from the aura the row's `cc=` names, not from the first aura
 *    of that second (b9aae137 r1 0:07: Predatory Swiftness 78 ms before the
 *    Hammer of Justice, 145k against the printed 157k).
 *  - `stackedWallPrice` (D77): a `[STACKED DEFENSIVES]` percentage price
 *    against (landed + absorbed) × b / (1 − b). 831c3fd5 0:23: ~6 % printed,
 *    ~20 % true.
 *  - `duringLethalHit` (fact12 D31): the `Nk on target` of a `| during it:`
 *    segment whose window ends at a REMOVED row the target's death tore
 *    down — a hit with overkill on it logged after that row in its
 *    millisecond (`auraCloseRow`) — against the landed rows on the target
 *    up to and including that hit. f13566f0 r0 11:51:37.841: Obsidian
 *    Scales' copy REMOVED, then the killing Bladestorm (28.8k landed);
 *    `0k on target` printed. Counted: every such segment.
 *  - `channelTookBasis` (fact12 D19): the `Mk damage they took over it` of
 *    an Ultimate Penitence line, against every landed (redistribution
 *    left out) and absorbed (deferral shields left out) row on that player
 *    from the press for the caster's aura's length, cut at the round's end
 *    (`roundEndMs`), the player's own rows too — a deferred Time
 *    Dilation tick lands as self → self damage and a reflected spell as the
 *    victim's own. 66bd381b r0 1:40: 556k printed, 705k on the rows.
 *    Counted: every such clause.
 */
import {
  resolveMitigation,
  strongestComponentPct,
} from "@gladlog/analysis/src/data/mitigationComponents";
import {
  KILL_LIVE_HP_PCT,
  mitigationVerdictOf,
  nonMeleeMitigationVerdictOf,
} from "@gladlog/analysis/src/data/mitigationVerdicts";
import {
  PARRYABLE_SPELL_IDS,
  UNPARRYABLE_SPELL_IDS,
} from "@gladlog/analysis/src/data/spellParryGenerated";
import {
  MELEE_RANGE_YD,
  spellRangeYards,
} from "@gladlog/analysis/src/data/spellReach";
import { auraCloseRow } from "@gladlog/analysis/src/utils/auraIntervals";
import { isNoPressRow } from "@gladlog/analysis/src/utils/castPress";
import { immunityStopsSpellSchool } from "@gladlog/analysis/src/utils/enemyDefensives";
import { withoutDeferralTag } from "@gladlog/analysis/src/utils/offensiveWasteAnalysis";
import { isAutomaticCastRow } from "@gladlog/analysis/src/utils/pressRow";
import { roundEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import {
  ABSORBED,
  APPLIED,
  deathMs,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "duringExternalShare",
  "allyOverlapDeferral",
  "spikeAbsorbedPart",
  "topSourceRedistribution",
  "abilityIntoWallShare",
  "postCcAbsorbedUnsaid",
  "stackedWallPrice",
  "duringLethalHit",
  "channelTookBasis",
] as const;

export const DEFERRAL_SHIELDS = new Set(["357170", "410355", "386124"]);
const REDISTRIBUTION_IDS = new Set(["98021", "451963", "469704"]);
const REDISTRIBUTION_NAMES = [
  "Spirit Link",
  "Void Leech",
  "Tempered in Battle",
];

const SLACK_PCT = 2;
/** the printed length is a tenth of a second, its end within this of the row */
const PRINTED_LENGTH_MS = 150;
const AURA_AFTER_PRESS_MS = 3000;
const fmtLedger = (n: number): string => (n / 1e6).toFixed(2);
const POST_CC_S = 5;
const MIN_ABSORBED = 1000;
/** the 5 % of the legend */
const HIGH_VALUE_SHARE = 0.05;
const WALL_MIN_CASTS = 3;

const secOfTag = (m: string, s: string): number => +m * 60 + +s;
/** an aura's REMOVED row: a row of its millisecond logged before it was
 * still under the aura (fact9 D2, the product's `IAuraInterval.toRow`) */
type CloseRow = { ms: number; lineIndex: number } | undefined;
const inSpan = (r: any, a: number, b: number, close?: CloseRow): boolean =>
  (tsOf(r) >= a && tsOf(r) < b) ||
  (close !== undefined &&
    tsOf(r) === close.ms &&
    r.logLine?.lineIndex !== undefined &&
    r.logLine.lineIndex < close.lineIndex);
const attackersOf = (ctx: IRoundCtx, u: any): Set<string> =>
  new Set([
    u.id,
    ...ctx.units.filter((x) => x.ownerId === u.id).map((x) => x.id),
  ]);
const landedOn = (
  v: any,
  a: number,
  b: number,
  src?: Set<string>,
  close?: CloseRow,
): number =>
  ((v.damageIn ?? []) as any[])
    .filter((d) => inSpan(d, a, b, close) && (!src || src.has(d.srcUnitId)))
    .filter((d) => !REDISTRIBUTION_IDS.has(String(d.spellId)))
    .reduce((n, d) => n + Math.abs(d.effectiveAmount ?? 0), 0);
const absorbedOn = (
  v: any,
  a: number,
  b: number,
  src?: Set<string>,
  close?: CloseRow,
): number =>
  ((v.absorbsIn ?? []) as any[])
    .filter((r) => inSpan(r, a, b, close) && (!src || src.has(r.attackerId)))
    .filter((r) => !DEFERRAL_SHIELDS.has(String(r.spellId)))
    .filter((r) => !REDISTRIBUTION_IDS.has(String(r.attackSpellId)))
    .reduce((n, r) => n + Math.abs(r.absorbedAmount ?? 0), 0);
const deferredOn = (
  v: any,
  a: number,
  b: number,
  src?: Set<string>,
  close?: CloseRow,
): number =>
  ((v.absorbsIn ?? []) as any[])
    .filter((r) => inSpan(r, a, b, close) && (!src || src.has(r.attackerId)))
    .filter((r) => DEFERRAL_SHIELDS.has(String(r.spellId)))
    .reduce((n, r) => n + (r.absorbedAmount ?? 0), 0);

const ENEMY_DEF_EXTERNAL =
  /^\s*(\d+):(\d\d)\s+\[ENEMY DEF\]\s+\d+\([^)]*\)(?: \([^)]*\))?: (.+?)(?: \+ \d+% copy)? → (\d+)\([^)]*\) \((\d+(?:\.\d+)?)s/;
const ENEMY_DEF_CASTER = /\[ENEMY DEF\]\s+(\d+)\(/;
const DURING_SHARE =
  /^(\d+)\([^)]*\) \d+k on target(?: \([^)]*\))? · (\d+)% of their enemy-player damage/;
const DURING_ON_TARGET = /^(\d+)\([^)]*\) (\d+)k on target/;

function duringExternalShare(ctx: IRoundCtx): void {
  const enemies = ctx.players.filter((p) => p.reaction !== ctx.owner.reaction);
  for (const line of ctx.lines) {
    const at = line.indexOf("| during it: ");
    if (at < 0) continue;
    const m = ENEMY_DEF_EXTERNAL.exec(line);
    if (!m) continue;
    const target = ctx.unitOfPid(m[4]);
    if (!target) continue;
    const lo = ctx.start + secOfTag(m[1]!, m[2]!) * 1000;
    // the line prints the press's second; its aura can follow by more than
    // that second (45e12c2b r3 2:01: cast 22:33:14.786, Pain Suppression on the
    // target at 15.571), and a press on a unit already holding the aura opens
    // no APPLIED, only a REFRESH (cb6f3e66 r5 0:35: Time Dilation up from 0:27,
    // the second press and its 10.4 s from the REFRESH at 35.871). The row is
    // the line's caster's, nearest its press: the target's own copy of the
    // name, or a re-broadcast, can open first (55-3 0:24: own Obsidian Scales
    // 24.647, the ally's 24.976)
    const caster = ctx.unitOfPid(ENEMY_DEF_CASTER.exec(line)?.[1]);
    const press = successesOf(caster ?? {}).find(
      (c) =>
        tsOf(c) >= lo &&
        tsOf(c) < lo + 1000 &&
        nameOf(c.spellId, c.spellName) === m[3],
    );
    const anchor = press ? tsOf(press) : lo;
    const named = ((target.auraEvents ?? []) as any[]).filter(
      (a) =>
        (ev(a) === APPLIED || ev(a) === REFRESH) &&
        tsOf(a) >= lo - 1000 &&
        tsOf(a) < lo + AURA_AFTER_PRESS_MS &&
        nameOf(a.spellId, a.spellName) === m[3],
    );
    const fromCaster = named.filter((a) => a.srcUnitId === caster?.id);
    const applied = (fromCaster.length > 0 ? fromCaster : named).sort(
      (a, b) => Math.abs(tsOf(a) - anchor) - Math.abs(tsOf(b) - anchor),
    )[0];
    // an APPLIED inside the target's re-stating batch (≥ 6 APPLIED rows on
    // it within 5 ms: the target seen again) only showed an aura its press
    // had put up (fact9 D19, 36-12 r12 1:09: Life Cocoon cast on a vanished
    // rogue, its row 1.9 s later in the batch)
    const restated =
      applied !== undefined &&
      press !== undefined &&
      tsOf(press) < tsOf(applied) &&
      ((target.auraEvents ?? []) as any[]).filter(
        (x) =>
          x.destUnitId === target.id &&
          ev(x) === APPLIED &&
          Math.abs(tsOf(x) - tsOf(applied)) <= 5,
      ).length >= 6;
    const fromMs = restated ? tsOf(press) : applied ? tsOf(applied) : lo;
    const printedTo = fromMs + +m[5]! * 1000;
    // the aura's own end, read from its row (a re-broadcast's REMOVED sits
    // mid-span, so the one the printed length points at)
    const removedRow = ((target.auraEvents ?? []) as any[])
      .filter(
        (a) =>
          ev(a) === REMOVED &&
          tsOf(a) >= fromMs &&
          nameOf(a.spellId, a.spellName) === m[3],
      )
      .sort(
        (a, b) => Math.abs(tsOf(a) - printedTo) - Math.abs(tsOf(b) - printedTo),
      )[0];
    const removed = removedRow === undefined ? undefined : tsOf(removedRow);
    const auraTo =
      removed !== undefined &&
      Math.abs(removed - printedTo) <= PRINTED_LENGTH_MS
        ? removed
        : printedTo;
    const removedIx = removedRow?.logLine?.lineIndex;
    const wallTo = Math.min(auraTo, deathMs(target), ctx.end);
    for (const seg of line.slice(at + "| during it: ".length).split("; ")) {
      const s = DURING_SHARE.exec(seg);
      if (!s) continue;
      const ally = ctx.unitOfPid(s[1]);
      if (!ally) continue;
      const src = attackersOf(ctx, ally);
      const toMs = Math.min(wallTo, deathMs(ally));
      // the window ends at the REMOVED row itself, not its millisecond —
      // past a lethal hit its death teardown logged after it (the
      // product's `auraCloseRow`)
      const close: CloseRow =
        toMs === removed && removedIx !== undefined
          ? auraCloseRow(removedRow.logLine, target)
          : undefined;
      // the close moved past the REMOVED row: a lethal hit after it
      const lethalAfterRemoval =
        close !== undefined &&
        removedIx !== undefined &&
        close.lineIndex > removedIx;
      const ot = DURING_ON_TARGET.exec(seg);
      if (lethalAfterRemoval && ot) {
        ctx.bump("duringLethalHit");
        const truthK = Math.round(
          landedOn(target, fromMs, toMs, src, close) / 1000,
        );
        if (Math.abs(truthK - +ot[2]!) > 1)
          ctx.violate(
            "duringLethalHit",
            +ot[2]! < truthK ? "dropped" : "high",
            removed!,
            `${m[3]}#${m[1]}:${m[2]}#${ally.name}`,
            `${ally.name} on ${target.name}: printed ${ot[2]}k on target, rows ${truthK}k through the lethal hit after the REMOVED row`,
            line.slice(0, 200),
          );
      }
      // signed: a negative Fel Armor row is the other half of a shield's
      // overstated row on one hit (7308d15a r2 1:16: a 350 tick logged Fel Armor
      // -1480 + Saved by the Light 1458 + Soul Leech 247 = its 225 absorbed)
      const onUnit = (v: any) =>
        Math.max(
          0,
          landedOn(v, fromMs, toMs, src, close) +
            absorbedOn(v, fromMs, toMs, src, close) +
            deferredOn(v, fromMs, toMs, src, close),
        );
      const all = enemies.reduce((n, e) => n + onUnit(e), 0);
      ctx.bump("duringExternalShare");
      if (all <= 0) continue;
      const truth = (onUnit(target) / all) * 100;
      const printed = +s[2]!;
      if (Math.abs(truth - printed) <= SLACK_PCT) continue;
      ctx.violate(
        "duringExternalShare",
        printed > truth ? "high" : "low",
        fromMs,
        `${m[3]}#${m[1]}:${m[2]}#${ally.name}`,
        `${ally.name} on ${target.name}: printed ${printed}%, rows ${truth.toFixed(0)}% of ${Math.round(all / 1000)}k`,
        line.slice(0, 200),
      );
    }
  }
}

const BURST_HEAD = /^\s*Burst #\d+ — (\d+):(\d\d)–(\d+):(\d\d)/;
const ALLY_ITEM =
  /(?:: |, )(\S+) ([^(),]+?) (\d+(?:\.\d+)?)s \(their top target in it: (\S+) ([\d.]+)M\)/g;

function allyOverlapDeferral(ctx: IRoundCtx): void {
  let burst: [number, number] | undefined;
  for (const line of ctx.lines) {
    const h = BURST_HEAD.exec(line);
    if (h) {
      burst = [secOfTag(h[1]!, h[2]!), secOfTag(h[3]!, h[4]!)];
      continue;
    }
    if (!burst || !line.includes("Ally CDs overlapping:")) continue;
    for (const m of line.matchAll(ALLY_ITEM)) {
      const ally = ctx.byName.get(m[1]!);
      const target = ctx.byName.get(m[4]!);
      if (!ally || !target) continue;
      ctx.bump("allyOverlapDeferral");
      const printed = +m[5]! * 1e6;
      const src = attackersOf(ctx, ally);
      const seconds = +m[3]!;
      const fromB = ctx.start + burst[0] * 1000;
      const toB = ctx.start + burst[1] * 1000;
      // the header's seconds are floored: the burst opened at the owner's press
      const opened = successesOf(ctx.owner)
        .map(tsOf)
        .filter((t) => t >= fromB && t < fromB + 1000);
      const press = successesOf(ally)
        .filter(
          (c) =>
            nameOf(c.spellId, c.spellName) === m[2] && tsOf(c) <= toB + 1000,
        )
        .map(tsOf);
      // the overlap opens at the burst or at the press, closes at either end;
      // which of them is the real one the line does not say, so a span that
      // reads the printed figure with no deferral row clears the item
      const opens = [fromB, ...opened, ...press.filter((t) => t >= fromB)];
      const spans = [
        ...opens.map((a) => [a, a + seconds * 1000] as const),
        [toB - seconds * 1000, toB] as const,
      ];
      const cleanOf = (a: number, b: number): number =>
        landedOn(target, a, b + 1, src) + absorbedOn(target, a, b + 1, src);
      if (spans.some(([a, b]) => fmtLedger(cleanOf(a, b)) === m[5])) continue;
      const abs = (a: number, b: number): number =>
        ((target.absorbsIn ?? []) as any[])
          .filter(
            (r) =>
              tsOf(r) >= a &&
              tsOf(r) <= b &&
              src.has(r.attackerId) &&
              DEFERRAL_SHIELDS.has(String(r.spellId)),
          )
          .reduce((n, r) => n + Math.abs(r.absorbedAmount ?? 0), 0);
      for (const [a, b] of spans) {
        const clean = cleanOf(a, b);
        if (abs(a, b) < MIN_ABSORBED) continue;
        if (fmtLedger(clean + abs(a, b)) !== m[5]) continue;
        ctx.violate(
          "allyOverlapDeferral",
          "summedByMagnitude",
          a,
          `${ally.name}#${m[2]}#${burst[0]}`,
          `printed ${(printed / 1e6).toFixed(2)}M = ${Math.round(clean)} + ${Math.round(abs(a, b))} deferral rows`,
          line.trim().slice(0, 200),
        );
        break;
      }
    }
  }
}

const SPIKE = /^\s*(\d+):(\d\d)–(\d+):(\d\d)\s+\[DMG SPIKE\]\s+(\d+)\(/;
const SPIKE_ABSORBED = /\(([\d.]+)M absorbed\)/;
/** `toFixed(2)` of the M figure stops being 0.00 here */
const PRINTS_AS_NONZERO = 5000;

function spikeAbsorbedPart(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = SPIKE.exec(line);
    if (!m) continue;
    const unit = ctx.unitOfPid(m[5]);
    if (!unit) continue;
    const a = ctx.start + secOfTag(m[1]!, m[2]!) * 1000;
    const b = ctx.start + secOfTag(m[3]!, m[4]!) * 1000;
    ctx.bump("spikeAbsorbedPart");
    if (SPIKE_ABSORBED.test(line)) continue;
    // the printed bounds are floored: only rows of [a + 1 s, b] are surely in
    const truth = absorbedOn(unit, a + 1000, b + 1);
    if (truth < PRINTS_AS_NONZERO) continue;
    ctx.violate(
      "spikeAbsorbedPart",
      "unsaid",
      a,
      `${unit.name}#${m[1]}:${m[2]}`,
      `${Math.round(truth / 1000)}k absorbed in the window, the line says nothing`,
      line.trim().slice(0, 200),
    );
  }
}

function topSourceRedistribution(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    if (!/Top sources:|Top damage in final/.test(line)) continue;
    ctx.bump("topSourceRedistribution");
    for (const n of REDISTRIBUTION_NAMES) {
      const m = new RegExp(`${n} \\(own\\) \\((\\d+)k`).exec(line);
      if (!m) continue;
      ctx.violate(
        "topSourceRedistribution",
        n,
        ctx.start,
        `${line.trim().slice(0, 80)}`,
        `${n} (own) ${m[1]}k listed as a source`,
        line.trim().slice(0, 200),
      );
    }
  }
}

const INTO_LINE =
  /^\s*\[(\d+):(\d\d)\] [^(]+\((\S+)\): (.+) into (\S+)'s (.+)$/;

/** did a logged HP reading of the unit inside the span sit at or below `pct` */
function readHpAtOrBelow(
  ctx: IRoundCtx,
  unit: any,
  fromMs: number,
  toMs: number,
  pct: number,
): boolean {
  const rows = ((unit.advancedActions ?? []) as any[]).filter(
    (a) => a.advancedActorId === unit.id && a.advancedActorMaxHp > 0,
  );
  const lo = fromMs - ctx.start;
  const hi = toMs - ctx.start;
  return rows.some(
    (a) =>
      tsOf(a) - ctx.start >= Math.floor(lo / 1000) * 1000 &&
      tsOf(a) - ctx.start <= Math.ceil(hi / 1000) * 1000 &&
      (100 * a.advancedActorCurrentHp) / a.advancedActorMaxHp <= pct,
  );
}

const PARRY_ROW =
  /\bSPELL_MISSED,([^,]+),.*?,(\d+),"([^"]*)",0x[0-9a-fA-F]+,PARRY\b/;

/** the round's PARRY rows: `ids` whoever cast them, `named` as `caster|spell`
 * with a pet's rows under its owner */
function parriedThisRound(ctx: IRoundCtx): {
  ids: Set<string>;
  named: Set<string>;
} {
  const ids = new Set<string>();
  const named = new Set<string>();
  for (const l of ctx.rawLines) {
    const m = PARRY_ROW.exec(l);
    if (!m) continue;
    ids.add(m[2]!);
    const owner = ctx.units.find((u) => u.id === m[1])?.ownerId;
    const caster = owner && !/^0+$/.test(owner) ? owner : m[1]!;
    named.add(`${caster}|${nameOf(m[2]!, m[3]!)}`);
  }
  return { ids, named };
}

/** DB2's word on a press, for a spell the round holds no PARRY row of: any row
 * it landed as, then the press; an id in neither table falls to the press's
 * reach, an unknown reach reads as melee */
function db2Parryable(
  pressId: string,
  rowIds: Set<string> | undefined,
): boolean {
  const ids = [...(rowIds ?? []), pressId];
  if (ids.some((id) => PARRYABLE_SPELL_IDS.has(id))) return true;
  if (ids.some((id) => UNPARRYABLE_SPELL_IDS.has(id))) return false;
  const reach = spellRangeYards(pressId);
  return reach === null || reach <= MELEE_RANGE_YD;
}

function abilityIntoWallShare(ctx: IRoundCtx): void {
  const parried = parriedThisRound(ctx);
  const friendIds = new Set(
    ctx.players
      .filter((p) => p.reaction === ctx.owner.reaction)
      .map((p) => p.id),
  );
  // a wall read by two verdicts prints two lines (Die by the Sword: melee
  // casts, the rest), and one wall's list is both
  const intoKey = (m: RegExpExecArray): string =>
    [m[1], m[2], m[3], m[5], m[6]].join("#");
  const listedOf = new Map<string, string>();
  for (const line of ctx.lines) {
    const m = INTO_LINE.exec(line);
    if (m)
      listedOf.set(intoKey(m), `${listedOf.get(intoKey(m)) ?? ""} + ${m[4]!}`);
  }
  for (const line of ctx.lines) {
    const m = INTO_LINE.exec(line);
    if (!m) continue;
    const friend = ctx.byName.get(m[3]!);
    const target = ctx.byName.get(m[5]!);
    if (!friend || !target) continue;
    ctx.bump("abilityIntoWallShare");
    // what the legend's 5 % is of (D53): a hit a shield ate counts under its
    // own attack spell (`spellId` is the shield), a swing's has none
    const name = (d: any) =>
      ev(d) === ABSORBED
        ? nameOf(d.attackSpellId, d.attackSpellName) || "melee"
        : nameOf(d.spellId, d.spellName) || "melee";
    const totals = new Map<string, number>();
    // the ids a spell's rows are logged under, for DB2's reading of it
    const rowIdsOf = new Map<string, Set<string>>();
    let all = 0;
    for (const d of (friend.damageOut ?? []) as any[]) {
      if (friendIds.has(d.destUnitId)) continue;
      if (ev(d) === ABSORBED && DEFERRAL_SHIELDS.has(String(d.spellId)))
        continue;
      const a = Math.abs(d.effectiveAmount ?? 0);
      totals.set(name(d), (totals.get(name(d)) ?? 0) + a);
      all += a;
      const rowId = ev(d) === ABSORBED ? d.attackSpellId : d.spellId;
      if (rowId)
        rowIdsOf.set(
          name(d),
          (rowIdsOf.get(name(d)) ?? new Set<string>()).add(String(rowId)),
        );
    }
    const lo = ctx.start + secOfTag(m[1]!, m[2]!) * 1000;
    const auras = ((target.auraEvents ?? []) as any[]).filter(
      (a) => nameOf(a.spellId, a.spellName) === withoutDeferralTag(m[6]!),
    );
    const up = auras.find(
      (a) => ev(a) === APPLIED && tsOf(a) >= lo - 1000 && tsOf(a) < lo + 1000,
    );
    if (!up) continue;
    const down = auras.find((a) => ev(a) === REMOVED && tsOf(a) > tsOf(up));
    const toMs = down ? tsOf(down) : ctx.end;
    const listed = listedOf.get(intoKey(m))!;
    // the wall's verdict for what a parry cannot stop can be a gated one, or
    // none at all (Evasion: a spell meets only Elusiveness's 20 %, `never` —
    // user 2026-11-05)
    const wallKey = String(up.spellId);
    const nonMelee = nonMeleeMitigationVerdictOf(wallKey);
    const rangedGated =
      (nonMelee !== mitigationVerdictOf(wallKey) &&
        (nonMelee === "never" || nonMelee === "unresolved")) ||
      (nonMelee === "kill-live-gated" &&
        mitigationVerdictOf(wallKey) !== "kill-live-gated" &&
        readHpAtOrBelow(ctx, target, tsOf(up), toMs, KILL_LIVE_HP_PCT));
    for (const [spell, v] of totals) {
      if (v < all * HIGH_VALUE_SHARE || listed.includes(spell)) continue;
      const parryStops = (id: string) =>
        parried.ids.has(id) ||
        parried.named.has(`${friend.id}|${spell}`) ||
        db2Parryable(id, rowIdsOf.get(spell));
      const friendRows = successesOf(friend);
      const casts = friendRows.filter(
        (c) =>
          tsOf(c) >= tsOf(up) &&
          tsOf(c) <= toMs &&
          c.destUnitId === target.id &&
          nameOf(c.spellId, c.spellName) === spell &&
          // a copy row of another press is no cast (Twin Flame 1265980, a set
          // proc in Disintegrate's instant)
          !isNoPressRow(c, friendRows) &&
          // nor an auto-attack swing or a passive proc — the producer's
          // `isAutomaticCastRow` (pipeline T12: Crusading Strikes swings)
          !isAutomaticCastRow(c) &&
          // a school the immunity does not stop (DB2 masks, else the hand mask
          // of a school-limited immunity: fact11 D20) goes through it:
          // Crusading Strikes (Physical) into Spellwarding (Magic)
          immunityStopsSpellSchool(wallKey, c.spellId) !== false &&
          !(rangedGated && !parryStops(String(c.spellId))),
      );
      if (casts.length < WALL_MIN_CASTS) continue;
      ctx.violate(
        "abilityIntoWallShare",
        "leftOut",
        lo,
        `${friend.name}#${m[6]}#${spell}`,
        `${spell} ${((v / all) * 100).toFixed(1)}% of damage on enemies, ×${casts.length} into ${m[6]}`,
        line.trim().slice(0, 200),
      );
    }
  }
}

const MISSED_ROW =
  /id=missed-cleanse:\S+ type=missed-cleanse t=([\d.]+)s units=(\S+) facts=\{[^}]*?postCcDamageK=(\d+)([^}]*)\}/g;

function postCcAbsorbedUnsaid(ctx: IRoundCtx): void {
  for (const m of ctx.menu.matchAll(MISSED_ROW)) {
    const unit = ctx.byName.get(m[2]!);
    if (!unit) continue;
    ctx.bump("postCcAbsorbedUnsaid");
    // the control's own landing, not the first aura of that second: the
    // menu's `t` is cut to a tenth
    const lo = ctx.start + +m[1]! * 1000 - 100;
    const cc = /[{ ]cc=([^,}]+)/.exec(m[0])?.[1];
    const landing =
      ((unit.auraEvents ?? []) as any[])
        .filter(
          (a) =>
            ev(a) === APPLIED &&
            tsOf(a) >= lo &&
            tsOf(a) < lo + 1100 &&
            nameOf(a.spellId, a.spellName) === cc,
        )
        .map(tsOf)[0] ?? lo;
    const absorbed = absorbedOn(unit, landing, landing + POST_CC_S * 1000 + 1);
    if (absorbed < MIN_ABSORBED) continue;
    const said = /postCcAbsorbedK=(\d+)/.exec(m[4]!);
    if (said && Math.abs(+said[1]! * 1000 - absorbed) <= 2 * MIN_ABSORBED)
      continue;
    ctx.violate(
      "postCcAbsorbedUnsaid",
      said ? "differs" : "unsaid",
      landing,
      `${unit.name}#${m[1]}`,
      `${Math.round(absorbed / 1000)}k absorbed beside postCcDamageK=${m[3]}, row says ${said?.[0] ?? "nothing"}`,
    );
  }
}

const STACKED_LATER_FROM = /\(from (you|\d+\([^)]*\))\) up together \d/;
const STACKED =
  /^\s*(\d+):(\d\d)\s+\[STACKED DEFENSIVES\]\s+\d+\([^)]*\)(?: \(you\))? had .+? up together (\d+):(\d\d)–(\d+):(\d\d) \([\d.]+s\); the later one, (.+?), blocked ~(\d+)% of their max HP during the overlap/;

function stackedWallPrice(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = STACKED.exec(line);
    if (!m) continue;
    const pid = /\[STACKED DEFENSIVES\]\s+(\d+)\(/.exec(line)?.[1];
    const unit = ctx.unitOfPid(pid);
    if (!unit) continue;
    // the later one's own copy: two of one name are priced apart (Obsidian
    // Scales 40 % on the evoker, 15 % from an ally, 55-2 0:52)
    const fromTag = STACKED_LATER_FROM.exec(line)?.[1];
    const laterFrom =
      fromTag === "you"
        ? ctx.owner
        : ctx.unitOfPid(/^\d+/.exec(fromTag ?? "")?.[0]);
    const ofLater = (a: any) =>
      nameOf(a.spellId, a.spellName) === m[7] &&
      (!laterFrom || a.srcUnitId === laterFrom.id);
    const carrierAura = ((unit.auraEvents ?? []) as any[]).find(ofLater);
    if (!carrierAura) continue;
    const res = resolveMitigation(String(carrierAura.spellId), {
      carrierIsCaster: carrierAura.srcUnitId === unit.id,
      caster: ctx.units.find((u) => u.id === carrierAura.srcUnitId),
    });
    const pct = res
      ? strongestComponentPct(res, { includeImmunity: true })
      : undefined;
    if (!pct || pct.pctMin <= 0 || pct.pctMin >= 100) continue;
    if (DEFERRAL_SHIELDS.has(String(carrierAura.spellId))) continue;
    const b = pct.pctMin / 100;
    const auras = ((unit.auraEvents ?? []) as any[]).filter(
      (a) => a.spellId === carrierAura.spellId && ofLater(a),
    );
    const lo = ctx.start + secOfTag(m[3]!, m[4]!) * 1000;
    // the printed end is floored: the overlap ended inside that second
    const hi = ctx.start + secOfTag(m[5]!, m[6]!) * 1000;
    const up = auras.find(
      (a) => ev(a) === APPLIED && tsOf(a) >= lo - 1000 && tsOf(a) < hi,
    );
    const fromMs = up ? tsOf(up) : lo;
    const maxHp = Math.max(
      1,
      ...((unit.advancedActions ?? []) as any[]).map(
        (x) => x.advancedActorMaxHp ?? 0,
      ),
    );
    const priceTo = (to: number) => {
      const dmg = landedOn(unit, fromMs, to) + absorbedOn(unit, fromMs, to);
      return { dmg, pct: ((dmg * b) / (1 - b) / maxHp) * 100 };
    };
    const { dmg, pct: truth } = priceTo(hi);
    const latest = priceTo(hi + 999).pct;
    ctx.bump("stackedWallPrice");
    const printed = +m[8]!;
    const slack = Math.max(SLACK_PCT, truth * 0.2);
    if (printed >= truth - slack && printed <= latest + slack) continue;
    ctx.violate(
      "stackedWallPrice",
      printed > truth ? "high" : "low",
      fromMs,
      `${unit.name}#${m[1]}:${m[2]}#${m[7]}`,
      `printed ~${printed}%, rows ~${truth.toFixed(0)}% (${Math.round(dmg / 1000)}k before absorbs, ${pct.pctMin}%)`,
      line.trim().slice(0, 200),
    );
  }
}

export function run(ctx: IRoundCtx): void {
  duringExternalShare(ctx);
  allyOverlapDeferral(ctx);
  spikeAbsorbedPart(ctx);
  topSourceRedistribution(ctx);
  abilityIntoWallShare(ctx);
  postCcAbsorbedUnsaid(ctx);
  stackedWallPrice(ctx);
  channelTookBasis(ctx);
}

const CHANNEL_HEAD =
  /^\s*(\d+):(\d\d)\s+\[ENEMY (?:CD|DEF)\]\s+(\d+)\([^)]*\)(?: \([^)]*\))?: (Ultimate Penitence) /;
const CHANNEL_TOOK =
  /(?:its bolts hit |; )(\d+)\([^)]*\): \d+k of the (\d+)k damage they took over it/g;

function channelTookBasis(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const at = line.indexOf("— its bolts hit ");
    if (at < 0) continue;
    const h = CHANNEL_HEAD.exec(line);
    if (!h) continue;
    const caster = ctx.unitOfPid(h[3]);
    if (!caster) continue;
    const lo = ctx.start + secOfTag(h[1]!, h[2]!) * 1000;
    // the caster's own aura of the channel opened in the line's second
    const rows = ((caster.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.destUnitId === caster.id &&
        a.srcUnitId === caster.id &&
        nameOf(a.spellId, a.spellName) === h[4],
    );
    const applied = rows.find(
      (a) => ev(a) === APPLIED && tsOf(a) >= lo && tsOf(a) < lo + 1000,
    );
    if (!applied) continue;
    const removed = rows.find(
      (a) => ev(a) === REMOVED && tsOf(a) >= tsOf(applied),
    );
    // the line's window: from the press, the aura's length long, cut at
    // the product's round end — what the basis is judged over, not the
    // window itself (a SUCCESS logged 1 ms after its APPLIED moves a tick
    // in that millisecond across the edge: b2db52b4 r5 1:04, 11k)
    const press = successesOf(caster).find(
      (s) =>
        nameOf(s.spellId, s.spellName) === h[4] &&
        Math.abs(tsOf(s) - tsOf(applied)) <= 50,
    );
    const fromMs = press ? tsOf(press) : tsOf(applied);
    const toMs = Math.min(
      removed ? fromMs + tsOf(removed) - tsOf(applied) : Infinity,
      roundEndMs(ctx.legacy),
      ctx.end,
    );
    for (const c of line.slice(at).matchAll(CHANNEL_TOOK)) {
      const victim = ctx.unitOfPid(c[1]);
      if (!victim) continue;
      ctx.bump("channelTookBasis");
      const landed = ((victim.damageIn ?? []) as any[])
        .filter((d) => tsOf(d) >= fromMs && tsOf(d) <= toMs)
        .filter((d) => !REDISTRIBUTION_IDS.has(String(d.spellId)))
        .reduce((n, d) => n + Math.abs(d.effectiveAmount ?? 0), 0);
      const absorbed = ((victim.absorbsIn ?? []) as any[])
        .filter((r) => tsOf(r) >= fromMs && tsOf(r) <= toMs)
        .filter((r) => !DEFERRAL_SHIELDS.has(String(r.spellId)))
        .filter((r) => !REDISTRIBUTION_IDS.has(String(r.attackSpellId)))
        .reduce((n, r) => n + Math.abs(r.absorbedAmount ?? 0), 0);
      const truthK = Math.round((landed + absorbed) / 1000);
      const printed = +c[2]!;
      if (Math.abs(truthK - printed) <= Math.max(1, truthK * 0.01)) continue;
      ctx.violate(
        "channelTookBasis",
        printed < truthK ? "low" : "high",
        fromMs,
        `${caster.id}@${fromMs}#${victim.id}`,
        `${victim.name} took ${truthK}k on the rows over ${h[4]} ${fmtLedgerS((toMs - fromMs) / 1000)}; printed ${printed}k`,
        line.slice(0, 240),
      );
    }
  }
}

const fmtLedgerS = (s: number): string => `${s.toFixed(1)}s`;
