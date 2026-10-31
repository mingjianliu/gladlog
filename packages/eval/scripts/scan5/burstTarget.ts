/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, damageIn, absorbsIn) */
/**
 * scan5/burstTarget.ts — class 4 of the round-7 audit (fact7 F21, D58): a
 * friendly whose only hits from the burst's casters were eaten by a shield,
 * read as not hit. 4f8a5947 2:33: the mage took 272k landed + 194k absorbed
 * and the druid's hits on him were all absorbed; POSITIONING named the shaman.
 *
 * Log truth, rows only: the casters are the enemies with an [ENEMY CD] line in
 * the POSITIONING line's second, or a press of a CD its [OFFENSIVE WINDOW] line
 * names, with their summons; the span is that second + `BURST_EVAL_SECONDS`.
 * Violation: a friend other than the one the line names took nothing landed
 * and something absorbed from the casters, and more in all (landed + absorbed,
 * any source) than the named one.
 */
import { type IRoundCtx, nameOf, successesOf, tsOf } from "./ctx";

export const CHECKS = ["burstTargetAbsorbedOnly"] as const;

const LINE =
  /^\s+(\d+):(\d\d) \[[A-Za-z]+ burst\].*— (?:burst targeted (\S+?),|you were the burst target)/;
const ENEMY_CD = /^\s*(\d+):(\d\d)\s+\[ENEMY CD\]\s+(\d+)\(/;
/** the span POSITIONING evaluates (`positionAnalysis.ts` evalEnd) */
const BURST_EVAL_SECONDS = 10;
const WINDOW = /^\s*(\d+):(\d\d)\s+\[OFFENSIVE WINDOW\].*\| CDs: (.*)$/;

export function run(ctx: IRoundCtx): void {
  const enemies = ctx.players.filter((p) => p.reaction !== ctx.owner.reaction);
  const friends = ctx.players.filter((p) => p.reaction === ctx.owner.reaction);
  // who pressed a cooldown in each printed second
  const pressers = new Map<number, Set<any>>();
  const addPresser = (t: number, u: any) => {
    if (u) pressers.set(t, (pressers.get(t) ?? new Set()).add(u));
  };
  for (const l of ctx.lines) {
    const e = ENEMY_CD.exec(l);
    if (e) addPresser(+e[1]! * 60 + +e[2]!, ctx.unitOfPid(e[3]));
    const w = WINDOW.exec(l);
    if (!w) continue;
    const t = +w[1]! * 60 + +w[2]!;
    const lo = ctx.start + t * 1000;
    const names = new Set(
      w[3]!.split(" + ").map((c) => c.replace(/@\d+:\d\d.*$/, "").trim()),
    );
    for (const u of enemies)
      if (
        successesOf(u).some(
          (c) =>
            tsOf(c) >= lo &&
            tsOf(c) <= lo + BURST_EVAL_SECONDS * 1000 &&
            names.has(nameOf(c.spellId, c.spellName)),
        )
      )
        addPresser(t, u);
  }
  for (const line of ctx.lines) {
    const m = LINE.exec(line);
    if (!m) continue;
    const t = +m[1]! * 60 + +m[2]!;
    const casters = [...(pressers.get(t) ?? [])];
    if (casters.length === 0) continue;
    const fromMs = ctx.start + t * 1000;
    const toMs = fromMs + BURST_EVAL_SECONDS * 1000;
    const casterIds = new Set([
      ...casters.map((c) => c.id),
      ...ctx.units
        .filter((u) => casters.some((c) => c.id === u.ownerId))
        .map((u) => u.id),
    ]);
    const named = m[3] ? ctx.byName.get(m[3]) : ctx.owner;
    if (!named) continue;
    const inSpan = (r: any) => tsOf(r) >= fromMs && tsOf(r) <= toMs;
    const landed = (f: any, src?: Set<string>) =>
      ((f.damageIn ?? []) as any[])
        .filter((d) => inSpan(d) && (!src || src.has(d.srcUnitId)))
        .reduce((n, d) => n + Math.abs(d.effectiveAmount ?? 0), 0);
    const absorbed = (f: any, src?: Set<string>) =>
      ((f.absorbsIn ?? []) as any[])
        .filter((a) => inSpan(a) && (!src || src.has(a.attackerId)))
        .reduce((n, a) => n + Math.abs(a.absorbedAmount ?? 0), 0);
    ctx.bump("burstTargetAbsorbedOnly");
    const namedAll = landed(named) + absorbed(named);
    for (const f of friends) {
      if (f.id === named.id) continue;
      if (landed(f, casterIds) > 0 || absorbed(f, casterIds) <= 0) continue;
      const all = landed(f) + absorbed(f);
      if (all <= namedAll) continue;
      ctx.violate(
        "burstTargetAbsorbedOnly",
        "absorbedOnlyTarget",
        fromMs,
        `${t}#${f.name}`,
        `${f.name} took ${Math.round(all / 1000)}k (${Math.round(absorbed(f, casterIds) / 1000)}k absorbed from the casters, 0 landed); line names ${named.name} ${Math.round(namedAll / 1000)}k`,
        line,
      );
    }
  }
}
