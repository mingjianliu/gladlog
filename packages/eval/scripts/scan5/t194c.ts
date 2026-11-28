/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, actionOut, auraEvents) */
/**
 * scan5/t194c.ts — pipeline T194, count first: three settling counts. Each
 * decides whether a defect exists; none is a fix.
 *
 *  - `passiveDispelPartPressedForm` (GH #173 item 50, fact2Scan
 *    `riderPassive`): a `[MINOR DISPELS]` part `X (passive)[ xN]` — the fold
 *    part `minorDispelPartTag` gives a removal nobody pressed for — whose X
 *    the unit pressed this round: a SPELL_CAST_SUCCESS that is a button
 *    (`isButtonPress`) of X's name, or of a cast whose own effect X's id is
 *    (`castsOwningEffectAura`), or an empower release of X. Truth is the
 *    unit's own SPELL_DISPEL / SPELL_STOLEN rows of X: a removal is `at a
 *    press` within `DISPEL_CAST_MATCH_WINDOW_MS` of such a press and `away`
 *    otherwise; a delayed repeat (`dispelIsDelayedRepeat`, Spellsteal's
 *    re-steal — ruled passive) is away. Population (`bump`): every
 *    `(passive)` part of a player's own line. Kinds:
 *      `<X>` — the part prints more instants than the unit has removals away
 *        from every press of X (instants merged as the fold merges them,
 *        `MINOR_DISPEL_CAST_MERGE_S`): a removal a press made reads passive.
 *      out of the total (the part is right as far as the rows show):
 *      `pressed this round, every passive removal away from its presses` —
 *        the form left, or entered on a proc; the detail gives the nearest
 *        press;
 *      `pressed this round, a delayed repeat of an earlier press`;
 *      `no dispel row of the unit under the part's name` — not checked.
 *
 *  - `timeSpiralFreePressOnCooldown` (GH #179, "readers that rebuild press
 *    lists from raw rows"): the one reader of a Time Spiral spell that counts
 *    charges from raw cast rows is `gapCloserStateAt` (utils/gapClosers.ts,
 *    through `gapCloserStateOver` into kick-eaten's `outRangeable`); the
 *    cooldown ledger, `[PRESS] … back`, `[RES]` and the kit read the
 *    free-press-aware model. Population (`bump`, once per round): every Time
 *    Spiral free press of a player (`timeSpiralFreePressMs` over
 *    `TIME_SPIRAL_FREE_PRESSES`, a gap closer's rows by its whole button).
 *    The statement is a kick-eaten menu row printing `outRangeable=yes (…
 *    no gap-closer of theirs just used or ready)`. The count asks the
 *    product twice over the row's own span (`castStartT` … `t`): on the
 *    kicker as parsed, and on a copy without its free presses and their
 *    echo rows (`timeSpiralEchoMs`). Kinds:
 *      `kick-eaten outRangeable=yes: <X> stated on cooldown after a free
 *        press` — null as parsed, a state without the free rows;
 *      `kick-eaten outRangeable=yes: <X> pressed only for free, never
 *        spent` — the button's every row this round is a free press at or
 *        before the kick, so no charge was ever spent;
 *      out of the total: `free press of a gap closer (exposure)` — the rows
 *        `gapCloserStateAt` reads as a spent charge, whether or not a row
 *        states anything.
 *
 *  - `hiddenPressAtRelisting` (GH #179, "Sprint hidden-press timing"): a
 *    hidden press (`hiddenPressMs`, a ledger cast marked `timedAtLatest`) is
 *    dated at the batch that re-states its holder — hiddenPress.ts requires
 *    `isResyncBatchAt` of the anchor row, so every one sits in such a batch
 *    and the real press is at or before it. Population (`bump`, once per
 *    round): every ledger cast of a player that is a hidden press. Kinds:
 *      `<spell>` — the anchor aura's own REMOVED comes more than
 *        `SHORT_BY_MS` sooner than its length for this holder
 *        (`hiddenAuraLifeMs`, official + 1 s) after the anchor: the press
 *        was that much before the instant the ledger holds (an early end by
 *        a dispel, a cancel or a used-up absorb reads the same);
 *      `anchor outside a re-stating batch` — the producer's own condition
 *        failing (0 by construction);
 *      out of the total: `anchor in a re-stating batch` — every other one.
 */
import {
  MINOR_DISPEL_CAST_MERGE_S,
  MINOR_DISPEL_PASSIVE_TAG,
} from "@gladlog/analysis/src/context/timelineSections/minorDispels";
import { castsOwningEffectAura } from "@gladlog/analysis/src/data/castEffectAuras";
import {
  TIME_SPIRAL_FREE_PRESSES,
  timeSpiralEchoMs,
  timeSpiralFreePressMs,
} from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import { isButtonPress } from "@gladlog/analysis/src/utils/castCommitSpans";
import { unitCooldownLedger } from "@gladlog/analysis/src/utils/cooldowns";
import {
  buildCastMatchIndex,
  DISPEL_CAST_MATCH_WINDOW_MS,
  dispelIsDelayedRepeat,
} from "@gladlog/analysis/src/utils/dispelKind";
import {
  GAP_CLOSER_BUTTONS,
  GAP_CLOSER_SPELL_IDS,
  gapCloserStateOver,
} from "@gladlog/analysis/src/utils/gapClosers";
import {
  hiddenAuraLifeMs,
  hiddenPressMs,
  isResyncBatchAt,
} from "@gladlog/analysis/src/utils/hiddenPress";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

const PD = "passiveDispelPartPressedForm";
const TS = "timeSpiralFreePressOnCooldown";
const HP = "hiddenPressAtRelisting";
export const CHECKS = [PD, TS, HP] as const;
/** whole checks out of the total (T314): the precision of a line that stands at the latest its legend allows (T194: report, no fix) */
export const MEASURED_ONLY: ReadonlySet<string> = new Set([HP]);

const PD_AWAY =
  "pressed this round, every passive removal away from its presses";
const PD_REPEAT = "pressed this round, a delayed repeat of an earlier press";
const PD_NO_ROW = "no dispel row of the unit under the part's name";
const TS_EXPOSURE = "free press of a gap closer (exposure)";
const HP_IN_BATCH = "anchor in a re-stating batch";
const HP_OUT_OF_BATCH = "anchor outside a re-stating batch";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  `${PD}|${PD_AWAY}`,
  `${PD}|${PD_REPEAT}`,
  `${PD}|${PD_NO_ROW}`,
  `${TS}|${TS_EXPOSURE}`,
  `${HP}|${HP_IN_BATCH}`,
]);

const DISPEL_ROWS = new Set(["SPELL_DISPEL", "SPELL_STOLEN"]);
const MINOR = /^\s*(\d+:\d\d)\s+\[MINOR DISPELS\]\s+(\d+)\([^)]*\): (.+)$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PASSIVE_PART = new RegExp(
  `(?:^|, )([^,(]+?) ${escapeRe(MINOR_DISPEL_PASSIVE_TAG)}(?: x(\\d+))?`,
  "g",
);
const KICK_ROW = /type=kick-eaten t=[\d.]+s .*?facts=\{(.*)\}\s*$/;
/** `hiddenAuraLifeMs` is the official length + 1 s; a run this much under it
 * ended more than 1 s short of the official length. */
const SHORT_BY_MS = 2000;

const sec = (ms: number) => (ms / 1000).toFixed(1);

function passiveDispelPartPressedForm(ctx: IRoundCtx): void {
  let index: ReturnType<typeof buildCastMatchIndex> | undefined;
  for (const line of ctx.lines) {
    const m = MINOR.exec(line);
    if (!m) continue;
    const unit = ctx.unitOfPid(m[2]);
    if (!unit) continue;
    for (const p of m[3]!.matchAll(PASSIVE_PART)) {
      const name = p[1]!.trim();
      const printed = p[2] !== undefined ? Number(p[2]) : 1;
      ctx.bump(PD);
      const rows = ((unit.actionOut ?? []) as any[]).filter(
        (r) =>
          DISPEL_ROWS.has(ev(r)) &&
          r.srcUnitId === unit.id &&
          nameOf(r.spellId, r.spellName) === name &&
          tsOf(r) >= ctx.start &&
          tsOf(r) <= ctx.end,
      );
      const factId = `${unit.id}#${name}`;
      const at = ctx.start + secOf(m[1]!) * 1000;
      if (rows.length === 0) {
        ctx.violate(
          PD,
          PD_NO_ROW,
          at,
          factId,
          `${unit.name} ${name} (passive): no SPELL_DISPEL / SPELL_STOLEN row of the unit under that name`,
          line.trim().slice(0, 200),
        );
        continue;
      }
      // the casts whose own effect the dispelling id is, besides its name
      const owning = new Set(
        rows.flatMap((r) => [...castsOwningEffectAura(String(r.spellId))]),
      );
      const presses = [
        ...successesOf(unit).filter(
          (c) =>
            isButtonPress(String(c.spellId)) &&
            (nameOf(c.spellId, c.spellName) === name ||
              owning.has(String(c.spellId))),
        ),
        // an empowered cast acts at its release
        ...((unit.empowerEnds ?? []) as any[]).filter(
          (r) => nameOf(r.spellId, r.spellName) === name,
        ),
      ]
        .map(tsOf)
        .filter((t) => t >= ctx.start && t <= ctx.end);
      if (presses.length === 0) continue; // nobody pressed it: passive
      index ??= buildCastMatchIndex(ctx.units as any[]);
      const gapOf = (t: number) =>
        Math.min(...presses.map((x) => Math.abs(x - t)));
      const repeat = (r: any) =>
        dispelIsDelayedRepeat(index!, {
          srcUnitId: r.srcUnitId,
          spellId: r.spellId,
          spellName: r.spellName,
          timestamp: tsOf(r),
        });
      const away = rows.filter(
        (r) => repeat(r) || gapOf(tsOf(r)) > DISPEL_CAST_MATCH_WINDOW_MS,
      );
      // instants as the fold counts a passive part's
      const instants: number[] = [];
      for (const t of away.map(tsOf).sort((a, b) => a - b))
        if (
          !instants.some(
            (i) => Math.abs(i - t) <= MINOR_DISPEL_CAST_MERGE_S * 1000,
          )
        )
          instants.push(t);
      const nearest = Math.min(...rows.map((r) => gapOf(tsOf(r))));
      if (printed > instants.length) {
        ctx.violate(
          PD,
          name,
          at,
          factId,
          `${unit.name} ${name} (passive) x${printed}: ${rows.length} removal rows, ${instants.length} instants away from every press of it (${presses.length} presses, nearest ${sec(nearest)}s from a removal)`,
          line.trim().slice(0, 200),
        );
        continue;
      }
      const onlyRepeats = away.length > 0 && away.every(repeat);
      ctx.violate(
        PD,
        onlyRepeats ? PD_REPEAT : PD_AWAY,
        at,
        factId,
        `${unit.name} ${name} (passive) x${printed}: ${presses.length} presses this round, ${instants.length} removal instants away from them (nearest press ${sec(Math.min(...away.map((r) => gapOf(tsOf(r)))))}s off)`,
        line.trim().slice(0, 200),
      );
    }
  }
}

/** The unit's Time Spiral free presses as the product pairs them: per listed
 * spell, over the cast rows of its button (a gap closer's other ids log the
 * same press — Heroic Leap's 52174), with the rows that echo one. */
function timeSpiralFreeRows(unit: any): {
  free: Array<{ ms: number; spellId: string; ids: readonly string[] }>;
  echoMs: Set<number>;
} {
  const free: Array<{ ms: number; spellId: string; ids: readonly string[] }> =
    [];
  const echoMs = new Set<number>();
  const casts = successesOf(unit);
  for (const row of Object.values(TIME_SPIRAL_FREE_PRESSES))
    for (const spellId of row.spellIds) {
      const ids = GAP_CLOSER_BUTTONS.find((b) => b.includes(spellId)) ?? [
        spellId,
      ];
      const castMs = casts
        .filter((c) => ids.includes(String(c.spellId)))
        .map(tsOf);
      for (const ms of timeSpiralFreePressMs(unit, spellId, castMs))
        if (!free.some((f) => f.ms === ms && f.ids === ids))
          free.push({ ms, spellId, ids });
      for (const ms of timeSpiralEchoMs(unit, spellId, castMs)) echoMs.add(ms);
    }
  return { free, echoMs };
}

function timeSpiralFreePressOnCooldown(ctx: IRoundCtx): void {
  if (ctx.firstOwnerOfRound)
    for (const u of ctx.players as any[])
      for (const f of timeSpiralFreeRows(u).free) {
        ctx.bump(TS);
        if (!f.ids.some((id) => GAP_CLOSER_SPELL_IDS.has(id))) continue;
        ctx.violate(
          TS,
          TS_EXPOSURE,
          f.ms,
          `${u.id}#${f.spellId}#${f.ms}`,
          `${u.name} ${nameOf(f.spellId)} free under Time Spiral at ${fmtS((f.ms - ctx.start) / 1000)}: gapCloserStateAt counts the row as a spent charge`,
        );
      }
  for (const row of (ctx.menu ?? "").split("\n")) {
    const facts = KICK_ROW.exec(row)?.[1];
    if (facts === undefined || !facts.includes("outRangeable=yes")) continue;
    const t = /(?:^|, )t=([\d.]+)/.exec(facts)?.[1];
    const castStart = /(?:^|, )castStartT=([\d.]+)/.exec(facts)?.[1];
    const source = /(?:^|, )source=([^,]+)/.exec(facts)?.[1];
    if (t === undefined || castStart === undefined || source === undefined)
      continue;
    const unit = ctx.byName.get(source);
    if (!unit) continue;
    const { free, echoMs } = timeSpiralFreeRows(unit);
    const closers = free.filter((f) =>
      f.ids.some((id) => GAP_CLOSER_SPELL_IDS.has(id)),
    );
    if (closers.length === 0) continue;
    const fromMs = ctx.start + Number(castStart) * 1000;
    const toMs = ctx.start + Number(t) * 1000;
    // the product's own answer over the row's span, as parsed (the row's
    // instants are printed to 0.1 s, so both answers are read the same way)
    if (gapCloserStateOver(unit, fromMs, toMs, ctx.start) !== null) continue;
    const isFreeRow = (c: any) =>
      GAP_CLOSER_SPELL_IDS.has(String(c.spellId)) &&
      (echoMs.has(tsOf(c)) ||
        closers.some(
          (f) => f.ms === tsOf(c) && f.ids.includes(String(c.spellId)),
        ));
    const cut = gapCloserStateOver(
      {
        ...unit,
        spellCastEvents: ((unit.spellCastEvents ?? []) as any[]).filter(
          (c) => !isFreeRow(c),
        ),
      },
      fromMs,
      toMs,
      ctx.start,
    );
    const factId = `${unit.id}#kick-eaten#${t}`;
    if (cut !== null) {
      ctx.violate(
        TS,
        `kick-eaten outRangeable=yes: ${cut.spellName} stated on cooldown after a free press`,
        toMs,
        factId,
        `${unit.name}: without its ${closers.length} Time Spiral free press rows the gap closer reads ${cut.state} over ${castStart}–${t}s; free at ${closers.map((f) => fmtS((f.ms - ctx.start) / 1000)).join(", ")}`,
        row.trim().slice(0, 240),
      );
      continue;
    }
    // a button whose every row is a free press was never spent: without the
    // rows the product no longer sees the button at all
    const never = closers.find(
      (f) =>
        f.ms <= toMs &&
        successesOf(unit)
          .filter((c) => f.ids.includes(String(c.spellId)))
          .every(isFreeRow),
    );
    if (never)
      ctx.violate(
        TS,
        `kick-eaten outRangeable=yes: ${nameOf(never.spellId)} pressed only for free, never spent`,
        toMs,
        factId,
        `${unit.name}: every ${nameOf(never.spellId)} row this round is a Time Spiral free press (first ${fmtS((never.ms - ctx.start) / 1000)}), the row's span is ${castStart}–${t}s`,
        row.trim().slice(0, 240),
      );
  }
}

function hiddenPressAtRelisting(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.players as any[]) {
    const own = ((u.auraEvents ?? []) as any[]).filter(
      (a) => a.srcUnitId === u.id && a.destUnitId === u.id,
    );
    for (const cd of unitCooldownLedger(u, ctx.legacy)) {
      const late = cd.casts.filter((c) => c.timedAtLatest);
      if (late.length === 0) continue;
      const hidden = hiddenPressMs(u, cd.spellId, ctx.start);
      const name = nameOf(cd.spellId, cd.spellName);
      for (const c of late) {
        const ms = hidden.find(
          (h) => Math.abs(h - (ctx.start + c.timeSeconds * 1000)) < 1,
        );
        // timed at the latest by its effect's first row, not a hidden press
        if (ms === undefined) continue;
        ctx.bump(HP);
        const factId = `${u.id}#${cd.spellId}#${ms}`;
        const at = fmtS((ms - ctx.start) / 1000);
        const inBatch = isResyncBatchAt(u, ms);
        ctx.violate(
          HP,
          inBatch ? HP_IN_BATCH : HP_OUT_OF_BATCH,
          ms,
          `${factId}#batch`,
          `${u.name} ${name} hidden press at ${at}`,
        );
        // the press's own aura at the anchor: its id, or a same-named one
        const anchor = own.find(
          (a) =>
            ev(a) === APPLIED &&
            Math.abs(tsOf(a) - ms) < 1 &&
            (String(a.spellId) === cd.spellId ||
              nameOf(a.spellId, a.spellName) === name),
        );
        if (!anchor) continue;
        const end = own.find(
          (a) =>
            ev(a) === REMOVED && a.spellId === anchor.spellId && tsOf(a) > ms,
        );
        const life = hiddenAuraLifeMs(String(anchor.spellId), u, ms);
        if (!end || !Number.isFinite(life)) continue;
        const ran = tsOf(end) - ms;
        if (ran >= life - SHORT_BY_MS) continue;
        ctx.violate(
          HP,
          name,
          ms,
          factId,
          `${u.name} ${name} dated ${at} by its re-listing; aura ${anchor.spellId} ended ${sec(ran)}s later of ${sec(life - 1000)}s — pressed about ${sec(life - 1000 - ran)}s earlier, unless it ended early`,
        );
      }
    }
  }
}

export function run(ctx: IRoundCtx): void {
  passiveDispelPartPressedForm(ctx);
  timeSpiralFreePressOnCooldown(ctx);
  hiddenPressAtRelisting(ctx);
}
