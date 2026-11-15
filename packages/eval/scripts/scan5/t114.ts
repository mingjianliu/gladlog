/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, spellCastEvents) */
/**
 * scan5/t114.ts — ticket T114 (fact13 D22): the burst ledger's `pressed Zs
 * after the burst opened` names the press — the cast row — not the instant
 * the wall's aura settled on the target. Truth is read off the log rows;
 * lookups only name things.
 *
 *  - `ledgerPressedNotAtPress`: a burst-ledger line `<Wall> active ON THE
 *    TARGET … (pressed Zs after the burst opened)`. The burst opens at the
 *    owner's first SUCCESS / APPLIED of the head's first cooldown in the
 *    head's second. Every interval of that wall on the target
 *    (`buildAuraIntervals`) that starts after the opening and by the head's
 *    end second, and each one's press, are taken from the producer's own
 *    selection (FIX-CONTRACT step 7; batch review 80-PIPE-73-B70 #2: a hand
 *    lookback missed a totem whose holder was linked seconds after its first
 *    pulse) — the interval's `[ENEMY DEF]` press (`pressReadingOf`), else its
 *    cast row (`pressRowOf`, a summon's anchored at its first pulse,
 *    `summonPressAnchorMs`) — and found without the printed Z (a wrong Z
 *    must not drop out of coverage — codex 85-tk-K-T114-1); a source-less
 *    aura's (Anti-Magic Zone) through `sourcelessPressOf` (its one root
 *    caster's cast), and when none resolves the line must not say
 *    "pressed" (batch review 80-PIPE-75-B70b #1). A line is
 *    checked when one such press at or after the opening exists, and is a
 *    violation when Z is more than one rounding step off every press −
 *    opening (e2047b8b r0 2:43: Spirit Link Totem pressed 4.95 s in, its
 *    aura flickered and settled at 6.0 s, the line read `pressed 6.0s`).
 *    Kind = the wall's name.
 */
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import {
  isSourcelessAura,
  pressReadingOf,
  pressRowOf,
  sourcelessPressOf,
  wallDefensiveEventsOn,
} from "@gladlog/analysis/src/utils/burstLedger";
import {
  enemyDefensiveEvents,
  type IEnemyDefensiveEvent,
} from "@gladlog/analysis/src/utils/enemyDefensives";
import type { AtomicArenaCombat, ICombatUnit } from "@gladlog/parser-compat";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["ledgerPressedNotAtPress"] as const;

/** an interval's press (`c`, its presser `u`); no `c`: a source-less aura
 * no cast resolves for — no press */
interface IPress {
  app: { logLine: { timestamp: number } };
  c?: { logLine: { timestamp: number } };
  u?: any;
}

const BURST_HEAD =
  /^\s+Burst #\d+ — (\d+:\d{2})–(\d+:\d{2}) \| (.+?)(?: \d+:\d{2}–| \+ |$)/;
const BURST_TARGET = /^\s+Target: (.+?) (?:\d+% → |\| )/;
const BURST_PRESSED =
  /^\s+(?:Target had [^:]+|⚠ Target was IMMUNE): (.+?) active ON THE TARGET [\d.]+s of this burst \(pressed (<?[\d.]+)s after the burst opened\)/;

/** one rounding step of the printed tenth, and a little */
const TOLERANCE_S = 0.15;

export function run(ctx: IRoundCtx): void {
  const C = "ledgerPressedNotAtPress";
  let openMs: number | undefined;
  let endMs = 0;
  let target: string | undefined;
  const defByTeam = new Map<string, IEnemyDefensiveEvent[]>();
  for (const l of ctx.lines) {
    const h = BURST_HEAD.exec(l);
    if (h) {
      target = undefined;
      const sec = secOf(h[1]!);
      const cd = h[3]!.trim();
      endMs = ctx.start + (secOf(h[2]!) + 1) * 1000;
      const lo = ctx.start + sec * 1000;
      const rows = [
        ...successesOf(ctx.owner),
        ...((ctx.owner.auraEvents ?? []) as any[]).filter(
          (a) => ev(a) === APPLIED && a.srcUnitId === ctx.owner.id,
        ),
      ]
        .filter(
          (r) =>
            nameOf(r.spellId, r.spellName) === cd &&
            tsOf(r) >= lo &&
            tsOf(r) < lo + 1000,
        )
        .map(tsOf)
        .sort((a, b) => a - b);
      openMs = rows[0];
      continue;
    }
    const t = BURST_TARGET.exec(l);
    if (t) {
      target = t[1];
      continue;
    }
    const p = BURST_PRESSED.exec(l);
    if (!p || openMs === undefined || target === undefined) continue;
    const named = ctx.units.filter((u) => u.name === target);
    if (named.length !== 1) continue;
    const holder = named[0];
    const wall = p[1]!;
    const z = Number(p[2]!.replace("<", ""));
    const open = openMs;
    const combat = ctx.legacy as AtomicArenaCombat;
    const team = ctx.players.filter(
      (u) => u.reaction === holder.reaction,
    ) as ICombatUnit[];
    const teamKey = String(holder.reaction);
    if (!defByTeam.has(teamKey))
      defByTeam.set(
        teamKey,
        team.flatMap((e) => enemyDefensiveEvents(e, team, combat)),
      );
    const defOn = wallDefensiveEventsOn(defByTeam.get(teamKey)!, holder);
    const intervals = buildAuraIntervals(holder as ICombatUnit, combat);
    const byId = new Map(ctx.units.map((u) => [u.id as string, u]));
    // every interval of the wall on the holder from the burst's opening to
    // its end, and each one's press — the producer's own selection, found
    // without the printed Z, so a wrong Z cannot drop out of coverage
    // (codex 85-tk-K-T114-1)
    const presses = intervals
      .filter((iv) => {
        const ms = combat.startTime + iv.fromS * 1000;
        return (
          nameOf(iv.spellId, iv.spellName) === wall && ms > open && ms <= endMs
        );
      })
      .flatMap((iv): IPress[] => {
        const startMs = combat.startTime + iv.fromS * 1000;
        const app = { logLine: { timestamp: startMs } };
        // a source-less aura (Anti-Magic Zone): its press is its one root
        // caster's cast, else none — the line must not say "pressed" (batch
        // review 80-PIPE-75-B70b #1)
        if (isSourcelessAura(iv)) {
          const sp = sourcelessPressOf(
            Object.values(combat.units ?? {}),
            holder as ICombatUnit,
            combat.startTime,
            iv.spellId,
            startMs,
          );
          if ("noPress" in sp) return [{ app }];
          if (sp.pressMs < open) return [];
          const root = byId.get(sp.casterId);
          return [
            {
              app,
              c: { logLine: { timestamp: sp.pressMs } },
              u: root ?? holder,
            },
          ];
        }
        const r = pressReadingOf(
          defOn,
          intervals,
          combat.startTime,
          iv.spellId,
          { name: iv.srcUnitName, id: iv.srcUnitId },
          startMs,
          Math.min(combat.startTime + iv.toS * 1000, endMs),
        );
        if (r && "noPress" in r) return [];
        const pressMs =
          r?.pressMs ??
          pressRowOf(
            (id) => byId.get(id) as ICombatUnit | undefined,
            holder as ICombatUnit,
            combat.startTime,
            iv.spellId,
            iv.srcUnitId,
            startMs,
          );
        if (pressMs === undefined || pressMs < open) return [];
        const src = byId.get(iv.srcUnitId ?? "");
        const owner =
          src && src.ownerId && src.ownerId !== src.id
            ? byId.get(src.ownerId)
            : undefined;
        return [
          {
            app,
            c: { logLine: { timestamp: pressMs } },
            u: owner ?? src ?? holder,
          },
        ];
      });
    if (presses.length === 0) continue;
    ctx.bump(C);
    const pressed = presses.filter(
      (p): p is Required<IPress> => p.c !== undefined,
    );
    const truthOf = (p: Required<IPress>) => (tsOf(p.c) - open) / 1000;
    if (pressed.some((p) => Math.abs(truthOf(p) - z) <= TOLERANCE_S)) continue;
    if (pressed.length === 0) {
      const app = presses[0]!.app;
      ctx.violate(
        C,
        wall,
        tsOf(app),
        `${holder.id}#${wall}#${tsOf(app)}`,
        `the ledger says ${wall} was pressed ${z.toFixed(1)}s after the burst opened; its aura carries no source and no one cast of its resolves (the aura arrived ${((tsOf(app) - open) / 1000).toFixed(2)}s after)`,
        l.trim().slice(0, 300),
      );
      continue;
    }
    const worst = pressed.sort(
      (a, b) => Math.abs(truthOf(a) - z) - Math.abs(truthOf(b) - z),
    )[0]!;
    ctx.violate(
      C,
      wall,
      tsOf(worst.c),
      `${holder.id}#${wall}#${tsOf(worst.app)}`,
      `the ledger says ${wall} was pressed ${z.toFixed(1)}s after the burst opened; ${worst.u.name}'s press is ${truthOf(worst).toFixed(2)}s after it (the aura went up ${((tsOf(worst.app) - open) / 1000).toFixed(2)}s after)`,
      l.trim().slice(0, 300),
    );
  }
}
