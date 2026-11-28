/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t133.ts — ticket T133 (wave-4 P03): the residue of two checks, split
 * by where the gap is. Both checks say "the line and the log disagree about a
 * cooldown"; neither says whether the cooldown MODEL has the press impossible
 * (a reduction or reset it does not read — a model gap) or the model has it
 * possible and the LINE left it out (a line gap).
 *
 *  - `pressedInsideSplit`: every `pressed inside` entry `pressedInsideNeverBack`
 *    reports (`pressedInsideEntries`, that check's own reading of the
 *    sentence), judged on the producer's own ledger rows (`extractMajorCooldowns`
 *    × `isOffensiveCdFor`, `castSpellName` — `createKillWindowFactsComputer`'s
 *    selection). Kinds, `<class>: <reason>`:
 *      `model: not back at the press` — with the presses before it, the model
 *        has no charge at the press (`cdAvailableAt`, then
 *        `cdMaybeAvailableAt`: `cooldownRecastScan`'s predicate pair);
 *      `line: maybe back at the press` — not certainly back, but past the
 *        cooldown's earliest (`cdMaybeAvailableAt`); the sentence prints `may
 *        already be back` for its start second only;
 *      `line: back in the press's own second` — back at the press, not at
 *        the whole second the press renders in (the `back inside` grid);
 *      `line: holder is no team burst` — `countsAsTeamBurst` says no for the
 *        holder (the ready / back lists never carry it);
 *      `line: listed under another name` — the entry's own name is on a
 *        ready / back list and the press logged a variant (`pressedName`);
 *      `line: free press` — the model reads the press as free (`freeRecast`);
 *      `line: ready before, on no list` — anything else the model has ready;
 *      `no ledger press` — no ledger row of the team's has that press.
 *    Checked = the entries judged.
 *  - `backBeforeNextSplit`: every `[PRESS]` line whose `back m:ss` sits more
 *    than `BACK_SLACK_MS` after the unit's next press (`offListPressLine` /
 *    `backBeforeNextPress`, re-read here through the same exported reading),
 *    judged on `unitCooldownEntry` — the entry the line read. Kinds:
 *      `model: next press not back` — the model has that next press
 *        impossible too;
 *      `line: next press possible` — the model has it possible: the line's
 *        `back` (the entry cut at the press, `upToPress`) is later than the
 *        whole entry's.
 *    The spell is the kind's suffix, so the report itemises by spell.
 */
import { countsAsTeamBurst } from "@gladlog/analysis/src/analysis/candidates/cooldownTiming";
import {
  castSpellName,
  cdAvailableAt,
  cdMaybeAvailableAt,
  extractMajorCooldowns,
  type IMajorCooldownInfo,
  unitCooldownEntry,
} from "@gladlog/analysis/src/utils/cooldowns";
import { toRenderSecond } from "@gladlog/analysis/src/utils/renderGrid";
import { isOffensiveCdFor } from "@gladlog/analysis/src/utils/spellDanger";

import { type IRoundCtx, secOf } from "./ctx";
import { pressedInsideEntries } from "./fact11";
import { backBeforeNextPresses } from "./offListPress";

export const CHECKS = ["pressedInsideSplit", "backBeforeNextSplit"] as const;
/** whole checks out of the total (T314): each re-splits another check's rows by cause (`pressedInsideNeverBack`, `offListPressLine|backBeforeNextPress`), so every row is counted there already */
export const MEASURED_ONLY: ReadonlySet<string> = new Set([
  "pressedInsideSplit",
  "backBeforeNextSplit",
]);

/** the entry with only the presses before `t` */
function before(cd: IMajorCooldownInfo, t: number): IMajorCooldownInfo {
  const keep = (c: { timeSeconds: number }) => c.timeSeconds < t;
  return {
    ...cd,
    casts: cd.casts.filter(keep),
    ...(cd.sharedCasts ? { sharedCasts: cd.sharedCasts.filter(keep) } : {}),
  };
}

const teamCache = new WeakMap<
  object,
  Array<{ cd: IMajorCooldownInfo; holder: any }>
>();
/** the producer's `teamCds`: every friendly's offensive ledger rows */
function teamCdsOf(ctx: IRoundCtx) {
  const key = ctx.owner as object;
  const hit = teamCache.get(key);
  if (hit) return hit;
  const out = (ctx.players as any[])
    .filter((u) => u.reaction === ctx.owner.reaction)
    .flatMap((f) => {
      try {
        return extractMajorCooldowns(f, ctx.legacy)
          .filter((cd) => isOffensiveCdFor(String(cd.spellId), f.spec))
          .map((cd) => ({ cd, holder: f }));
      } catch {
        return [];
      }
    });
  teamCache.set(key, out);
  return out;
}

function pressedInsideSplit(ctx: IRoundCtx): void {
  if (!ctx.owner) return;
  for (const e of pressedInsideEntries(ctx)) {
    if (!e.offList || e.atS === null) continue;
    ctx.bump("pressedInsideSplit");
    const hits = teamCdsOf(ctx).flatMap(({ cd, holder }) =>
      cd.casts
        .filter(
          (c) =>
            castSpellName(cd, c) === e.name &&
            toRenderSecond(c.timeSeconds) === e.atS,
        )
        .map((c) => ({ cd, holder, c })),
    );
    const report = (kind: string, detail: string) =>
      ctx.violate(
        "pressedInsideSplit",
        `${kind} | ${e.name}`,
        ctx.start + secOf(e.readyAt) * 1000,
        `${e.readyAt}:${e.name}:${e.atS}:${e.line.slice(0, 40)}`,
        detail,
        e.line,
      );
    const hit = hits[0];
    if (!hit) {
      report("no ledger press", `${e.name}: no ledger press in that second`);
      continue;
    }
    const { cd, holder, c } = hit;
    const pt = c.timeSeconds;
    const prior = before(cd, pt);
    const last = [...prior.casts, ...(prior.sharedCasts ?? [])]
      .map((x) => x.timeSeconds)
      .sort((a, b) => a - b)
      .pop();
    const gap =
      last === undefined
        ? "first press of the round"
        : `${(pt - last).toFixed(1)}s after the press before, model ${cd.cooldownSeconds}s`;
    const who = `${holder.spec} ${e.name} at ${pt.toFixed(2)}s (${gap})`;
    if (c.freeRecast) report("line: free press", who);
    else if (!countsAsTeamBurst(holder, String(cd.spellId)))
      report("line: holder is no team burst", who);
    else if (cdAvailableAt(prior, pt)) {
      if (cd.spellName !== e.name)
        report(
          "line: listed under another name",
          `${who}; the entry is ${cd.spellName}`,
        );
      else if (!cdAvailableAt(prior, toRenderSecond(pt)))
        report("line: back in the press's own second", who);
      else report("line: ready before, on no list", who);
    } else if (cdMaybeAvailableAt(prior, pt))
      report(
        "line: maybe back at the press",
        `${who}; earliest ${cd.earliestCooldownSeconds}s`,
      );
    else report("model: not back at the press", who);
  }
}

function backBeforeNextSplit(ctx: IRoundCtx): void {
  for (const b of backBeforeNextPresses(ctx)) {
    ctx.bump("backBeforeNextSplit");
    const id = String(b.press.spellId);
    const entry = unitCooldownEntry(b.unit, ctx.legacy, id);
    const next = (b.nextMs - ctx.start) / 1000;
    const at = (b.atMs - ctx.start) / 1000;
    const possible =
      entry !== undefined &&
      (cdAvailableAt(before(entry, next), next) ||
        cdMaybeAvailableAt(before(entry, next), next));
    ctx.violate(
      "backBeforeNextSplit",
      `${possible ? "line: next press possible" : "model: next press not back"} | ${b.name}`,
      b.atMs,
      `${ctx.roundKey}|${b.unit.id}|${b.name}|${Math.floor(at)}`,
      `${b.unit.spec} ${b.name} ${id} at ${at.toFixed(2)}s: back ${b.back}, pressed again ${(next - at).toFixed(1)}s later (model ${entry?.cooldownSeconds ?? "?"}s, ${entry?.charges ?? 1} charge)`,
      b.line,
    );
  }
}

export function run(ctx: IRoundCtx): void {
  pressedInsideSplit(ctx);
  backBeforeNextSplit(ctx);
}
