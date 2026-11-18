/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/t155.ts — ticket T155 (r13 P1): a Retribution paladin's Divine Toll
 * runs on the talent aura Divine Resonance 1266308
 * (`TALENT_EFFECT_AURAS_OF_CAST`), and a press inside it had no
 * `[friendly offensive CD active]`.
 *
 *  - `resonanceTagMissing`, from the printed line and the log's aura.
 *    Counted: every line of a type that carries the tag — `[ENEMY DEF]`
 *    (enemyDef.ts) and `[ENEMY TRINKET]` (ccOnEnemy.ts), the two renderers
 *    that ask `friendlyOffensiveCdActiveAt`; a `[CC ON ENEMY]` line never
 *    carries it (codex 85-tk-WIN-T155-1 #2) — whose printed second, the
 *    second before it and the second after it all lie inside a Divine
 *    Resonance a friendly paladin put on itself (the producer's intervals,
 *    `buildAuraIntervals`) — a paladin for whom Divine Toll is an offensive
 *    cooldown (`isEnemyCdWindowSpell`, the tag's own filter). The tag is a
 *    fact of the PRESS instant and a line can print its aura's second, a
 *    moment after the press (#3): with the Resonance up a second either
 *    side, it is up at the press whichever the line prints. A violation is
 *    a line without the tag. Kind `untagged`.
 *  - `resonanceWithoutToll` (the forward check of the table row): every
 *    Divine Resonance interval on a paladin of either side whose start the
 *    log shows, each round once. A violation is one with no Divine Toll
 *    press of that paladin within a second of it, nor an earlier one it can
 *    be re-stating (#4: inside the Resonance's official length, no logged
 *    end of a Resonance in between) — an aura that is not a press's. Kind =
 *    the paladin's spec.
 */
import { TALENT_EFFECT_AURAS_OF_CAST } from "@gladlog/analysis/src/data/castEffectAuras";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import { buildAuraIntervals } from "@gladlog/analysis/src/utils/auraIntervals";
import {
  isEnemyCdWindowSpell,
  specToString,
} from "@gladlog/analysis/src/utils/cooldowns";
import { ENEMY_DEF_TAG_RE_SRC } from "@gladlog/analysis/src/utils/enemyDefensives";

import { type IRoundCtx, successesOf, tsOf } from "./ctx";

export const CHECKS = ["resonanceTagMissing", "resonanceWithoutToll"] as const;

const TOLL = "375576";
const RESONANCE = new Set(TALENT_EFFECT_AURAS_OF_CAST[TOLL]);
const TAG = "[friendly offensive CD active]";
const TAGGED_LINE = new RegExp(
  String.raw`^\s*(\d+):(\d\d)\s+(?:${ENEMY_DEF_TAG_RE_SRC}|\[ENEMY TRINKET\])`,
);
const PRESS_NEAR_MS = 1000;
/** the Resonance's official length (DB2), the reach of a re-statement —
 * read when a round is scanned, after the analysis data has loaded */
const resonanceMs = (): number =>
  Math.max(
    ...[...RESONANCE].map((id) => spellEffectData[id]?.durationSeconds ?? 0),
  ) * 1000;

const runsOf = (u: any, legacy: any) =>
  buildAuraIntervals(u, legacy).filter(
    (iv) =>
      RESONANCE.has(iv.spellId) &&
      (iv.srcUnitId === u.id || iv.srcUnitName === u.name),
  );

export function run(ctx: IRoundCtx): void {
  const start = (ctx.legacy as any).startTime as number;
  const holders = (ctx.players as any[])
    .map((u) => ({ u, runs: runsOf(u, ctx.legacy) }))
    .filter((h) => h.runs.length > 0);
  if (holders.length === 0) return;

  const RESONANCE_MS = resonanceMs();
  if (ctx.firstOwnerOfRound)
    for (const { u, runs } of holders) {
      const presses = successesOf(u)
        .filter((c: any) => String(c.spellId) === TOLL)
        .map((c: any) => tsOf(c) as number);
      for (const iv of runs) {
        if (iv.inferredStart) continue;
        ctx.bump("resonanceWithoutToll");
        const at = start + iv.fromS * 1000;
        // the press beside it — or an earlier one this interval re-states:
        // inside the official length, with no Resonance of this paladin the
        // log saw END between that press and this start (an aura removed
        // and up again is a new application, codex 85-tk-WIN-T155-1b)
        const endedBetween = (p: number): boolean =>
          runs.some(
            (r) =>
              r !== iv &&
              !r.inferredEnd &&
              start + r.toS * 1000 <= at &&
              start + r.toS * 1000 >= p,
          );
        if (
          presses.some(
            (p) =>
              Math.abs(p - at) <= PRESS_NEAR_MS ||
              (p < at && p >= at - RESONANCE_MS && !endedBetween(p)),
          )
        )
          continue;
        ctx.violate(
          "resonanceWithoutToll",
          specToString(u.spec),
          at,
          `${u.id}|${Math.round(at)}`,
          `${u.name} Divine Resonance ${iv.fromS.toFixed(1)}–${iv.toS.toFixed(1)}s with no Divine Toll press from ${RESONANCE_MS / 1000} s before it`,
        );
      }
    }

  if (!ctx.owner) return;
  const friendly = holders.filter(
    (h) =>
      h.u.reaction === ctx.owner.reaction &&
      isEnemyCdWindowSpell(TOLL, h.u.spec),
  );
  if (friendly.length === 0) return;
  for (const line of ctx.lines) {
    const m = TAGGED_LINE.exec(line);
    if (!m) continue;
    const s = +m[1]! * 60 + +m[2]!;
    const holder = friendly.find((h) =>
      h.runs.some((iv) => iv.fromS <= s - 1 && iv.toS >= s + 2),
    );
    if (!holder) continue;
    ctx.bump("resonanceTagMissing");
    if (line.includes(TAG)) continue;
    ctx.violate(
      "resonanceTagMissing",
      "untagged",
      start + s * 1000,
      `${holder.u.id}|${line.trim().slice(0, 120)}`,
      `inside ${holder.u.name}'s Divine Resonance, no tag`,
      line.trim().slice(0, 220),
    );
  }
}
