/**
 * killWindowFacts.ts — GH #31 ① (2026-09-02, user-ruled): the killability
 * gate-facts for kill-window rendering, ONE computation shared by the healer
 * view (healerOffenseAnalysis) and the DPS view (buildMatchContext's
 * <kill_windows> block) so the two can never disagree (CLAUDE.md
 * shared-predicate rule).
 *
 * Semantics settled on the 2026-09-02 value-gate examples: the three checks
 * gate the ACCUSATION side only — an unpunished [VULNERABLE] span is
 * accountable only when a canonical offensive CD was ready AND the target was
 * reachable; [KILL WINDOW] burst lines carry the same fields as FACTS, never
 * as a gate (measured: every killable=no burst in the smoke still killed its
 * target — sustained damage suffices once CDs were spent earlier).
 *
 * Predicate sources (all existing, imported never re-derived):
 *   ready    OFFENSIVE_CD_SPELL_IDS (spellDanger, chg9 canonical) ×
 *            extractMajorCooldowns × cdAvailableAt at span/burst start
 *   reach    getUnitPositionAtTime(LOS_SWEEP_GAP_MS) + canReachTargetAt
 *            (40 yd, LoS, fail OPEN — [ROOT]'s posture: sampling gaps must
 *            not manufacture unreachability)
 *   healer   enemyHealerCcWindows overlap (fact only, never a gate — a free
 *            healer does not make a target unkillable)
 */
import { CombatUnitClass, type ICombatUnit } from "@gladlog/parser-compat";

import { enemyHealerCcWindows } from "../analysis/candidates/cooldownTiming";
import {
  cdAvailableAt,
  cdIsProcOnly,
  cdLatestRemainingSeconds,
  cdMaybeAvailableAt,
  extractMajorCooldowns,
  isMeleeSpec,
} from "./cooldowns";
import { getUnitPositionAtTime } from "./losAnalysis";
import { CLOSE_RANGE_YARDS } from "./positionAnalysis";
import { LOS_SWEEP_GAP_MS } from "./positionSampling";
import { fmtTime, toRenderSecond } from "./renderGrid";
import { canReachTargetAt } from "./rootReachability";
import { OFFENSIVE_CD_SPELL_IDS } from "./spellDanger";
import { RANGE_HITBOX_SLACK_YD, spellRangeForCaster } from "./spellRange";
import { isDeadAt } from "./unitDeath";

/** Caster reach for "some attacker could reach the target" — the caster end
 * of the melee-12 / caster-40 convention [ROOT] uses. */
export const KW_REACH_YARDS = 40;

/** Evoker damage reach: Living Flame's talent-resolved range (25 yd; +5 with
 * Arcane Reach or the Preservation aura). */
const EVOKER_REACH_SPELL_ID = "361469";

/**
 * Whether friendly `f` at `pos` reaches `target` with damage at `tMs` — the
 * [ROOT] roles (melee `CLOSE_RANGE_YARDS` without a LoS test, casters with
 * one), and an Evoker's own 25/30 yd instead of 40. Until 2026-09-26 every
 * friendly got 40 yd: `reachable === true` is the ACCUSING side of this gate
 * (it makes the window accountable), so the flat 40 called a melee at 38 yd
 * or a Devastation Evoker at 35 yd able to deliver (talent impact audit).
 */
function friendlyReachesAt(
  f: ICombatUnit,
  pos: NonNullable<ReturnType<typeof getUnitPositionAtTime>>,
  target: ICombatUnit,
  tMs: number,
  zoneId: string | undefined,
): boolean | null {
  if (isMeleeSpec(f.spec))
    return canReachTargetAt(pos, target, tMs, zoneId, CLOSE_RANGE_YARDS, false);
  // an Evoker's own range plus the hitbox slack every reach claim adds
  // (RANGE_HITBOX_SLACK_YD, the spellReachToAccuse convention)
  const evokerRange =
    f.class === CombatUnitClass.Evoker
      ? spellRangeForCaster(f, EVOKER_REACH_SPELL_ID)
      : null;
  const yards =
    evokerRange !== null ? evokerRange + RANGE_HITBOX_SLACK_YD : KW_REACH_YARDS;
  return canReachTargetAt(pos, target, tMs, zoneId, yards, true);
}

/** A cooldown named on a kill-window line with the second it is about. */
export interface IKillWindowCdAt {
  name: string;
  /** seconds from match start (a whole second for `backInside`; a press's own
   * instant for the `pressed…` lists — both print through `fmtTime`) */
  atSeconds: number;
}

export interface IKillWindowGateFacts {
  /** Canonical friendly offensive CDs CERTAINLY ready (`cdAvailableAt`) at
   * the span/burst start's rendered second, holders dead by then left out.
   * The accusation side reads this list and nothing else. */
  readyOffCds: string[];
  /** The rendered second `readyOffCds` was sampled at — `toRenderSecond` of
   * the span start (ruling A46, 2026-09-30: the line prints that floored
   * second, so "ready" is read on it; the GH #31 start instant is unchanged
   * for reach and the healer-CC overlap). Absent on hand-built facts. */
  readyAtSecond?: number;
  /** GH #106 step 3: not certainly ready at that second but past the earliest
   * this cooldown has been seen back (`cdMaybeAvailableAt`) — "≤Ns" is the
   * [RES] ledger's own number (`cdLatestRemainingSeconds`). A FACT only: it
   * keeps the line from stating certain unavailability, never accuses. */
  maybeOffCds?: Array<{ name: string; withinSeconds: number }>;
  /** Presses of a team offensive CD in the start's own rendered second —
   * already spent at the sample (ruling A45), so invisible in `readyOffCds`. */
  pressedAtStart?: IKillWindowCdAt[];
  /** For a CD not certainly ready at the start: the first whole second inside
   * the span at which it is (`cdAvailableAt`), its holder still alive. */
  backInside?: IKillWindowCdAt[];
  /** Presses of a team offensive CD after the start's second, up to the end. */
  pressedInside?: IKillWindowCdAt[];
  /** Over the span's rendered seconds (ruling A61): true when a living
   * friendly could reach the target (range+LoS) on any of them; false only
   * when positions WERE recorded and none could on every second; null when
   * no position data. */
  reachable: boolean | null;
  /** Enemy healer sat in hard CC overlapping the rendered span. */
  healerLocked: boolean;
  /** The accusation gate: ready tool AND not provably unreachable. */
  accountable: boolean;
}

export interface IKillWindowFactsComputer {
  facts(
    target: ICombatUnit,
    fromSeconds: number,
    toSeconds: number,
  ): IKillWindowGateFacts;
}

/** Build once per round; `facts()` per rendered span/burst. */
export function createKillWindowFactsComputer(
  combat: { startTime: number; startInfo?: { zoneId?: string } },
  friends: ICombatUnit[],
  enemies: ICombatUnit[],
): IKillWindowFactsComputer {
  const startMs = combat.startTime;
  const teamCds = friends.flatMap((f) => {
    try {
      return extractMajorCooldowns(
        f,
        combat as Parameters<typeof extractMajorCooldowns>[1],
      )
        .filter((cd) => OFFENSIVE_CD_SPELL_IDS.has(String(cd.spellId)))
        .map((cd) => ({ cd, holder: f }));
    } catch {
      return [];
    }
  });
  let healerWindows: Array<{ fromSeconds: number; toSeconds: number }>;
  try {
    // The window derivation only reads units/timestamps off `combat`; the
    // narrow structural type here is what both call sites actually hold.
    healerWindows = enemyHealerCcWindows(
      friends,
      enemies,
      combat as Parameters<typeof enemyHealerCcWindows>[2],
    );
  } catch {
    healerWindows = [];
  }
  return {
    facts(
      target: ICombatUnit,
      fromSeconds: number,
      toSeconds: number,
    ): IKillWindowGateFacts {
      const tMs = startMs + fromSeconds * 1000;
      // F-C9 (ruling A46): readiness is sampled on the rendered second the
      // line prints, not at the fractional start — only the readiness
      // sample; reach (below) and the healer-CC overlap keep the raw span.
      const readyAtSecond = toRenderSecond(fromSeconds);
      // F-KW2 (triage sync-burst): a friendly dead at the instant holds no
      // cooldown — 539b6ed0's [VULNERABLE] 1:23 accused the team of holding
      // Incarnation for a Druid who died at 67.0. `isDeadAt` is the one
      // dead-at predicate (missed-sync-window's ready filter and [RES] read
      // the same one). It filters every clause: a dead holder's cooldown is
      // neither ready, nor maybe back, nor back inside.
      const living = teamCds.filter(({ holder }) => !isDeadAt(holder, tMs));
      const certain = living.filter(({ cd }) =>
        cdAvailableAt(cd, readyAtSecond),
      );
      const readyOffCds = certain.map(({ cd }) => cd.spellName);
      const notCertain = living.filter((x) => !certain.includes(x));
      // F-C8 (GH #106 step 3): "no CD ready" must not state certain
      // unavailability for a cooldown combat shortens.
      const maybeOffCds = notCertain
        .filter(({ cd }) => cdMaybeAvailableAt(cd, readyAtSecond))
        .map(({ cd }) => ({
          name: cd.spellName,
          withinSeconds: cdLatestRemainingSeconds(cd, readyAtSecond),
        }));
      // F-KW1: the first WHOLE second inside the span at which a CD that was
      // not certainly ready is — the same `cdAvailableAt` on the same grid.
      const lastSecond = Math.floor(toSeconds);
      const backInside: IKillWindowCdAt[] = [];
      for (const { cd, holder } of notCertain)
        for (let s = readyAtSecond + 1; s <= lastSecond; s++) {
          if (isDeadAt(holder, startMs + s * 1000)) break;
          if (cdAvailableAt(cd, s)) {
            backInside.push({ name: cd.spellName, atSeconds: s });
            break;
          }
        }
      // F-KW1 / F-C12: what the team pressed. A press in the start's own
      // rendered second is spent at the sample (A45) and would otherwise be
      // invisible; everything later, up to the span end, is "inside".
      // (a proc-only entry has no button: its activations are not presses)
      const presses = teamCds
        .filter(({ cd }) => !cdIsProcOnly(cd))
        .flatMap(({ cd }) =>
          cd.casts
            .filter(
              (c) =>
                c.timeSeconds >= readyAtSecond && c.timeSeconds <= toSeconds,
            )
            .map((c) => ({ name: cd.spellName, atSeconds: c.timeSeconds })),
        )
        .sort((a, b) => a.atSeconds - b.atSeconds);
      const pressedAtStart = presses.filter(
        (p) => toRenderSecond(p.atSeconds) === readyAtSecond,
      );
      const pressedInside = presses.filter(
        (p) => toRenderSecond(p.atSeconds) > readyAtSecond,
      );
      // Fail OPEN: reachable stays null until a recorded position pair
      // actually disproves reach for EVERY sampled friendly.
      //
      // position F-K1 (ruling A61 = A, 2026-09-30): over the WHOLE span, one
      // rendered second at a time — reachable as soon as any living friendly
      // reaches on any second. The single sample at the span start called
      // 539fef93's 1:34–1:50 "target unreachable" with the owner 3.0 yd from
      // the target at 1:37. A friendly dead at a second (`isDeadAt`) is not
      // sampled there: a corpse keeps its last position.
      let reachable: boolean | null = null;
      const zoneId = combat.startInfo?.zoneId;
      scan: for (let s = readyAtSecond; s <= lastSecond; s++) {
        const sMs = startMs + s * 1000;
        for (const f of friends) {
          if (isDeadAt(f, sMs)) continue;
          const pos = getUnitPositionAtTime(f, sMs, LOS_SWEEP_GAP_MS);
          if (!pos) continue;
          if (friendlyReachesAt(f, pos, target, sMs, zoneId) !== false) {
            reachable = true;
            break scan;
          }
          reachable = false;
        }
      }
      return {
        readyOffCds,
        readyAtSecond,
        maybeOffCds,
        pressedAtStart,
        backInside,
        pressedInside,
        reachable,
        healerLocked: healerWindows.some(
          (h) => h.fromSeconds <= toSeconds && h.toSeconds >= fromSeconds,
        ),
        accountable: readyOffCds.length > 0 && reachable !== false,
      };
    },
  };
}

/** `X ≤Ns、Y ≤Ns` — the maybe-ready list, one wording for the suffix and the
 * acquittal. Lists on these lines are joined with "、", like the ready list:
 * offensive cooldown names carry commas (Invoke Xuen, the White Tiger; Storm,
 * Earth, and Fire). */
function maybeClause(f: IKillWindowGateFacts): string {
  return (f.maybeOffCds ?? [])
    .map((m) => `${m.name} ≤${m.withinSeconds}s`)
    .join("、");
}

/**
 * Render the shared facts suffix — one wording for both views so the gate
 * (and any future re-parse) sees identical text.
 *
 * One grammar (triage 2026-09-29: sync-burst F-KW1, res-readiness F-C8 / F-C9
 * / F-C12 — the three had specified competing rewrites of the same clause):
 *
 *   team offensive CDs ready at M:SS: <certain list | none>[ (<clauses>)]
 *
 * M:SS is the sampled second, so "none" no longer reads as "none for the
 * whole window". The parenthesis holds, in this order and only when
 * non-empty, joined by "; ":
 *   may already be back: X ≤Ns     GH #106 step 3 (F-C8)
 *   pressed at start: X M:SS       spent in the start's own second (F-C12)
 *   back inside: X M:SS            came off cooldown inside the span (F-KW1)
 *   pressed inside: X M:SS         pressed after the start's second (F-KW1)
 * Hand-built facts without `readyAtSecond` keep the legacy wording.
 */
export function killWindowFactsSuffix(f: IKillWindowGateFacts): string {
  const parts: string[] = [];
  if (f.readyAtSecond === undefined) {
    parts.push(
      f.readyOffCds.length > 0
        ? `team offensive CDs ready: ${f.readyOffCds.join("、")}`
        : "no team offensive CD ready",
    );
  } else {
    const at = (list: IKillWindowCdAt[] | undefined) =>
      (list ?? []).map((x) => `${x.name} ${fmtTime(x.atSeconds)}`).join("、");
    const clauses = [
      ["may already be back", maybeClause(f)],
      ["pressed at start", at(f.pressedAtStart)],
      ["back inside", at(f.backInside)],
      ["pressed inside", at(f.pressedInside)],
    ]
      .filter(([, body]) => body !== "")
      .map(([label, body]) => `${label}: ${body}`);
    parts.push(
      `team offensive CDs ready at ${fmtTime(f.readyAtSecond)}: ${
        f.readyOffCds.length > 0 ? f.readyOffCds.join("、") : "none"
      }${clauses.length > 0 ? ` (${clauses.join("; ")})` : ""}`,
    );
  }
  if (f.reachable === false)
    parts.push("target unreachable (positions recorded)");
  if (f.healerLocked) parts.push("enemy healer hard-CC'd in window");
  return parts.join("; ");
}

/** Why an unpunished span is NOT accountable — rendered instead of the
 * "never punished" accusation when the gate fails. */
export function killWindowAcquittal(f: IKillWindowGateFacts): string {
  const reasons: string[] = [];
  // F-C8: with a maybe-ready cooldown the acquittal is "none CERTAINLY
  // ready" — the gate itself (`accountable`) still reads the certain list.
  const maybe = maybeClause(f);
  if (f.readyOffCds.length === 0)
    reasons.push(
      maybe
        ? `no offensive CD certainly ready (may already be back: ${maybe})`
        : "no offensive CD was ready",
    );
  if (f.reachable === false) reasons.push("target unreachable");
  return reasons.join(" and ");
}

/** The lean DPS-view lines (<kill_windows> block, GH #31 ③): burst-anchored
 * [KILL WINDOW] facts plus gated [VULNERABLE] accusations, same spans and
 * same facts as the healer view, without the healer-only owner fields. */
export function buildDpsKillWindowLines(
  offensiveWindows: Array<{
    targetUnitId: string;
    targetName: string;
    targetSpec: string;
    fromSeconds: number;
    toSeconds: number;
    friendlyDamageInWindow: number;
    bursts: Array<{ fromSeconds: number; toSeconds: number; damage: number }>;
  }>,
  enemies: ICombatUnit[],
  computer: IKillWindowFactsComputer,
): string[] {
  const lines: string[] = [];
  for (const w of offensiveWindows) {
    const target = enemies.find((e) => e.id === w.targetUnitId);
    if (!target) continue;
    if (w.bursts.length > 0) {
      for (const b of w.bursts) {
        const f = computer.facts(target, b.fromSeconds, b.toSeconds);
        lines.push(
          `  [KILL WINDOW] ${fmtTime(b.fromSeconds)}–${fmtTime(b.toSeconds)} on ${w.targetSpec} (${w.targetName}): team burst ${(b.damage / 1000).toFixed(0)}k (defenseless ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)}); ${killWindowFactsSuffix(f)}.`,
        );
      }
    } else {
      const f = computer.facts(target, w.fromSeconds, w.toSeconds);
      const verdict = f.accountable
        ? "never punished"
        : `not punished — not accountable (${killWindowAcquittal(f)})`;
      lines.push(
        `  [VULNERABLE] ${fmtTime(w.fromSeconds)}–${fmtTime(w.toSeconds)} on ${w.targetSpec} (${w.targetName}): no major defensives, ${verdict} (team damage ${(w.friendlyDamageInWindow / 1000).toFixed(0)}k total); ${killWindowFactsSuffix(f)}.`,
      );
    }
  }
  return lines;
}

