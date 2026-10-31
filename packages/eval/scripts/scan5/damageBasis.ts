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
 *    enemy players inside the aura's span. 96fb4d42 0:55: 100 % printed, 73 %
 *    with the 117k put into another enemy's shields; 163de8f1 1:37: 0 %
 *    printed for 70k all absorbed on the target.
 *  - `allyOverlapDeferral` (D22): a burst ledger `their top target in it: T
 *    N.NNM` that only matches with the deferral rows summed by magnitude.
 *    d2e6e70b: 1.29M printed, 1.28M true.
 *  - `spikeAbsorbedPart` (D49): a `[DMG SPIKE]` whose absorbed part prints as
 *    at least 0.01M with no `(X absorbed)`. 7acbefeb 1:05: 85k.
 *  - `topSourceRedistribution` (D54): a `Top sources:` entry that names a
 *    redistribution id as the unit's own damage. 7e7b1e51 0:28: Tempered in
 *    Battle (own) (79k).
 *  - `abilityIntoWallShare` (D53): a spell of ≥ 5 % of the player's damage on
 *    enemies, cast ≥ 3 times inside a listed wall, absent from the line.
 *    7e7b1e51 0:43: Fire Blast.
 *  - `postCcAbsorbedUnsaid` (D70): a missed-cleanse row whose 5 s after the
 *    control held ≥ 1k absorbed with no absorbed fact beside `postCcDamageK`.
 *    6ac699c9 0:25: 272k.
 *  - `stackedWallPrice` (D77): a `[STACKED DEFENSIVES]` percentage price
 *    against (landed + absorbed) × b / (1 − b). 831c3fd5 0:23: ~6 % printed,
 *    ~20 % true.
 */
import {
  resolveMitigation,
  strongestComponentPct,
} from "@gladlog/analysis/src/data/mitigationComponents";

import {
  ABSORBED,
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
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
] as const;

const DEFERRAL_SHIELDS = new Set(["357170", "410355", "386124"]);
const REDISTRIBUTION_IDS = new Set(["98021", "451963", "469704"]);
const REDISTRIBUTION_NAMES = [
  "Spirit Link",
  "Void Leech",
  "Tempered in Battle",
];

const SLACK_PCT = 2;
const fmtLedger = (n: number): string => (n / 1e6).toFixed(2);
const POST_CC_S = 5;
const MIN_ABSORBED = 1000;
/** the 5 % of the legend */
const HIGH_VALUE_SHARE = 0.05;
const WALL_MIN_CASTS = 3;

const secOfTag = (m: string, s: string): number => +m * 60 + +s;
const inSpan = (r: any, a: number, b: number): boolean =>
  tsOf(r) >= a && tsOf(r) < b;
const attackersOf = (ctx: IRoundCtx, u: any): Set<string> =>
  new Set([
    u.id,
    ...ctx.units.filter((x) => x.ownerId === u.id).map((x) => x.id),
  ]);
const landedOn = (v: any, a: number, b: number, src?: Set<string>): number =>
  ((v.damageIn ?? []) as any[])
    .filter((d) => inSpan(d, a, b) && (!src || src.has(d.srcUnitId)))
    .filter((d) => !REDISTRIBUTION_IDS.has(String(d.spellId)))
    .reduce((n, d) => n + Math.abs(d.effectiveAmount ?? 0), 0);
const absorbedOn = (v: any, a: number, b: number, src?: Set<string>): number =>
  ((v.absorbsIn ?? []) as any[])
    .filter((r) => inSpan(r, a, b) && (!src || src.has(r.attackerId)))
    .filter((r) => !DEFERRAL_SHIELDS.has(String(r.spellId)))
    .filter((r) => !REDISTRIBUTION_IDS.has(String(r.attackSpellId)))
    .reduce((n, r) => n + Math.abs(r.absorbedAmount ?? 0), 0);
const deferredOn = (v: any, a: number, b: number, src?: Set<string>): number =>
  ((v.absorbsIn ?? []) as any[])
    .filter((r) => inSpan(r, a, b) && (!src || src.has(r.attackerId)))
    .filter((r) => DEFERRAL_SHIELDS.has(String(r.spellId)))
    .reduce((n, r) => n + (r.absorbedAmount ?? 0), 0);

const ENEMY_DEF_EXTERNAL =
  /^\s*(\d+):(\d\d)\s+\[ENEMY DEF\]\s+\d+\([^)]*\)(?: \([^)]*\))?: (.+?) → (\d+)\([^)]*\) \((\d+(?:\.\d+)?)s/;
const DURING_SHARE =
  /^(\d+)\([^)]*\) \d+k on target(?: \([^)]*\))? · (\d+)% of their enemy-player damage/;

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
    const applied = ((target.auraEvents ?? []) as any[]).find(
      (a) =>
        ev(a) === APPLIED &&
        tsOf(a) >= lo - 1000 &&
        tsOf(a) < lo + 1000 &&
        nameOf(a.spellId, a.spellName) === m[3],
    );
    const fromMs = applied ? tsOf(applied) : lo;
    const toMs = fromMs + +m[5]! * 1000;
    for (const seg of line.slice(at + "| during it: ".length).split("; ")) {
      const s = DURING_SHARE.exec(seg);
      if (!s) continue;
      const ally = ctx.unitOfPid(s[1]);
      if (!ally) continue;
      const src = attackersOf(ctx, ally);
      const onUnit = (v: any) =>
        landedOn(v, fromMs, toMs, src) +
        absorbedOn(v, fromMs, toMs, src) +
        Math.max(0, deferredOn(v, fromMs, toMs, src));
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
      const press = successesOf(ally)
        .filter(
          (c) =>
            nameOf(c.spellId, c.spellName) === m[2] && tsOf(c) <= toB + 1000,
        )
        .map(tsOf);
      // the overlap opens at the burst or at the press, closes at either end
      const opens = [fromB, ...press.filter((t) => t >= fromB)];
      const spans = [
        ...opens.map((a) => [a, a + seconds * 1000] as const),
        [toB - seconds * 1000, toB] as const,
      ];
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
        const clean =
          landedOn(target, a, b + 1, src) + absorbedOn(target, a, b + 1, src);
        const withDeferral = clean + abs(a, b);
        if (abs(a, b) < MIN_ABSORBED) continue;
        if (fmtLedger(clean) === m[5]) continue;
        if (fmtLedger(withDeferral) !== m[5]) continue;
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

function abilityIntoWallShare(ctx: IRoundCtx): void {
  const friendIds = new Set(
    ctx.players
      .filter((p) => p.reaction === ctx.owner.reaction)
      .map((p) => p.id),
  );
  for (const line of ctx.lines) {
    const m = INTO_LINE.exec(line);
    if (!m) continue;
    const friend = ctx.byName.get(m[3]!);
    const target = ctx.byName.get(m[5]!);
    if (!friend || !target) continue;
    ctx.bump("abilityIntoWallShare");
    const name = (d: any) => nameOf(d.spellId, d.spellName) || "melee";
    const totals = new Map<string, number>();
    let all = 0;
    for (const d of (friend.damageOut ?? []) as any[]) {
      if (ev(d) === ABSORBED || friendIds.has(d.destUnitId)) continue;
      const a = Math.abs(d.effectiveAmount ?? 0);
      totals.set(name(d), (totals.get(name(d)) ?? 0) + a);
      all += a;
    }
    const lo = ctx.start + secOfTag(m[1]!, m[2]!) * 1000;
    const auras = ((target.auraEvents ?? []) as any[]).filter(
      (a) => nameOf(a.spellId, a.spellName) === m[6],
    );
    const up = auras.find(
      (a) => ev(a) === APPLIED && tsOf(a) >= lo - 1000 && tsOf(a) < lo + 1000,
    );
    if (!up) continue;
    const down = auras.find((a) => ev(a) === REMOVED && tsOf(a) > tsOf(up));
    const toMs = down ? tsOf(down) : ctx.end;
    const listed = m[4]!;
    for (const [spell, v] of totals) {
      if (v < all * HIGH_VALUE_SHARE || listed.includes(spell)) continue;
      const casts = successesOf(friend).filter(
        (c) =>
          tsOf(c) >= tsOf(up) &&
          tsOf(c) <= toMs &&
          c.destUnitId === target.id &&
          nameOf(c.spellId, c.spellName) === spell,
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
    // the control's own landing: the menu's `t` is cut to a tenth
    const lo = ctx.start + +m[1]! * 1000 - 100;
    const landing =
      ((unit.auraEvents ?? []) as any[])
        .filter(
          (a) => ev(a) === APPLIED && tsOf(a) >= lo && tsOf(a) < lo + 1100,
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

const STACKED =
  /^\s*(\d+):(\d\d)\s+\[STACKED DEFENSIVES\]\s+\d+\([^)]*\)(?: \(you\))? had .+? up together (\d+):(\d\d)–(\d+):(\d\d) \([\d.]+s\); the later one, (.+?), blocked ~(\d+)% of their max HP during the overlap/;

function stackedWallPrice(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = STACKED.exec(line);
    if (!m) continue;
    const pid = /\[STACKED DEFENSIVES\]\s+(\d+)\(/.exec(line)?.[1];
    const unit = ctx.unitOfPid(pid);
    if (!unit) continue;
    const carrierAura = ((unit.auraEvents ?? []) as any[]).find(
      (a) => nameOf(a.spellId, a.spellName) === m[7],
    );
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
      (a) => a.spellId === carrierAura.spellId,
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
}
