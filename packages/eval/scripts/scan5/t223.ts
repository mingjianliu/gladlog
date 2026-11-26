/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t223.ts — pipeline T223, count first: an aligned burst window's
 * damage (`enemyCDs.ts` `windowDamage`, the slice average it is divided by,
 * and the pressured-unit pick) sums every `damageIn` row of the owner's
 * side, while the incoming-damage reading everything else shares
 * (`incomingPressureEvents`, utils/incomingPressure.ts) leaves out
 * `REDISTRIBUTION_DAMAGE_IDS` rows from the unit's own side — Spirit Link,
 * Void Leech, Tempered in Battle: health moved between teammates (user
 * rulings 2026-09-30 R2 / A22, 2026-10-25 F18).
 *
 * `burstSumRedistribution` — per aligned burst window of the owner's
 * timeline, the ratio recomputed on the shared reading's LANDED rows (window
 * and slice average both), kinds:
 *  - `label reads high` / `label reads low` — the tier differs;
 *  - `ratio off, same label` — out of the total;
 *  - `holds a redistribution row` — out of the total: the window's sum has
 *    one at all;
 *  - `window total is not the landed sum` — the window's own
 *    `damageInWindow` against the shared landed reading of its span;
 *  - `pressured unit differs` — the side's top unit by the product's sum is
 *    not the top unit by the shared reading;
 *  - `with absorbs: label differs` — out of the total, a measurement: the
 *    tier on the shared reading's full pressure (landed + absorbed), the
 *    `[DMG SPIKE]` measure.
 *
 * `redistributionTableComplete` — the table's forward check (Curated-List
 * rule): a damage row from the unit's own side with a heal row of the same
 * spell id on a teammate in the same millisecond, by spell; a spell not in
 * the table is a violation (`unlisted`), a listed one is counted out of the
 * total. `deferralTableComplete` — a self-sourced periodic damage id, both
 * kinds out of the total: `unlisted` is a candidate only (self-damage of
 * other kinds shares the shape; read the names in the details).
 */
import { HP_SAMPLE_RADIUS_MS } from "@gladlog/analysis/src/utils/cooldowns";
import {
  BURST_DAMAGE_RATIO_MAX,
  BURST_DAMAGE_RATIO_MIN,
  burstHpPctAt,
  burstWindowRateSpanSeconds,
  reconstructEnemyCDTimeline,
} from "@gladlog/analysis/src/utils/enemyCDs";
import {
  incomingPressureEvents,
  isDeferredTickId,
  isRedistributionRow,
  REDISTRIBUTION_DAMAGE_IDS,
} from "@gladlog/analysis/src/utils/incomingPressure";
import { buildRosterSides } from "@gladlog/analysis/src/utils/rosterSide";
import { roundDamageEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import { fmtS, type IRoundCtx, nameOf } from "./ctx";
import { rateVerdict } from "./t91";

export const CHECKS = [
  "burstEndHpPastRoundEnd",
  "burstSumRedistribution",
  "redistributionTableComplete",
  "deferralTableComplete",
] as const;
/** the product's pressured-unit pick counted rows after the round's end */
const PICK_READS_PAST_END =
  "pressured unit differs: the pick reads rows after the round's end";
const WINDOW_TOTAL = "window total is not the landed sum";
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "burstSumRedistribution|ratio off, same label",
  "burstSumRedistribution|holds a redistribution row",
  "burstSumRedistribution|with absorbs: label reads high",
  "burstSumRedistribution|with absorbs: label reads low",
  `burstSumRedistribution|${PICK_READS_PAST_END}`,
  "redistributionTableComplete|listed",
  "deferralTableComplete|listed",
  "deferralTableComplete|unlisted",
]);

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (p) => p.reaction !== owner.reaction,
  );
  const sides = buildRosterSides(ctx.units as any[]);
  // the round's end the burst readers stop at (`roundDamageEndMs`, T237)
  const dmgEnd = roundDamageEndMs({
    ...(ctx.legacy as any),
    endTime: ctx.end,
  });
  const sliceEndS = (dmgEnd - ctx.start) / 1000;
  if (!(sliceEndS > 0)) return;

  // ── the tables' forward checks (every view walks the round's players;
  // the distinct count is the round's)
  {
    for (const u of ctx.players as any[]) {
      const mates = (ctx.players as any[]).filter(
        (p) => p.reaction === u.reaction && p.id !== u.id,
      );
      const seen = new Set<string>();
      for (const d of (u.damageIn ?? []) as any[]) {
        const id = String(d.spellId ?? "");
        if (!id || d.logLine.timestamp > ctx.end) continue;
        const sameSide = sides.get(d.srcUnitId) === u.reaction;
        if (
          d.srcUnitId === u.id &&
          /PERIODIC/.test(String(d.logLine.event)) &&
          !seen.has(`d${id}`)
        ) {
          seen.add(`d${id}`);
          ctx.bump("deferralTableComplete");
          ctx.violate(
            "deferralTableComplete",
            isDeferredTickId(id) ? "listed" : "unlisted",
            d.logLine.timestamp,
            `${u.name}#${id}`,
            `${nameOf(id, id)} ${id}: self-sourced periodic damage`,
          );
        }
        if (!sameSide || seen.has(`r${id}`)) continue;
        const paired = mates.some((m) =>
          ((m.healIn ?? []) as any[]).some(
            (h) =>
              String(h.spellId ?? "") === id &&
              h.logLine.timestamp === d.logLine.timestamp,
          ),
        );
        if (!paired) continue;
        seen.add(`r${id}`);
        ctx.bump("redistributionTableComplete");
        ctx.violate(
          "redistributionTableComplete",
          REDISTRIBUTION_DAMAGE_IDS.has(id) ? "listed" : "unlisted",
          d.logLine.timestamp,
          `${u.name}#${id}`,
          `${nameOf(id, id)} ${id}: own-side damage with a same-ms heal of the spell on a teammate`,
        );
      }
    }
  }

  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  const timeline = reconstructEnemyCDTimeline(
    enemies as never,
    combat as never,
    owner as never,
    friends as never,
  );
  if (timeline.alignedBurstWindows.length === 0) return;

  // T237 (codex 80-PIPE-234-B212 #1): a window whose last buff runs past
  // the round's end prints its pressured unit's HP at the round's end, from
  // a reading taken no later than it — not the 100 % of a reading after the
  // deciding death (7686e97d r5: death 239.105 s at 8 %, the buff to
  // 254.065 s). Counted: windows ending after the round's end with an end
  // reading printed.
  for (const w of timeline.alignedBurstWindows) {
    const t = w.mostPressuredTarget;
    if (!t || ctx.start + w.toSeconds * 1000 <= dmgEnd) continue;
    const unit = friends.find((u: any) => u.name === t.unitName);
    if (!unit) continue;
    ctx.bump("burstEndHpPastRoundEnd");
    const want = burstHpPctAt(
      unit,
      ctx.start + w.toSeconds * 1000,
      dmgEnd,
      HP_SAMPLE_RADIUS_MS,
    );
    if (t.endHpPct === want) continue;
    ctx.violate(
      "burstEndHpPastRoundEnd",
      "end HP read past the round's end",
      ctx.start + w.fromSeconds * 1000,
      `${t.unitName}#${w.fromSeconds}`,
      `${t.unitName} burst ${fmtS(w.fromSeconds)}–${fmtS(w.toSeconds)} (round ends ${fmtS(sliceEndS)}): printed end ${t.endHpPct ?? "none"}, at the round's end ${want ?? "none"}`,
    );
  }

  type Row = { t: number; amount: number; unit: string; absorb: boolean };
  const shared: Row[] = [];
  const product: Array<Row & { redistributed: boolean; id: string }> = [];
  for (const u of friends) {
    for (const e of incomingPressureEvents(u, sides)) {
      if (e.timestamp > dmgEnd) continue;
      shared.push({
        t: (e.timestamp - ctx.start) / 1000,
        amount: e.amount,
        unit: u.name,
        absorb: e.isAbsorb,
      });
    }
    for (const d of (u.damageIn ?? []) as any[]) {
      if (d.logLine.timestamp > dmgEnd) continue;
      product.push({
        t: (d.logLine.timestamp - ctx.start) / 1000,
        amount: Math.abs(d.effectiveAmount ?? 0),
        unit: u.name,
        absorb: false,
        id: String(d.spellId ?? ""),
        redistributed: isRedistributionRow(
          u,
          d.spellId,
          d.srcUnitId,
          d.srcUnitFlags,
          d.destUnitFlags,
          sides,
        ),
      });
    }
  }
  // the unit's damage rows logged after the round's end, inside a window
  // (the product's pressured-unit pick does not stop at the round's end)
  const afterEnd = (unit: string, fromS: number, toS: number): number =>
    friends
      .filter((u: any) => u.name === unit)
      .flatMap((u: any) => (u.damageIn ?? []) as any[])
      .filter(
        (d) =>
          d.logLine.timestamp > dmgEnd &&
          d.logLine.timestamp >= ctx.start + fromS * 1000 &&
          d.logLine.timestamp <= ctx.start + toS * 1000,
      )
      .reduce((n, d) => n + Math.abs(d.effectiveAmount ?? 0), 0);
  const landed = shared.filter((r) => !r.absorb);
  const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.amount, 0);
  const totLanded = sum(landed);
  const totShared = sum(shared);
  if (!(totLanded > 0)) return;

  for (const w of timeline.alignedBurstWindows) {
    if (!(w.damageRatio > 0)) continue;
    ctx.bump("burstSumRedistribution");
    const inW = <T extends Row>(rows: T[]) =>
      rows.filter((r) => r.t >= w.fromSeconds && r.t <= w.toSeconds);
    const span = burstWindowRateSpanSeconds(
      w.fromSeconds,
      w.toSeconds,
      sliceEndS,
    );
    const ratioOf = (win: number, tot: number) =>
      Math.min(
        BURST_DAMAGE_RATIO_MAX,
        Math.max(win / span / (tot / sliceEndS), BURST_DAMAGE_RATIO_MIN),
      );
    const prodW = inW(product);
    const moved = prodW.filter((r) => r.redistributed);
    const at = ctx.start + w.fromSeconds * 1000;
    const id = `${owner.name}#${Math.round(w.fromSeconds * 1000)}`;
    const head = `window ${fmtS(w.fromSeconds)}–${fmtS(w.toSeconds)}: ratio ${w.damageRatio.toFixed(2)} [${w.dangerLabel}]`;
    if (moved.length > 0) {
      const by = new Map<string, number>();
      for (const r of moved) by.set(r.id, (by.get(r.id) ?? 0) + r.amount);
      const [topId, topAmount] = [...by].sort((a, b) => b[1] - a[1])[0]!;
      ctx.violate(
        "burstSumRedistribution",
        "holds a redistribution row",
        at,
        `${id}#holds`,
        `${head}; ${(sum(moved) / 1000).toFixed(0)}k of ${(sum(prodW) / 1000).toFixed(0)}k is redistribution (top ${nameOf(topId, topId)} ${(topAmount / 1000).toFixed(0)}k)`,
      );
    }
    // the product's own total against the shared landed sum — the ratio
    // checks cannot see a total inflated in step with the slice average
    // (codex 85-tk-WIN-T223-1 #5)
    const landedW = sum(inW(landed));
    if (Math.abs(w.damageInWindow - landedW) > 1)
      ctx.violate(
        "burstSumRedistribution",
        WINDOW_TOTAL,
        at,
        `${id}#total`,
        `${head}; damageInWindow ${(w.damageInWindow / 1000).toFixed(0)}k, shared landed sum ${(landedW / 1000).toFixed(0)}k (raw rows ${(sum(prodW) / 1000).toFixed(0)}k, redistribution ${(sum(moved) / 1000).toFixed(0)}k)`,
      );
    const rLanded = ratioOf(sum(inW(landed)), totLanded);
    const v = rateVerdict(w, rLanded);
    if (v.kind)
      ctx.violate(
        "burstSumRedistribution",
        v.kind,
        at,
        id,
        `${head}, on the shared landed reading ${rLanded.toFixed(2)} [${v.logLabel}]; redistribution in it ${(sum(moved) / 1000).toFixed(0)}k`,
      );
    const rFull = ratioOf(sum(inW(shared)), totShared);
    const vf = rateVerdict(w, rFull);
    if (vf.kind && vf.kind !== "ratio off, same label")
      ctx.violate(
        "burstSumRedistribution",
        `with absorbs: ${vf.kind}`,
        at,
        `${id}#full`,
        `${head}, landed + absorbed ${rFull.toFixed(2)} [${vf.logLabel}]`,
      );
    // the pressured unit: the side's top unit by each sum
    const top = (rows: Row[]) => {
      const by = new Map<string, number>();
      for (const r of rows) by.set(r.unit, (by.get(r.unit) ?? 0) + r.amount);
      return [...by].sort((a, b) => b[1] - a[1])[0];
    };
    // the product's own pick (`mostPressuredTarget`), not this file's
    // restatement of it: the check has to move when the product does
    const rawTop = top(prodW);
    const prodName: string | undefined = (w as any).mostPressuredTarget
      ?.unitName;
    const pTop: [string, number] | undefined =
      prodName === undefined
        ? undefined
        : [prodName, prodName === rawTop?.[0] ? rawTop[1] : NaN];
    const sTop = top(inW(landed));
    if (pTop && sTop && pTop[0] !== sTop[0]) {
      // why: each unit's sum on the product's rows without redistribution
      // (what the product's pick reads) and on the shared landed rows
      const k = (n: number) => `${(n / 1000).toFixed(0)}k`;
      const of = (unit: string) =>
        `${unit} product-rows ${k(sum(prodW.filter((r) => r.unit === unit && !r.redistributed)))} / shared ${k(sum(inW(landed).filter((r) => r.unit === unit)))} / rows after the round's end inside the window ${k(afterEnd(unit, w.fromSeconds, w.toSeconds))}`;
      // The product's pick does not stop at the round's end (the window's
      // damage sum does): with the rows logged after it inside the window,
      // is the product's unit the top one? Then the difference is that
      // reading, not redistribution — counted, out of the total (found by
      // T223's recount, 6 on the 605; not this ticket's fact).
      const withLate = (unit: string) =>
        sum(prodW.filter((r) => r.unit === unit && !r.redistributed)) +
        afterEnd(unit, w.fromSeconds, w.toSeconds);
      const lateExplains =
        afterEnd(pTop[0], w.fromSeconds, w.toSeconds) > 0 &&
        friends.every(
          (u: any) =>
            u.name === pTop[0] || withLate(u.name) <= withLate(pTop[0]),
        );
      ctx.violate(
        "burstSumRedistribution",
        lateExplains ? PICK_READS_PAST_END : "pressured unit differs",
        at,
        `${id}#unit`,
        `${head}; product's pick ${of(pTop[0])}; shared reading's top ${of(sTop[0])}`,
      );
    }
  }
}
