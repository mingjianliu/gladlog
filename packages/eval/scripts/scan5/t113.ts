/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents) */
/**
 * scan5/t113.ts — ticket T113 (fact13 D21): the end of a stealth-kind
 * immunity the log never shows (`ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS`: Burrow,
 * Vanish, Mass Invisibility). e2047b8b r0: Mass Invisibility at 0:11.03, no
 * REMOVED; the mage started a Polymorph cast 9.0 s in and the line read
 * `(immune, 10.8s — ended by a hit` — the first aimed hit, searched as far
 * as the aura's official 12 s.
 *
 *  - `hitEndPastOwnAction`: an `[ENEMY DEF] P: X (immune, N.Ns — ended by a
 *    hit` line of such an aura with no REMOVED logged, whose holder's first
 *    own action after it went up (`holderFirstOwnActionAfterMs`, the one
 *    predicate `untargetableEndS` and the burst ledger read) comes more than
 *    `SLACK_MS` before the printed end.
 *  - `killWindowShutPastAction` (batch review 80-PIPE-104-B91): the
 *    producer's own interval (`saveAuraIntervals`) of such an aura whose
 *    holder acted before the aimed hit (`untargetableEndS`, the end every
 *    span reader shares), against the producer's own kill windows
 *    (`computeOffensiveWindows`) on that holder: one opening at the hit
 *    itself, later than the action, read the protection as lasting to the
 *    hit. Checked = those intervals (each round once).
 *  - `visibleRunCastStart` (the measurement behind what counts as the
 *    holder's action): on a self-applied run of an any-action-ends aura
 *    (Mass Invisibility 414664, Greater Invisibility 110960; Vanish 11327,
 *    its allowed presses left out) whose REMOVED
 *    is logged, the holder's first own row inside it — a cast bar begun
 *    (SPELL_CAST_START), a press (SUCCESS) or a direct hit it dealt, in its
 *    first second or after — kind `ended` when the run ended within
 *    `RUN_END_MS` of that row, `kept` when it went on. Checked = those
 *    first rows; a "violation" is an occasion, counted by kind.
 */
import { ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS } from "@gladlog/analysis/src/data/spellIdLists";
import { ALLOWED_WHILE_STEALTHED_SPELL_IDS } from "@gladlog/analysis/src/data/spellStateAttrsGenerated";
import {
  holderFirstOwnActionAfterMs,
  isMeleeSwingRow,
  saveAuraIntervals,
  untargetableEndS,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import { computeOffensiveWindows } from "@gladlog/analysis/src/utils/offensiveWindows";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "hitEndPastOwnAction",
  "killWindowShutPastAction",
  "visibleRunCastStart",
  "applyMsCastStart",
] as const;

export const LINE_RE =
  /^(\d+):(\d\d)\s+\[ENEMY DEF\]\s+(\d+)\([^)]*\) \([^)]*\): (.+?) \(immune, (\d+(?:\.\d)?)s — ended by a hit/;
/** the print rounds the length to 0.1 s */
const SLACK_MS = 100;
const ANY_ACTION_ENDS = new Set(["414664", "110960", "11327"]);
const RUN_END_MS = 100;
const OWN_PRESS_ROW_MS = 150;

export function run(ctx: IRoundCtx): void {
  const idsByName = new Map<string, string>();
  for (const id of ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS)
    idsByName.set(nameOf(id), id);
  for (const line of ctx.lines) {
    const m = LINE_RE.exec(line.trim());
    if (!m) continue;
    const id = idsByName.get(m[4]!);
    const unit = ctx.unitOfPid(m[3]!);
    if (!id || !unit) continue;
    const lineS = Number(m[1]) * 60 + Number(m[2]);
    const auras = ((unit.auraEvents ?? []) as any[]).filter(
      (a) => a.spellId === id,
    );
    const i = auras.findIndex(
      (a) =>
        ev(a) === APPLIED && Math.floor((tsOf(a) - ctx.start) / 1000) === lineS,
    );
    if (i < 0) continue;
    // an end the log shows is the aura's own: the holder's action did not
    // end it
    if (auras[i + 1] && ev(auras[i + 1]) === REMOVED) continue;
    const C = "hitEndPastOwnAction";
    ctx.bump(C);
    const from = tsOf(auras[i]);
    const endMs = from + Number(m[5]) * 1000;
    const own = holderFirstOwnActionAfterMs(unit, from, id, ctx.units);
    // which kind of action it was: a cast bar begun, or a press / hit /
    // opener debuff (the reading without the bars)
    const noBars = holderFirstOwnActionAfterMs(
      { ...unit, castStartEvents: [] },
      from,
      id,
      ctx.units,
    );
    const kind = noBars < endMs - SLACK_MS ? "press-or-hit" : "cast-start";
    const early = own - from <= 1000 ? "≤1s" : ">1s";
    if (own < endMs - SLACK_MS)
      ctx.violate(
        C,
        `${m[4]!} ${kind} ${early}`,
        from,
        `${m[3]}#${id}#${lineS}`,
        `${m[4]} printed immune ${m[5]}s; its holder's first own action came ${((own - from) / 1000).toFixed(2)}s in`,
        line.trim().slice(0, 300),
      );
  }
  killWindowShutPastAction(ctx);
  if (!ctx.firstOwnerOfRound) return;
  // a cast bar begun in the very millisecond an unseen-end stealth immunity
  // went up: which side of the APPLIED row it was logged on decides whether
  // it is the holder's action after it
  for (const u of ctx.players) {
    const auras: any[] = u.auraEvents ?? [];
    const starts: any[] = (u as any).castStartEvents ?? [];
    for (let k = 0; k < auras.length; k++) {
      const a = auras[k];
      if (
        !ENEMY_IMMUNITY_HOLDS_ITS_AURA_IDS.has(a.spellId) ||
        ev(a) !== APPLIED
      )
        continue;
      const next = auras.slice(k + 1).find((b) => b.spellId === a.spellId);
      if (next && ev(next) === REMOVED) continue;
      const C = "applyMsCastStart";
      ctx.bump(C);
      const same = starts.filter((r) => tsOf(r) === tsOf(a));
      if (same.length > 0)
        ctx.violate(
          C,
          `${a.spellId} cast start in the APPLIED ms`,
          tsOf(a),
          `${u.id}:${tsOf(a)}`,
          `${same.length} cast start(s) at the APPLIED ms of ${nameOf(a.spellId)}`,
        );
    }
  }
  for (const u of ctx.players) {
    const auras: any[] = u.auraEvents ?? [];
    const casts = successesOf(u);
    const starts: any[] = (u as any).castStartEvents ?? [];
    const hits: any[] = ((u.damageOut ?? []) as any[]).filter(
      (d) =>
        d.srcUnitId === u.id &&
        (ev(d) === "SPELL_DAMAGE" ||
          ev(d) === "RANGE_DAMAGE" ||
          isMeleeSwingRow(d)),
    );
    for (let k = 0; k < auras.length; k++) {
      const a = auras[k];
      if (
        !ANY_ACTION_ENDS.has(a.spellId) ||
        ev(a) !== APPLIED ||
        a.srcUnitId !== u.id
      )
        continue;
      const end = auras
        .slice(k + 1)
        .find((b) => b.spellId === a.spellId && ev(b) === REMOVED);
      if (!end) continue;
      const from = tsOf(a);
      const to = tsOf(end);
      // the first row of each kind inside the run; the aura's own press row
      // lags it (Greater Invisibility's 110959)
      const firstOf = (rows: any[], lagMs: number) =>
        rows
          .map((r) => tsOf(r))
          .filter((t) => t > from + lagMs && t <= to + RUN_END_MS)
          .sort((x, y) => x - y)[0];
      const kinds: Array<[string, number | undefined]> = [
        ["cast-start", firstOf(starts, 0)],
        [
          "press",
          firstOf(
            // Vanish stays up through a press stealth allows (T77)
            a.spellId === "11327"
              ? casts.filter(
                  (c) => !ALLOWED_WHILE_STEALTHED_SPELL_IDS.has(c.spellId),
                )
              : casts,
            OWN_PRESS_ROW_MS,
          ),
        ],
        [
          "hit-swing",
          firstOf(
            hits.filter((d) => isMeleeSwingRow(d)),
            0,
          ),
        ],
        [
          "hit-spell",
          firstOf(
            hits.filter((d) => !isMeleeSwingRow(d)),
            0,
          ),
        ],
      ];
      // only the earliest kind is the run's first action
      const firsts = kinds
        .filter((x): x is [string, number] => x[1] !== undefined)
        .sort((x, y) => x[1] - y[1]);
      if (firsts.length === 0) continue;
      const [kind, first] = firsts[0]!;
      const C = "visibleRunCastStart";
      ctx.bump(C);
      const kept = first < to - RUN_END_MS;
      const early = first - from <= 1000 ? "≤1s" : ">1s";
      ctx.violate(
        C,
        `${a.spellId} ${kind} ${early} ${kept ? "kept" : "ended"}`,
        first,
        `${u.id}:${from}:${first}`,
        `first own ${kind} ${((first - from) / 1000).toFixed(2)}s into ${nameOf(a.spellId)} ${a.spellId}, which ended ${((to - first) / 1000).toFixed(2)}s after it`,
      );
    }
  }
}

function killWindowShutPastAction(ctx: IRoundCtx): void {
  const C = "killWindowShutPastAction";
  if (!ctx.firstOwnerOfRound) return;
  const combat = {
    startTime: ctx.start,
    endTime: ctx.legacy.endTime,
    units: ctx.legacy.units,
  };
  for (const u of ctx.players) {
    const team = ctx.players.filter((p) => p.info?.teamId === u.info?.teamId);
    // the one end every span reader shares (`untargetableEndS`), on the
    // intervals the hit cut
    const cut = saveAuraIntervals(u, team, combat as any)
      .filter((iv) => iv.endedByHit)
      .map((iv) => ({
        iv,
        actS: untargetableEndS(u, iv, ctx.start, ctx.units),
      }))
      .filter((x) => x.actS < x.iv.toS);
    if (cut.length === 0) continue;
    const others = ctx.players.filter((p) => p.info?.teamId !== u.info?.teamId);
    // the producer's own windows on this unit (the one computation the
    // kill-window lines print)
    const windows = computeOffensiveWindows(team, others, ctx.legacy).filter(
      (w) => w.targetName === u.name,
    );
    for (const { iv, actS } of cut) {
      ctx.bump(C);
      // a window that opens at the hit itself, later than the action: the
      // protection was read as lasting to the hit
      const w = windows.find(
        (x) =>
          Math.abs(x.fromSeconds - iv.toS) < 0.001 &&
          x.fromSeconds > actS + 0.001,
      );
      if (w)
        ctx.violate(
          C,
          nameOf(iv.spellId, iv.spellId),
          ctx.start + Math.round(iv.toS * 1000),
          `${u.id}#${iv.spellId}#${Math.floor(iv.fromS)}`,
          `${nameOf(iv.spellId)} over at ${actS.toFixed(3)} s (own action); kill window opens ${w.fromSeconds.toFixed(3)} s (the hit)`,
        );
    }
  }
}
