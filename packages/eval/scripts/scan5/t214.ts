/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t214.ts — ticket T214 (fact14 D39 / D40): Elusiveness 79008 makes
 * Evasion 5277 a 20 % all-damage reduction and Feint 1966 a 20 % reduction
 * of non-area damage on the rogue that holds it (`MITIGATION_TABLE`,
 * `wholeReductionTalentId`), and the wall family's readers ask "is X a
 * wall" of the id alone (`MITIGATION_WALL_IDS` leaves both out). Ownership
 * is the pricing reader's own (`talentModifierOwnershipOf`, COMBATANT_INFO).
 *
 *  - `elusivenessWallNotRead`, per enemy rogue, by ownership (`yes` / `no` /
 *    `unknown`):
 *      `evasion:<own>:<plain|pct>` — an `[ENEMY DEF] … Evasion (dodge)` /
 *        `(dodge, N% all damage)` line;
 *      `feintPress:<own>:<line|noLine>` — a Feint press of the round, with
 *        or without its `[ENEMY DEF] … Feint (N%, Ts)` fact line;
 *      `spanOverFeint:<own>` / `spanOverEvasion:<own>` — a `defenseless`
 *        span (or `[VULNERABLE] … no major defensives`) on the rogue that
 *        holds one whole second or more of its own Feint / Evasion aura (the
 *        producer's intervals, `buildAuraIntervals`), inside [a + 1, b].
 *    Counted: every such line, press and overlapped span. The class
 *    (rulings R52 / R56, 2026-11-18): a holder's Feint with no line
 *    (`feintPress:yes:noLine`), a holder's Evasion without the percentage
 *    (`evasion:yes:plain`), and either form on a unit without the talent;
 *    the rest are denominators, out of the total — the spans too, since by
 *    R52 (a) neither press is a wall.
 *
 * The report also carries the corpus leg of the Game-Behaviour Rule, once
 * per round and press: the same attacker's same spell on the rogue, last
 * non-crit hit in the 4 s before the press against the first in the 5 s
 * after it — (amount + absorbed + blocked) / baseAmount, after ÷ before —
 * pooled by spell and ownership. A holder reads 0.800; a non-holder 1.000
 * (Feint's own area-damage reduction, aura 229, is on both).
 */
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import {
  carriesTalentReductionFactLine,
  dodgeAllDamagePctOf,
  statesSelfDefensiveLabel,
} from "@gladlog/analysis/src/utils/selfDefensiveMechanism";
import { talentModifierOwnershipOf } from "@gladlog/analysis/src/utils/talentOwnership";
import { parseLine } from "@gladlog/parser";
import { CombatUnitClass } from "@gladlog/parser-compat";

import { fmtS, type IRoundCtx, secOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["elusivenessWallNotRead"] as const;

const ELUSIVENESS = "79008";
const WALLS: Readonly<Record<string, string>> = {
  "1966": "Feint",
  "5277": "Evasion",
};
const OWN = ["yes", "no", "unknown"];
/** In the total (rulings R52 / R56): a holder's Feint press with no fact
 * line, a holder's Evasion line without its percentage — and either on a
 * unit that does not hold the talent. The spans are counts only: by R52 (a)
 * neither press is a wall, so a `defenseless` span may hold one. */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set(
  [
    "feintPress:yes:line",
    "feintPress:no:noLine",
    "feintPress:unknown:noLine",
    "evasion:yes:pct",
    "evasion:no:plain",
    "evasion:unknown:plain",
    ...OWN.flatMap((o) => [`spanOverFeint:${o}`, `spanOverEvasion:${o}`]),
  ].map((k) => `elusivenessWallNotRead|${k}`),
);

const SPAN =
  /^\s+\[(KILL WINDOW|VULNERABLE)\] (\d+:\d\d)–(\d+:\d\d)(?: \(\d+s\))? on [^(]+\(([^)]+)\)(.*)$/;
const DEFENSELESS = /(?:\(|; target )defenseless (\d+:\d\d)–(\d+:\d\d)/;
/** what Elusiveness 79008 takes off all damage under Evasion (DB2) */
const ELUSIVENESS_ALL_DAMAGE_PCT = 20;
const BEFORE_MS = 4000;
const AFTER_MS = 5000;

let ratios: Record<string, number[]> = {};

/** the edge pairs of one press on its own caster: per attacker and spell.
 * The press is found among the raw lines by its caster, spell and ordinal,
 * and every time is the raw lines' own. */
export function edgeRatios(
  ctx: Pick<IRoundCtx, "rawLines">,
  casterId: string,
  spellId: string,
  ordinal: number,
): number[] {
  const rows = ctx.rawLines.flatMap((line) => parseLine(line) ?? []);
  const at = rows.filter(
    (pl) =>
      pl.eventName === "SPELL_CAST_SUCCESS" &&
      pl.base?.srcGuid === casterId &&
      String(pl.spell?.spellId) === spellId,
  )[ordinal]?.timestamp;
  if (at === undefined) return [];
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  for (const pl of rows) {
    if (!pl.damage || !pl.base || pl.eventName === "DAMAGE_SPLIT") continue;
    const t = pl.timestamp;
    if (t < at - BEFORE_MS || t > at + AFTER_MS || t === at) continue;
    if (pl.base.destGuid !== casterId) continue;
    const d = pl.damage;
    if (d.critical || !(d.baseAmount > 0)) continue;
    const r =
      (d.amount + Math.max(d.absorbed, 0) + Math.max(d.blocked, 0)) /
      d.baseAmount;
    const k = `${pl.base.srcGuid}|${pl.spell?.spellId ?? 0}`;
    if (t < at) before.set(k, r);
    else if (!after.has(k)) after.set(k, r);
  }
  const out: number[] = [];
  for (const [k, b] of before) {
    const a = after.get(k);
    if (a !== undefined && b > 0) out.push(a / b);
  }
  return out;
}

const quantile = (xs: number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
};

export function report(): string[] {
  return [
    "Elusiveness edge pairs on the rogue, after ÷ before (n; p25 / median / p75):",
    ...Object.entries(ratios)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([b, xs]) =>
          `  ${b}: ${xs.length}; ${[0.25, 0.5, 0.75].map((q) => quantile(xs, q).toFixed(3)).join(" / ")}`,
      ),
  ];
}
export const state = () => ({ ratios });
export const load = (s: ReturnType<typeof state>): void => {
  ratios = s.ratios;
};
export const merge = {
  ratios: (a: Record<string, number[]>, b: Record<string, number[]>) => {
    for (const [k, v] of Object.entries(b)) (a[k] ??= []).push(...v);
    return a;
  },
};

/**
 * Which Feint presses the check asks a line of, and the line of each: every
 * press from the round's start to the last second the timeline prints
 * (`lastRenderedS`) — NOT the playable end: the timeline runs on past a
 * 3v3's deciding friendly death and prints `[ENEMY DEF]` there (batch check
 * T214-2: 605 s1/113 r1, a Feint at 247.977 s after the death at 243.758 s
 * printed `4:07 … Feint (20%, 6.0s)`, and s2/190 r1 three more; the scan
 * stopped at the playable end and read 3,618 of 3,630 lines). The n-th
 * press of a second takes the n-th line of that second (line 135 r6:
 * presses at 135.531 s and 135.849 s, two `2:15` lines).
 */
export function feintPressLines(
  pressesMs: readonly number[],
  startMs: number,
  lastRenderedS: number,
  casterFeintLines: readonly string[],
): Map<number, { line?: string }> {
  const out = new Map<number, { line?: string }>();
  const taken = new Map<string, number>();
  for (const at of [...pressesMs].sort((a, b) => a - b)) {
    const s = Math.floor((at - startMs) / 1000);
    if (at < startMs || s > lastRenderedS) continue;
    const second = fmtS(s);
    const n = taken.get(second) ?? 0;
    taken.set(second, n + 1);
    out.set(at, {
      line: casterFeintLines.filter((l) => l.startsWith(`${second} `))[n],
    });
  }
  return out;
}

export function run(ctx: IRoundCtx): void {
  const C = "elusivenessWallNotRead";
  if (!ctx.owner) return;
  const rogues = (ctx.players as any[]).filter(
    (u) => u.class === CombatUnitClass.Rogue,
  );
  const ownOf = new Map<string, string>(
    rogues.map((u) => [u.id, talentModifierOwnershipOf(u, ELUSIVENESS)]),
  );

  // the last second the context's timeline prints
  let lastS = -1;
  for (const l of ctx.lines) {
    const m = /^(\d+:\d\d)\s/.exec(l);
    if (m) lastS = Math.max(lastS, secOf(m[1]!));
  }
  const feintLines = new Map<string, ReturnType<typeof feintPressLines>>();
  for (const u of rogues)
    feintLines.set(
      u.id,
      feintPressLines(
        successesOf(u)
          .filter((c) => String(c.spellId) === "1966")
          .map((c) => tsOf(c)),
        ctx.start,
        lastS,
        // the producer's own reading of the line, on the caster's own line
        // (codex 85-tk-WIN-T214-2 #2 / #3)
        ctx.lines.filter(
          (l) =>
            carriesTalentReductionFactLine(l) &&
            ctx.unitOfPid(/\[ENEMY DEF\]\s+(\d+)\(/.exec(l)?.[1]) === u,
        ),
      ),
    );

  for (const u of rogues) {
    const own = ownOf.get(u.id)!;
    const enemy = u.reaction !== ctx.owner.reaction;
    const ordinal: Record<string, number> = {};
    for (const c of successesOf(u).sort((x, y) => tsOf(x) - tsOf(y))) {
      const id = String(c.spellId);
      const name = WALLS[id];
      if (!name) continue;
      const n = (ordinal[id] = (ordinal[id] ?? -1) + 1);
      const at = tsOf(c);
      // a wall press of the playable round feeds the ratios; a Feint press
      // is checked as far as the timeline prints (below)
      const playable = at >= ctx.start && at < ctx.roundEndAt;
      if (!playable && !(id === "1966" && at >= ctx.start)) continue;
      if (playable && ctx.firstOwnerOfRound)
        (ratios[`${name}, ${own}`] ??= []).push(
          ...edgeRatios(ctx, u.id, id, n),
        );
      if (enemy && id === "1966") {
        const hit = feintLines.get(u.id)?.get(at);
        // past the last second the timeline prints: no line to ask for
        if (!hit) continue;
        const line = hit.line;
        ctx.bump(C);
        ctx.violate(
          C,
          `feintPress:${own}:${line ? "line" : "noLine"}`,
          at,
          // the press's own ms: two presses of one second are two facts
          // (605 line 135 r6, 135.531 s and 135.849 s)
          `${u.id}:${at - ctx.start}`,
          `${u.name} pressed Feint, Elusiveness ${own}`,
          line?.trim().slice(0, 300),
        );
      }
    }
  }

  for (const l of ctx.lines) {
    // every `[ENEMY DEF]` Evasion line, read with the producer's predicates;
    // one that is neither form is counted, not dropped (codex #2)
    const d =
      /^(\d+:\d\d)\s+\[ENEMY DEF\]\s+(\d+)\(\S+\) \([^)]+\): Evasion (\(.*)$/.exec(
        l,
      );
    if (d) {
      const u = ctx.unitOfPid(d[2]);
      const own = u && ownOf.get(u.id);
      if (!own) continue;
      const pct = dodgeAllDamagePctOf(l);
      const form = !statesSelfDefensiveLabel(d[3]!, { kind: "dodge" })
        ? "malformed"
        : pct === undefined
          ? "plain"
          : // Elusiveness takes 20 % off every school (DB2 79008); another
            // figure is a school-limited talent's (Bait and Switch: 32 % is
            // magic alone)
            pct === ELUSIVENESS_ALL_DAMAGE_PCT
            ? "pct"
            : "pctOther";
      ctx.bump(C);
      ctx.violate(
        C,
        `evasion:${own}:${form}`,
        ctx.start + secOf(d[1]!) * 1000,
        `${u.id}:${d[1]}`,
        `${u.name} Evasion ${d[3]!.slice(0, 40)}, Elusiveness ${own}`,
        l.trim().slice(0, 300),
      );
      continue;
    }
    const m = SPAN.exec(l);
    if (!m) continue;
    const dl = DEFENSELESS.exec(m[5]!);
    let a: number;
    let b: number;
    if (dl) {
      a = secOf(dl[1]!);
      b = secOf(dl[2]!);
    } else if (m[1] === "VULNERABLE" && /no major defensives/.test(m[5]!)) {
      a = secOf(m[2]!);
      b = secOf(m[3]!);
    } else continue;
    const u = rogues.find(
      (p) => p.name === m[4] && p.reaction !== ctx.owner.reaction,
    );
    if (!u) continue;
    const own = ownOf.get(u.id)!;
    for (const [id, name] of Object.entries(WALLS)) {
      const hit = buildAuraIntervals(u, ctx.legacy).find(
        (iv) =>
          iv.spellId === id &&
          (iv.srcUnitId === u.id || iv.srcUnitName === u.name) &&
          Math.min(b, iv.toS) - Math.max(a + 1, iv.fromS) >= 1,
      );
      if (!hit) continue;
      ctx.bump(C);
      ctx.violate(
        C,
        `spanOver${name}:${own}`,
        ctx.start + Math.max(a, hit.fromS) * 1000,
        `${u.id}#${a}#${b}#${id}`,
        `${u.name} defenseless ${m[2]}… while its ${name} ran ${hit.fromS.toFixed(1)}–${hit.toS.toFixed(1)}s, Elusiveness ${own}`,
        l.trim().slice(0, 300),
      );
    }
  }
}
