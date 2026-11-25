/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * scan5/t159.ts — pipeline T159 (GH #218 3.10), count first: an aligned
 * burst window's `damageInWindow` and `damageRatio` (`enemyCDs.ts`) sum
 * every damage row on the owner's side, whoever dealt it, and the window's
 * `dangerScore` / `dangerLabel` read that ratio. Damage a player did to
 * itself (Burning Rush, Shadow Word: Death's backlash, Stagger) or a
 * teammate did is not the enemy's burst.
 *
 * Counted, per owner context: every aligned burst window of the owner's
 * timeline (the product's own call). Log truth, on the raw rows of the
 * slice: the side's damage by who dealt it —
 *  - `enemy`: an enemy player, or a unit an enemy player owns;
 *  - `own side`: the victim itself, a teammate, or a unit one of them owns;
 *  - `unowned`: a source the roster does not place (environment, a unit
 *    with no owner in the log).
 * The window's ratio is then recomputed with the `own side` rows left out
 * of BOTH the window's damage and the slice's average (clamped and spanned
 * as the product's is: `burstWindowRateSpanSeconds`, the two bounds).
 *
 * Check `burstRatioOwnSideDamage`, kinds:
 *  - `label reads high` / `label reads low` — the window's `dangerLabel`
 *    differs from the label of its own score at the enemy-and-unowned
 *    ratio (`rateVerdict`, the T91 reading);
 *  - `ratio off, same label` — out of the total: the ratio moves by more
 *    than 2 %, the label stands;
 *  - `own side share ≥ 10 %` — out of the total, a measurement: a tenth or
 *    more of the window's damage is the side's own.
 * The examples carry the top own-side spell of the window.
 */
import {
  BURST_DAMAGE_RATIO_MAX,
  BURST_DAMAGE_RATIO_MIN,
  burstWindowRateSpanSeconds,
  reconstructEnemyCDTimeline,
} from "@gladlog/analysis/src/utils/enemyCDs";
import { roundDamageEndMs } from "@gladlog/analysis/src/utils/roundEnd";

import { fmtS, type IRoundCtx, nameOf } from "./ctx";
import { rateVerdict } from "./t91";

export const CHECKS = ["burstRatioOwnSideDamage"] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "burstRatioOwnSideDamage|ratio off, same label",
  "burstRatioOwnSideDamage|own side share ≥ 10 %",
]);

const SHARE_NOTED = 0.1;

export function run(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const friends = (ctx.players as any[]).filter(
    (p) => p.reaction === owner.reaction,
  );
  const enemies = (ctx.players as any[]).filter(
    (p) => p.reaction !== owner.reaction,
  );
  const friendIds = new Set(friends.map((p) => p.id));
  const enemyIds = new Set(enemies.map((p) => p.id));
  const ownerOf = new Map<string, string>();
  for (const u of ctx.units as any[])
    if (u.ownerId && u.ownerId !== "0000000000000000")
      ownerOf.set(u.id, u.ownerId);
  const sideOf = (src: string | undefined): "enemy" | "own" | "unowned" => {
    const who = src ? (ownerOf.get(src) ?? src) : "";
    return friendIds.has(who) ? "own" : enemyIds.has(who) ? "enemy" : "unowned";
  };
  const combat = { ...ctx.legacy, startTime: ctx.start, endTime: ctx.end };
  // the round's end the burst readers stop at (`roundDamageEndMs`, T237)
  const dmgEnd = roundDamageEndMs({
    ...(ctx.legacy as any),
    endTime: ctx.end,
  });
  const sliceEndS = (dmgEnd - ctx.start) / 1000;
  if (!(sliceEndS > 0)) return;
  const timeline = reconstructEnemyCDTimeline(
    enemies as never,
    combat as never,
    owner as never,
    friends as never,
  );
  if (timeline.alignedBurstWindows.length === 0) return;

  // the side's damage rows of the slice, each with who dealt it
  const rows: Array<{ t: number; amount: number; side: string; id: string }> =
    [];
  for (const u of friends)
    for (const e of (u.damageIn ?? []) as any[]) {
      if (e.logLine.timestamp > dmgEnd) continue;
      rows.push({
        t: (e.logLine.timestamp - ctx.start) / 1000,
        amount: Math.abs(e.effectiveAmount ?? 0),
        side: sideOf(e.srcUnitId),
        id: String(e.spellId ?? ""),
      });
    }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const totalNotOwn = rows.reduce(
    (s, r) => s + (r.side === "own" ? 0 : r.amount),
    0,
  );
  if (!(total > 0) || !(totalNotOwn > 0)) return;

  for (const w of timeline.alignedBurstWindows) {
    if (!(w.damageRatio > 0)) continue;
    ctx.bump("burstRatioOwnSideDamage");
    const inW = rows.filter((r) => r.t >= w.fromSeconds && r.t <= w.toSeconds);
    const all = inW.reduce((s, r) => s + r.amount, 0);
    const own = inW.reduce((s, r) => s + (r.side === "own" ? r.amount : 0), 0);
    // a window with no own-side row still moves when the slice's average
    // does (codex 85-tk-WIN-T159-1 #1)
    if (!(own > 0) && total === totalNotOwn) continue;
    const span = burstWindowRateSpanSeconds(
      w.fromSeconds,
      w.toSeconds,
      sliceEndS,
    );
    const ratio = Math.min(
      BURST_DAMAGE_RATIO_MAX,
      Math.max(
        (all - own) / span / (totalNotOwn / sliceEndS),
        BURST_DAMAGE_RATIO_MIN,
      ),
    );
    const bySpell = new Map<string, number>();
    for (const r of inW)
      if (r.side === "own")
        bySpell.set(r.id, (bySpell.get(r.id) ?? 0) + r.amount);
    const [topId, topAmount] = [...bySpell].sort((a, b) => b[1] - a[1])[0] ?? [
      "",
      0,
    ];
    const at = ctx.start + w.fromSeconds * 1000;
    const id = `${owner.name}#${Math.round(w.fromSeconds * 1000)}`;
    const share = all > 0 ? own / all : 0;
    const detail = `window ${fmtS(w.fromSeconds)}–${fmtS(w.toSeconds)}: ${(share * 100).toFixed(1)} % of ${(all / 1000).toFixed(0)}k is the side's own (${own > 0 ? `top ${nameOf(topId, topId || "melee")} ${(topAmount / 1000).toFixed(0)}k` : "none in the window; the slice's average moves"}); ratio ${w.damageRatio.toFixed(2)} [${w.dangerLabel}]`;
    const { kind, logLabel } = rateVerdict(w, ratio);
    if (kind)
      ctx.violate(
        "burstRatioOwnSideDamage",
        kind,
        at,
        id,
        `${detail}, without it ${ratio.toFixed(2)} [${logLabel}]`,
      );
    if (share >= SHARE_NOTED)
      ctx.violate(
        "burstRatioOwnSideDamage",
        "own side share ≥ 10 %",
        at,
        `${id}#share`,
        detail,
      );
  }
}
